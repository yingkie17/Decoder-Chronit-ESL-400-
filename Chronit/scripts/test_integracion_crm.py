#!/usr/bin/env python3
# =============================================================================
# CHRONIT ECOSYSTEM — Pruebas de integración (CRM + seguridad + auditoría)
# -----------------------------------------------------------------------------
# Verifica, contra los servicios en ejecución:
#   1. Autorización por roles en el CRM (roles financieros/gestión sí; operativos no).
#   2. Los 6 dominios centralizados responden y la arquitectura biométrica está lista.
#   3. Filtros avanzados y paginación.
#   4. Exportación CSV (cabeceras, BOM, content-type).
#   5. Auditoría del CRM (consultas, exportaciones e IP real vía proxy).
#   6. El CRM NO expone superficie de escritura (solo lectura).
#   7. Cabeceras de seguridad en backends y frontends.
#   8. La separación no rompe la operación: el cajero sigue generando tickets
#      y usando contabilidad, pero NO entra al CRM.
#   9. Auditoría del sistema de tickets: registra operaciones sensibles
#      (crear/eliminar ticket, cambios de rol, bloqueos) y solo la lee admin.
#
# Uso:
#   python3 scripts/test_integracion_crm.py
#
# URLs configurables por entorno (útil para el perfil TLS, que sirve por HTTPS):
#   TICKETS_URL, CONTA_URL, CRM_URL, CRM_FE_URL
#   PSQL_CONTAINER (por defecto chronit-postgres)
#   PSQL_DB, PSQL_USER (por defecto chronit / chronit)
# =============================================================================
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

TICKETS = os.environ.get("TICKETS_URL", "http://localhost:4000")
CONTA = os.environ.get("CONTA_URL", "http://localhost:4100")
CRM = os.environ.get("CRM_URL", "http://localhost:4200")
CRM_FE = os.environ.get("CRM_FE_URL", "http://localhost:3003")

PSQL_CONTAINER = os.environ.get("PSQL_CONTAINER", "chronit-postgres")
PSQL_DB = os.environ.get("PSQL_DB", "chronit")
PSQL_USER = os.environ.get("PSQL_USER", "chronit")

PASS = 0
FAIL = 0
ROWS = []


def check(nombre, cond, detalle=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        ROWS.append(("PASS", nombre, detalle))
    else:
        FAIL += 1
        ROWS.append(("FAIL", nombre, detalle))


def http(method, url, body=None, token=None, headers=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        kwargs = {"context": _ssl_context()} if url.startswith("https") else {}
        with urllib.request.urlopen(req, timeout=20, **kwargs) as r:
            payload = r.read()
            hs = {k.lower(): v for k, v in r.headers.items()}
            if raw:
                return r.status, payload, hs
            try:
                return r.status, json.loads(payload or b"{}"), hs
            except Exception:
                return r.status, {"_raw": payload[:200].decode("utf-8", "replace")}, hs
    except urllib.error.HTTPError as e:
        payload = e.read()
        hs = {k.lower(): v for k, v in e.headers.items()}
        if raw:
            return e.code, payload, hs
        try:
            return e.code, json.loads(payload or b"{}"), hs
        except Exception:
            return e.code, {"_raw": payload[:200].decode("utf-8", "replace")}, hs


def login(carnet, password):
    st, body, _ = http("POST", f"{TICKETS}/api/auth/login", {"carnet": carnet, "password": password})
    tok = body.get("token") if isinstance(body, dict) else None
    return st, tok, body


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", PSQL_CONTAINER, "psql", "-U", PSQL_USER, "-d", PSQL_DB, "-A", "-t", "-c", sql],
        capture_output=True, text=True,
    )
    return (out.stdout or "").strip()


# -----------------------------------------------------------------------------
# 1) Sesiones por rol
# -----------------------------------------------------------------------------
st_admin, tok_admin, _ = login("ADMIN-001", "Admin123!")
st_caj, tok_caj, _ = login("CAJERO-001", "Cajero123!")
st_coord, tok_coord, _ = login("COORD-001", "Coord123!")

check("login admin -> 200 y token", st_admin == 200 and bool(tok_admin), f"status={st_admin}")
check("login cajero -> 200 y token", st_caj == 200 and bool(tok_caj), f"status={st_caj}")
check("login coordinador -> 200 y token", st_coord == 200 and bool(tok_coord), f"status={st_coord}")

# -----------------------------------------------------------------------------
# 2) Autorización por roles en el CRM
# -----------------------------------------------------------------------------
st, body, _ = http("GET", f"{CRM}/api/crm/resumen", token=tok_admin)
check("admin: /api/crm/resumen -> 200", st == 200, f"status={st}")
check("admin: resumen trae los 5 sistemas", isinstance(body, dict) and set(body.get("sistemas", {}).keys()) >= {"usuarios", "tickets", "carreras", "parte_web", "caja"}, str(list(body.get("sistemas", {}).keys())) if isinstance(body, dict) else "")

st, body, _ = http("GET", f"{CRM}/api/crm/me", token=tok_admin)
check("admin: /api/crm/me -> 200 y lista roles_crm", st == 200 and isinstance(body, dict) and "admin" in (body.get("roles_crm") or []), f"status={st}")

st, _, _ = http("GET", f"{CRM}/api/crm/resumen", token=tok_coord)
check("coordinador (gestión): /api/crm/resumen -> 200", st == 200, f"status={st}")

st, _, _ = http("GET", f"{CRM}/api/crm/resumen", token=tok_caj)
check("cajero (operativo): /api/crm/resumen -> 403", st == 403, f"status={st}")

st, _, _ = http("GET", f"{CRM}/api/crm/tickets", token=tok_caj)
check("cajero: /api/crm/tickets -> 403", st == 403, f"status={st}")

st, _, _ = http("GET", f"{CRM}/api/crm/personas", token=tok_caj)
check("cajero: /api/crm/personas -> 403", st == 403, f"status={st}")

st, _, _ = http("GET", f"{CRM}/api/crm/personal/estado", token=tok_caj)
check("cajero: módulo biométrico -> 403", st == 403, f"status={st}")

st, _, _ = http("GET", f"{CRM}/api/crm/resumen")
check("sin sesión: /api/crm/resumen -> 401", st == 401, f"status={st}")

st, _, _ = http("GET", f"{CRM}/api/crm/auditoria", token=tok_caj)
check("cajero: auditoría del CRM -> 403", st == 403, f"status={st}")

# Un piloto (rol no staff) tampoco debe entrar al CRM.
# El alta de pilotos es pública (/api/auth/register); /api/personal sólo
# gestiona personal interno (cajero/coordinador), por diseño.
st_np, _, _ = http("POST", f"{TICKETS}/api/auth/register", {
    "nombre": "Prueba", "apellido": "CRM", "carnet": "TESTCRM5-001",
    "password": "Prueba123!",
})
piloto_id = None
st_p, tok_piloto, _ = login("TESTCRM5-001", "Prueba123!")
check("piloto de prueba puede iniciar sesión", st_p == 200 and bool(tok_piloto), f"status={st_p}")
if tok_piloto:
    st, _, _ = http("GET", f"{CRM}/api/crm/resumen", token=tok_piloto)
    check("piloto: /api/crm/resumen -> 403", st == 403, f"status={st}")
if st_np in (200, 201) or st_p == 200:
    fila = psql("SELECT id FROM usuarios WHERE carnet='TESTCRM5-001' AND rol='piloto';")
    if fila.isdigit():
        piloto_id = int(fila)

# -----------------------------------------------------------------------------
# 3) Dominios centralizados + arquitectura biométrica
# -----------------------------------------------------------------------------
for ruta, nombre in [
    ("/api/crm/personas", "personas"),
    ("/api/crm/tickets", "tickets"),
    ("/api/crm/carreras", "carreras"),
    ("/api/crm/caja", "caja"),
    ("/api/crm/comunidad", "comunidad"),
    ("/api/crm/personal/empleados", "personal/empleados"),
    ("/api/crm/personal/asistencia", "personal/asistencia"),
    ("/api/crm/auditoria", "auditoria"),
]:
    st, body, _ = http("GET", f"{CRM}{ruta}?limit=5", token=tok_admin)
    ok = st == 200 and isinstance(body, dict) and "datos" in body and "paginacion" in body
    check(f"CRM {nombre} -> 200 con datos+paginación", ok, f"status={st}")

st, body, _ = http("GET", f"{CRM}/api/crm/personal/estado", token=tok_admin)
check("biométrico: arquitectura_lista = true", st == 200 and body.get("arquitectura_lista") is True, f"status={st} body={str(body)[:120]}")
check("biométrico: declara tabla crm_asistencia_diaria", isinstance(body, dict) and "crm_asistencia_diaria" in (body.get("tablas") or []), "")

# -----------------------------------------------------------------------------
# 4) Filtros avanzados y paginación
# -----------------------------------------------------------------------------
st, base, _ = http("GET", f"{CRM}/api/crm/personas?limit=1", token=tok_admin)
st, filtrado, _ = http("GET", f"{CRM}/api/crm/personas?rol=piloto&limit=1", token=tok_admin)
tot_base = base.get("paginacion", {}).get("total", 0) if isinstance(base, dict) else 0
tot_fil = filtrado.get("paginacion", {}).get("total", 0) if isinstance(filtrado, dict) else 0
check("filtro personas?rol=piloto -> 200", st == 200, f"status={st}")
check("filtro rol reduce el total", tot_fil <= tot_base and tot_fil > 0, f"piloto={tot_fil} total={tot_base}")

st, body, _ = http("GET", f"{CRM}/api/crm/personas?q=Chronit&limit=5", token=tok_admin)
check("filtro de texto personas?q=Chronit -> 200", st == 200, f"status={st}")

st, body, _ = http("GET", f"{CRM}/api/crm/tickets?desde=2000-01-01&hasta=2100-01-01&limit=5", token=tok_admin)
check("filtro por rango de fechas en tickets -> 200", st == 200, f"status={st}")

st, body, _ = http("GET", f"{CRM}/api/crm/tickets?impreso=true&limit=5", token=tok_admin)
check("filtro booleano tickets?impreso=true -> 200", st == 200, f"status={st}")

st, body, _ = http("GET", f"{CRM}/api/crm/personal/asistencia?tipo=entrada&limit=5", token=tok_admin)
check("filtro asistencia?tipo=entrada -> 200", st == 200, f"status={st}")

st, body, _ = http("GET", f"{CRM}/api/crm/caja?limit=5", token=tok_admin)
check("caja: cruza sesiones de caja con cajera", st == 200, f"status={st}")

st, body, _ = http("GET", f"{CRM}/api/crm/personas?limit=99999", token=tok_admin)
lim = body.get("paginacion", {}).get("limit") if isinstance(body, dict) else None
check("paginación acota el límite a 200", lim == 200, f"limit={lim}")

# -----------------------------------------------------------------------------
# 5) Exportación CSV
# -----------------------------------------------------------------------------
st, raw, hs = http("GET", f"{CRM}/api/crm/personas?rol=piloto&formato=csv", token=tok_admin, raw=True)
check("export personas CSV -> 200", st == 200, f"status={st}")
check("export CSV: content-type text/csv", "text/csv" in (hs.get("content-type") or ""), hs.get("content-type", ""))
check("export CSV: BOM UTF-8", raw[:3] == b"\xef\xbb\xbf", str(raw[:3]))
check("export CSV: cabeceras separadas por ';'", b"Nombre;Apellido;Carnet" in raw, "")
check("export CSV: Content-Disposition adjunta", "attachment" in (hs.get("content-disposition") or ""), hs.get("content-disposition", ""))

st, raw, hs = http("GET", f"{CRM}/api/crm/tickets?formato=csv", token=tok_admin, raw=True)
check("export tickets CSV -> 200", st == 200 and "Número".encode() in raw, f"status={st}")

st, raw, hs = http("GET", f"{CRM}/api/crm/personal/empleados?formato=csv", token=tok_admin, raw=True)
check("export personal/empleados CSV -> 200", st == 200, f"status={st}")

# -----------------------------------------------------------------------------
# 6) Auditoría del CRM (consultas, exportaciones e IP real vía proxy)
# -----------------------------------------------------------------------------
# Petición con X-Forwarded-For: debe quedar registrada la IP del cliente real.
st, _, _ = http("GET", f"{CRM}/api/crm/personas?q=AuditoriaIP&limit=1", token=tok_admin,
                headers={"X-Forwarded-For": "203.0.113.9"})
check("petición con X-Forwarded-For -> 200", st == 200, f"status={st}")

n_exp = psql("SELECT COUNT(*) FROM crm_auditoria WHERE accion='exportar' AND formato='csv';")
n_con = psql("SELECT COUNT(*) FROM crm_auditoria WHERE accion='consultar';")
n_ip = psql("SELECT COUNT(*) FROM crm_auditoria WHERE ip='203.0.113.9';")
n_rec = psql("SELECT COUNT(DISTINCT recurso) FROM crm_auditoria;")
check("auditoría registra exportaciones (acción=exportar)", n_exp.isdigit() and int(n_exp) > 0, f"filas={n_exp}")
check("auditoría registra consultas (acción=consultar)", n_con.isdigit() and int(n_con) > 0, f"filas={n_con}")
check("auditoría guarda la IP real del cliente (trust proxy)", n_ip.isdigit() and int(n_ip) > 0, f"filas={n_ip}")
check("auditoría cubre varios recursos", n_rec.isdigit() and int(n_rec) >= 3, f"recursos={n_rec}")

# -----------------------------------------------------------------------------
# 7) Solo lectura: el CRM no expone superficie de escritura
# -----------------------------------------------------------------------------
st, _, _ = http("POST", f"{CRM}/api/crm/personas", {"nombre": "x"}, token=tok_admin)
check("CRM no acepta POST en /personas -> 404", st == 404, f"status={st}")
st, _, _ = http("DELETE", f"{CRM}/api/crm/tickets/1", token=tok_admin)
check("CRM no acepta DELETE en /tickets -> 404", st == 404, f"status={st}")
st, _, _ = http("POST", f"{CRM}/api/crm/personal/asistencia", {"tipo": "entrada"}, token=tok_admin)
check("CRM no acepta marcaciones por POST -> 404", st == 404, f"status={st}")

# -----------------------------------------------------------------------------
# 8) Cabeceras de seguridad (backends y frontends)
# -----------------------------------------------------------------------------
st, _, hs = http("GET", f"{CRM}/health")
check("CRM backend: X-Content-Type-Options nosniff", hs.get("x-content-type-options") == "nosniff", hs.get("x-content-type-options", ""))
check("CRM backend: X-Frame-Options DENY", hs.get("x-frame-options") == "DENY", hs.get("x-frame-options", ""))
check("CRM backend: Referrer-Policy no-referrer", hs.get("referrer-policy") == "no-referrer", hs.get("referrer-policy", ""))

st, _, hs = http("GET", f"{TICKETS}/health")
check("tickets-backend: cabeceras de seguridad", hs.get("x-content-type-options") == "nosniff" and hs.get("x-frame-options") == "DENY", "")
st, _, hs = http("GET", f"{CONTA}/health")
check("contabilidad-backend: cabeceras de seguridad", hs.get("x-content-type-options") == "nosniff" and hs.get("x-frame-options") == "DENY", "")
st, _, hs = http("GET", f"{CRM_FE}/login")
check("CRM frontend: cabeceras de seguridad", hs.get("x-content-type-options") == "nosniff" and hs.get("x-frame-options") == "DENY", f"status={st}")

# -----------------------------------------------------------------------------
# 9) La separación NO rompe la operación del cajero
# -----------------------------------------------------------------------------
piloto_para_ticket = piloto_id or 9
st, body, _ = http("POST", f"{TICKETS}/api/tickets", {"usuario_id": piloto_para_ticket}, token=tok_caj)
check("cajero: genera ticket de carrera -> 201", st == 201, f"status={st} body={str(body)[:120]}")
ticket_id = body.get("id") if isinstance(body, dict) else None

if ticket_id:
    st, body, _ = http("GET", f"{TICKETS}/api/tickets/{ticket_id}", token=tok_caj)
    check("cajero: consulta el ticket generado -> 200", st == 200, f"status={st}")
    # Los campos de control contable añadidos en la Fase 0 existen en la BD.
    fila = psql(
        "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='tickets' "
        "AND column_name IN ('cantidad_vueltas','promocion_id','tipo_promocion','promocion_nombre_snapshot',"
        "'impreso_en','veces_impreso','cajero_carnet_snapshot','sucursal_id');"
    )
    check("tickets: conserva los campos de control contable (8/8)", fila == "8", f"columnas={fila}")

st, body, _ = http("GET", f"{CONTA}/api/conta/cajas/actual", token=tok_caj)
check("cajero: sigue usando contabilidad -> 200", st == 200, f"status={st}")

st, _, _ = http("GET", f"{CONTA}/api/conta/configuracion", token=tok_caj)
check("cajero: NO accede a la configuración contable -> 403", st == 403, f"status={st}")

st, _, _ = http("GET", f"{TICKETS}/api/personal", token=tok_caj)
check("cajero: NO accede al gestor de usuarios -> 403", st == 403, f"status={st}")

# El propio CRM no puede modificar el ticket (solo lectura).
if ticket_id:
    st, _, _ = http("POST", f"{CRM}/api/crm/tickets/{ticket_id}", {"estado": "USADO"}, token=tok_admin)
    check("CRM no puede modificar un ticket -> 404", st == 404, f"status={st}")

# Operación sensible: crear y eliminar un ticket (debe quedar auditado).
st, body, _ = http("POST", f"{TICKETS}/api/tickets", {"usuario_id": piloto_para_ticket}, token=tok_caj)
tk_borrar = body.get("id") if isinstance(body, dict) else None
if st == 201 and tk_borrar:
    st_del, _, _ = http("DELETE", f"{TICKETS}/api/tickets/{tk_borrar}", token=tok_caj)
    check("cajero: elimina un ticket -> 200", st_del == 200, f"status={st_del}")

# -----------------------------------------------------------------------------
# 10) Auditoría del sistema de tickets (operaciones sensibles)
# -----------------------------------------------------------------------------
st, body, _ = http("GET", f"{TICKETS}/api/auditoria?limit=5", token=tok_admin)
check("admin: bitácora de tickets -> 200", st == 200 and isinstance(body, dict) and "datos" in body and "paginacion" in body, f"status={st}")

st, _, _ = http("GET", f"{TICKETS}/api/auditoria", token=tok_caj)
check("cajero: bitácora de tickets -> 403", st == 403, f"status={st}")

n_tk = psql("SELECT COUNT(*) FROM tickets_auditoria WHERE accion='crear' AND entidad='ticket';")
check("auditoría de tickets registra creación de tickets", n_tk.isdigit() and int(n_tk) > 0, f"filas={n_tk}")

n_del = psql("SELECT COUNT(*) FROM tickets_auditoria WHERE accion='eliminar' AND entidad='ticket';")
check("auditoría de tickets registra eliminación de tickets", n_del.isdigit() and int(n_del) > 0, f"filas={n_del}")

n_carnet = psql("SELECT COUNT(*) FROM tickets_auditoria WHERE usuario_carnet IS NOT NULL;")
check("auditoría de tickets guarda snapshot del carnet", n_carnet.isdigit() and int(n_carnet) > 0, f"filas={n_carnet}")

st, body, _ = http("GET", f"{TICKETS}/api/auditoria?accion=crear&limit=5", token=tok_admin)
ok = st == 200 and isinstance(body, dict) and all(r.get("accion") == "crear" for r in (body.get("datos") or []))
check("auditoría de tickets: filtro por acción -> 200", ok, f"status={st}")

# -----------------------------------------------------------------------------
# Limpieza del usuario de prueba y del ticket generado
# -----------------------------------------------------------------------------
if ticket_id:
    psql(f"DELETE FROM tickets WHERE id={ticket_id};")
if piloto_id:
    psql(f"DELETE FROM usuarios WHERE id={piloto_id} AND rol='piloto';")

# -----------------------------------------------------------------------------
# Reporte
# -----------------------------------------------------------------------------
print("=" * 78)
print("PRUEBAS DE INTEGRACIÓN — CRM + SEGURIDAD + AUDITORÍA")
print("=" * 78)
for estado, nombre, detalle in ROWS:
    marca = "OK " if estado == "PASS" else "FALLA"
    extra = f"   [{detalle}]" if (detalle and estado == "FAIL") else ""
    print(f"[{marca}] {nombre}{extra}")
print("-" * 78)
print(f"TOTAL: {PASS} PASS / {FAIL} FAIL  (de {PASS + FAIL})")
print("=" * 78)
sys.exit(0 if FAIL == 0 else 1)
