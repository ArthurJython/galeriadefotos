import os
import secrets
import sqlite3
import time
import uuid
from flask import (
    Flask, request, jsonify, render_template, session, redirect, send_file
)
from werkzeug.security import generate_password_hash, check_password_hash
import filetype

app = Flask(__name__)


def _load_secret_key():
    path = os.path.join(os.path.dirname(__file__), ".secret_key")
    if os.path.exists(path):
        with open(path, "r") as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(path, "w") as f:
        f.write(key)
    os.chmod(path, 0o600)
    return key


app.secret_key = _load_secret_key()

app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True
# app.config["SESSION_COOKIE_SECURE"] = True  # produção HTTPS

# 51 MB no request (50 MB do arquivo + ~1 MB de overhead multipart)
app.config["MAX_CONTENT_LENGTH"] = 51 * 1024 * 1024

MAX_UPLOAD_BYTES = 50 * 1024 * 1024

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "users.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Whitelist de MIME (verificado por magic bytes, não pelo cliente)
ALLOWED_MIMES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/webm",
}

LOGIN_ATTEMPTS = {}
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 60

DUMMY_HASH = generate_password_hash("nunca-usado-apenas-para-tempo")


# ---------- Seed ----------
# Senhas de DEMONSTRAÇÃO. Não são segredo.
SEED_USERS = [
    ("alice", "AliceSenhaForte!2026"),
    ("bruno", "BrunoSenhaForte!2026"),
    ("carla", "CarlaSenhaForte!2026"),
]

# name, description, is_special, num_photos
ALBUMS_BY_USER = {
    "alice": [
        ("Verão 2025",      "Os melhores dias na praia",      1, 6),
        ("Família",         "Momentos com quem amamos",       1, 5),
        ("Viagem Itália",   "Roma, Florença e Veneza",        0, 4),
        ("Trabalho",        "Eventos e conferências",         0, 3),
    ],
    "bruno": [
        ("Montanha",        "Trilhas e picos",                1, 4),
        ("Urban",           "A cidade em detalhes",           0, 4),
        ("Animais",         "Meus companheiros",              1, 3),
        ("Viagens",         "Pelo mundo afora",               0, 4),
    ],
    "carla": [
        ("Praia 2026",      "Ondas e sol",                    1, 4),
        ("Flores",          "Jardim de casa",                 0, 3),
        ("Comida",          "Receitas favoritas",             0, 3),
        ("Amigos",          "Risadas e encontros",            1, 4),
    ],
}

# Vídeos de exemplo (Google sample bucket, público, sem chave, com Range)
SAMPLE_VIDEOS = [
    ("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
     "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg"),
    ("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
     "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg"),
    ("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
     "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerBlazes.jpg"),
]


# ---------- Banco ----------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS albums (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            cover_url TEXT,
            is_special INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS medias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            album_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('photo','video')),
            url TEXT,
            file_path TEXT,
            mime_type TEXT,
            size_bytes INTEGER,
            thumb_url TEXT,
            title TEXT,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (album_id) REFERENCES albums(id)
        )
    """)

    for username, password in SEED_USERS:
        c.execute("SELECT id FROM users WHERE username = ?", (username,))
        row = c.fetchone()
        if row:
            user_id = row[0]
        else:
            c.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, generate_password_hash(password)),
            )
            user_id = c.lastrowid

        c.execute("SELECT COUNT(*) FROM albums WHERE user_id = ?", (user_id,))
        if c.fetchone()[0] == 0:
            for name, desc, is_special, n in ALBUMS_BY_USER.get(username, []):
                slug = f"{username}-{name.lower().replace(' ', '-')}"
                cover = f"https://picsum.photos/seed/{slug}-cover/800/600"
                c.execute(
                    "INSERT INTO albums (user_id, name, description, cover_url, is_special) VALUES (?, ?, ?, ?, ?)",
                    (user_id, name, desc, cover, is_special),
                )
                album_id = c.lastrowid

                # Fotos (externas, Picsum)
                for i in range(n):
                    url = f"https://picsum.photos/seed/{slug}-{i}/1200/1200"
                    is_fav = 1 if (is_special and i < 2) else 0
                    c.execute(
                        "INSERT INTO medias (album_id, type, url, title, is_favorite) "
                        "VALUES (?, 'photo', ?, ?, ?)",
                        (album_id, url, f"Foto {i+1}", is_fav),
                    )

                # Vídeo de exemplo (externo) em álbuns especiais
                if is_special:
                    vid_url, poster = SAMPLE_VIDEOS[album_id % len(SAMPLE_VIDEOS)]
                    c.execute(
                        "INSERT INTO medias (album_id, type, url, thumb_url, title, is_favorite) "
                        "VALUES (?, 'video', ?, ?, ?, 1)",
                        (album_id, vid_url, poster, "Vídeo do álbum"),
                    )

    conn.commit()
    conn.close()


def get_user(username):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT username, password_hash FROM users WHERE username = ?", (username,))
    row = c.fetchone()
    conn.close()
    return {"username": row[0], "password_hash": row[1]} if row else None


def media_row_to_dict(row):
    """row: id, type, url, file_path, thumb_url, title, is_favorite"""
    id_, type_, url_, file_path, thumb_url, title, is_fav = row
    display_url = f"/api/media/{id_}/raw" if file_path else url_
    return {
        "id": id_,
        "type": type_,
        "url": display_url,
        "thumb_url": thumb_url,
        "title": title,
        "is_favorite": bool(is_fav),
        "is_upload": bool(file_path),
    }


# ---------- Rate limit ----------
def is_rate_limited(ip):
    now = time.time()
    attempts = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now - t < WINDOW_SECONDS]
    LOGIN_ATTEMPTS[ip] = attempts
    return len(attempts) >= MAX_ATTEMPTS


def register_attempt(ip):
    LOGIN_ATTEMPTS.setdefault(ip, []).append(time.time())


def require_login():
    return "username" not in session


def owns_album(cursor, album_id, username):
    cursor.execute("""
        SELECT a.id FROM albums a
        JOIN users u ON u.id = a.user_id
        WHERE a.id = ? AND u.username = ?
    """, (album_id, username))
    return cursor.fetchone() is not None


# ---------- Rotas de página ----------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/galeria")
def galeria():
    if require_login():
        return redirect("/")
    return render_template("galeria.html", username=session["username"])


# ---------- Auth ----------
@app.route("/api/auth/login", methods=["POST"])
def login():
    ip = request.remote_addr or "unknown"
    if is_rate_limited(ip):
        return jsonify({"error": "Muitas tentativas."}), 429

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        register_attempt(ip)
        return jsonify({"error": "Usuário ou senha inválidos."}), 401

    user = get_user(username)
    stored_hash = user["password_hash"] if user else DUMMY_HASH
    password_ok = check_password_hash(stored_hash, password)

    if user and password_ok:
        session["username"] = user["username"]
        return jsonify({"username": user["username"], "message": "Login OK"}), 200

    register_attempt(ip)
    return jsonify({"error": "Usuário ou senha inválidos."}), 401


@app.route("/api/auth/me")
def me():
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401
    return jsonify({"username": session["username"]}), 200


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True}), 200


# ---------- Álbuns ----------
@app.route("/api/albums")
def list_albums():
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT a.id, a.name, a.description, a.cover_url, a.is_special,
               (SELECT COUNT(*) FROM medias WHERE album_id = a.id) AS count
        FROM albums a
        JOIN users u ON u.id = a.user_id
        WHERE u.username = ?
        ORDER BY a.is_special DESC, a.id ASC
    """, (session["username"],))
    rows = c.fetchall()
    conn.close()

    return jsonify([
        {
            "id": r[0], "name": r[1], "description": r[2] or "",
            "cover_url": r[3], "is_special": bool(r[4]), "fotos_count": r[5],
        }
        for r in rows
    ])


@app.route("/api/albums/<int:album_id>/medias")
def list_medias(album_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT a.id, a.name FROM albums a
        JOIN users u ON u.id = a.user_id
        WHERE a.id = ? AND u.username = ?
    """, (album_id, session["username"]))
    album = c.fetchone()
    if not album:
        conn.close()
        return jsonify({"error": "Álbum não encontrado"}), 404

    c.execute("""
        SELECT id, type, url, file_path, thumb_url, title, is_favorite
        FROM medias WHERE album_id = ?
        ORDER BY type DESC, id
    """, (album_id,))
    rows = c.fetchall()
    conn.close()

    return jsonify({
        "album": {"id": album[0], "name": album[1]},
        "medias": [media_row_to_dict(r) for r in rows],
    })


@app.route("/api/medias/favorites")
def list_favorites():
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT m.id, m.type, m.url, m.file_path, m.thumb_url, m.title, m.is_favorite, a.name
        FROM medias m
        JOIN albums a ON a.id = m.album_id
        JOIN users u ON u.id = a.user_id
        WHERE u.username = ? AND m.is_favorite = 1
        ORDER BY m.id
    """, (session["username"],))
    rows = c.fetchall()
    conn.close()

    out = []
    for r in rows:
        d = media_row_to_dict(r[:7])
        d["album_name"] = r[7]
        out.append(d)
    return jsonify(out)


# ---------- Upload ----------
@app.route("/api/albums/<int:album_id>/upload", methods=["POST"])
def upload_media(album_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if not owns_album(c, album_id, session["username"]):
        conn.close()
        return jsonify({"error": "Álbum não encontrado"}), 404

    if "file" not in request.files:
        conn.close()
        return jsonify({"error": "Nenhum arquivo enviado"}), 400

    f = request.files["file"]
    if not f or f.filename == "":
        conn.close()
        return jsonify({"error": "Arquivo inválido"}), 400

    # Magic bytes (não confia no Content-Type do cliente)
    header = f.stream.read(261)
    f.stream.seek(0)
    kind = filetype.guess(header)
    if not kind or kind.mime not in ALLOWED_MIMES:
        conn.close()
        return jsonify({
            "error": "Tipo não aceito. Envie jpg/png/gif/webp ou mp4/webm."
        }), 400

    media_type = "photo" if kind.mime.startswith("image/") else "video"

    # Salva com nome aleatório (evita path traversal e colisão)
    filename = f"{uuid.uuid4().hex}.{kind.extension}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    f.save(filepath)

    size_bytes = os.path.getsize(filepath)
    if size_bytes > MAX_UPLOAD_BYTES:
        os.remove(filepath)
        conn.close()
        return jsonify({"error": "Arquivo muito grande (máximo 50 MB)"}), 413

    title = (request.form.get("title") or "").strip()[:100] or f.filename[:100]

    c.execute("""
        INSERT INTO medias
            (album_id, type, url, file_path, mime_type, size_bytes, thumb_url, title, is_favorite)
        VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, 0)
    """, (album_id, media_type, filename, kind.mime, size_bytes, title))
    new_id = c.lastrowid
    conn.commit()
    conn.close()

    return jsonify({
        "id": new_id,
        "type": media_type,
        "url": f"/api/media/{new_id}/raw",
        "title": title,
        "mime_type": kind.mime,
        "size_bytes": size_bytes,
    }), 201


@app.route("/api/media/<int:media_id>/raw")
def serve_media(media_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT m.file_path, m.mime_type, m.type
        FROM medias m
        JOIN albums a ON a.id = m.album_id
        JOIN users u ON u.id = a.user_id
        WHERE m.id = ? AND u.username = ?
    """, (media_id, session["username"]))
    row = c.fetchone()
    conn.close()

    if not row or not row[0]:
        return jsonify({"error": "Mídia não encontrada"}), 404

    path = os.path.join(UPLOAD_DIR, row[0])
    if not os.path.isfile(path):
        return jsonify({"error": "Arquivo não encontrado"}), 404

    # conditional=True → suporta Range (streaming de vídeo)
    return send_file(
        path,
        mimetype=row[1] or "application/octet-stream",
        conditional=True,
        as_attachment=False,
    )


@app.errorhandler(413)
def request_too_large(e):
    return jsonify({"error": "Arquivo muito grande (máximo 50 MB)"}), 413


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)