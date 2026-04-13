import sqlite3
from datetime import datetime
from contextlib import contextmanager

DB_PATH = '/app/data/chronit.db'

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS drivers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transponder_id INTEGER UNIQUE,
                name TEXT NOT NULL,
                lastname TEXT,
                age INTEGER,
                gender TEXT,
                nationality TEXT,
                weight REAL,
                description TEXT,
                photo TEXT DEFAULT 'default-avatar.png',
                best_lap_time REAL,
                total_races INTEGER DEFAULT 0,
                total_wins INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.execute('''
            CREATE TABLE IF NOT EXISTS transponders (
                id INTEGER PRIMARY KEY,
                code TEXT,
                description TEXT,
                is_active BOOLEAN DEFAULT 1,
                first_detected TEXT DEFAULT CURRENT_TIMESTAMP,
                last_seen TEXT,
                times_detected INTEGER DEFAULT 1
            )
        ''')
        
        conn.execute('''
            CREATE TABLE IF NOT EXISTS race_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                circuit_name TEXT NOT NULL,
                laps_limit INTEGER DEFAULT 10,
                start_time TEXT,
                end_time TEXT,
                status TEXT DEFAULT 'pending',
                winner_driver_id INTEGER,
                winner_time REAL,
                best_lap_driver_id INTEGER,
                best_lap_value REAL,
                best_lap_number INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.execute('''
            CREATE TABLE IF NOT EXISTS race_drivers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                driver_id INTEGER NOT NULL,
                transponder_id INTEGER NOT NULL,
                start_position INTEGER,
                finished BOOLEAN DEFAULT 0,
                final_position INTEGER,
                total_time REAL,
                best_lap REAL,
                best_lap_number INTEGER,
                UNIQUE(session_id, driver_id),
                UNIQUE(session_id, transponder_id)
            )
        ''')
        
        conn.execute('''
            CREATE TABLE IF NOT EXISTS laps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                driver_id INTEGER NOT NULL,
                transponder_id INTEGER NOT NULL,
                lap_number INTEGER NOT NULL,
                physical_laps INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                total_seconds REAL NOT NULL,
                lap_seconds REAL,
                position_at_lap INTEGER,
                gap_to_leader REAL,
                signal_h INTEGER,
                signal_l INTEGER,
                is_last_lap BOOLEAN DEFAULT 0
            )
        ''')
        
        conn.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('current_session_id', '0')")
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('default_laps_limit', '10')")
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('race_status', 'pending')")
        
        session = conn.execute('SELECT * FROM race_sessions WHERE status != "completed" LIMIT 1').fetchone()
        if not session:
            cursor = conn.execute('''
                INSERT INTO race_sessions (circuit_name, laps_limit, start_time, status)
                VALUES (?, ?, ?, 'pending')
            ''', ('Circuito Principal', 10, None))
            conn.execute('UPDATE settings SET value = ? WHERE key = "current_session_id"', (str(cursor.lastrowid),))
            print("[SISTEMA] Base de datos inicializada")

# ==================== PILOTOS ====================

def add_driver(transponder_id, name, lastname='', age=None, gender='', nationality='', weight=None, description=''):
    with get_db() as conn:
        cursor = conn.execute('''
            INSERT OR REPLACE INTO drivers 
            (transponder_id, name, lastname, age, gender, nationality, weight, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (transponder_id, name, lastname, age, gender, nationality, weight, description, datetime.now().isoformat()))
        
        conn.execute('''
            INSERT OR REPLACE INTO transponders (id, code, last_seen)
            VALUES (?, ?, ?)
        ''', (transponder_id, str(transponder_id), datetime.now().isoformat()))
        
        return cursor.lastrowid

def get_all_drivers():
    with get_db() as conn:
        results = conn.execute('SELECT * FROM drivers ORDER BY name ASC').fetchall()
        return [dict(r) for r in results]

def get_driver_by_id(driver_id):
    with get_db() as conn:
        result = conn.execute('SELECT * FROM drivers WHERE id = ?', (driver_id,)).fetchone()
        return dict(result) if result else None

def get_driver_by_transponder(transponder_id):
    with get_db() as conn:
        result = conn.execute('SELECT * FROM drivers WHERE transponder_id = ?', (transponder_id,)).fetchone()
        return dict(result) if result else None

def delete_driver(driver_id):
    with get_db() as conn:
        conn.execute('DELETE FROM drivers WHERE id = ?', (driver_id,))

# ==================== TRANSPONDERS ====================

def add_transponder_manual(transponder_id, description=''):
    with get_db() as conn:
        existing = conn.execute('SELECT * FROM transponders WHERE id = ?', (transponder_id,)).fetchone()
        if existing:
            return False
        
        conn.execute('''
            INSERT INTO transponders (id, code, description, first_detected, is_active)
            VALUES (?, ?, ?, ?, 1)
        ''', (transponder_id, str(transponder_id), description, datetime.now().isoformat()))
        return True

def add_transponder_detected(transponder_id):
    with get_db() as conn:
        existing = conn.execute('SELECT * FROM transponders WHERE id = ?', (transponder_id,)).fetchone()
        if existing:
            conn.execute('''
                UPDATE transponders 
                SET last_seen = ?, times_detected = times_detected + 1
                WHERE id = ?
            ''', (datetime.now().isoformat(), transponder_id))
            return False
        else:
            conn.execute('''
                INSERT INTO transponders (id, code, first_detected, last_seen, is_active)
                VALUES (?, ?, ?, ?, 1)
            ''', (transponder_id, str(transponder_id), datetime.now().isoformat(), datetime.now().isoformat()))
            return True

def get_all_transponders():
    with get_db() as conn:
        results = conn.execute('SELECT * FROM transponders ORDER BY id ASC').fetchall()
        return [dict(r) for r in results]

def get_unassigned_transponders():
    with get_db() as conn:
        results = conn.execute('''
            SELECT t.* FROM transponders t
            LEFT JOIN drivers d ON t.id = d.transponder_id
            WHERE d.id IS NULL
            ORDER BY t.first_detected DESC
        ''').fetchall()
        return [dict(r) for r in results]

# ==================== SESIONES ====================

def get_current_session():
    with get_db() as conn:
        result = conn.execute('''
            SELECT * FROM race_sessions 
            WHERE status != 'completed'
            ORDER BY id DESC LIMIT 1
        ''').fetchone()
        return dict(result) if result else None

def start_new_session(circuit_name, laps_limit):
    with get_db() as conn:
        cursor = conn.execute('''
            INSERT INTO race_sessions (circuit_name, laps_limit, start_time, status)
            VALUES (?, ?, ?, 'pending')
        ''', (circuit_name, laps_limit, None))
        
        session_id = cursor.lastrowid
        conn.execute('UPDATE settings SET value = ? WHERE key = "current_session_id"', (str(session_id),))
        conn.execute('UPDATE settings SET value = "pending" WHERE key = "race_status"')
        
        return session_id

def get_session_info(session_id):
    with get_db() as conn:
        result = conn.execute('SELECT * FROM race_sessions WHERE id = ?', (session_id,)).fetchone()
        return dict(result) if result else None

def get_session_lap_count(session_id):
    with get_db() as conn:
        result = conn.execute(
            'SELECT COUNT(*) AS total FROM laps WHERE session_id = ? AND lap_number > 0',
            (session_id,),
        ).fetchone()
        return int(result['total'] or 0) if result else 0

def update_race_status(session_id, status, winner_driver_id=None, winner_time=None):
    with get_db() as conn:
        conn.execute('''
            UPDATE race_sessions 
            SET status = ?, end_time = ?, winner_driver_id = ?, winner_time = ?
            WHERE id = ?
        ''', (status, datetime.now().isoformat(), winner_driver_id, winner_time, session_id))
        conn.execute('UPDATE settings SET value = ? WHERE key = "race_status"', (status,))

# ==================== PILOTOS EN CARRERA ====================

def add_driver_to_race(session_id, driver_id, transponder_id, start_position=None):
    with get_db() as conn:
        conn.execute('''
            INSERT OR REPLACE INTO race_drivers (session_id, driver_id, transponder_id, start_position)
            VALUES (?, ?, ?, ?)
        ''', (session_id, driver_id, transponder_id, start_position))

def remove_driver_from_race(session_id, driver_id):
    with get_db() as conn:
        conn.execute('DELETE FROM race_drivers WHERE session_id = ? AND driver_id = ?', (session_id, driver_id))

def get_race_drivers(session_id):
    with get_db() as conn:
        results = conn.execute('''
            SELECT rd.*, d.name, d.lastname, d.transponder_id as driver_transponder, d.photo
            FROM race_drivers rd
            JOIN drivers d ON rd.driver_id = d.id
            WHERE rd.session_id = ?
            ORDER BY rd.start_position ASC
        ''', (session_id,)).fetchall()
        return [dict(r) for r in results]

def is_driver_in_race(session_id, transponder_id):
    with get_db() as conn:
        result = conn.execute('''
            SELECT 1 FROM race_drivers rd
            JOIN drivers d ON rd.driver_id = d.id
            WHERE rd.session_id = ? AND d.transponder_id = ?
        ''', (session_id, transponder_id)).fetchone()
        return result is not None

def clear_race_drivers(session_id):
    with get_db() as conn:
        conn.execute('DELETE FROM race_drivers WHERE session_id = ?', (session_id,))

# ==================== VUELTAS ====================

def save_lap(session_id, driver_id, transponder_id, physical_laps, lap_number, total_seconds, lap_seconds, signal_h, signal_l, position=None, gap_to_leader=None, is_last_lap=False):
    with get_db() as conn:
        conn.execute('''
            INSERT INTO laps (session_id, driver_id, transponder_id, lap_number, physical_laps, 
                            timestamp, total_seconds, lap_seconds, position_at_lap, gap_to_leader,
                            signal_h, signal_l, is_last_lap)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (session_id, driver_id, transponder_id, lap_number, physical_laps, 
              datetime.now().isoformat(), total_seconds, lap_seconds, position, gap_to_leader,
              signal_h, signal_l, is_last_lap))
        
        if lap_number > 0 and lap_seconds:
            current_best = conn.execute('''
                SELECT best_lap, best_lap_number FROM race_drivers 
                WHERE session_id = ? AND driver_id = ?
            ''', (session_id, driver_id)).fetchone()
            if not current_best or not current_best['best_lap'] or lap_seconds < current_best['best_lap']:
                conn.execute('''
                    UPDATE race_drivers 
                    SET best_lap = ?, best_lap_number = ?
                    WHERE session_id = ? AND driver_id = ?
                ''', (lap_seconds, lap_number, session_id, driver_id))

def get_leaderboard_with_details(session_id):
    with get_db() as conn:
        results = conn.execute('''
            SELECT 
                d.id as driver_id,
                d.name,
                d.lastname,
                d.transponder_id,
                d.photo,
                COALESCE(MAX(l.lap_number), 0) as total_laps,
                MIN(CASE WHEN l.lap_number > 0 AND l.lap_seconds IS NOT NULL THEN l.lap_seconds END) as best_lap,
                (SELECT lap_seconds FROM laps l2 
                 WHERE l2.driver_id = d.id 
                 AND l2.session_id = l.session_id 
                 AND l2.lap_number > 0
                 ORDER BY l2.lap_number DESC LIMIT 1) as last_lap
            FROM race_drivers rd
            JOIN drivers d ON rd.driver_id = d.id
            LEFT JOIN laps l ON l.driver_id = d.id AND l.session_id = rd.session_id
            WHERE rd.session_id = ?
            GROUP BY d.id
        ''', (session_id,)).fetchall()
        
        session = get_current_session()
        laps_limit = session.get('laps_limit', 10) if session else 10
        
        leaderboard = []
        for row in results:
            row_dict = dict(row)
            row_dict['laps_remaining'] = max(0, laps_limit - (row_dict['total_laps'] or 0))
            row_dict['is_finished'] = (row_dict['total_laps'] or 0) >= laps_limit
            
            if row_dict.get('lastname'):
                row_dict['full_name'] = f"{row_dict['name']} {row_dict['lastname']}"
            else:
                row_dict['full_name'] = row_dict['name']
            
            leaderboard.append(row_dict)
        
        leaderboard.sort(key=lambda x: (-x['total_laps'], x['best_lap'] if x['best_lap'] else 999999))
        
        for i, driver in enumerate(leaderboard):
            driver['position'] = i + 1
        
        return leaderboard

def get_lap_details(session_id, driver_id):
    with get_db() as conn:
        results = conn.execute('''
            SELECT lap_number, lap_seconds, position_at_lap, gap_to_leader
            FROM laps
            WHERE session_id = ? AND driver_id = ? AND lap_number > 0
            ORDER BY lap_number ASC
        ''', (session_id, driver_id)).fetchall()
        return [dict(r) for r in results]

def get_race_history():
    with get_db() as conn:
        results = conn.execute('''
            SELECT rs.*, 
                   d.name as winner_name, 
                   d.lastname as winner_lastname
            FROM race_sessions rs
            LEFT JOIN drivers d ON rs.winner_driver_id = d.id
            WHERE rs.status = 'completed'
            ORDER BY rs.end_time DESC
            LIMIT 20
        ''').fetchall()
        return [dict(r) for r in results]

# ==================== REPETIR CARRERA (JSON) ====================
import json
import os

JSON_STATE_FILE = '/app/data/race_state.json'

def guardar_estado_repetir(session_id, circuit_name, laps_limit, race_drivers):
    estado = {
        "action": "repeat_race",
        "session_id": session_id,
        "circuit_name": circuit_name,
        "laps_limit": laps_limit,
        "race_drivers": race_drivers
    }
    with open(JSON_STATE_FILE, 'w') as f:
        json.dump(estado, f, indent=2)
    print(f"[SISTEMA] Estado guardado para repetir carrera: {len(race_drivers)} pilotos")

def cargar_estado_repetir():
    if not os.path.exists(JSON_STATE_FILE):
        return None
    
    with open(JSON_STATE_FILE, 'r') as f:
        estado = json.load(f)
    
    os.remove(JSON_STATE_FILE)
    print(f"[SISTEMA] Estado restaurado: {len(estado.get('race_drivers', []))} pilotos")
    return estado

def limpiar_estado_repetir():
    if os.path.exists(JSON_STATE_FILE):
        os.remove(JSON_STATE_FILE)
