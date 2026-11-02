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
app.config["MAX_CONTENT_LENGTH"] = 51 * 1024 * 1024

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "users.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_MIMES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/webm",
}

LOGIN_ATTEMPTS = {}
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 60
DUMMY_HASH = generate_password_hash("nunca-usado-apenas-para-tempo")

SEED_USERS = [
    ("alice", "AliceSenhaForte!2026"),
    ("bruno", "BrunoSenhaForte!2026"),
    ("carla", "CarlaSenhaForte!2026"),
]

ALBUMS_BY_USER = {
    "alice": [
        ("Verão 2025",    "Os melhores dias na praia",   1),
        ("Família",       "Momentos com quem amamos",    1),
        ("Viagem Itália", "Roma, Florença e Veneza",     0),
        ("Trabalho",      "Eventos e conferências",      0),
    ],
    "bruno": [
        ("Montanha", "Trilhas e picos",        1),
        ("Urban",    "A cidade em detalhes",   0),
        ("Animais",  "Meus companheiros",      1),
        ("Natureza", "Verde por todo lado",    0),
    ],
    "carla": [
        ("Praia 2026", "Ondas e sol",         1),
        ("Flores",     "Jardim de casa",      0),
        ("Comida",     "Receitas favoritas",  0),
        ("Amigos",     "Risadas e encontros", 1),
    ],
}


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
            is_special INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    # album_id NULL = foto/vídeo solto (sem álbum). user_id sempre obrigatório.
    c.execute("""
        CREATE TABLE IF NOT EXISTS medias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            album_id INTEGER,
            type TEXT NOT NULL CHECK(type IN ('photo','video')),
            file_path TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER,
            title TEXT,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id),
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
            for name, desc, is_special in ALBUMS_BY_USER.get(username, []):
                c.execute(
                    "INSERT INTO albums (user_id, name, description, is_special) "
                    "VALUES (?, ?, ?, ?)",
                    (user_id, name, desc, is_special),
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


def media_to_dict(row):
    """row: id, type, file_path, title, is_favorite, album_id, album_name"""
    id_, type_, file_path, title, is_fav, album_id, album_name = row
    return {
        "id": id_,
        "type": type_,
        "url": f"/api/media/{id_}/raw",
        "title": title,
        "is_favorite": bool(is_fav),
        "album_id": album_id,
        "album_name": album_name,
    }


def is_rate_limited(ip):
    now = time.time()
    attempts = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now - t < WINDOW_SECONDS]
    LOGIN_ATTEMPTS[ip] = attempts
    return len(attempts) >= MAX_ATTEMPTS


def register_attempt(ip):
    LOGIN_ATTEMPTS.setdefault(ip, []).append(time.time())


def require_login():
    return "username" not in session


def current_user_id(cursor):
    cursor.execute("SELECT id FROM users WHERE username = ?", (session["username"],))
    row = cursor.fetchone()
    return row[0] if row else None


def user_owns_album(cursor, album_id, user_id):
    cursor.execute("SELECT 1 FROM albums WHERE id = ? AND user_id = ?", (album_id, user_id))
    return cursor.fetchone() is not None


def user_owns_media(cursor, media_id, user_id):
    cursor.execute("SELECT 1 FROM medias WHERE id = ? AND user_id = ?", (media_id, user_id))
    return cursor.fetchone() is not None


def score_text(text, query):
    if not text or not query:
        return 0
    t = text.lower()
    q = query.lower()
    if t == q:
        return 100
    if t.startswith(q):
        return 80
    if f" {q} " in f" {t} ":
        return 60
    if q in t:
        return 40
    return 0


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
        SELECT a.id, a.name, a.description, a.is_special,
               (SELECT COUNT(*) FROM medias WHERE album_id = a.id) AS count,
               (SELECT id FROM medias WHERE album_id = a.id AND type = 'photo'
                ORDER BY is_favorite DESC, id ASC LIMIT 1) AS cover_id
        FROM albums a
        JOIN users u ON u.id = a.user_id
        WHERE u.username = ?
        ORDER BY a.is_special DESC, a.id ASC
    """, (session["username"],))
    rows = c.fetchall()
    conn.close()

    return jsonify([
        {
            "id": r[0],
            "name": r[1],
            "description": r[2] or "",
            "is_special": bool(r[3]),
            "fotos_count": r[4],
            "cover_url": f"/api/media/{r[5]}/raw" if r[5] else None,
        }
        for r in rows
    ])


@app.route("/api/albums/<int:album_id>", methods=["PATCH"])
def update_album(album_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    if not uid or not user_owns_album(c, album_id, uid):
        conn.close()
        return jsonify({"error": "Álbum não encontrado"}), 404

    data = request.get_json(silent=True) or {}
    updates = []
    params = []

    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name or len(name) > 80:
            conn.close()
            return jsonify({"error": "Nome inválido"}), 400
        updates.append("name = ?")
        params.append(name)

    if "description" in data:
        desc = (data.get("description") or "").strip()[:300]
        updates.append("description = ?")
        params.append(desc)

    if "is_special" in data:
        updates.append("is_special = ?")
        params.append(1 if data["is_special"] else 0)

    if not updates:
        conn.close()
        return jsonify({"error": "Nada para atualizar"}), 400

    params.append(album_id)
    c.execute(f"UPDATE albums SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()
    conn.close()
    return jsonify({"ok": True}), 200


@app.route("/api/albums/<int:album_id>", methods=["DELETE"])
def delete_album(album_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    if not uid or not user_owns_album(c, album_id, uid):
        conn.close()
        return jsonify({"error": "Álbum não encontrado"}), 404

    # Mídias do álbum viram soltas
    c.execute("UPDATE medias SET album_id = NULL WHERE album_id = ?", (album_id,))
    c.execute("DELETE FROM albums WHERE id = ?", (album_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True}), 200


# ---------- Mídias ----------
def _fetch_medias(cursor, user_id, album_id_filter, only_null=False):
    if only_null:
        cursor.execute("""
            SELECT m.id, m.type, m.file_path, m.title, m.is_favorite, NULL, NULL
            FROM medias m
            WHERE m.user_id = ? AND m.album_id IS NULL
            ORDER BY m.is_favorite DESC, m.id DESC
        """, (user_id,))
    else:
        cursor.execute("""
            SELECT m.id, m.type, m.file_path, m.title, m.is_favorite,
                   m.album_id, a.name
            FROM medias m
            LEFT JOIN albums a ON a.id = m.album_id
            WHERE m.user_id = ? AND m.album_id = ?
            ORDER BY m.type DESC, m.is_favorite DESC, m.id
        """, (user_id, album_id_filter))
    return [media_to_dict(r) for r in cursor.fetchall()]


@app.route("/api/albums/<int:album_id>/medias")
def list_album_medias(album_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    if not uid or not user_owns_album(c, album_id, uid):
        conn.close()
        return jsonify({"error": "Álbum não encontrado"}), 404

    c.execute("SELECT name FROM albums WHERE id = ?", (album_id,))
    album_name = c.fetchone()[0]

    medias = _fetch_medias(c, uid, album_id)
    conn.close()

    return jsonify({
        "album": {"id": album_id, "name": album_name},
        "medias": medias,
    })


@app.route("/api/medias/loose")
def list_loose_medias():
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    if not uid:
        conn.close()
        return jsonify({"error": "Não autenticado"}), 401

    medias = _fetch_medias(c, uid, None, only_null=True)
    conn.close()
    return jsonify({"medias": medias})


@app.route("/api/medias/favorites")
def list_favorites():
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    c.execute("""
        SELECT m.id, m.type, m.file_path, m.title, m.is_favorite, m.album_id, a.name
        FROM medias m
        LEFT JOIN albums a ON a.id = m.album_id
        WHERE m.user_id = ? AND m.is_favorite = 1
        ORDER BY m.type DESC, m.id DESC
    """, (uid,))
    rows = c.fetchall()
    conn.close()
    return jsonify([media_to_dict(r) for r in rows])


# ---------- Upload ----------
def _save_upload(cursor, user_id, album_id):
    """Retorna (dict, status). album_id pode ser None (foto solta)."""
    if "file" not in request.files:
        return {"error": "Nenhum arquivo enviado"}, 400

    f = request.files["file"]
    if not f or f.filename == "":
        return {"error": "Arquivo inválido"}, 400

    header = f.stream.read(261)
    f.stream.seek(0)
    kind = filetype.guess(header)
    if not kind or kind.mime not in ALLOWED_MIMES:
        return {"error": "Tipo não aceito. Use jpg/png/gif/webp ou mp4/webm."}, 400

    media_type = "photo" if kind.mime.startswith("image/") else "video"
    filename = f"{uuid.uuid4().hex}.{kind.extension}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    f.save(filepath)

    size_bytes = os.path.getsize(filepath)
    if size_bytes > MAX_UPLOAD_BYTES:
        os.remove(filepath)
        return {"error": "Arquivo muito grande (máximo 50 MB)"}, 413

    title = (request.form.get("title") or "").strip()[:100] or f.filename[:100]

    cursor.execute("""
        INSERT INTO medias
            (user_id, album_id, type, file_path, mime_type, size_bytes, title, is_favorite)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    """, (user_id, album_id, media_type, filename, kind.mime, size_bytes, title))
    new_id = cursor.lastrowid

    return {
        "id": new_id,
        "type": media_type,
        "url": f"/api/media/{new_id}/raw",
        "title": title,
        "album_id": album_id,
    }, 201


@app.route("/api/albums/<int:album_id>/upload", methods=["POST"])
def upload_to_album(album_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    if not uid or not user_owns_album(c, album_id, uid):
        conn.close()
        return jsonify({"error": "Álbum não encontrado"}), 404

    payload, status = _save_upload(c, uid, album_id)
    if status == 201:
        conn.commit()
    else:
        conn.rollback()
    conn.close()
    return jsonify(payload), status


@app.route("/api/medias/loose/upload", methods=["POST"])
def upload_loose():
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    if not uid:
        conn.close()
        return jsonify({"error": "Não autenticado"}), 401

    payload, status = _save_upload(c, uid, None)
    if status == 201:
        conn.commit()
    else:
        conn.rollback()
    conn.close()
    return jsonify(payload), status


@app.route("/api/medias/<int:media_id>", methods=["PATCH"])
def update_media(media_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    if not uid or not user_owns_media(c, media_id, uid):
        conn.close()
        return jsonify({"error": "Mídia não encontrada"}), 404

    data = request.get_json(silent=True) or {}
    updates = []
    params = []

    if "title" in data:
        title = (data.get("title") or "").strip()[:100]
        updates.append("title = ?")
        params.append(title)

    if "is_favorite" in data:
        updates.append("is_favorite = ?")
        params.append(1 if data["is_favorite"] else 0)

    if "album_id" in data:
        new_album = data["album_id"]
        if new_album is not None:
            if not user_owns_album(c, new_album, uid):
                conn.close()
                return jsonify({"error": "Álbum de destino não encontrado"}), 404
        updates.append("album_id = ?")
        params.append(new_album)

    if not updates:
        conn.close()
        return jsonify({"error": "Nada para atualizar"}), 400

    params.append(media_id)
    c.execute(f"UPDATE medias SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()
    conn.close()
    return jsonify({"ok": True}), 200


@app.route("/api/medias/<int:media_id>/replace", methods=["POST"])
def replace_media(media_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    if not uid or not user_owns_media(c, media_id, uid):
        conn.close()
        return jsonify({"error": "Mídia não encontrada"}), 404

    if "file" not in request.files:
        conn.close()
        return jsonify({"error": "Nenhum arquivo enviado"}), 400

    f = request.files["file"]
    if not f or f.filename == "":
        conn.close()
        return jsonify({"error": "Arquivo inválido"}), 400

    header = f.stream.read(261)
    f.stream.seek(0)
    kind = filetype.guess(header)
    if not kind or kind.mime not in ALLOWED_MIMES:
        conn.close()
        return jsonify({"error": "Tipo não aceito."}), 400

    # Busca arquivo antigo para apagar
    c.execute("SELECT file_path, type FROM medias WHERE id = ?", (media_id,))
    old_path, old_type = c.fetchone()
    new_type = "photo" if kind.mime.startswith("image/") else "video"

    filename = f"{uuid.uuid4().hex}.{kind.extension}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    f.save(filepath)

    size_bytes = os.path.getsize(filepath)
    if size_bytes > MAX_UPLOAD_BYTES:
        os.remove(filepath)
        conn.close()
        return jsonify({"error": "Arquivo muito grande (máximo 50 MB)"}), 413

    c.execute("""
        UPDATE medias SET file_path = ?, mime_type = ?, size_bytes = ?, type = ?
        WHERE id = ?
    """, (filename, kind.mime, size_bytes, new_type, media_id))
    conn.commit()

    # Remove arquivo antigo do disco
    try:
        old_full = os.path.join(UPLOAD_DIR, old_path)
        if os.path.isfile(old_full):
            os.remove(old_full)
    except Exception:
        pass

    conn.close()
    return jsonify({"ok": True, "type": new_type}), 200


@app.route("/api/medias/<int:media_id>", methods=["DELETE"])
def delete_media(media_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    if not uid or not user_owns_media(c, media_id, uid):
        conn.close()
        return jsonify({"error": "Mídia não encontrada"}), 404

    c.execute("SELECT file_path FROM medias WHERE id = ?", (media_id,))
    row = c.fetchone()
    c.execute("DELETE FROM medias WHERE id = ?", (media_id,))
    conn.commit()
    conn.close()

    try:
        if row and row[0]:
            p = os.path.join(UPLOAD_DIR, row[0])
            if os.path.isfile(p):
                os.remove(p)
    except Exception:
        pass

    return jsonify({"ok": True}), 200


@app.route("/api/media/<int:media_id>/raw")
def serve_media(media_id):
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)
    c.execute("""
        SELECT file_path, mime_type FROM medias WHERE id = ? AND user_id = ?
    """, (media_id, uid))
    row = c.fetchone()
    conn.close()

    if not row:
        return jsonify({"error": "Mídia não encontrada"}), 404

    path = os.path.join(UPLOAD_DIR, row[0])
    if not os.path.isfile(path):
        return jsonify({"error": "Arquivo não encontrado"}), 404

    return send_file(
        path,
        mimetype=row[1] or "application/octet-stream",
        conditional=True,
        as_attachment=False,
    )


# ---------- Busca global (server-side, com score) ----------
@app.route("/api/search")
def search():
    if require_login():
        return jsonify({"error": "Não autenticado"}), 401

    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"albums": [], "medias": [], "query": ""})

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = current_user_id(c)

    c.execute("""
        SELECT a.id, a.name, a.description, a.is_special,
               (SELECT COUNT(*) FROM medias WHERE album_id = a.id),
               (SELECT id FROM medias WHERE album_id = a.id AND type='photo'
                ORDER BY is_favorite DESC, id LIMIT 1)
        FROM albums a WHERE a.user_id = ?
    """, (uid,))
    album_rows = c.fetchall()

    c.execute("""
        SELECT m.id, m.type, m.file_path, m.title, m.is_favorite, m.album_id, a.name
        FROM medias m LEFT JOIN albums a ON a.id = m.album_id
        WHERE m.user_id = ?
    """, (uid,))
    media_rows = c.fetchall()
    conn.close()

    albums_out = []
    for r in album_rows:
        s = max(score_text(r[1], q), int(score_text(r[2], q) * 0.6))
        if s > 0:
            albums_out.append({
                "id": r[0], "name": r[1], "description": r[2] or "",
                "is_special": bool(r[3]), "fotos_count": r[4],
                "cover_url": f"/api/media/{r[5]}/raw" if r[5] else None,
                "score": s,
            })

    medias_out = []
    for r in media_rows:
        s = score_text(r[3], q)
        if s > 0:
            d = media_to_dict(r)
            d["score"] = s
            medias_out.append(d)

    albums_out.sort(key=lambda x: x["score"], reverse=True)
    medias_out.sort(key=lambda x: x["score"], reverse=True)

    return jsonify({
        "albums": albums_out[:50],
        "medias": medias_out[:60],
        "query": q,
    })


@app.errorhandler(413)
def request_too_large(e):
    return jsonify({"error": "Arquivo muito grande (máximo 50 MB)"}), 413


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)