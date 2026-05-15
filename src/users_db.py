import sqlite3
from contextlib import contextmanager
import os
import platform
import secrets
from werkzeug.security import generate_password_hash, check_password_hash

IS_WINDOWS = platform.system() == 'Windows'

if IS_WINDOWS:
    BASE_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    if not os.path.exists(BASE_DATA_DIR):
        os.makedirs(BASE_DATA_DIR)
    USERS_DB_PATH = os.path.join(BASE_DATA_DIR, 'users.db')
else:
    USERS_DB_PATH = '/app/data/users.db'

@contextmanager
def get_users_db():
    conn = sqlite3.connect(USERS_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

def init_users_db():
    with get_users_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'admin',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        conn.execute('''
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                session_token TEXT UNIQUE NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                expires_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        
        # Verificar si existe el usuario admin por defecto
        cursor = conn.execute('SELECT id FROM users WHERE username = ?', ('admin',))
        if not cursor.fetchone():
            # Crear usuario admin por defecto: admin / admin123
            default_password = 'admin123'
            password_hash = generate_password_hash(default_password)
            conn.execute('''
                INSERT INTO users (username, password_hash, role)
                VALUES (?, ?, ?)
            ''', ('admin', password_hash, 'admin'))
            print(f"✅ Usuario admin creado por defecto (username: admin, password: {default_password})")

def create_session(user_id):
    """Crea un token de sesión persistente en la base de datos"""
    token = secrets.token_urlsafe(32)
    with get_users_db() as conn:
        conn.execute('''
            INSERT INTO user_sessions (user_id, session_token, expires_at)
            VALUES (?, ?, datetime('now', '+7 days'))
        ''', (user_id, token))
    return token
def verify_session(token):
    """Verifica si un token de sesión es válido"""
    with get_users_db() as conn:
        cursor = conn.execute('''
            SELECT u.id, u.username, u.role 
            FROM user_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.session_token = ? AND (s.expires_at > datetime('now') OR s.expires_at IS NULL)
        ''', (token,))
        row = cursor.fetchone()
        if row:
            return dict(row)
    return None

def delete_session(token):
    """Elimina un token de sesión (logout)"""
    with get_users_db() as conn:
        result = conn.execute('DELETE FROM user_sessions WHERE session_token = ?', (token,))
        print(f"[DB] delete_session: eliminadas {result.rowcount} filas")
        return result.rowcount > 0


def verify_user(username, password):
    with get_users_db() as conn:
        cursor = conn.execute('SELECT * FROM users WHERE username = ?', (username,))
        user = cursor.fetchone()
        if user and check_password_hash(user['password_hash'], password):
            return {
                'id': user['id'],
                'username': user['username'],
                'role': user['role']
            }
    return None

def get_all_users():
    with get_users_db() as conn:
        cursor = conn.execute('SELECT id, username, role, created_at FROM users')
        return [dict(row) for row in cursor.fetchall()]

def change_password(user_id, new_password):
    password_hash = generate_password_hash(new_password)
    with get_users_db() as conn:
        conn.execute('''
            UPDATE users SET password_hash = ? WHERE id = ?
        ''', (password_hash, user_id))
    return True


def delete_session(token):
    """Elimina un token de sesión (logout)"""
    with get_users_db() as conn:
        result = conn.execute('DELETE FROM user_sessions WHERE session_token = ?', (token,))
        print(f"[LOGOUT] delete_session: {result.rowcount} fila(s) eliminada(s)")
        return result.rowcount > 0