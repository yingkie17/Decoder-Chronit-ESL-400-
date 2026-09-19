# =============================================================================
# CHRONIT ECOSYSTEM — Sentinela de sincronización (SQLite <-> PostgreSQL)
# -----------------------------------------------------------------------------
# Responsabilidad: mantener sincronizadas la base SQLite local (Chronit) y la
# PostgreSQL del ecosistema (usuarios/drivers, eventos, tickets, resultados).
#
# Estrategia (offline-first):
#   - Identidad compartida por uuid_global (clave de mapeo, evita duplicados).
#   - Replicación bidireccional con UPSERT (nunca borra en origen).
#   - Resolución de conflictos por timestamp (el último cambio gana).
#   - Backfill de uuid_global para registros históricos que no lo tengan.
#
# Bidireccionalidad (qué lado es la fuente de verdad por dominio):
#   - drivers            <-> usuarios    (SQLite crea, PG edita perfil => PG gana)
#   - future_events      ->  eventos     (el core crea eventos; espejo solo-lectura)
#   - future_event_drivers <-> tickets/colas (el vestidor en PG es autoritativo)
#   - race_drivers       ->  resultados_carrera (los resultados nacen en el core)
#
# Transacciones:
#   - Cada tabla sincroniza en UNA transacción PG (commit al final).
#   - Si algo falla, se hace rollback y se resetea la conexión para no envenenar
#     las tablas siguientes (antes una fila fallida abortaba toda la tabla).
#
# Direcciones:
#   drivers            <-> usuarios
#   future_events        ->  eventos
#   future_event_drivers <-> tickets + colas
#   race_drivers         ->  resultados_carrera  (historial del piloto)
# =============================================================================
import os
import json
import time
import logging
import sqlite3
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="[sync] %(levelname)s %(message)s")
log = logging.getLogger("chronit-sync")

SQLITE_DATABASE = os.getenv("SQLITE_DATABASE", "/app/data/chronit.db")
DATABASE_URL = os.getenv("DATABASE_URL", "")
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", "30"))

_MIGRATION = """
CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT
)
"""


# --------------------------------------------------------------------------
# Outbox: registrar operaciones de sincronización (trazabilidad / conflictos)
# --------------------------------------------------------------------------
def outbox_record(cur, origen, tabla, operacion, uuid_ref, payload=None, estado="aplicada"):
    """Inserta una operación en sync_operaciones dentro de la transacción activa.

    No hace commit ni crea su propio cursor: se agrupa con el lote de la tabla
    para que una operación quede registrada de forma atómica con sus datos.
    """
    cur.execute(
        """INSERT INTO sync_operaciones (origen, tabla, operacion, uuid_ref, payload, estado)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (origen, tabla, operacion, uuid_ref, json.dumps(payload) if payload else None, estado),
    )


# --------------------------------------------------------------------------
# Conexiones (robustas a transacciones abortadas / errores transitorios)
# --------------------------------------------------------------------------
def sqlite_conn():
    conn = sqlite3.connect(SQLITE_DATABASE)
    conn.row_factory = sqlite3.Row
    conn.execute(_MIGRATION)
    conn.commit()
    return conn


_pg = None


def pg_conn():
    global _pg
    if _pg is not None:
        try:
            # La conexión puede haber sido cerrada por un error transitorio.
            if _pg.closed:
                _pg = None
            else:
                return _pg
        except Exception:  # noqa: BLE001
            _pg = None
    import psycopg2
    _pg = psycopg2.connect(DATABASE_URL)
    return _pg


def pg_cursor():
    conn = pg_conn()
    return conn, conn.cursor()


def pg_commit(cursor):
    cursor.connection.commit()


def pg_rollback():
    global _pg
    if _pg is not None:
        try:
            _pg.rollback()
        except Exception:  # noqa: BLE001
            pass


def pg_reset():
    """Cierra y descarta la conexión PG para reabrir una limpia en el próximo ciclo."""
    global _pg
    if _pg is not None:
        try:
            _pg.close()
        except Exception:  # noqa: BLE001
            pass
    _pg = None


# --------------------------------------------------------------------------
# Watermark de sincronización (resolución de conflictos last-write-wins)
# --------------------------------------------------------------------------
def sync_meta_get(conn, key):
    row = conn.execute("SELECT value FROM sync_meta WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["value"])
    except Exception:  # noqa: BLE001
        return None


def sync_meta_set(conn, key, value):
    conn.execute(
        "INSERT INTO sync_meta (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value)),
    )
    conn.commit()


# --------------------------------------------------------------------------
# Backfill de uuid_global en SQLite
# --------------------------------------------------------------------------
def backfill_uuid(conn, table, pk="id"):
    rows = conn.execute(f"SELECT {pk}, uuid_global FROM {table} WHERE uuid_global IS NULL").fetchall()
    for r in rows:
        conn.execute(
            f"UPDATE {table} SET uuid_global = ? WHERE {pk} = ?",
            (__import__("uuid").uuid4().__str__(), r[pk]),
        )
    if rows:
        conn.commit()
        log.info("backfill uuid_global: %s registros en %s", len(rows), table)
    return len(rows)


# --------------------------------------------------------------------------
# 1) drivers (SQLite) <-> usuarios (PostgreSQL)
#    SQLite crea pilotos; la web edita su perfil (PG). Si ambos cambian el mismo
#    registro => conflicto, se resuelve con last-write-wins (PG gana identidad).
# --------------------------------------------------------------------------
def sync_drivers_usuarios():
    conn = sqlite_conn()
    pg, cur = pg_cursor()
    try:
        # --- SQLite -> PostgreSQL (crear/actualizar pilotos nacidos en el core) ---
        sqlite_rows = conn.execute(
            """SELECT id, uuid_global, name, lastname, nationality, email, carnet, phone,
                      photo, created_at FROM drivers"""
        ).fetchall()
        n_push = 0
        for d in sqlite_rows:
            if not d["uuid_global"]:
                continue
            # SQLite crea el piloto; si ya existe en PG (registrado/actualizado en
            # la web), NO se sobrescribe el perfil: la web es la fuente de verdad.
            cur.execute(
                """
                INSERT INTO usuarios
                    (uuid_global, nombre, apellido, email, telefono, carnet, foto, nacionalidad, creado_en, password_hash, rol)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, '', 'piloto')
                ON CONFLICT (uuid_global) DO NOTHING
                """,
                (d["uuid_global"], d["name"], d["lastname"] or "", d["email"], d["phone"],
                 d["carnet"], d["photo"], d["nationality"], d["created_at"]),
            )
            outbox_record(cur, "sqlite", "drivers", "upsert", d["uuid_global"], {"tabla": "usuarios"})
            n_push += 1

        # --- PostgreSQL -> SQLite (pilotos registrados/actualizados desde la web) ---
        # Los últimos cambios en PG (actualizado_en) ganan; se registra como
        # 'conflicto' cuando ambos lados tenían el registro con valores distintos.
        cur.execute(
            """SELECT uuid_global, nombre, apellido, email, telefono, carnet, foto,
                      nacionalidad, creado_en, actualizado_en
               FROM usuarios WHERE rol = 'piloto'"""
        )
        pg_users = cur.fetchall()
        wm = sync_meta_get(conn, "watermark:drivers") or {}
        n_pull = 0
        for u in pg_users:
            uuid = u[0]
            if not uuid:
                continue
            existing = conn.execute(
                "SELECT id, name, lastname, email, carnet, phone, nationality, photo FROM drivers WHERE uuid_global = ?",
                (uuid,),
            ).fetchone()
            if not existing:
                # No duplicar por carnet si ya existe localmente (otro piloto con ese carnet)
                if u[5]:
                    dup = conn.execute(
                        "SELECT id FROM drivers WHERE carnet = ? AND (uuid_global IS NULL OR uuid_global != ?)",
                        (u[5], uuid),
                    )
                    if dup.fetchone():
                        continue
                conn.execute(
                    """INSERT OR IGNORE INTO drivers
                       (name, lastname, email, carnet, phone, nationality, photo, created_at, uuid_global)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (u[1], u[2], u[3], u[5] or "", u[4], u[7], u[6], u[8], uuid),
                )
                outbox_record(cur, "postgres", "usuarios", "insert", uuid, {"tabla": "drivers"})
                n_pull += 1
                continue

            # Ya existe en ambos lados: detectar divergencia (posible conflicto).
            diverged = (
                existing["name"] != u[1]
                or (existing["lastname"] or "") != (u[2] or "")
                or (existing["email"] or "") != (u[3] or "")
                or (existing["carnet"] or "") != (u[5] or "")
                or (existing["phone"] or "") != (u[4] or "")
                or (existing["photo"] or "") != (u[6] or "")
                or (existing["nationality"] or "") != (u[7] or "")
            )
            pg_ts = str(u[9]) if u[9] else ""
            if diverged:
                # Ambos lados tienen el registro con valores distintos => conflicto.
                # LWW: PG (perfil web) es la fuente de verdad para pilotos existentes.
                outbox_record(cur, "postgres", "usuarios", "update", uuid,
                              {"tabla": "drivers", "lww": "postgres"}, estado="conflicto")
                conn.execute(
                    """UPDATE drivers SET name = ?, lastname = ?, email = ?, carnet = ?,
                              phone = ?, nationality = ?, photo = ?
                       WHERE uuid_global = ?""",
                    (u[1], u[2], u[3], u[5] or "", u[4], u[7], u[6], uuid),
                )
                outbox_record(cur, "postgres", "usuarios", "update", uuid, {"tabla": "drivers"})
                n_pull += 1
            # Actualizar watermark del último cambio PG aplicado.
            wm[uuid] = pg_ts
        conn.commit()
        sync_meta_set(conn, "watermark:drivers", wm)
        pg_commit(cur)
        if n_push or n_pull:
            log.info("sync drivers<->usuarios: push=%s pull=%s", n_push, n_pull)
    except Exception:  # noqa: BLE001
        pg_rollback()
        raise
    finally:
        conn.close()


# --------------------------------------------------------------------------
# 2) future_events (SQLite) -> eventos (PostgreSQL)
#    El core (SQLite) es la fuente de verdad de los eventos: se crean en el core
#    y la sentinela los refleja en PG (donde se asignan tickets).
# --------------------------------------------------------------------------
def sync_events():
    conn = sqlite_conn()
    _, cur = pg_cursor()
    try:
        rows = conn.execute(
            """SELECT id, uuid_global, event_code, name, event_date, event_time, status,
                      race_mode, track_type, track_length_km, responsible_user, created_at
               FROM future_events"""
        ).fetchall()
        # Mapeo de estados SQLite -> PostgreSQL (evento nace 'pendiente' y pasa a
        # 'preparada' al estar listo para correr, según el módulo de vestidores).
        estado_map = {
            "upcoming": "pendiente",
            "pending": "pendiente",
            "pendiente": "pendiente",
            "active": "activo",
            "activo": "activo",
            "completed": "finalizado",
            "finalizado": "finalizado",
            "preparada": "preparada",
            "ready": "preparada",
        }
        n = 0
        for ev in rows:
            if not ev["uuid_global"]:
                continue
            estado = estado_map.get(ev["status"], ev["status"] or "pendiente")
            cur.execute(
                """
                INSERT INTO eventos
                    (uuid_global, nombre, fecha, hora, estado, tipo_carrera, tipo_pista, largo_km, responsable, creado_en)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (uuid_global) DO UPDATE
                    SET nombre = EXCLUDED.nombre,
                        fecha = COALESCE(EXCLUDED.fecha, eventos.fecha),
                        hora = COALESCE(EXCLUDED.hora, eventos.hora),
                        -- REQ 4: 'llamando' es un estado que sólo conoce el
                        -- vestidor (el core no lo soporta). No lo degradamos a
                        -- 'pendiente' mientras el core siga en estado previo.
                        estado = CASE
                            WHEN eventos.estado = 'llamando' AND EXCLUDED.estado = 'pendiente'
                                THEN eventos.estado
                            ELSE EXCLUDED.estado
                        END,
                        tipo_carrera = EXCLUDED.tipo_carrera,
                        tipo_pista = EXCLUDED.tipo_pista,
                        largo_km = COALESCE(EXCLUDED.largo_km, eventos.largo_km),
                        responsable = COALESCE(EXCLUDED.responsable, eventos.responsable),
                        actualizado_en = now()
                """,
                (ev["uuid_global"], ev["name"], ev["event_date"], ev["event_time"],
                  estado, ev["race_mode"], ev["track_type"], ev["track_length_km"],
                  ev["responsible_user"], ev["created_at"]),
            )
            outbox_record(cur, "sqlite", "future_events", "upsert", ev["uuid_global"], {"tabla": "eventos"})
            n += 1
        pg_commit(cur)
        if n:
            log.info("sync eventos: %s eventos", n)
    except Exception:  # noqa: BLE001
        pg_rollback()
        raise
    finally:
        conn.close()


# --------------------------------------------------------------------------
# 3) future_event_drivers (SQLite) <-> tickets + colas (PostgreSQL)
#    El core crea inscripciones (SQLite); el vestidor muta el estado de cola en
#    PG. PG es autoritativo para el ciclo de vestidor, por lo que se propaga de
#    vuelta a SQLite (called/ready/locker_room).
# --------------------------------------------------------------------------
def sync_event_drivers():
    conn = sqlite_conn()
    pg, cur = pg_cursor()
    try:
        # --- SQLite -> PostgreSQL (inscripciones -> tickets + colas) ---
        rows = conn.execute(
            """SELECT fed.id, fed.uuid_global, fed.order_index, fed.called, fed.locker_room,
                      fed.ready, fed.enrolled_at, fed.event_id, fed.driver_id,
                      d.uuid_global AS driver_uuid, fe.uuid_global AS event_uuid
               FROM future_event_drivers fed
               JOIN drivers d ON d.id = fed.driver_id
               LEFT JOIN future_events fe ON fe.id = fed.event_id
               WHERE fed.uuid_global IS NOT NULL"""
        ).fetchall()
        n = 0
        for r in rows:
            if not r["driver_uuid"]:
                continue
            # Localizar id de usuario en PG por uuid del driver
            cur.execute("SELECT id FROM usuarios WHERE uuid_global = %s", (r["driver_uuid"],))
            user = cur.fetchone()
            usuario_id = user[0] if user else None
            evento_id_pg = None
            if r["event_uuid"]:
                cur.execute("SELECT id FROM eventos WHERE uuid_global = %s", (r["event_uuid"],))
                ev = cur.fetchone()
                evento_id_pg = ev[0] if ev else None
            if not usuario_id:
                continue

            # Ticket (uno por driver/evento).
            # Reutiliza el ticket que la taquilla (kiosco) ya haya creado para
            # este usuario+evento; si no existe, lo crea desde la inscripción del
            # core. Evita duplicados con distinto uuid_global para el mismo piloto
            # en el mismo evento (Hallazgo C).
            if evento_id_pg:
                cur.execute(
                    "SELECT id FROM tickets WHERE usuario_id = %s AND evento_id = %s",
                    (usuario_id, evento_id_pg),
                )
                t = cur.fetchone()
            else:
                t = None
            if t:
                ticket_id = t[0]
            else:
                cur.execute(
                    """
                    INSERT INTO tickets (uuid_global, usuario_id, evento_id, estado, creado_en)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (uuid_global) DO NOTHING
                    """,
                    (r["uuid_global"], usuario_id, evento_id_pg,
                     "ASIGNADO", r["enrolled_at"]),
                )
                cur.execute("SELECT id FROM tickets WHERE uuid_global = %s", (r["uuid_global"],))
                t = cur.fetchone()
                if not t:
                    continue
                ticket_id = t[0]

            # Cola (estado de vestidor / ready)
            estado = "espera"
            if r["ready"]:
                estado = "ready"
            elif r["called"]:
                estado = "llamado"
            vestidor = None
            if r["locker_room"] and "1" in str(r["locker_room"]):
                vestidor = 1
            elif r["locker_room"] and "2" in str(r["locker_room"]):
                vestidor = 2

            cur.execute(
                """
                INSERT INTO colas (ticket_id, evento_id, estado, vestidor)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (ticket_id) DO UPDATE
                    SET evento_id = EXCLUDED.evento_id
                """,
                (ticket_id, evento_id_pg, estado, vestidor),
            )
            outbox_record(cur, "sqlite", "future_event_drivers", "upsert", r["uuid_global"],
                          {"tabla": "tickets/colas"})
            n += 1

        # --- PostgreSQL -> SQLite (estado de vestidor autoritativo en PG) ---
        # Aplica llamada/ready/vestidor de vuelta a future_event_drivers para que
        # el core (pantalla, karts, inscripción) vea el ciclo del vestidor.
        cur.execute(
            """SELECT t.uuid_global AS ticket_uuid, c.estado, c.vestidor
               FROM colas c JOIN tickets t ON t.id = c.ticket_id
               WHERE c.estado IN ('espera','llamado','ready')"""
        )
        colas_pg = cur.fetchall()
        pulled = 0
        for c in colas_pg:
            ticket_uuid = c[0]
            if not ticket_uuid:
                continue
            fed = conn.execute(
                "SELECT id FROM future_event_drivers WHERE uuid_global = ?", (ticket_uuid,)
            ).fetchone()
            if not fed:
                continue
            estado_pg = c[1]
            called = 1 if estado_pg == "llamado" else 0
            ready = 1 if estado_pg == "ready" else 0
            locker = str(c[2]) if c[2] else None
            cur_where = conn.execute(
                "SELECT called, ready, locker_room FROM future_event_drivers WHERE id = ?",
                (fed["id"],),
            ).fetchone()
            # Conflicto cuando el estado local difiere del que manda PG (vestidor).
            local_diff = bool(cur_where["called"]) != bool(called) or bool(cur_where["ready"]) != bool(ready)
            if local_diff:
                outbox_record(cur, "postgres", "colas", "update", ticket_uuid,
                              {"tabla": "future_event_drivers", "lww": "postgres"}, estado="conflicto")
            conn.execute(
                "UPDATE future_event_drivers SET called = ?, ready = ?, locker_room = ? WHERE id = ?",
                (called, ready, locker, fed["id"]),
            )
            pulled += 1
        conn.commit()
        pg_commit(cur)
        if n or pulled:
            log.info("sync tickets/colas: push=%s pull=%s", n, pulled)
    except Exception as e:  # noqa: BLE001
        pg_rollback()
        log.error("Error en sync_event_drivers: %s", e)
        raise
    finally:
        conn.close()


# --------------------------------------------------------------------------
# 4) race_drivers (SQLite) -> resultados_carrera (PostgreSQL) => historial
#    Los resultados de carrera nacen en el core (SQLite); se reflejan en PG para
#    el historial del piloto. Nótese el vínculo al evento si la sesión lo tiene.
# --------------------------------------------------------------------------
def sync_results():
    conn = sqlite_conn()
    _, cur = pg_cursor()
    try:
        rows = conn.execute(
            """SELECT rd.uuid_global, rd.final_position, rd.total_time, rd.best_lap,
                      rs.start_time, rs.circuit_name, rs.event_uuid, d.uuid_global AS driver_uuid
               FROM race_drivers rd
               JOIN race_sessions rs ON rs.id = rd.session_id
               JOIN drivers d ON d.id = rd.driver_id
               WHERE rd.uuid_global IS NOT NULL AND rd.final_position IS NOT NULL
               ORDER BY rd.id ASC"""
        ).fetchall()
        n = 0
        for r in rows:
            if not r["driver_uuid"]:
                continue
            cur.execute("SELECT id FROM usuarios WHERE uuid_global = %s", (r["driver_uuid"],))
            user = cur.fetchone()
            if not user:
                continue
            evento_id_pg = None
            if r["event_uuid"]:
                cur.execute("SELECT id FROM eventos WHERE uuid_global = %s", (r["event_uuid"],))
                ev = cur.fetchone()
                evento_id_pg = ev[0] if ev else None
            cur.execute(
                """
                INSERT INTO resultados_carrera
                    (uuid_global, usuario_id, evento_id, fecha, posicion, tiempo_total, mejor_vuelta, circuito)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (uuid_global) DO UPDATE SET
                    usuario_id   = EXCLUDED.usuario_id,
                    evento_id    = EXCLUDED.evento_id,
                    fecha        = EXCLUDED.fecha,
                    posicion     = EXCLUDED.posicion,
                    tiempo_total = EXCLUDED.tiempo_total,
                    mejor_vuelta = EXCLUDED.mejor_vuelta,
                    circuito     = EXCLUDED.circuito
                """,
                (r["uuid_global"], user[0], evento_id_pg, r["start_time"], r["final_position"],
                 r["total_time"], r["best_lap"], r["circuit_name"]),
            )
            outbox_record(cur, "sqlite", "race_drivers", "upsert", r["uuid_global"],
                          {"tabla": "resultados_carrera"})
            n += 1
        pg_commit(cur)
        if n:
            log.info("sync resultados: %s carreras", n)
    except Exception:  # noqa: BLE001
        pg_rollback()
        raise
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Ciclo principal
# --------------------------------------------------------------------------
def sync_cycle():
    conn = sqlite_conn()
    for table in ("drivers", "future_events", "future_event_drivers", "race_drivers"):
        try:
            backfill_uuid(conn, table)
        except sqlite3.OperationalError:
            pass
    conn.close()

    # Cada tabla en su propia transacción: si una falla no aborta las demás.
    for fn in (sync_drivers_usuarios, sync_events, sync_event_drivers, sync_results):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            log.error("sync %s falló: %s", fn.__name__, e)
            pg_reset()
    log.info("ciclo completado")


def main():
    log.info("Sentinela iniciado. Intervalo=%ss", SYNC_INTERVAL)
    if not DATABASE_URL:
        log.warning("DATABASE_URL vacío — sincronización deshabilitada.")
    while True:
        try:
            sync_cycle()
        except Exception as e:  # noqa: BLE001
            log.exception("error en ciclo de sincronización: %s", e)
            pg_reset()
        time.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    main()
