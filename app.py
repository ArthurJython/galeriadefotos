import os
import sqlite3
import time
from flask import Flask, request, jsonify, render_template, session
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-troque-isso-em-producao")

DB_PATH = os.path.join(os.path.dirname(__file__), "users.db")

LOGIN_ATTEMPTS = {}
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 60

DUMMY_HASH = generate_password_hash("nunca-usado-apenas-para-tempo")


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
    SEED_USERS = [
        ("alice", "AliceSenhaForte!2026"),
        ("bruno", "BrunoSenhaForte!2026"),
        ("carla", "CarlaSenhaForte!2026"),
    ]
    for username, password in SEED_USERS:
        c.execute("SELECT 1 FROM users WHERE username = ?", (username,))
        if not c.fetchone():
            c.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, generate_password_hash(password))
            )
    conn.commit()
    conn.close()


def get_user(username):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT username, password_hash FROM users WHERE username = ?", (username,))
    row = c.fetchone()
    conn.close()
    if row:
        return {"username": row[0], "password_hash": row[1]}
    return None


def is_rate_limited(ip):
    now = time.time()
    attempts = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now - t < WINDOW_SECONDS]
    LOGIN_ATTEMPTS[ip] = attempts
    return len(attempts) >= MAX_ATTEMPTS


def register_attempt(ip):
    LOGIN_ATTEMPTS.setdefault(ip, []).append(time.time())


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/auth/login", methods=["POST"])
def login():
    ip = request.remote_addr or "unknown"

    if is_rate_limited(ip):
        return jsonify({"error": "Muitas tentativas. Tente novamente em instantes."}), 429

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
    username = session.get("username")
    if not username:
        return jsonify({"error": "Não autenticado"}), 401
    return jsonify({"username": username}), 200


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
