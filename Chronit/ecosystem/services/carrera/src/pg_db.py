# =============================================================================
# CHRONIT ECOSYSTEM — Conexión a PostgreSQL desde el core de carrera
# -----------------------------------------------------------------------------
# El modo 'gestionada' lee los pilotos inscritos desde PostgreSQL (tickets/colas)
# en lugar de la lista local (SQLite) del modo 'rapida'. Este módulo centraliza
# el acceso a PostgreSQL para que el control de carrera pueda:
#   1) Listar los pilotos listos de un evento (colas en estado listo/llamado).
#   2) Escribir los resultados de una carrera finalizada a `resultados_carrera`.
#
# Es tolerante a fallos: si PostgreSQL no está disponible, las funciones no
# lanzan excepciones que rompan el core, simplemente devuelven listas vacías
# (el flujo de carrera sigue funcionando en modo 'rapida' / local).
# =============================================================================

import os

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PG = True
except ImportError:  # pragma: no cover - depende del build de la imagen
    HAS_PG = False


def pg_check_online():
    """Comprueba si PostgreSQL responde. Devuelve un bool (mejor esfuerzo)."""
    conn = _conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[PG] Chequeo de conexión falló: {e}")
        return False
    finally:
        conn.close()


def _conn():
    """Abre una conexión a PostgreSQL usando variables de entorno (py-style).

    Usa RealDictCursor para que todas las consultas devuelvan filas tipo dict
    (r["columna"]). Varias funciones (get_event_tickets, get_gestionada_pilots)
    dependían de este formato; sin él psycopg2 devolvía tuplas y el acceso por
    nombre lanzaba "tuple indices must be integers", dejando la lista vacía.
    """
    if not HAS_PG:
        return None
    try:
        return psycopg2.connect(
            host=os.environ.get("PGHOST", "postgres"),
            port=os.environ.get("PGPORT", "5432"),
            dbname=os.environ.get("PGDATABASE", "chronit"),
            user=os.environ.get("PGUSER", "chronit"),
            password=os.environ.get("PGPASSWORD", ""),
            connect_timeout=3,
            cursor_factory=RealDictCursor,
        )
    except Exception as e:  # noqa: BLE001 - queremos degradar con elegancia
        print(f"[PG] No se pudo conectar a PostgreSQL: {e}")
        return None


def get_gestionada_pilots(event_uuid):
    """Pilotos listos para el evento (por uuid_global) desde PostgreSQL.

    Devuelve una lista de dicts con la identidad del piloto (uuid_global) para
    que el core la mapee a su tabla local `drivers` (via uuid_global).
    """
    conn = _conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.uuid_global, u.nombre, u.apellido, c.estado AS cola_estado
                FROM colas c
                JOIN tickets t ON t.id = c.ticket_id
                JOIN eventos e ON e.id = t.evento_id
                JOIN usuarios u   ON u.id = t.usuario_id
                WHERE e.uuid_global = %s
                  AND c.estado IN ('llamado', 'ready')
                  AND t.estado <> 'FINALIZADO'
                ORDER BY t.numero ASC
                """,
                (str(event_uuid),),
            )
            return [dict(r) for r in cur.fetchall()]
    except Exception as e:  # noqa: BLE001
        print(f"[PG] Error al leer pilotos gestionados: {e}")
        return []
    finally:
        conn.close()


def mark_event_tickets_activo(event_uuid, usuario_uuids=None):
    """Marca como ACTIVO los tickets de los pilotos que entran a pista.

    Completa la máquina de estados del ticket:
        ASIGNADO -> LLAMANDO -> PREPARADO -> ACTIVO -> FINALIZADO
    Se llama al iniciar una carrera desde un evento; los pilotos inscritos
    pasan de PREPARADO a ACTIVO. Tolerante a fallos (no rompe el core).
    """
    conn = _conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            if usuario_uuids:
                cur.execute(
                    """
                    UPDATE tickets SET estado = 'ACTIVO'
                    WHERE evento_id = (SELECT id FROM eventos WHERE uuid_global = %s)
                      AND estado NOT IN ('FINALIZADO')
                      AND usuario_id IN (SELECT id FROM usuarios
                                         WHERE uuid_global::text = ANY(%s))
                    """,
                    (str(event_uuid), list(usuario_uuids)),
                )
            else:
                cur.execute(
                    """
                    UPDATE tickets SET estado = 'ACTIVO'
                    WHERE evento_id = (SELECT id FROM eventos WHERE uuid_global = %s)
                      AND estado NOT IN ('FINALIZADO')
                    """,
                    (str(event_uuid),),
                )
            conn.commit()
            print(f"[PG] Tickets marcados como ACTIVO para el evento {event_uuid}")
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        print(f"[PG] Error al marcar tickets ACTIVO: {e}")
    finally:
        conn.close()


def sync_finished_session(session_id, event_uuid, leaderboard):
    """Vuelca la clasificación de una carrera finalizada a PostgreSQL.

    `leaderboard` es una lista de dicts con: usuario_uuid, posicion,
    tiempo_total, mejor_vuelta, circuito. Actualiza además el estado de los
    tickets de ese evento a ACTIVO/FINALIZADO según corresponda.
    """
    conn = _conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            for row in leaderboard:
                user_uuid = row.get("usuario_uuid")
                # `usuario_id` es NOT NULL en `resultados_carrera`. Sin él el
                # INSERT falla siempre. Si no se puede resolver el piloto en
                # PostgreSQL, se omite la fila (best-effort) y se loguea.
                if not user_uuid:
                    print(f"[PG] Resultados: fila sin uuid_global, se omite (pos {row.get('posicion')})")
                    continue
                cur.execute(
                    "SELECT id, nombre FROM usuarios WHERE uuid_global = %s::uuid",
                    (str(user_uuid),),
                )
                user = cur.fetchone()
                if not user:
                    print(
                        f"[PG] Resultados: el usuario uuid={user_uuid} no existe en PostgreSQL, se omite (pos {row.get('posicion')})"
                    )
                    continue
                # Resolver el evento_id ONLY si la carrera pertenece a un evento.
                # En carreras manuales (sin evento) event_uuid es None y NO se
                # debe pasar "None" a un cast ::uuid (rompe con
                # 'invalid input syntax for type uuid').
                evento_id = None
                if event_uuid:
                    cur.execute(
                        "SELECT id FROM eventos WHERE uuid_global = %s::uuid",
                        (str(event_uuid),),
                    )
                    ev = cur.fetchone()
                    evento_id = ev["id"] if ev else None
                cur.execute(
                    """
                    INSERT INTO resultados_carrera
                        (uuid_global, usuario_id, evento_id, fecha, posicion,
                         tiempo_total, mejor_vuelta, circuito)
                    VALUES (%s::uuid, %s, %s, now(), %s, %s, %s, %s)
                    ON CONFLICT (uuid_global) DO UPDATE SET
                        usuario_id   = EXCLUDED.usuario_id,
                        evento_id    = EXCLUDED.evento_id,
                        fecha        = EXCLUDED.fecha,
                        posicion     = EXCLUDED.posicion,
                        tiempo_total = EXCLUDED.tiempo_total,
                        mejor_vuelta = EXCLUDED.mejor_vuelta,
                        circuito     = EXCLUDED.circuito
                    """,
                    (
                        str(user_uuid),
                        user["id"],
                        evento_id,
                        row.get("posicion"),
                        row.get("tiempo_total"),
                        row.get("mejor_vuelta"),
                        row.get("circuito", ""),
                    ),
                )
            if event_uuid:
                # Marcar los tickets del evento como FINALIZADO (carrera completada)
                cur.execute(
                    """
                    UPDATE tickets SET estado = 'FINALIZADO'
                    WHERE evento_id = (SELECT id FROM eventos WHERE uuid_global = %s)
                      AND estado <> 'FINALIZADO'
                    """,
                    (str(event_uuid),),
                )
            conn.commit()
            print(f"[PG] Resultados de la sesión {session_id} sincronizados")
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        print(f"[PG] Error al sincronizar resultados: {e}")
    finally:
        conn.close()


# Estados de ticket admitidos para el cambio manual (emergencia) del control.
EVENT_TICKET_STATUSES = (
    "PENDIENTE", "ASIGNADO", "LLAMANDO", "PREPARADO",
    "ACTIVO", "FINALIZADO", "AUSENTE", "REVOCADO", "USADO",
)


def get_event_tickets(event_uuid):
    """Devuelve los tickets del evento mapeados por uuid del piloto.

    Estructura: { uuid_piloto: {ticket_id, ticket_numero, ticket_estado} }.
    Es de mejor esfuerzo: si PostgreSQL no está disponible, devuelve {}.
    """
    conn = _conn()
    if not conn:
        return {}
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.uuid_global, t.id AS ticket_id,
                       t.numero AS ticket_numero, t.estado AS ticket_estado
                FROM tickets t
                JOIN eventos e ON e.id = t.evento_id
                JOIN usuarios u ON u.id = t.usuario_id
                WHERE e.uuid_global = %s
                """,
                (str(event_uuid),),
            )
            return {
                str(r["uuid_global"]): {
                    "ticket_id": r["ticket_id"],
                    "ticket_numero": r["ticket_numero"],
                    "ticket_estado": r["ticket_estado"],
                }
                for r in cur.fetchall()
            }
    except Exception as e:  # noqa: BLE001
        print(f"[PG] Error al leer tickets del evento: {e}")
        return {}
    finally:
        conn.close()


def set_ticket_status_by_driver_uuid(event_uuid, driver_uuid, status):
    """Cambia el estado de un ticket en PostgreSQL (acción de emergencia).

    Localiza el ticket por el uuid_global del piloto y el uuid_global del evento.
    Devuelve True si se actualizó alguna fila. Tolerante a fallos.
    """
    if status not in EVENT_TICKET_STATUSES:
        return False
    conn = _conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE tickets
                SET estado = %s
                WHERE evento_id = (SELECT id FROM eventos WHERE uuid_global = %s)
                  AND usuario_id = (SELECT id FROM usuarios WHERE uuid_global = %s::uuid)
                """,
                (status, str(event_uuid), str(driver_uuid)),
            )
            conn.commit()
            return cur.rowcount > 0
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        print(f"[PG] Error al cambiar estado de ticket: {e}")
        return False
    finally:
        conn.close()
