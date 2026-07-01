import sqlite3
from datetime import datetime
from contextlib import contextmanager
import json
import os
import platform

# Detectar sistema operativo
IS_WINDOWS = platform.system() == "Windows"

# Configurar ruta de base de datos según SO
if IS_WINDOWS:
    BASE_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    if not os.path.exists(BASE_DATA_DIR):
        os.makedirs(BASE_DATA_DIR)
    DB_PATH = os.path.join(BASE_DATA_DIR, "chronit.db")
else:
    DB_PATH = "/app/data/chronit.db"


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
        # ===== TABLA DRIVERS CON FOTO CORRECTA =====
        conn.execute("""
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
                photo TEXT DEFAULT '/static/default-avatar.png',
                best_lap_time REAL,
                total_races INTEGER DEFAULT 0,
                total_wins INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
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
        """)

        # Migración: Añadir columnas faltantes si la tabla ya existía
        columnas_nuevas = [
            ("kart_id", 'TEXT DEFAULT ""'),
            ("last_signal_h", "INTEGER"),
            ("last_signal_l", "INTEGER"),
            ("last_time_accumulated", "TEXT"),
            ("last_physical_laps", "INTEGER"),
            ("usage_laps_total", "INTEGER DEFAULT 0"),
        ]
        for col_name, col_type in columnas_nuevas:
            try:
                conn.execute(
                    f"ALTER TABLE transponders ADD COLUMN {col_name} {col_type}"
                )
            except sqlite3.OperationalError:
                pass

        conn.execute("""
            CREATE TABLE IF NOT EXISTS race_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                circuit_name TEXT NOT NULL,
                laps_limit INTEGER DEFAULT 10,
                race_mode TEXT DEFAULT 'position',
                time_limit_seconds INTEGER DEFAULT 0,
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
        """)

        columnas_sesion_nuevas = [
            ("elapsed_seconds", "REAL DEFAULT 0"),
            ("last_status_change_at", "TEXT"),
            ("race_mode", 'TEXT DEFAULT "position"'),
            ("time_limit_seconds", "INTEGER DEFAULT 0"),
        ]
        for col_name, col_type in columnas_sesion_nuevas:
            try:
                conn.execute(
                    f"ALTER TABLE race_sessions ADD COLUMN {col_name} {col_type}"
                )
            except sqlite3.OperationalError:
                pass

        conn.execute("""
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
        """)

        conn.execute("""
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
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS circuit_config (
                id INTEGER PRIMARY KEY DEFAULT 1,
                circuit_name TEXT NOT NULL DEFAULT 'Circuito Principal',
                track_length_km REAL DEFAULT 0,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            INSERT OR IGNORE INTO circuit_config (id, circuit_name, track_length_km)
            VALUES (1, 'Circuito Principal', 0.33)
        """)
        conn.execute('''
            UPDATE circuit_config 
            SET track_length_km = 0.33 
            WHERE id = 1 AND (track_length_km IS NULL OR track_length_km = 0)
        ''')
        try:
            conn.execute(
                'ALTER TABLE circuit_config ADD COLUMN track_type TEXT DEFAULT "karting"'
            )
        except sqlite3.OperationalError:
            pass

        conn.execute("""
            CREATE TABLE IF NOT EXISTS decoder_config (
                id INTEGER PRIMARY KEY DEFAULT 1,
                mode TEXT DEFAULT 'chronit',
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)


        conn.execute("""
            CREATE TABLE IF NOT EXISTS columns_config (
                id INTEGER PRIMARY KEY DEFAULT 1,
                desktop_hidden TEXT DEFAULT '[]',  -- JSON array de columnas ocultas en escritorio
                mobile_hidden TEXT DEFAULT '[]',   -- JSON array de columnas ocultas en móvil
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
            INSERT OR IGNORE INTO columns_config (id, desktop_hidden, mobile_hidden)
            VALUES (1, '[]', '[]')
        """)

        conn.execute("""
            INSERT OR IGNORE INTO decoder_config (id, mode)
            VALUES (1, 'chronit')
        """)

        conn.execute("""
            INSERT OR IGNORE INTO circuit_config (id, circuit_name, track_length_km)
            VALUES (1, 'Circuito Principal', 0)
        """)


        try:
            conn.execute(
                'ALTER TABLE circuit_config ADD COLUMN track_type TEXT DEFAULT "karting"'
            )
        except sqlite3.OperationalError:
            pass

        # ========== NUEVAS COLUMNAS ==========
        try:
            conn.execute("ALTER TABLE laps ADD COLUMN avg_speed_kmh REAL")
        except sqlite3.OperationalError:
            pass

        try:
            conn.execute("ALTER TABLE drivers ADD COLUMN best_lap_date TEXT")
        except sqlite3.OperationalError:
            pass

        try:
            conn.execute("ALTER TABLE drivers ADD COLUMN best_total_time REAL")
        except sqlite3.OperationalError:
            pass

        try:
            conn.execute("ALTER TABLE drivers ADD COLUMN best_session_id INTEGER")
        except sqlite3.OperationalError:
            pass

        # Migración: email, carnet, telefono
        for col, tipo in [("email", "TEXT"), ("carnet", "TEXT"), ("phone", "TEXT")]:
            try:
                conn.execute(f"ALTER TABLE drivers ADD COLUMN {col} {tipo}")
            except sqlite3.OperationalError:
                pass

        # Agregar columna finish_timestamp a race_drivers si no existe
        try:
            conn.execute("ALTER TABLE race_drivers ADD COLUMN finish_timestamp TEXT")
        except sqlite3.OperationalError:
            pass

        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('current_session_id', '0')"
        )
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('default_laps_limit', '10')"
        )
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('race_status', 'pending')"
        )

        session = conn.execute(
            'SELECT * FROM race_sessions WHERE status != "completed" LIMIT 1'
        ).fetchone()
        if not session:
            cursor = conn.execute(
                """
                INSERT INTO race_sessions (circuit_name, laps_limit, race_mode, time_limit_seconds, start_time, status)
                VALUES (?, ?, ?, ?, ?, 'pending')
            """,
                ("Circuito Principal", 10, "position", 0, None),
            )
            conn.execute(
                'UPDATE settings SET value = ? WHERE key = "current_session_id"',
                (str(cursor.lastrowid),),
            )
            print("[SISTEMA] Base de datos inicializada")

    # ===== IMPORTANTE: FUERA del with =====
    init_user_preferences_table()
    init_timing_config()


def add_driver(
    transponder_id,
    name,
    lastname="",
    age=None,
    gender="",
    nationality="",
    weight=None,
    description="",
    email="",
    carnet="",
    phone="",
    photo=None,
):
    with get_db() as conn:
        # ✅ Validar que el transponder no esté ya asignado a otro piloto
        if transponder_id is not None:
            existing = conn.execute(
                "SELECT id, name, lastname FROM drivers WHERE transponder_id = ?",
                (transponder_id,)
            ).fetchone()
            if existing:
                raise ValueError(
                    f"El transponder {transponder_id} ya está asignado al piloto "
                    f"{existing['name']} {existing.get('lastname', '')} (ID: {existing['id']})"
                )

        cursor = conn.execute(
            """
            INSERT OR REPLACE INTO drivers 
            (transponder_id, name, lastname, age, gender, nationality, weight, description, email, carnet, phone, photo, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                transponder_id,
                name,
                lastname,
                age,
                gender,
                nationality,
                weight,
                description,
                email,
                carnet,
                phone,
                photo or None,
                datetime.now().isoformat(),
            ),
        )
        if transponder_id is not None:
            conn.execute(
                """
                INSERT OR IGNORE INTO transponders (id, code, first_detected, is_active, usage_laps_total)
                VALUES (?, ?, ?, 1, 0)
            """,
                (transponder_id, str(transponder_id), datetime.now().isoformat()),
            )
            conn.execute(
                "UPDATE transponders SET last_seen = ? WHERE id = ?",
                (datetime.now().isoformat(), transponder_id),
            )
        return cursor.lastrowid


def delete_transponder(transponder_id):
    with get_db() as conn:
        # Solo permitir eliminar si no está asignado a un piloto
        assigned = conn.execute(
            "SELECT 1 FROM drivers WHERE transponder_id = ?", (transponder_id,)
        ).fetchone()
        if assigned:
            return False
        conn.execute("DELETE FROM transponders WHERE id = ?", (transponder_id,))
        return True


def update_transponder_id(old_id, new_id):
    with get_db() as conn:
        # Solo permitir si no está asignado
        assigned = conn.execute(
            "SELECT 1 FROM drivers WHERE transponder_id = ?", (old_id,)
        ).fetchone()
        if assigned:
            return False

        # Verificar que el nuevo ID no exista ya
        exists = conn.execute(
            "SELECT 1 FROM transponders WHERE id = ?", (new_id,)
        ).fetchone()
        if exists:
            return False

        conn.execute(
            "UPDATE transponders SET id = ?, code = ? WHERE id = ?",
            (new_id, str(new_id), old_id),
        )
        return True


def update_transponder(transponder_id, kart_id=None, description=None):
    with get_db() as conn:
        if kart_id is not None:
            conn.execute(
                "UPDATE transponders SET kart_id = ? WHERE id = ?",
                (kart_id, transponder_id),
            )
        if description is not None:
            conn.execute(
                "UPDATE transponders SET description = ? WHERE id = ?",
                (description, transponder_id),
            )
        return True


def get_all_drivers():
    with get_db() as conn:
        return [
            dict(r)
            for r in conn.execute("""
                SELECT d.*, t.kart_id as transponder_kart_id
                FROM drivers d
                LEFT JOIN transponders t ON d.transponder_id = t.id
                ORDER BY d.id DESC
            """).fetchall()
        ]


def get_driver_by_id(driver_id):
    with get_db() as conn:
        result = conn.execute(
            "SELECT * FROM drivers WHERE id = ?", (driver_id,)
        ).fetchone()
        return dict(result) if result else None


def get_driver_by_transponder(transponder_id):
    with get_db() as conn:
        result = conn.execute(
            "SELECT * FROM drivers WHERE transponder_id = ?", (transponder_id,)
        ).fetchone()
        return dict(result) if result else None


def delete_driver(driver_id):
    with get_db() as conn:
        conn.execute("DELETE FROM drivers WHERE id = ?", (driver_id,))


def add_transponder_manual(transponder_id, description="", kart_id=""):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM transponders WHERE id = ?", (transponder_id,)
        ).fetchone()
        if existing:
            return False
        conn.execute(
            """
            INSERT INTO transponders (id, code, description, kart_id, first_detected, is_active, usage_laps_total)
            VALUES (?, ?, ?, ?, ?, 1, 0)
        """,
            (
                transponder_id,
                str(transponder_id),
                description,
                kart_id,
                datetime.now().isoformat(),
            ),
        )
        return True


def add_transponder_detected(
    transponder_id,
    signal_h=None,
    signal_l=None,
    time_accumulated=None,
    physical_laps=None,
):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM transponders WHERE id = ?", (transponder_id,)
        ).fetchone()
        now = datetime.now().isoformat()
        if existing:
            # times_detected ya se incrementa automáticamente
            conn.execute(
                """
                UPDATE transponders 
                SET last_seen = ?, times_detected = times_detected + 1,
                    last_signal_h = ?, last_signal_l = ?, 
                    last_time_accumulated = ?, last_physical_laps = ?
                WHERE id = ?
            """,
                (
                    now,
                    signal_h,
                    signal_l,
                    time_accumulated,
                    physical_laps,
                    transponder_id,
                ),
            )
            return False
        else:
            conn.execute(
                """
                INSERT INTO transponders (id, code, first_detected, last_seen, is_active, 
                                        last_signal_h, last_signal_l, last_time_accumulated, last_physical_laps, times_detected) 
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 1)
            """,
                (
                    transponder_id,
                    str(transponder_id),
                    now,
                    now,
                    signal_h,
                    signal_l,
                    time_accumulated,
                    physical_laps,
                ),
            )
            return True


def get_transponder_health():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT 
                t.id, 
                t.description, 
                t.kart_id, 
                t.last_physical_laps,
                t.times_detected,
                t.last_seen,
                d.name, 
                d.lastname,
                (SELECT COUNT(*) FROM laps WHERE transponder_id = t.id AND timestamp > datetime('now', '-3 hours')) as laps_last_3h
            FROM transponders t
            LEFT JOIN drivers d ON d.transponder_id = t.id
            ORDER BY t.id ASC
        """).fetchall()

    items = []
    for r in rows:
        # Desgaste del transponder (vueltas totales)
        transponder_usage = int(r["times_detected"] or 0)

        # Desgaste del decoder (memoria física)
        decoder_memory = int(r["last_physical_laps"] or 0)

        # Desgaste por tiempo (últimas 3 horas)
        intensity = int(r["laps_last_3h"] or 0)

        # Determinar colores y alertas
        if transponder_usage < 40:
            transponder_health = "optimo"
            transponder_color = "#63d297"
        elif transponder_usage < 70:
            transponder_health = "moderado"
            transponder_color = "#f4c06b"
        else:
            transponder_health = "critico"
            transponder_color = "#ef7a86"

        # Alertas por intensidad en últimas 3 horas
        if intensity > 30:
            intensity_alert = "🔴 ALTA (descanso necesario)"
            intensity_color = "#ef7a86"
        elif intensity > 15:
            intensity_alert = "🟡 MODERADA"
            intensity_color = "#f4c06b"
        else:
            intensity_alert = "🟢 NORMAL"
            intensity_color = "#63d297"

        # Alerta de memoria del decoder
        if decoder_memory > 60:
            decoder_alert = "⚠️ MEMORIA CASI LLENA"
            decoder_color = "#ef7a86"
        elif decoder_memory > 40:
            decoder_alert = "⚠️ Memoria media"
            decoder_color = "#f4c06b"
        else:
            decoder_alert = "✅ OK"
            decoder_color = "#63d297"

        items.append(
            {
                "id": r["id"],
                "description": r["description"],
                "kart_id": r["kart_id"],
                "transponder_usage": transponder_usage,
                "transponder_health": transponder_health,
                "transponder_color": transponder_color,
                "decoder_memory": decoder_memory,
                "decoder_alert": decoder_alert,
                "decoder_color": decoder_color,
                "intensity": intensity,
                "intensity_alert": intensity_alert,
                "intensity_color": intensity_color,
                "last_seen": r["last_seen"],
                "assigned_driver": f"{(r['name'] or '').strip()} {(r['lastname'] or '').strip()}".strip()
                or None,
            }
        )
    return items


def reset_transponder_health(transponder_id):
    with get_db() as conn:
        # Resetear times_detected a 0
        cursor = conn.execute(
            "UPDATE transponders SET times_detected = 0 WHERE id = ?", (transponder_id,)
        )
        return cursor.rowcount > 0


def hard_reset_all_data():
    with get_db() as conn:
        conn.execute("DELETE FROM laps")
        conn.execute("DELETE FROM race_drivers")
        conn.execute("DELETE FROM race_sessions")
        conn.execute("DELETE FROM drivers")
        conn.execute("DELETE FROM transponders")
        conn.execute('UPDATE settings SET value = "0" WHERE key = "current_session_id"')
        conn.execute('UPDATE settings SET value = "pending" WHERE key = "race_status"')


def get_all_transponders():
    with get_db() as conn:
        return [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM transponders ORDER BY id ASC"
            ).fetchall()
        ]


def get_unassigned_transponders():
    with get_db() as conn:
        return [
            dict(r)
            for r in conn.execute("""
            SELECT t.* FROM transponders t
            LEFT JOIN drivers d ON t.id = d.transponder_id
            WHERE d.id IS NULL
            ORDER BY t.first_detected DESC
        """).fetchall()
        ]


def get_current_session():
    with get_db() as conn:
        result = conn.execute(
            "SELECT * FROM race_sessions ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return dict(result) if result else None


def get_latest_session():
    with get_db() as conn:
        result = conn.execute(
            "SELECT * FROM race_sessions ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return dict(result) if result else None


def normalize_race_mode(value):
    v = (value or "").strip().lower()
    if v in ("time_attack", "time-attack", "timeattack", "ta"):
        return "time_attack"
    if v in ("classification", "clasificacion", "class", "cl"):
        return "classification"
    if v in ("endurance", "enduro", "en"):
        return "endurance"
    return "position"

# ==================== CLASSIFICATION Y ENDURANCE - FUNCIÓN ADICIONAL ====================
def get_session_time_limit(session_id):
    """Obtiene el tiempo límite de una sesión"""
    with get_db() as conn:
        result = conn.execute(
            "SELECT time_limit_seconds FROM race_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        return result["time_limit_seconds"] if result else 0


def start_new_session(
    circuit_name, laps_limit, race_mode="position", time_limit_seconds=0
):
    with get_db() as conn:
        mode = normalize_race_mode(race_mode)
        try:
            tls = int(time_limit_seconds or 0)
        except (TypeError, ValueError):
            tls = 0

        cursor = conn.execute(
            'INSERT INTO race_sessions (circuit_name, laps_limit, race_mode, time_limit_seconds, start_time, status) VALUES (?, ?, ?, ?, ?, "pending")',
            (circuit_name, laps_limit, mode, max(0, tls), None),
        )
        session_id = cursor.lastrowid
        conn.execute(
            'UPDATE settings SET value = ? WHERE key = "current_session_id"',
            (str(session_id),),
        )
        conn.execute('UPDATE settings SET value = "pending" WHERE key = "race_status"')
        return session_id


def get_session_info(session_id):
    with get_db() as conn:
        result = conn.execute(
            "SELECT * FROM race_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        return dict(result) if result else None


def update_race_status(session_id, status, winner_driver_id=None, winner_time=None):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id

        try:
            session = conn.execute(
                "SELECT status, start_time, end_time, elapsed_seconds, last_status_change_at FROM race_sessions WHERE id = ?",
                (s_id,),
            ).fetchone()
        except sqlite3.OperationalError:
            session = None

        # Modo legacy: si la DB aún no tiene las columnas nuevas, no rompemos el runtime.
        if session is None:
            now = datetime.now().isoformat()
            if status == "completed":
                conn.execute(
                    "UPDATE race_sessions SET status = ?, end_time = ?, winner_driver_id = COALESCE(?, winner_driver_id), winner_time = COALESCE(?, winner_time) WHERE id = ?",
                    (status, now, winner_driver_id, winner_time, s_id),
                )
            elif status == "active":
                conn.execute(
                    "UPDATE race_sessions SET status = ?, start_time = COALESCE(start_time, ?) WHERE id = ?",
                    (status, now, s_id),
                )
            else:
                conn.execute(
                    "UPDATE race_sessions SET status = ? WHERE id = ?", (status, s_id)
                )
            conn.execute(
                'UPDATE settings SET value = ? WHERE key = "race_status"', (status,)
            )
            return

        if not session:
            return

        now = datetime.now().isoformat()
        previous_status = session["status"]
        start_time = session["start_time"]
        elapsed_seconds = float(session["elapsed_seconds"] or 0)
        last_status_change_at = session["last_status_change_at"]

        if previous_status == "active" and last_status_change_at:
            try:
                delta = (
                    datetime.fromisoformat(now)
                    - datetime.fromisoformat(last_status_change_at)
                ).total_seconds()
                elapsed_seconds += max(0.0, delta)
            except ValueError:
                pass

        next_start_time = start_time
        next_end_time = session["end_time"]
        next_last_status_change = now

        if status == "active":
            if not start_time:
                next_start_time = now
        elif status == "completed":
            next_end_time = now
        elif status == "pending":
            elapsed_seconds = 0
            next_start_time = None
            next_end_time = None
            next_last_status_change = None

        conn.execute(
            """
            UPDATE race_sessions
            SET status = ?, start_time = ?, end_time = ?, elapsed_seconds = ?, last_status_change_at = ?,
                winner_driver_id = COALESCE(?, winner_driver_id),
                winner_time = COALESCE(?, winner_time)
            WHERE id = ?
        """,
            (
                status,
                next_start_time,
                next_end_time,
                elapsed_seconds,
                next_last_status_change,
                winner_driver_id,
                winner_time,
                s_id,
            ),
        )

        conn.execute(
            'UPDATE settings SET value = ? WHERE key = "race_status"', (status,)
        )


def get_session_elapsed_seconds(session):
    if not session:
        return 0.0

    # Compatible con DB vieja: si no existen columnas nuevas, calculamos desde start_time/end_time.
    if "elapsed_seconds" not in session and session.get("start_time"):
        try:
            start = datetime.fromisoformat(session["start_time"])
            if session.get("status") == "completed" and session.get("end_time"):
                end = datetime.fromisoformat(session["end_time"])
                return max(0.0, (end - start).total_seconds())
            if session.get("status") in ("active", "paused", "completed"):
                return max(0.0, (datetime.now() - start).total_seconds())
        except ValueError:
            return 0.0

    elapsed_seconds = float(session.get("elapsed_seconds") or 0)
    status = session.get("status")
    last_status_change_at = session.get("last_status_change_at")

    if status == "active" and last_status_change_at:
        try:
            elapsed_seconds += max(
                0.0,
                (
                    datetime.now() - datetime.fromisoformat(last_status_change_at)
                ).total_seconds(),
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
        conn.execute(
            "INSERT OR REPLACE INTO race_drivers (session_id, driver_id, transponder_id, start_position) VALUES (?, ?, ?, ?)",
            (s_id, driver_id, transponder_id, start_position),
        )


def remove_driver_from_race(session_id, driver_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        conn.execute(
            "DELETE FROM race_drivers WHERE session_id = ? AND driver_id = ?",
            (s_id, driver_id),
        )


def get_race_drivers(session_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        return [
            dict(r)
            for r in conn.execute(
                """
            SELECT rd.*, d.name, d.lastname, d.transponder_id as driver_transponder, d.photo, t.kart_id as transponder_kart_id
            FROM race_drivers rd
            JOIN drivers d ON rd.driver_id = d.id
            LEFT JOIN transponders t ON d.transponder_id = t.id
            WHERE rd.session_id = ?
            ORDER BY rd.start_position ASC
        """,
                (s_id,),
            ).fetchall()
        ]


def is_driver_in_race(session_id, transponder_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        result = conn.execute(
            """
            SELECT 1 FROM race_drivers rd
            JOIN drivers d ON rd.driver_id = d.id
            WHERE rd.session_id = ? AND d.transponder_id = ?
        """,
            (s_id, transponder_id),
        ).fetchone()
        return result is not None


def clear_race_drivers(session_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id
        conn.execute("DELETE FROM race_drivers WHERE session_id = ?", (s_id,))


def save_lap(
    session_id,
    driver_id,
    transponder_id,
    physical_laps,
    lap_number,
    total_seconds,
    lap_seconds,
    signal_h,
    signal_l,
    position=None,
    gap_to_leader=None,
    is_last_lap=False,
):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id

        track_length = get_track_length()

        # Calcular velocidad promedio (km/h)
        avg_speed = None
        if track_length > 0 and lap_seconds and lap_seconds > 0:
            avg_speed = (track_length / lap_seconds) * 3600

        # ... resto del código existente ...
        conn.execute(
            """
            INSERT INTO laps (session_id, driver_id, transponder_id, lap_number, physical_laps, 
                            timestamp, total_seconds, lap_seconds, position_at_lap, gap_to_leader,
                            signal_h, signal_l, is_last_lap, avg_speed_kmh)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                s_id,
                driver_id,
                transponder_id,
                lap_number,
                physical_laps,
                datetime.now().isoformat(),
                total_seconds,
                lap_seconds,
                position,
                gap_to_leader,
                signal_h,
                signal_l,
                is_last_lap,
                avg_speed,
            ),
        )

        if lap_number > 0 and lap_seconds:
            current_best = conn.execute(
                "SELECT best_lap, best_lap_number FROM race_drivers WHERE session_id = ? AND driver_id = ?",
                (s_id, driver_id),
            ).fetchone()
            if (
                not current_best
                or not current_best["best_lap"]
                or lap_seconds < current_best["best_lap"]
            ):
                conn.execute(
                    "UPDATE race_drivers SET best_lap = ?, best_lap_number = ? WHERE session_id = ? AND driver_id = ?",
                    (lap_seconds, lap_number, s_id, driver_id),
                )


def update_driver_finish_time(
    session_id, driver_id, finish_total_seconds, finish_timestamp=None
):
    """Actualiza el tiempo total de finalización de un piloto en race_drivers
    También guarda el timestamp para saber el orden de llegada (Position Race)
    """
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id

        # Si no se proporciona timestamp, usar el actual
        if finish_timestamp is None:
            from datetime import datetime

            finish_timestamp = datetime.now().isoformat()

        conn.execute(
            """
            UPDATE race_drivers 
            SET finished = 1, total_time = ?, finish_timestamp = ?
            WHERE session_id = ? AND driver_id = ?
        """,
            (finish_total_seconds, finish_timestamp, s_id, driver_id),
        )
        return True


def update_driver(driver_id, transponder_id, name, lastname="", email="", carnet="", phone="", photo=None):
    with get_db() as conn:
        # ✅ Validar transponder duplicado (excluyendo al piloto actual)
        if transponder_id is not None:
            existing = conn.execute(
                "SELECT id, name, lastname FROM drivers WHERE transponder_id = ? AND id != ?",
                (transponder_id, driver_id)
            ).fetchone()
            if existing:
                raise ValueError(
                    f"El transponder {transponder_id} ya está asignado al piloto "
                    f"{existing['name']} {existing.get('lastname', '')} (ID: {existing['id']})"
                )

        conn.execute(
            """
            UPDATE drivers 
            SET transponder_id = ?, name = ?, lastname = ?, email = ?, carnet = ?, phone = ?
            WHERE id = ?
        """,
            (transponder_id, name, lastname, email or "", carnet or "", phone or "", driver_id),
        )
        if photo:
            conn.execute(
                "UPDATE drivers SET photo = ? WHERE id = ?",
                (photo, driver_id),
            )
        return True


def clear_all_driver_transponders():
    """Quita el transponder_id de todos los pilotos (lo pone a NULL)"""
    with get_db() as conn:
        conn.execute("UPDATE drivers SET transponder_id = NULL")
    return True


def get_recent_signals(limit=10):
    with get_db() as conn:
        return [
            dict(r)
            for r in conn.execute(
                """
            SELECT id as transponder_id, last_seen, times_detected, 
                   last_signal_h, last_signal_l, last_time_accumulated, last_physical_laps
            FROM transponders
            ORDER BY last_seen DESC
            LIMIT ?
        """,
                (limit,),
            ).fetchall()
        ]


def get_leaderboard_with_details(session_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id

        session_info = conn.execute(
            "SELECT race_mode, laps_limit, time_limit_seconds FROM race_sessions WHERE id = ?", (s_id,)
        ).fetchone()
        
        if not session_info:
            return []
        
        race_mode = normalize_race_mode(session_info["race_mode"])
        laps_limit = session_info["laps_limit"] if session_info["laps_limit"] is not None and session_info["laps_limit"] > 0 else 0

        effective_laps_limit = laps_limit
        if race_mode in ('classification', 'endurance'):
            effective_laps_limit = 999999

        results = conn.execute(
            """
    SELECT 
        d.id as driver_id,
        d.name,
        d.lastname,
        d.transponder_id,
        t.kart_id as kart_id,
        d.photo,
        rd.finished as is_finished_flag,
        rd.total_time as race_total_time_stored,
        rd.finish_timestamp as finish_timestamp,
        MIN(l.timestamp) as first_detection,
        MAX(l.timestamp) as last_detection,
        COUNT(DISTINCT CASE WHEN l.lap_number > 0 AND l.lap_number <= ? THEN l.lap_number END) as total_laps,
        (julianday(COALESCE(MAX(CASE WHEN l.is_last_lap = 1 THEN l.timestamp END), datetime('now'))) - julianday(MIN(l.timestamp))) * 86400 as real_total_time,
        MIN(CASE WHEN l.lap_number > 0 AND l.lap_number <= ? AND l.lap_seconds IS NOT NULL THEN l.lap_seconds END) as best_lap,
        MAX(CASE WHEN l.lap_number > 0 AND l.lap_number <= ? THEN l.lap_number END) as last_valid_lap_number,
        (julianday(COALESCE(MAX(l.timestamp), datetime('now'))) - julianday(MIN(l.timestamp))) * 86400 as calculated_total_time,
        SUM(CASE WHEN l.lap_number > 0 AND l.lap_number <= ? AND l.lap_seconds IS NOT NULL THEN l.lap_seconds ELSE 0 END) as sum_lap_times
    FROM race_drivers rd
    JOIN drivers d ON rd.driver_id = d.id
    LEFT JOIN transponders t ON t.id = d.transponder_id
    LEFT JOIN laps l ON l.driver_id = d.id AND l.session_id = rd.session_id
    WHERE rd.session_id = ?
    GROUP BY rd.id, d.id, d.name, d.lastname, d.transponder_id, t.kart_id, d.photo
""",
            (effective_laps_limit, effective_laps_limit, effective_laps_limit, effective_laps_limit, s_id),
        ).fetchall()

        leaderboard = []
        for row in results:
            row_dict = dict(row)
            row_dict["total_laps"] = int(row_dict.get("total_laps") or 0)
            if laps_limit > 0:
                row_dict["laps_remaining"] = max(0, laps_limit - row_dict["total_laps"])
            else:
                row_dict["laps_remaining"] = 0
            row_dict["is_finished"] = bool(row_dict.get("is_finished_flag"))
            row_dict["full_name"] = (
                f"{row_dict['name']} {row_dict.get('lastname', '')}".strip()
            )
            
            # ✅ CORREGIDO: Calcular tiempo total para TIME ATTACK usando suma de vueltas
            if race_mode == "time_attack":
                # Usar sum_lap_times (suma de tiempos de vuelta) como tiempo total
                row_dict["race_total_time"] = (
                    float(row_dict.get("sum_lap_times")) 
                    if row_dict.get("sum_lap_times") is not None and row_dict.get("sum_lap_times") > 0
                    else None
                )
                # Si no hay sum_lap_times, usar el valor guardado en race_drivers (por si acaso)
                if row_dict["race_total_time"] is None and row_dict.get("race_total_time_stored") is not None:
                    row_dict["race_total_time"] = float(row_dict["race_total_time_stored"])
            elif race_mode == "classification":
                row_dict["race_total_time"] = None
            else:
                row_dict["race_total_time"] = (
                    float(row_dict["race_total_time_stored"])
                    if row_dict["race_total_time_stored"] is not None
                    else None
                )
            
            row_dict["real_total_time"] = float(row_dict.get("real_total_time") or 0.0)

            last_lap_row = conn.execute(
                """
                SELECT lap_seconds, avg_speed_kmh FROM laps
                WHERE driver_id = ? AND session_id = ? AND lap_number = ?
                ORDER BY id DESC LIMIT 1
            """,
                (
                    row_dict["driver_id"],
                    s_id,
                    row_dict.get("last_valid_lap_number") or 0,
                ),
            ).fetchone()

            if last_lap_row:
                row_dict["last_lap"] = (
                    float(last_lap_row["lap_seconds"])
                    if last_lap_row["lap_seconds"]
                    else None
                )
                row_dict["avg_speed_kmh"] = (
                    float(last_lap_row["avg_speed_kmh"])
                    if last_lap_row["avg_speed_kmh"]
                    else None
                )
            else:
                row_dict["last_lap"] = None
                row_dict["avg_speed_kmh"] = None

            leaderboard.append(row_dict)

        # ===== ORDENAMIENTO SEGÚN MODO =====
        if race_mode == "time_attack":
            finished = [x for x in leaderboard if x["is_finished"]]
            not_finished = [x for x in leaderboard if not x["is_finished"]]

            # ✅ CORREGIDO: Ordenar por race_total_time (suma de vueltas) ascendente
            finished.sort(
                key=lambda x: (
                    x["race_total_time"] if x["race_total_time"] is not None and x["race_total_time"] > 0 else float("inf")
                )
            )

            not_finished.sort(
                key=lambda x: (
                    -x["total_laps"],
                    x["best_lap"] if x["best_lap"] else 999999,
                )
            )

            leaderboard = finished + not_finished

        elif race_mode == "classification":
            leaderboard.sort(
                key=lambda x: (
                    -x.get("total_laps", 0),
                    x.get("best_lap") if x.get("best_lap") is not None and x.get("best_lap") > 0 else float("inf"),
                )
            )

        elif race_mode == "endurance":
            leaderboard.sort(
                key=lambda x: (
                    -x.get("total_laps", 0),
                    x.get("real_total_time") if x.get("real_total_time") is not None and x.get("real_total_time") > 0 else float("inf"),
                    x.get("best_lap") if x.get("best_lap") is not None and x.get("best_lap") > 0 else float("inf")
                )
            )

        else:
            # POSITION RACE
            finished = [x for x in leaderboard if x["is_finished"]]
            not_finished = [x for x in leaderboard if not x["is_finished"]]

            finished.sort(
                key=lambda x: (
                    x["finish_timestamp"]
                    if x["finish_timestamp"]
                    else "9999-12-31T23:59:59"
                )
            )

            not_finished.sort(
                key=lambda x: (
                    -x["total_laps"],
                    x["best_lap"] if x["best_lap"] else 999999,
                )
            )

            leaderboard = finished + not_finished

        # Asignar posiciones
        for i, driver in enumerate(leaderboard):
            driver["position"] = i + 1

        # ===== CÁLCULO DE GAP =====
        if leaderboard and len(leaderboard) > 0:
            leader = leaderboard[0]

            for driver in leaderboard:
                if driver["driver_id"] == leader["driver_id"]:
                    driver["gap"] = "Líder"
                elif race_mode == "endurance":
                    if driver["total_laps"] != leader["total_laps"]:
                        lap_diff = leader["total_laps"] - driver["total_laps"]
                        driver["gap"] = f"+{lap_diff} v"
                    else:
                        leader_time = leader.get("best_lap", 0) or 0
                        driver_time = driver.get("best_lap", 0) or 0
                        if leader_time > 0 and driver_time > 0:
                            gap_seconds = driver_time - leader_time
                            driver["gap"] = f"+{gap_seconds:.3f}s" if gap_seconds > 0 else "Líder"
                        else:
                            driver["gap"] = "--"
                elif race_mode == "classification":
                    leader_time = leader.get("best_lap", 0) or 0
                    driver_time = driver.get("best_lap", 0) or 0
                    if driver_time is not None and leader_time > 0 and driver_time > 0:
                        gap_seconds = driver_time - leader_time
                        driver["gap"] = f"+{gap_seconds:.3f}s" if gap_seconds > 0 else "Líder"
                    else:
                        driver["gap"] = "--"
                elif driver["total_laps"] != leader["total_laps"]:
                    lap_diff = leader["total_laps"] - driver["total_laps"]
                    driver["gap"] = f"+{lap_diff} v"
                else:
                    if race_mode == "time_attack":
                        leader_time = leader.get("race_total_time", 0) or 0
                        driver_time = driver.get("race_total_time", 0) or 0
                    else:
                        leader_time = leader.get("race_total_time", 0) or 0
                        driver_time = driver.get("race_total_time", 0) or 0

                    if leader_time > 0 and driver_time > 0:
                        gap_seconds = driver_time - leader_time
                        driver["gap"] = f"+{gap_seconds:.3f}s" if gap_seconds > 0 else "Líder"
                    else:
                        driver["gap"] = "--"

        return leaderboard

def get_lap_details(session_id, driver_id):
    with get_db() as conn:
        return [
            dict(r)
            for r in conn.execute(
                """
            SELECT lap_number, lap_seconds, position_at_lap, gap_to_leader
            FROM laps
            WHERE session_id = ? AND driver_id = ? AND lap_number > 0
            ORDER BY lap_number ASC
        """,
                (session_id, driver_id),
            ).fetchall()
        ]


def get_race_history(limit=50):
    """Obtiene el historial de carreras completadas"""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT 
                rs.id,
                rs.circuit_name,
                rs.laps_limit,
                rs.race_mode,
                rs.start_time,
                rs.end_time,
                rs.status,
                rs.winner_driver_id,
                rs.winner_time,
                d.name as winner_name,
                d.lastname as winner_lastname,
                (SELECT COUNT(*) FROM race_drivers WHERE session_id = rs.id) as total_drivers,
                (SELECT COUNT(*) FROM laps WHERE session_id = rs.id) as total_laps
            FROM race_sessions rs
            LEFT JOIN drivers d ON rs.winner_driver_id = d.id
            WHERE rs.status = 'completed'
            ORDER BY rs.end_time DESC
            LIMIT ?
        """,
            (limit,),
        )

        results = []
        for row in rows:
            r = dict(row)
            # Formatear fechas para mostrar
            if r.get("start_time"):
                r["start_time_formatted"] = r["start_time"].replace("T", " ")[:19]
            if r.get("end_time"):
                r["end_time_formatted"] = r["end_time"].replace("T", " ")[:19]
            results.append(r)

        return results


def get_podium(session_id):
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except (TypeError, ValueError):
            s_id = session_id

        session = conn.execute(
            "SELECT race_mode, laps_limit FROM race_sessions WHERE id = ?", (s_id,)
        ).fetchone()
        race_mode = normalize_race_mode(session["race_mode"] if session else None)
        laps_limit = int(session["laps_limit"] or 10) if session else 10

        effective_laps_limit = laps_limit
        if race_mode in ('classification', 'endurance'):
            effective_laps_limit = 999999

        rows = conn.execute("""
            SELECT
                d.id AS driver_id,
                d.name,
                d.lastname,
                d.transponder_id,
                t.kart_id AS kart_id,
                d.photo,  -- ✅ AGREGAR ESTA LÍNEA
                COUNT(CASE WHEN l.lap_number > 0 AND l.lap_number <= ? THEN 1 END) AS total_laps,
                SUM(CASE WHEN l.lap_number > 0 AND l.lap_number <= ? AND l.lap_seconds IS NOT NULL THEN l.lap_seconds ELSE 0 END) AS total_time,
                MIN(CASE WHEN l.lap_number > 0 AND l.lap_number <= ? AND l.lap_seconds IS NOT NULL THEN l.lap_seconds END) AS best_lap,
                MIN(CASE WHEN l.lap_number = ? THEN l.total_seconds END) AS finish_total_seconds,
                COALESCE(MAX(CASE WHEN l.lap_number > 0 AND l.lap_number <= ? THEN l.timestamp END), '9999-12-31T23:59:59') AS last_lap_ts,
                (SELECT COUNT(*) FROM laps l2 WHERE l2.session_id = rd.session_id AND l2.driver_id = d.id AND l2.lap_number > 0) as completed_laps,
                (julianday(COALESCE(MAX(CASE WHEN l.is_last_lap = 1 THEN l.timestamp END), datetime('now'))) - julianday(MIN(l.timestamp))) * 86400 as real_total_time
            FROM race_drivers rd
            JOIN drivers d ON rd.driver_id = d.id
            LEFT JOIN transponders t ON t.id = d.transponder_id
            LEFT JOIN laps l ON l.session_id = rd.session_id AND l.driver_id = d.id
            WHERE rd.session_id = ?
            GROUP BY rd.id, d.id, d.name, d.lastname, d.transponder_id, t.kart_id, d.photo
        """, (
            effective_laps_limit, effective_laps_limit, effective_laps_limit,
            effective_laps_limit, effective_laps_limit, s_id
        )).fetchall()

        podium = []
        for r in rows:
            d = dict(r)
            d["full_name"] = f"{d.get('name', '')} {d.get('lastname', '')}".strip()
            d["total_laps"] = int(d.get("total_laps") or 0)
            d["total_time"] = float(d.get("total_time") or 0.0)
            d["real_total_time"] = float(d.get("real_total_time") or 0.0)
            d["finish_total_seconds"] = float(d.get("finish_total_seconds") or 0.0)
            if race_mode == 'classification':
                d["is_finished"] = d["total_laps"] > 0
            else:
                d["is_finished"] = d["total_laps"] >= laps_limit
            if d.get("best_lap") is not None:
                try:
                    d["best_lap"] = float(d["best_lap"])
                except (TypeError, ValueError):
                    d["best_lap"] = None
            podium.append(d)

        if race_mode == "time_attack":
            # ✅ CORREGIDO: Ordenar por total_time (suma de vueltas) ascendente
            podium.sort(
                key=lambda x: (
                    0 if x["is_finished"] else 1,
                    x["total_time"] if x["is_finished"] and x["total_time"] > 0 else float("inf"),
                    -x["total_laps"],
                    x["best_lap"] if x["best_lap"] else 999999,
                )
            )
        elif race_mode in ("classification", "endurance"):
            if race_mode == "classification":
                podium.sort(
                    key=lambda x: (
                        -x.get("total_laps", 0),
                        x.get("best_lap") if x.get("best_lap") is not None and x.get("best_lap") > 0 else float("inf"),
                    )
                )
            else:
                podium.sort(
                    key=lambda x: (
                        -x["total_laps"],
                        x["best_lap"] if x["best_lap"] is not None else float("inf"),
                    )
                )
        else:
            podium.sort(
                key=lambda x: (
                    0 if x["is_finished"] else 1,
                    x["last_lap_ts"]
                    if x["is_finished"] and x["last_lap_ts"]
                    else "9999-12-31T23:59:59",
                    -x["total_laps"],
                    x["best_lap"] if x["best_lap"] else 999999,
                )
            )

        full_podium = list(podium)
        podium = podium[:3]
        result = {"race_mode": race_mode, "podium": podium}

        if race_mode == "classification":
            with_laps = [d for d in full_podium if d.get("total_laps", 0) > 0]
            dnq = [d for d in full_podium if d.get("total_laps", 0) <= 0]
            n = len(with_laps)
            if n >= 3:
                third = max(1, n // 3)
                q1 = with_laps[:third]
                q2 = with_laps[third:2*third]
                q3 = with_laps[2*third:]
            elif n == 2:
                q1 = with_laps[:1]
                q2 = with_laps[1:]
                q3 = []
            elif n == 1:
                q1 = with_laps
                q2 = []
                q3 = []
            else:
                q1 = []
                q2 = []
                q3 = []
            result["classification_groups"] = {
                "q1": q1,
                "q2": q2,
                "q3": q3,
                "dnq": dnq,
            }

        return result

JSON_STATE_FILE = "/app/data/race_state.json"


def guardar_estado_repetir(
    session_id, circuit_name, laps_limit, race_drivers, race_mode=None
):
    estado = {
        "action": "repeat_race",
        "session_id": session_id,
        "circuit_name": circuit_name,
        "laps_limit": laps_limit,
        "race_mode": normalize_race_mode(race_mode),
        "race_drivers": race_drivers,
    }
    with open(JSON_STATE_FILE, "w") as f:
        json.dump(estado, f, indent=2)
    print(
        f"[SISTEMA] Estado guardado para repetir carrera: {len(race_drivers)} pilotos"
    )


def cargar_estado_repetir():
    if not os.path.exists(JSON_STATE_FILE):
        return None
    with open(JSON_STATE_FILE, "r") as f:
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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS antenna_config (
                id INTEGER PRIMARY KEY DEFAULT 1,
                min_signal INTEGER DEFAULT 5,
                filter_time REAL DEFAULT 0.5,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            INSERT OR IGNORE INTO antenna_config (id, min_signal, filter_time)
            VALUES (1, 5, 0.5)
        """)
        result = conn.execute("SELECT * FROM antenna_config WHERE id = 1").fetchone()
        return dict(result) if result else {"min_signal": 5, "filter_time": 0.5}


def update_antenna_config(min_signal=None, filter_time=None):
    """Actualiza la configuración de la antena"""
    with get_db() as conn:
        if min_signal is not None:
            conn.execute(
                "UPDATE antenna_config SET min_signal = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
                (min_signal,),
            )
        if filter_time is not None:
            conn.execute(
                "UPDATE antenna_config SET filter_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
                (filter_time,),
            )
        return True


def get_driver_individual_times(session_id):
    """Obtiene el tiempo total individual de cada piloto desde su primera detección"""
    with get_db() as conn:
        try:
            s_id = int(session_id)
        except:
            s_id = session_id

        # Obtener la primera detección (vuelta de salida) y última de cada piloto
        results = conn.execute(
            """
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
            LEFT JOIN transponders t ON t.id = d.transponder_id
            LEFT JOIN laps l ON l.driver_id = d.id AND l.session_id = rd.session_id
            WHERE rd.session_id = ?
            GROUP BY rd.id, d.id, d.name, d.lastname, d.transponder_id, t.kart_id, d.photo
        """,
            (s_id,),
        ).fetchall()

        times = []
        for row in results:
            first_seconds = row["first_total_seconds"]
            last_seconds = row["last_total_seconds"]
            individual_time = None

            if first_seconds is not None and last_seconds is not None:
                individual_time = last_seconds - first_seconds

            times.append(
                {
                    "driver_id": row["driver_id"],
                    "driver_name": f"{row['name']} {row['lastname'] or ''}".strip(),
                    "first_detection": row["first_detection"],
                    "last_detection": row["last_detection"],
                    "individual_time_seconds": individual_time,  # Mantener segundos
                    "individual_time_formatted": format_individual_time(individual_time)
                    if individual_time
                    else "--",  # Ya existe
                    "completed_laps": row["completed_laps"] or 0,
                }
            )

        return times


def format_individual_time(seconds):
    """Formatea tiempo individual en HH:MM:SS.mmm"""
    if seconds is None:
        return "--"
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    milliseconds = int((secs - int(secs)) * 1000)

    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{int(secs):02d}.{milliseconds:03d}"
    else:
        return f"{minutes:02d}:{int(secs):02d}.{milliseconds:03d}"


def get_backup_dir():
    """Obtiene la carpeta de respaldos según el SO"""
    if IS_WINDOWS:
        backup_dir = os.path.join(os.path.dirname(DB_PATH), "backups")
    else:
        backup_dir = "/app/data/backups"

    if not os.path.exists(backup_dir):
        os.makedirs(backup_dir)
    return backup_dir


def create_backup():
    """Crea un respaldo de la base de datos actual con timestamp"""
    import shutil
    from datetime import datetime

    backup_dir = get_backup_dir()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = os.path.join(backup_dir, f"chronit_backup_{timestamp}.db")

    if os.path.exists(DB_PATH):
        shutil.copy2(DB_PATH, backup_file)
        print(f"✅ Respaldo creado: {backup_file}")
        return backup_file
    return None


def get_backups_list():
    """Lista todos los respaldos disponibles"""
    backup_dir = get_backup_dir()
    if not os.path.exists(backup_dir):
        return []

    backups = []
    for file in os.listdir(backup_dir):
        if file.endswith(".db") and file.startswith("chronit_backup_"):
            file_path = os.path.join(backup_dir, file)
            stat = os.stat(file_path)
            backups.append(
                {
                    "filename": file,
                    "path": file_path,
                    "size_mb": round(stat.st_size / (1024 * 1024), 2),
                    "created": datetime.fromtimestamp(stat.st_ctime).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                }
            )

    # Ordenar por fecha (más reciente primero)
    backups.sort(key=lambda x: x["created"], reverse=True)
    return backups


def soft_reset_race_data():
    """
    Limpia SOLO los datos de carrera (vueltas, sesiones, inscripciones)
    pero CONSERVA pilotos y transponders
    """
    # Primero crear respaldo automático
    backup_file = create_backup()
    print(f"📁 Respaldo creado antes de limpiar: {backup_file}")

    with get_db() as conn:
        # Contar registros antes de borrar
        laps_count = conn.execute("SELECT COUNT(*) FROM laps").fetchone()[0]
        sessions_count = conn.execute("SELECT COUNT(*) FROM race_sessions").fetchone()[
            0
        ]
        race_drivers_count = conn.execute(
            "SELECT COUNT(*) FROM race_drivers"
        ).fetchone()[0]

        print(
            f"📊 Borrando: {laps_count} vueltas, {sessions_count} carreras, {race_drivers_count} inscripciones"
        )

        # Borrar solo datos de carrera
        conn.execute("DELETE FROM laps")
        conn.execute("DELETE FROM race_drivers")
        conn.execute("DELETE FROM race_sessions")

        # Reiniciar la sesión actual
        conn.execute('UPDATE settings SET value = "0" WHERE key = "current_session_id"')
        conn.execute('UPDATE settings SET value = "pending" WHERE key = "race_status"')

        # Crear una nueva sesión por defecto
        cursor = conn.execute(
            """
            INSERT INTO race_sessions (circuit_name, laps_limit, start_time, status)
            VALUES (?, ?, ?, 'pending')
        """,
            ("Circuito Principal", 10, None),
        )
        conn.execute(
            'UPDATE settings SET value = ? WHERE key = "current_session_id"',
            (str(cursor.lastrowid),),
        )

    return {
        "laps_deleted": laps_count,
        "sessions_deleted": sessions_count,
        "race_drivers_deleted": race_drivers_count,
        "backup_file": backup_file,
    }


def safe_hard_reset():
    """Reinicio forzado PERO con respaldo previo"""
    backup_file = create_backup()
    hard_reset_all_data()
    return backup_file


def restore_backup(backup_filename):
    """Restaura un respaldo específico"""
    import shutil

    backup_dir = get_backup_dir()
    backup_path = os.path.join(backup_dir, backup_filename)

    if not os.path.exists(backup_path):
        raise Exception(f"Respaldo no encontrado: {backup_filename}")

    # Crear respaldo del estado actual antes de restaurar
    create_backup()

    # Restaurar
    shutil.copy2(backup_path, DB_PATH)
    print(f"✅ Base de datos restaurada desde: {backup_path}")
    return True


def get_db_stats():
    """Obtiene estadísticas de la base de datos"""
    with get_db() as conn:
        drivers = conn.execute("SELECT COUNT(*) FROM drivers").fetchone()[0]
        transponders = conn.execute("SELECT COUNT(*) FROM transponders").fetchone()[0]
        laps = conn.execute("SELECT COUNT(*) FROM laps").fetchone()[0]
        sessions = conn.execute("SELECT COUNT(*) FROM race_sessions").fetchone()[0]

        # Tamaño del archivo
        size_bytes = os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0
        size_mb = round(size_bytes / (1024 * 1024), 2)

        return {
            "drivers": drivers,
            "transponders": transponders,
            "laps": laps,
            "sessions": sessions,
            "size_mb": size_mb,
            "db_path": DB_PATH,
        }


# ==================== RESPALDOS DE PILOTOS Y TRANSPONDERS ====================


def backup_drivers_and_transponders():
    """Guarda una copia de seguridad de pilotos y transponders en un archivo JSON"""
    import json
    from datetime import datetime

    with get_db() as conn:
        drivers = [
            dict(row) for row in conn.execute("SELECT * FROM drivers").fetchall()
        ]
        transponders = [
            dict(row) for row in conn.execute("SELECT * FROM transponders").fetchall()
        ]

    backup_data = {
        "timestamp": datetime.now().isoformat(),
        "drivers": drivers,
        "transponders": transponders,
    }

    # Guardar en archivo JSON
    backup_dir = get_backup_dir()
    filename = (
        f"pilotos_transponders_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    filepath = os.path.join(backup_dir, filename)

    with open(filepath, "w") as f:
        json.dump(backup_data, f, indent=2, default=str)

    print(f"✅ Respaldo de pilotos y transponders guardado: {filepath}")
    return filepath


def get_pilotos_backups_list():
    """Lista todos los respaldos de pilotos y transponders disponibles"""
    backup_dir = get_backup_dir()
    if not os.path.exists(backup_dir):
        return []  # ✅ Debe devolver array vacío, no None

    backups = []
    for file in os.listdir(backup_dir):
        if file.endswith(".json") and file.startswith("pilotos_transponders_backup_"):
            file_path = os.path.join(backup_dir, file)
            stat = os.stat(file_path)
            backups.append(
                {
                    "filename": file,
                    "path": file_path,
                    "size_kb": round(stat.st_size / 1024, 2),
                    "created": datetime.fromtimestamp(stat.st_ctime).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                }
            )

    backups.sort(key=lambda x: x["created"], reverse=True)
    return backups


def restore_drivers_and_transponders_from_backup(filename):
    """Restaura pilotos y transponders desde un archivo JSON"""
    import json
    import shutil

    backup_dir = get_backup_dir()
    backup_path = os.path.join(backup_dir, filename)

    if not os.path.exists(backup_path):
        raise Exception(f"Respaldo no encontrado: {filename}")

    # Cargar datos del JSON
    with open(backup_path, "r") as f:
        data = json.load(f)

    drivers = data.get("drivers", [])
    transponders = data.get("transponders", [])

    with get_db() as conn:
        # Limpiar tablas existentes (opcional)
        conn.execute("DELETE FROM drivers")
        conn.execute("DELETE FROM transponders")

        # Restaurar drivers
        for d in drivers:
            conn.execute(
                """
                INSERT OR REPLACE INTO drivers 
                (id, transponder_id, name, lastname, age, gender, nationality, 
                 weight, description, photo, best_lap_time, total_races, total_wins, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    d["id"],
                    d["transponder_id"],
                    d["name"],
                    d.get("lastname", ""),
                    d.get("age"),
                    d.get("gender", ""),
                    d.get("nationality", ""),
                    d.get("weight"),
                    d.get("description", ""),
                    d.get("photo", "default-avatar.png"),
                    d.get("best_lap_time"),
                    d.get("total_races", 0),
                    d.get("total_wins", 0),
                    d.get("created_at"),
                ),
            )

        # Restaurar transponders
        for t in transponders:
            conn.execute(
                """
                INSERT OR REPLACE INTO transponders 
                (id, code, description, kart_id, is_active, first_detected, last_seen,
                 times_detected, last_signal_h, last_signal_l, last_time_accumulated,
                 last_physical_laps, usage_laps_total)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    t["id"],
                    t.get("code", str(t["id"])),
                    t.get("description", ""),
                    t.get("kart_id", ""),
                    t.get("is_active", 1),
                    t.get("first_detected"),
                    t.get("last_seen"),
                    t.get("times_detected", 1),
                    t.get("last_signal_h"),
                    t.get("last_signal_l"),
                    t.get("last_time_accumulated"),
                    t.get("last_physical_laps"),
                    t.get("usage_laps_total", 0),
                ),
            )

    print(f"✅ Restaurados {len(drivers)} pilotos y {len(transponders)} transponders")
    return {"drivers": len(drivers), "transponders": len(transponders)}


# ==================== CONFIGURACIÓN DE FUENTE DE TIEMPO ====================


def init_timing_config():
    """Inicializa la configuración de fuente de tiempo"""
    try:
        with get_db() as conn:
            # Crear tabla si no existe
            conn.execute("""
                CREATE TABLE IF NOT EXISTS timing_config (
                    id INTEGER PRIMARY KEY DEFAULT 1,
                    time_source TEXT DEFAULT 'server',
                    min_valid_lap_time REAL DEFAULT 5.0,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Insertar valores por defecto si no existen
            conn.execute("""
                INSERT OR IGNORE INTO timing_config (id, time_source, min_valid_lap_time)
                VALUES (1, 'server', 5.0)
            """)
            print(
                "[TIMING] Configuración inicializada: time_source='server', min_lap=5.0s"
            )
    except Exception as e:
        print(f"[TIMING] Error al inicializar: {e}")


def get_timing_config():
    """Obtiene la configuración actual de fuente de tiempo"""
    try:
        with get_db() as conn:
            result = conn.execute("SELECT * FROM timing_config WHERE id = 1").fetchone()
            if result:
                return dict(result)
    except Exception as e:
        print(f"[TIMING] Error al obtener configuración: {e}")
    return {"time_source": "server", "min_valid_lap_time": 5.0}


def update_timing_config(time_source=None, min_valid_lap_time=None):
    """Actualiza la configuración de fuente de tiempo"""
    try:
        with get_db() as conn:
            if time_source is not None:
                conn.execute(
                    "UPDATE timing_config SET time_source = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
                    (time_source,),
                )
            if min_valid_lap_time is not None:
                conn.execute(
                    "UPDATE timing_config SET min_valid_lap_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
                    (min_valid_lap_time,),
                )
            return True
    except Exception as e:
        print(f"[TIMING] Error al actualizar configuración: {e}")
        return False


def get_track_length():
    """Obtiene el largo de pista en kilómetros"""
    with get_db() as conn:
        result = conn.execute(
            "SELECT track_length_km FROM circuit_config WHERE id = 1"
        ).fetchone()
        return float(result["track_length_km"]) if result else 0.0


def update_circuit_config(track_length_km=None, track_type=None):
    """Actualiza la configuración de pista (largo y tipo)"""
    with get_db() as conn:
        if track_length_km is not None:
            conn.execute(
                """
                UPDATE circuit_config 
                SET track_length_km = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = 1
            """,
                (track_length_km,),
            )
        if track_type is not None:
            conn.execute(
                """
                UPDATE circuit_config 
                SET track_type = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = 1
            """,
                (track_type,),
            )
        return True


def get_circuit_config():
    """Obtiene toda la configuración de pista"""
    with get_db() as conn:
        result = conn.execute(
            "SELECT track_length_km, track_type FROM circuit_config WHERE id = 1"
        ).fetchone()
        if result:
            return {
                "track_length_km": float(result["track_length_km"])
                if result["track_length_km"]
                else 0.0,
                "track_type": result["track_type"] or "karting",
            }
        return {"track_length_km": 0.0, "track_type": "karting"}


# ==================== CONFIGURACIÓN DEL DECODER ====================


def get_decoder_mode():
    """Obtiene el modo actual del decoder desde la BD"""
    with get_db() as conn:
        # Asegurar que la tabla exista
        conn.execute("""
            CREATE TABLE IF NOT EXISTS decoder_config (
                id INTEGER PRIMARY KEY DEFAULT 1,
                mode TEXT DEFAULT 'chronit',
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Insertar registro por defecto si no existe
        conn.execute("""
            INSERT OR IGNORE INTO decoder_config (id, mode)
            VALUES (1, 'chronit')
        """)
        result = conn.execute("SELECT mode FROM decoder_config WHERE id = 1").fetchone()
        return result["mode"] if result else "chronit"


def update_decoder_mode(mode):
    """Actualiza el modo del decoder en la BD"""
    with get_db() as conn:
        # Asegurar que la tabla exista
        conn.execute("""
            CREATE TABLE IF NOT EXISTS decoder_config (
                id INTEGER PRIMARY KEY DEFAULT 1,
                mode TEXT DEFAULT 'chronit',
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute(
            """
            UPDATE decoder_config 
            SET mode = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = 1
        """,
            (mode,),
        )
        return True

# ==================== GESTIÓN DE FOTOS DE PILOTOS ====================

def update_driver_photo(driver_id, photo_filename):
    """
    Actualiza solo la foto de un piloto
    Guarda el nombre del archivo, NO el contenido de la imagen
    """
    with get_db() as conn:
        conn.execute(
            "UPDATE drivers SET photo = ? WHERE id = ?",
            (photo_filename, driver_id)
        )
        return True

def get_driver_photo_filename(driver_id):
    """Obtiene el nombre del archivo de foto de un piloto"""
    with get_db() as conn:
        result = conn.execute(
            "SELECT photo FROM drivers WHERE id = ?",
            (driver_id,)
        ).fetchone()
        return result['photo'] if result else 'default-avatar.png'

def get_photo_storage_path():
    """Obtiene la ruta donde se almacenan las fotos según el SO"""
    if IS_WINDOWS:
        base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads', 'drivers')
    else:
        base_dir = '/app/static/uploads/drivers'
    
    if not os.path.exists(base_dir):
        os.makedirs(base_dir)
    return base_dir

def get_thumbnails_path():
    """Obtiene la ruta donde se almacenan los thumbnails"""
    base_dir = get_photo_storage_path()
    thumb_dir = os.path.join(base_dir, 'thumbnails')
    if not os.path.exists(thumb_dir):
        os.makedirs(thumb_dir)
    return thumb_dir

# ==================== CONFIGURACIÓN DE USUARIO ====================

def init_user_preferences_table():
    """Crea la tabla de preferencias de usuario si no existe"""
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                pref_key TEXT NOT NULL,
                pref_value TEXT NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, pref_key)
            )
        """)
        print("[USER_PREFS] Tabla user_preferences inicializada")

def get_user_preference(user_id, pref_key, default_value=None):
    """Obtiene una preferencia de usuario"""
    with get_db() as conn:
        result = conn.execute(
            "SELECT pref_value FROM user_preferences WHERE user_id = ? AND pref_key = ?",
            (user_id, pref_key)
        ).fetchone()
        if result:
            return result["pref_value"]
        return default_value

def set_user_preference(user_id, pref_key, pref_value):
    """Guarda una preferencia de usuario"""
    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO user_preferences (user_id, pref_key, pref_value, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        """, (user_id, pref_key, pref_value))
        return True

def get_user_preferences(user_id):
    """Obtiene todas las preferencias de un usuario"""
    with get_db() as conn:
        results = conn.execute(
            "SELECT pref_key, pref_value FROM user_preferences WHERE user_id = ?",
            (user_id,)
        ).fetchall()
        prefs = {}
        for row in results:
            prefs[row["pref_key"]] = row["pref_value"]
        return prefs    

def get_columns_config():
    """Obtiene la configuración global de columnas"""
    with get_db() as conn:
        result = conn.execute("SELECT desktop_hidden, mobile_hidden FROM columns_config WHERE id = 1").fetchone()
        if result:
            try:
                return {
                    'desktop': json.loads(result['desktop_hidden']),
                    'mobile': json.loads(result['mobile_hidden'])
                }
            except:
                return {'desktop': [], 'mobile': []}
        return {'desktop': [], 'mobile': []}

def update_columns_config(desktop_hidden=None, mobile_hidden=None):
    """Actualiza la configuración global de columnas"""
    with get_db() as conn:
        if desktop_hidden is not None:
            conn.execute(
                "UPDATE columns_config SET desktop_hidden = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
                (json.dumps(desktop_hidden),)
            )
        if mobile_hidden is not None:
            conn.execute(
                "UPDATE columns_config SET mobile_hidden = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
                (json.dumps(mobile_hidden),)
            )
        return True

# ==================== CONFIGURACIÓN GLOBAL (SETTINGS) ====================

def get_global_setting(key):
    """Obtiene un valor de la tabla settings"""
    with get_db() as conn:
        result = conn.execute(
            "SELECT value FROM settings WHERE key = ?",
            (key,)
        ).fetchone()
        return result['value'] if result else None

def set_global_setting(key, value):
    """Guarda un valor en la tabla settings"""
    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO settings (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        """, (key, value))
        return True

