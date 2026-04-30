import sqlite3
from datetime import datetime
from contextlib import contextmanager
import json
import os

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
                kart_id TEXT DEFAULT '',
                is_active BOOLEAN DEFAULT 1,
                first_detected TEXT DEFAULT CURRENT_TIMESTAMP,
                last_seen TEXT,
                times_detected INTEGER DEFAULT 1,
                last_signal_h INTEGER,
                last_signal_l INTEGER,
                last_time_accumulated TEXT,
                last_physical_laps INTEGER
            )
        ''')

        # Migración: Añadir columnas faltantes si la tabla ya existía
        columnas_nuevas = [
            ('kart_id', 'TEXT DEFAULT ""'),
            ('last_signal_h', 'INTEGER'),
            ('last_signal_l', 'INTEGER'),
            ('last_time_accumulated', 'TEXT'),
            ('last_physical_laps', 'INTEGER'),
            ('usage_laps_total', 'INTEGER DEFAULT 0')
        ]
        for col_name, col_type in columnas_nuevas:
            try:
                conn.execute(f'ALTER TABLE transponders ADD COLUMN {col_name} {col_type}')
            except sqlite3.OperationalError:
                pass # La columna ya existe
        
        conn.execute('''
            CREATE TABLE IF NOT EXISTS race_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                circuit_name TEXT NOT NULL,
                laps_limit INTEGER DEFAULT 10,
                start_time TEXT,
                end_time TEXT,
                status TEXT DEFAULT 'pending',
                elapsed_seconds REAL DEFAULT 0,
                last_status_change_at TEXT,
                winner_driver_id INTEGER,
                winner_time REAL,
                best_lap_driver_id INTEGER,
                best_lap_value REAL,
                best_lap_number INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        columnas_sesion_nuevas = [
            ('elapsed_seconds', 'REAL DEFAULT 0'),
            ('last_status_change_at', 'TEXT')
        ]
        for col_name, col_type in columnas_sesion_nuevas:
            try:
                conn.execute(f'ALTER TABLE race_sessions ADD COLUMN {col_name} {col_type}')
            except sqlite3.OperationalError:
                pass
        
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

def add_driver(transponder_id, name, lastname='', age=None, gender='', nationality='', weight=None, description=''):
    with get_db() as conn:
        cursor = conn.execute('''
            INSERT OR REPLACE INTO drivers 
            (transponder_id, name, lastname, age, gender, nationality, weight, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (transponder_id, name, lastname, age, gender, nationality, weight, description, datetime.now().isoformat()))
        conn.execute('''
            INSERT OR IGNORE INTO transponders (id, code, first_detected, is_active, usage_laps_total)
            VALUES (?, ?, ?, 1, 0)
        ''', (transponder_id, str(transponder_id), datetime.now().isoformat()))
        conn.execute('UPDATE transponders SET last_seen = ? WHERE id = ?',
                    (datetime.now().isoformat(), transponder_id))
        return cursor.lastrowid

def delete_transponder(transponder_id):
    with get_db() as conn:
        # Solo permitir eliminar si no está asignado a un piloto
        assigned = conn.execute('SELECT 1 FROM drivers WHERE transponder_id = ?', (transponder_id,)).fetchone()
        if assigned:
            return False
        conn.execute('DELETE FROM transponders WHERE id = ?', (transponder_id,))
        return True

def update_transponder_id(old_id, new_id):
    with get_db() as conn:
        # Solo permitir si no está asignado
        assigned = conn.execute('SELECT 1 FROM drivers WHERE transponder_id = ?', (old_id,)).fetchone()
        if assigned:
            return False
        
        # Verificar que el nuevo ID no exista ya
        exists = conn.execute('SELECT 1 FROM transponders WHERE id = ?', (new_id,)).fetchone()
        if exists:
            return False

        conn.execute('UPDATE transponders SET id = ?, code = ? WHERE id = ?', (new_id, str(new_id), old_id))
        return True

def update_transponder(transponder_id, kart_id=None, description=None):
    with get_db() as conn:
        if kart_id is not None:
            conn.execute('UPDATE transponders SET kart_id = ? WHERE id = ?', (kart_id, transponder_id))
        if description is not None:
            conn.execute('UPDATE transponders SET description = ? WHERE id = ?', (description, transponder_id))
        return True

def get_all_drivers():
    with get_db() as conn:
        return [dict(r) for r in conn.execute('SELECT * FROM drivers ORDER BY name ASC').fetchall()]

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

def add_transponder_manual(transponder_id, description='', kart_id=''):
    with get_db() as conn:
        existing = conn.execute('SELECT * FROM transponders WHERE id = ?', (transponder_id,)).fetchone()
        if existing:
            return False
        conn.execute('''
            INSERT INTO transponders (id, code, description, kart_id, first_detected, is_active, usage_laps_total)
            VALUES (?, ?, ?, ?, ?, 1, 0)
        ''', (transponder_id, str(transponder_id), description, kart_id, datetime.now().isoformat()))
        return True

def add_transponder_detected(transponder_id, signal_h=None, signal_l=None, time_accumulated=None, physical_laps=None):
    with get_db() as conn:
        existing = conn.execute('SELECT * FROM transponders WHERE id = ?', (transponder_id,)).fetchone()
        now = datetime.now().isoformat()
        if existing:
            usage_laps_total = int(existing['usage_laps_total'] or 0)
            try:
                prev_physical = int(existing['last_physical_laps']) if existing['last_physical_laps'] is not None else None
                curr_physical = int(physical_laps) if physical_laps is not None else None
                if prev_physical is not None and curr_physical is not None and curr_physical >= prev_physical:
                    usage_laps_total += (curr_physical - prev_physical)
            except (TypeError, ValueError):
                pass
            conn.execute('''
                UPDATE transponders 
                SET last_seen = ?, times_detected = times_detected + 1,
                    last_signal_h = ?, last_signal_l = ?, 
                    last_time_accumulated = ?, last_physical_laps = ?, usage_laps_total = ?
                WHERE id = ?
            ''', (now, signal_h, signal_l, time_accumulated, physical_laps, usage_laps_total, transponder_id))
            return False
        else:
            conn.execute('''
                INSERT INTO transponders (id, code, first_detected, last_seen, is_active, 
                                        last_signal_h, last_signal_l, last_time_accumulated, last_physical_laps, usage_laps_total) 
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 0)
            ''', (transponder_id, str(transponder_id), now, now, signal_h, signal_l, time_accumulated, physical_laps))
            return True

def get_transponder_health():
    with get_db() as conn:
        rows = conn.execute('''
            SELECT t.id, t.description, t.kart_id, t.usage_laps_total, t.last_physical_laps, t.last_seen, t.times_detected,
                   d.name, d.lastname
            FROM transponders t
            LEFT JOIN drivers d ON d.transponder_id = t.id
            ORDER BY t.id ASC
        ''').fetchall()

    items = []
    for r in rows:
        usage = int(r['usage_laps_total'] or 0)
        if usage < 40:
            health = 'optimo'
        elif usage < 70:
            health = 'moderado'
        else:
            health = 'critico'
        items.append({
            'id': r['id'],
            'description': r['description'],
            'kart_id': r['kart_id'],
            'usage_laps_total': usage,
            'last_physical_laps': r['last_physical_laps'],
            'last_seen': r['last_seen'],
            'times_detected': r['times_detected'],
            'assigned_driver': f"{(r['name'] or '').strip()} {(r['lastname'] or '').strip()}".strip() or None,
            'health': health
        })
    return items

def reset_transponder_health(transponder_id):
    with get_db() as conn:
        cursor = conn.execute(
            'UPDATE transponders SET usage_laps_total = 0 WHERE id = ?',
            (transponder_id,)
        )
        return cursor.rowcount > 0

def hard_reset_all_data():
    with get_db() as conn:
        conn.execute('DELETE FROM laps')
        conn.execute('DELETE FROM race_drivers')
        conn.execute('DELETE FROM race_sessions')
        conn.execute('DELETE FROM drivers')
        conn.execute('DELETE FROM transponders')
        conn.execute('UPDATE settings SET value = "0" WHERE key = "current_session_id"')
        conn.execute('UPDATE settings SET value = "pending" WHERE key = "race_status"')

def get_all_transponders():
    with get_db() as conn:
        return [dict(r) for r in conn.execute('SELECT * FROM transponders ORDER BY id ASC').fetchall()]

def get_unassigned_transponders():
    with get_db() as conn:
        return [dict(r) for r in conn.execute('''
            SELECT t.* FROM transponders t
            LEFT JOIN drivers d ON t.id = d.transponder_id
            WHERE d.id IS NULL
            ORDER BY t.first_detected DESC
        ''').fetchall()]

def get_current_session():
    with get_db() as conn:
        result = conn.execute('SELECT * FROM race_sessions WHERE status != "completed" ORDER BY id DESC LIMIT 1').fetchone()
        return dict(result) if result else None

def get_latest_session():
    with get_db() as conn:
        result = conn.execute('SELECT * FROM race_sessions ORDER BY id DESC LIMIT 1').fetchone()
        return dict(result) if result else None

def start_new_session(circuit_name, laps_limit):
    with get_db() as conn:
        cursor = conn.execute('INSERT INTO race_sessions (circuit_name, laps_limit, start_time, status) VALUES (?, ?, ?, "pending")',
                              (circuit_name, laps_limit, None))
        session_id = cursor.lastrowid
        conn.execute('UPDATE settings SET value = ? WHERE key = "current_session_id"', (str(session_id),))
        conn.execute('UPDATE settings SET value = "pending" WHERE key = "race_status"')
        return session_id

def get_session_info(session_id):
    with get_db() as conn:
        result = conn.execute('SELECT * FROM race_sessions WHERE id = ?', (session_id,)).fetchone()
        return dict(result) if result else None

def update_race_status(session_id, status, winner_driver_id=None, winner_time=None):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id

        try:
            session = conn.execute(
                'SELECT status, start_time, end_time, elapsed_seconds, last_status_change_at FROM race_sessions WHERE id = ?',
                (s_id,)
            ).fetchone()
        except sqlite3.OperationalError:
            session = None

        # Modo legacy: si la DB aún no tiene las columnas nuevas, no rompemos el runtime.
        if session is None:
            now = datetime.now().isoformat()
            if status == 'completed':
                conn.execute(
                    'UPDATE race_sessions SET status = ?, end_time = ?, winner_driver_id = COALESCE(?, winner_driver_id), winner_time = COALESCE(?, winner_time) WHERE id = ?',
                    (status, now, winner_driver_id, winner_time, s_id)
                )
            elif status == 'active':
                conn.execute(
                    'UPDATE race_sessions SET status = ?, start_time = COALESCE(start_time, ?) WHERE id = ?',
                    (status, now, s_id)
                )
            else:
                conn.execute('UPDATE race_sessions SET status = ? WHERE id = ?', (status, s_id))
            conn.execute('UPDATE settings SET value = ? WHERE key = "race_status"', (status,))
            return

        if not session:
            return

        now = datetime.now().isoformat()
        previous_status = session['status']
        start_time = session['start_time']
        elapsed_seconds = float(session['elapsed_seconds'] or 0)
        last_status_change_at = session['last_status_change_at']

        if previous_status == 'active' and last_status_change_at:
            try:
                delta = (datetime.fromisoformat(now) - datetime.fromisoformat(last_status_change_at)).total_seconds()
                elapsed_seconds += max(0.0, delta)
            except ValueError:
                pass

        next_start_time = start_time
        next_end_time = session['end_time']
        next_last_status_change = now

        if status == 'active':
            if not start_time:
                next_start_time = now
        elif status == 'completed':
            next_end_time = now
        elif status == 'pending':
            elapsed_seconds = 0
            next_start_time = None
            next_end_time = None
            next_last_status_change = None

        conn.execute('''
            UPDATE race_sessions
            SET status = ?, start_time = ?, end_time = ?, elapsed_seconds = ?, last_status_change_at = ?,
                winner_driver_id = COALESCE(?, winner_driver_id),
                winner_time = COALESCE(?, winner_time)
            WHERE id = ?
        ''', (
            status, next_start_time, next_end_time, elapsed_seconds, next_last_status_change,
            winner_driver_id, winner_time, s_id
        ))

        conn.execute('UPDATE settings SET value = ? WHERE key = "race_status"', (status,))

def get_session_elapsed_seconds(session):
    if not session:
        return 0.0

    # Compatible con DB vieja: si no existen columnas nuevas, calculamos desde start_time/end_time.
    if 'elapsed_seconds' not in session and session.get('start_time'):
        try:
            start = datetime.fromisoformat(session['start_time'])
            if session.get('status') == 'completed' and session.get('end_time'):
                end = datetime.fromisoformat(session['end_time'])
                return max(0.0, (end - start).total_seconds())
            if session.get('status') in ('active', 'paused', 'completed'):
                return max(0.0, (datetime.now() - start).total_seconds())
        except ValueError:
            return 0.0

    elapsed_seconds = float(session.get('elapsed_seconds') or 0)
    status = session.get('status')
    last_status_change_at = session.get('last_status_change_at')

    if status == 'active' and last_status_change_at:
        try:
            elapsed_seconds += max(
                0.0,
                (datetime.now() - datetime.fromisoformat(last_status_change_at)).total_seconds()
            )
        except ValueError:
            pass

    return elapsed_seconds

def add_driver_to_race(session_id, driver_id, transponder_id, start_position=None):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        conn.execute('INSERT OR REPLACE INTO race_drivers (session_id, driver_id, transponder_id, start_position) VALUES (?, ?, ?, ?)',
                    (s_id, driver_id, transponder_id, start_position))

def remove_driver_from_race(session_id, driver_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        conn.execute('DELETE FROM race_drivers WHERE session_id = ? AND driver_id = ?', (s_id, driver_id))

def get_race_drivers(session_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        return [dict(r) for r in conn.execute('''
            SELECT rd.*, d.name, d.lastname, d.transponder_id as driver_transponder, d.photo
            FROM race_drivers rd
            JOIN drivers d ON rd.driver_id = d.id
            WHERE rd.session_id = ?
            ORDER BY rd.start_position ASC
        ''', (s_id,)).fetchall()]

def is_driver_in_race(session_id, transponder_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        result = conn.execute('''
            SELECT 1 FROM race_drivers rd
            JOIN drivers d ON rd.driver_id = d.id
            WHERE rd.session_id = ? AND d.transponder_id = ?
        ''', (s_id, transponder_id)).fetchone()
        return result is not None

def clear_race_drivers(session_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        conn.execute('DELETE FROM race_drivers WHERE session_id = ?', (s_id,))

def save_lap(session_id, driver_id, transponder_id, physical_laps, lap_number, total_seconds, lap_seconds, signal_h, signal_l, position=None, gap_to_leader=None, is_last_lap=False):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        conn.execute('''
            INSERT INTO laps (session_id, driver_id, transponder_id, lap_number, physical_laps, 
                            timestamp, total_seconds, lap_seconds, position_at_lap, gap_to_leader,
                            signal_h, signal_l, is_last_lap)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (s_id, driver_id, transponder_id, lap_number, physical_laps, 
              datetime.now().isoformat(), total_seconds, lap_seconds, position, gap_to_leader,
              signal_h, signal_l, is_last_lap))
        
        if lap_number > 0 and lap_seconds:
            current_best = conn.execute('SELECT best_lap, best_lap_number FROM race_drivers WHERE session_id = ? AND driver_id = ?',
                                        (s_id, driver_id)).fetchone()
            if not current_best or not current_best['best_lap'] or lap_seconds < current_best['best_lap']:
                conn.execute('UPDATE race_drivers SET best_lap = ?, best_lap_number = ? WHERE session_id = ? AND driver_id = ?',
                            (lap_seconds, lap_number, s_id, driver_id))

def update_driver(driver_id, transponder_id, name, lastname=''):
    with get_db() as conn:
        conn.execute('''
            UPDATE drivers 
            SET transponder_id = ?, name = ?, lastname = ?
            WHERE id = ?
        ''', (transponder_id, name, lastname, driver_id))
        return True

def get_recent_signals(limit=10):
    with get_db() as conn:
        return [dict(r) for r in conn.execute('''
            SELECT id as transponder_id, last_seen, times_detected, 
                   last_signal_h, last_signal_l, last_time_accumulated, last_physical_laps
            FROM transponders
            ORDER BY last_seen DESC
            LIMIT ?
        ''', (limit,)).fetchall()]

def get_leaderboard_with_details(session_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id

        session = conn.execute('SELECT laps_limit FROM race_sessions WHERE id = ?', (s_id,)).fetchone()
        laps_limit = session['laps_limit'] if session and session['laps_limit'] else 10

        results = conn.execute('''
            SELECT 
                d.id as driver_id,
                d.name,
                d.lastname,
                d.transponder_id,
                t.kart_id as kart_id,
                d.photo,
                COUNT(DISTINCT CASE WHEN l.lap_number > 0 AND l.lap_number <= ? THEN l.lap_number END) as total_laps,
                SUM(CASE WHEN l.lap_number > 0 AND l.lap_number <= ? AND l.lap_seconds IS NOT NULL THEN l.lap_seconds ELSE 0 END) as total_time,
                MIN(CASE WHEN l.lap_number > 0 AND l.lap_number <= ? AND l.lap_seconds IS NOT NULL THEN l.lap_seconds END) as best_lap,
                MAX(CASE WHEN l.lap_number > 0 AND l.lap_number <= ? THEN l.lap_number END) as last_valid_lap_number
            FROM race_drivers rd
            JOIN drivers d ON rd.driver_id = d.id
            LEFT JOIN transponders t ON t.id = d.transponder_id
            LEFT JOIN laps l ON l.driver_id = d.id AND l.session_id = rd.session_id
            WHERE rd.session_id = ?
            GROUP BY d.id
        ''', (laps_limit, laps_limit, laps_limit, laps_limit, s_id)).fetchall()

        leaderboard = []
        for row in results:
            row_dict = dict(row)
            row_dict['total_laps'] = int(row_dict.get('total_laps') or 0)
            row_dict['laps_remaining'] = max(0, laps_limit - row_dict['total_laps'])
            row_dict['is_finished'] = row_dict['total_laps'] >= laps_limit
            row_dict['full_name'] = f"{row_dict['name']} {row_dict.get('lastname', '')}".strip()
            row_dict['total_time'] = float(row_dict.get('total_time') or 0.0)

            last_lap_row = conn.execute('''
                SELECT lap_seconds FROM laps
                WHERE driver_id = ? AND session_id = ? AND lap_number = ?
                ORDER BY id DESC LIMIT 1
            ''', (row_dict['driver_id'], s_id, row_dict.get('last_valid_lap_number') or 0)).fetchone()
            row_dict['last_lap'] = float(last_lap_row['lap_seconds'] or 0) if last_lap_row else None
            leaderboard.append(row_dict)
        
        leaderboard.sort(key=lambda x: (
            -x['total_laps'],
            x['total_time'] if x['total_time'] is not None else float('inf'),
            x['best_lap'] if x['best_lap'] else 999999
        ))
        for i, driver in enumerate(leaderboard):
            driver['position'] = i + 1
        
        return leaderboard

def get_lap_details(session_id, driver_id):
    with get_db() as conn:
        return [dict(r) for r in conn.execute('''
            SELECT lap_number, lap_seconds, position_at_lap, gap_to_leader
            FROM laps
            WHERE session_id = ? AND driver_id = ? AND lap_number > 0
            ORDER BY lap_number ASC
        ''', (session_id, driver_id)).fetchall()]

def get_race_history():
    with get_db() as conn:
        return [dict(r) for r in conn.execute('''
            SELECT rs.*, d.name as winner_name, d.lastname as winner_lastname
            FROM race_sessions rs
            LEFT JOIN drivers d ON rs.winner_driver_id = d.id
            WHERE rs.status = 'completed'
            ORDER BY rs.end_time DESC
            LIMIT 20
        ''').fetchall()]

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




# ==================== CONFIGURACIÓN DE ANTENA ====================

def get_antenna_config():
    """Obtiene la configuración actual de la antena"""
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS antenna_config (
                id INTEGER PRIMARY KEY DEFAULT 1,
                min_signal INTEGER DEFAULT 60,
                filter_time REAL DEFAULT 0.5,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute('''
            INSERT OR IGNORE INTO antenna_config (id, min_signal, filter_time)
            VALUES (1, 60, 0.5)
        ''')
        result = conn.execute('SELECT * FROM antenna_config WHERE id = 1').fetchone()
        return dict(result) if result else {'min_signal': 60, 'filter_time': 0.5}

def update_antenna_config(min_signal=None, filter_time=None):
    """Actualiza la configuración de la antena"""
    with get_db() as conn:
        if min_signal is not None:
            conn.execute('UPDATE antenna_config SET min_signal = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', (min_signal,))
        if filter_time is not None:
            conn.execute('UPDATE antenna_config SET filter_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', (filter_time,))
        return True

def get_driver_individual_times(session_id):
    """Obtiene el tiempo total individual de cada piloto desde su primera detección"""
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        
        # Obtener la primera detección (vuelta de salida) y última de cada piloto
        results = conn.execute('''
            SELECT 
                d.id as driver_id,
                d.name,
                d.lastname,
                MIN(l.timestamp) as first_detection,
                MAX(CASE WHEN l.is_last_lap = 1 THEN l.timestamp END) as last_detection,
                MIN(l.total_seconds) as first_total_seconds,
                MAX(CASE WHEN l.is_last_lap = 1 THEN l.total_seconds END) as last_total_seconds,
                COUNT(CASE WHEN l.lap_number > 0 THEN 1 END) as completed_laps
            FROM race_drivers rd
            JOIN drivers d ON rd.driver_id = d.id
            LEFT JOIN laps l ON l.driver_id = d.id AND l.session_id = rd.session_id
            WHERE rd.session_id = ?
            GROUP BY d.id
        ''', (s_id,)).fetchall()
        
        times = []
        for row in results:
            first_seconds = row['first_total_seconds']
            last_seconds = row['last_total_seconds']
            individual_time = None
            
            if first_seconds is not None and last_seconds is not None:
                individual_time = last_seconds - first_seconds
            
            times.append({
                'driver_id': row['driver_id'],
                'driver_name': f"{row['name']} {row['lastname'] or ''}".strip(),
                'first_detection': row['first_detection'],
                'last_detection': row['last_detection'],
                'individual_time_seconds': individual_time,
                'individual_time_formatted': format_individual_time(individual_time) if individual_time else '--',
                'completed_laps': row['completed_laps'] or 0
            })
        
        return times

def format_individual_time(seconds):
    """Formatea tiempo individual en HH:MM:SS.mmm"""
    if seconds is None:
        return '--'
    
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    milliseconds = int((secs - int(secs)) * 1000)
    
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{int(secs):02d}.{milliseconds:03d}"
    else:
        return f"{minutes:02d}:{int(secs):02d}.{milliseconds:03d}"        
