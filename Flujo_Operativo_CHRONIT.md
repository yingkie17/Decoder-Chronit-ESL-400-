



1. Arquitectura y URLs por puerto

Tickets frontend :3000, web-client :3001, backend :4000, core de carrera :5000, Postgres :5433, Valeque :6380, paneles SQLite :8880/8881/8883.
2. Credenciales de prueba (verificadas funcionando ahora)

Admin: admin / Admin123! (id 92)
Piloto: FLOW-001 / Piloto123! (id 120)
Más pilotos de test (TEST123, TESTFLUJO001, etc.)
3. Máquinas de estado

Ticket: PENDIENTE → ASIGNADO → LLAMANDO → PREPARADO → ACTIVO → FINALIZADO
Cola: espera → llamado → ready
Evento: pendiente → preparada → activo → finalizado
4. Flujo paso a paso por actor

Cliente → kiosco self-service /cliente o register (buscar o crear cuenta)
Cajero → /kiosco (crear evento, ticket, cobrar/pagar, asignar a evento, transponder)
Vestidor → /vestidor (llamar grupo, marcar Ready, poner evento en «preparada»)
Control de carrera → :5000 dashboard (iniciar evento, finalizar, resultados a Postgres)
5. Verificación de base de datos

Comandos SQL para PostgreSQL (usuarios, eventos, tickets, colas, resultados, logros) + verificación del vínculo uuid_global.
Paneles SQLite en :8880/8881/8883.
Logs: chronit-sync, chronit-hardware, chronit-tickets-backend.
6. Postman

Tabla completa de peticiones con método, URL, auth, body y respuesta esperada (tickets + core).
Secuencia de 13 pasos para probar el flujo de punta a punta.
Verificaciones que hice en vivo
POST /api/auth/login con ambas credenciales → token correcto (admin id 92, piloto id 120).
GET /api/eventos con token admin → [200] con 3 eventos.
GET /api/eventos/resultados/ultima-carrera (público) → responde.
GET /api/status del core → sesión 245 completed (confirmando que la sincronización de resultados ya corre).










# 🏁 CHRONIT — Flujo Operativo Completo

> Documento de referencia para operar el ecosistema: **Cliente → Cajero → Vestidor → Control de carrera**.
> Incluye URLs de acceso, credenciales de prueba, cómo verificar la base de datos y cómo probar
> el backend con **Postman**.

---

## 1. Resumen del ecosistema

El ecosistema se compone de **un backend de tickets**, **dos frontends**, **una base PostgreSQL**,
**una base SQLite (core)**, **Valkey (sesiones/caché)** y un **sentinela de sincronización**.

| Servicio | Contenedor | Puerto | Qué hace |
|---|---|---|---|
| Core de carrera (Flask) | `chronit-hardware` | **5000** | Control de carrera (iniciar/finalizar), lector ESL-400, dashboard. Posee `chronit.db` (SQLite). |
| Backend de Tickets (Express) | `chronit-tickets-backend` | **4000** | API de auth, tickets, colas, eventos, pilotos, reportes, pantalla. Escribe en PostgreSQL. |
| Web de Pilotos + Admin (Next.js) | `chronit-tickets-frontend` | **3000** | Kiosco, Administración, Vestidores, Display, Registro/Login de pilotos. |
| Web de Cliente (Next.js) | `chronit-web-client` | **3001** | Feed social, Mi cuenta, Registro/Búsqueda de pilotos (sesión en Valkey). |
| PostgreSQL 16 | `chronit-postgres` | **5433** | Base universal: `usuarios`, `eventos`, `tickets`, `colas`, `resultados_carrera`, `logros`. |
| Valkey (Redis) | `chronit-valkey` | **6380** | Sesiones del web-client + caché de pantalla pública. |
| SQLite web — core | `chronit-sqlite-web` | **8880** | Panel web de `chronit.db` (drivers, sesiones, vueltas). |
| SQLite web — users | `users-sqlite-web` | **8881** | Panel web de `users.db`. |
| SQLite web — backups | `backups-temp-sqlite-web` | **8883** | Panel web de respaldos. |
| Sentinela de sync | `chronit-sync` | — | Sincroniza SQLite → PostgreSQL cada **30 s**. |

**Credenciales de base de datos (PostgreSQL):** `usuario: chronit` · `password: chronit_secret` · `base: chronit` · `puerto: 5433`.

---

## 2. URLs de acceso

### Web de Pilotos + Admin → `http://localhost:3000`

| Ruta | Para quién / uso |
|---|---|
| `/setup-admin` | **Primer acceso**: crear el primer Admin/taquilla/coordinador (solo si no existe). |
| `/login` | Iniciar sesión (carnet + contraseña). |
| `/register` | Registro de piloto (crear cuenta). |
| `/kiosco` | **Cajero / Taquilla**: crear evento, generar tickets, cobrar (pagar), asignar a evento, asignar transponders. |
| `/cliente` | **Kiosco de cliente** (self-service): el piloto busca o se registra y genera su ticket. |
| `/admin` | **Administración**: dashboard/reportes, llamar a vestidores, configurar pantalla, premios, roles, QR. |
| `/vestidor` | **Vestidor**: llamar siguiente grupo, marcar competidores «Listo», poner el evento en «preparada». |
| `/dashboard` | Perfil del piloto (historial, palmarés, notificaciones de llamada a vestidores). |
| `/display` | **Pantalla pública** (carrusel, llamados, resultados). |

### Web de Cliente → `http://localhost:3001`

| Ruta | Uso |
|---|---|
| `/` y `/feed` | Feed social. |
| `/register` | Crear cuenta de piloto (con/sin foto). |
| `/login` | Iniciar sesión (cookie `chronit_session` respaldada en Valkey). |
| `/cuenta` | **Mi cuenta**: datos, tickets, tiempos y premios. |
| `/buscar` | Buscar a otro piloto por nombre/carnet/teléfono. |
| `/historial` | Historial de carreras. |
| `/notificaciones` | Notificaciones. |

### Core de carrera → `http://localhost:5000`

| Ruta | Uso |
|---|---|
| `/` | **Dashboard de control de carrera** (iniciar evento, ver vueltas, finalizar). |
| `/api/*` | API REST del core (directa, con Postman). |

---

## 3. Credenciales de prueba

> ⚠️ **Credenciales creadas durante las pruebas.** Cámbialas antes de producción.

| Rol | Carnet | Contraseña | Notas |
|---|---|---|---|
| **Admin** | `admin` | `Admin123!` | Usuario id **92** en PostgreSQL. Permite todo. |
| **Piloto** | `FLOW-001` | `Piloto123!` | Usuario id **120**, nombre «Piloto Flow Test». |
| **Piloto** | `TEST123` | *(definida en la BD)* | Usuario id **11**, «Prueba Demo». |
| **Piloto** | `TESTFLUJO001` | *(definida en la BD)* | Usuario id **12**, «Prueba Flujo». |
| **Piloto** | `TESTBUSQ001` | *(definida en la BD)* | Usuario id **13**, «Flujo Busqueda». |
| **Piloto** | `PT-001` | *(definida en la BD)* | Usuario id **106**, «Piloto Test». |

Otros pilotos ya cargados (ids 1–10) provienen de la sincronización con el core (Chronit).
Si un piloto aún no tiene contraseña (`has_pwd = f`), al intentar login el backend responde
`needs_setup: true` y debe **definir su contraseña** por `/login` (endpoint `POST /api/auth/setup`).

> Para cambiar el rol de un usuario (promover a cajero/coordinador) se usa
> `PUT /api/auth/rol` (requiere admin) o la vista `/admin`.

---

## 4. Máquinas de estado (para entender el flujo)

**Ticket (fuente de verdad):**
`PENDIENTE → ASIGNADO → LLAMANDO → PREPARADO → ACTIVO → FINALIZADO`

- `PENDIENTE`: generado, aún no pagado.
- `ASIGNADO`: pagado (cobrado).
- `LLAMANDO`: se llamó al grupo a un vestidor.
- `PREPARADO`: el competidor está «Listo» en el vestidor.
- `ACTIVO` / `FINALIZADO`: ciclo de la carrera en pista (lo refleja el core/sync).

**Cola (operación de vestidor):**
`espera → llamado → ready`

**Evento:**
`pendiente → preparada → activo → finalizado`

---

## 5. Flujo paso a paso

### 5.1 Cliente — se registra o se busca su cuenta

**Opción A — Kiosco self-service** (`http://localhost:3000/cliente`)
1. Pulsar **«Generar ticket»**.
2. **Buscar** piloto por correo / carnet / nombre / celular.
   - Si **existe** → seleccionarlo.
   - Si **no existe** → **«Registrar piloto»** (nombre, apellido, email, celular, carnet, edad, nacionalidad, género, contraseña, foto) → se crea la cuenta como rol `piloto`.
3. Pulsar **«Generar ticket»** → se crea un ticket en estado **PENDIENTE**.
4. Aviso al cliente: pasar a **taquilla** para pagar y ser asignado al evento.

**Opción B — Web** (`http://localhost:3000/register` o `http://localhost:3001/register`)
1. Completar el formulario (nombre, carnet, email, nacionalidad, contraseña).
2. Al guardar ya queda logueado (redirige a `/dashboard` en 3000 o `/feed` en 3001).
3. Desde `http://localhost:3001/cuenta` el piloto ve sus tickets, tiempos y premios.
4. `http://localhost:3001/buscar` permite buscar a otros pilotos.

**Endpoints involucrados:** `POST /api/auth/register`, `POST /api/auth/search?q=`, `POST /api/auth/login`.

---

### 5.2 Cajero — cobra y asigna al evento

**Pantalla:** `http://localhost:3000/kiosco` (requiere sesión admin/cajero)

1. **Crear el evento** (si no existe): nombre, fecha, hora, tipo, vueltas, duración → `POST /api/eventos`.
2. **Buscar** al piloto (carnet/nombre/email/teléfono).
3. Pulsar **«Generar ticket»** → ticket en `PENDIENTE` (`POST /api/tickets`).
4. Pulsar **«Marcar pagado»** → ticket `ASIGNADO` (`POST /api/tickets/{id}/pagar`).
5. Seleccionar el **evento** y pulsar **«Asignar a evento»** → `POST /api/tickets/{id}/asignar` (crea la fila en `colas` con estado `espera`).
6. **Asignar transponder** a cada piloto del evento (opcional) → `POST /api/eventos/{id}/drivers/{driverId}/transponder`.
7. Ver que el piloto figura en «Pilotos del evento».

**Opcional (admin):** `http://localhost:3000/admin`
- Dashboard/reportes (`GET /api/reportes/resumen`).
- Llamar 5 a Vestidor 1/2 directamente.
- Cambiar roles, crear premios, subir fotos, ver QR/carné.

---

### 5.3 Vestidor — prepara para la carrera

**Pantalla:** `http://localhost:3000/vestidor`

1. Seleccionar el **evento** (aparece la lista de carrera con los tickets asignados).
2. Elegir **Vestidor (1 o 2)** y **tamaño del grupo** → pulsar **«Llamar siguiente grupo»**.
   - `POST /api/colas/siguiente` → colas pasan a `llamado` y los tickets a `LLAMANDO`.
   - La **pantalla pública** (`/display`) y el **piloto** (`/dashboard`) reciben notificación en tiempo real.
3. Cuando el competidor esté listo, marcar **Ready** → `POST /api/colas/{ticket_id}/ready {ready:true}` → ticket `PREPARADO`.
4. Repetir hasta que **todos** estén listos.
5. Pulsar **«Poner evento en preparada»** → `POST /api/eventos/{id}/preparada`.
   - El evento pasa a estado `preparada` (el core hace `ready-all` de los pilotos).
   - ⚠️ Solo se puede si **todos** están listos y **no hay carrera activa**.

**Acciones extra:** eliminar ticket de la lista, reemplazar competidor (`POST /api/colas/{id}/reemplazar`).

---

### 5.4 Control de carrera

**Pantalla:** `http://localhost:5000/` (dashboard del core)

1. Verificar que el evento está en estado `preparada` (`GET http://localhost:4000/api/eventos/carrera-activa`).
2. **Iniciar** el evento → `POST http://localhost:5000/api/events/{id}/start`.
   - El core crea la sesión de carrera e inscribe a los pilotos del evento.
   - Si el evento **no** está `preparada`, devuelve error 400.
3. La carrera corre en vivo (vueltas del lector ESL-400).
4. **Finalizar** la carrera → `POST http://localhost:5000/api/race/finish`.
   - El core calcula la clasificación y **sincroniza `resultados_carrera`** a PostgreSQL (best-effort).
5. El **display** (`http://localhost:3000/display`) muestra automáticamente los **resultados** de la última carrera (`GET /api/eventos/resultados/ultima-carrera`).

---

## 6. Verificación de la base de datos

### 6.1 PostgreSQL (base universal, puerto 5433)

```bash
docker exec chronit-postgres psql -U chronit -d chronit
```

```sql
-- Usuarios (pilotos, admin, cajero...)
SELECT id, carnet, nombre, apellido, rol,
       (password_hash IS NOT NULL) AS tiene_contrasena,
       uuid_global FROM usuarios ORDER BY id;

-- Eventos
SELECT id, nombre, fecha, estado FROM eventos ORDER BY id DESC;

-- Tickets (máquina de estados)
SELECT id, numero, estado, evento_id, usuario_id, creado_en
FROM tickets ORDER BY id DESC;

-- Colas (operación de vestidor)
SELECT c.id, c.estado, c.vestidor, t.numero AS ticket, u.nombre, u.apellido
FROM colas c
JOIN tickets t ON t.id = c.ticket_id
JOIN usuarios u ON u.id = t.usuario_id
ORDER BY t.numero;

-- Resultados de carrera (sincronizados por el core al finalizar)
SELECT id, posicion, tiempo_total, mejor_vuelta, evento_id, usuario_id
FROM resultados_carrera ORDER BY id DESC;

-- Logros / premios
SELECT id, tipo, descripcion, usuario_id FROM logros ORDER BY id DESC;
```

**Verificación de vínculo `uuid_global`** (clave para que los resultados se asocien al piloto):
```sql
SELECT u.nombre, u.uuid_global
FROM usuarios u
ORDER BY u.id;
```

### 6.2 SQLite (core `chronit.db`) — paneles web

- `http://localhost:8880` → base `chronit.db` (drivers, sesiones, vueltas).
- `http://localhost:8881` → base `users.db`.
- `http://localhost:8883` → base de respaldos.

```bash
docker exec chronit-sqlite-web sqlite3 /data/chronit.db "SELECT id, uuid_global, name, lastname FROM drivers LIMIT 20;"
```

### 6.3 Logs (mensajes de backend)

```bash
# Sentinela de sincronización (SQLite -> PostgreSQL cada 30s)
docker logs -f chronit-sync

# Core de carrera (control de carrera + sync de resultados)
docker logs -f chronit-hardware

# Backend de tickets (auth, tickets, colas, eventos)
docker logs -f chronit-tickets-backend
```

Pista: al finalizar una carrera, el log del core muestra algo como
`[PG] Resultados de la sesión N sincronizados` si el link de `uuid_global` fue correcto.

---

## 7. Pruebas del backend con Postman

### 7.1 Configuración inicial

- **Base de entornos:**
  - `tickets` = `http://localhost:4000` (backend de tickets, PostgreSQL).
  - `core` = `http://localhost:5000` (API del core de carrera).

- **Autenticación:** la mayoría de los endpoints requieren el header
  `Authorization: Bearer <token>`. El token se obtiene del login.

### 7.2 Colección de peticiones

| Método | URL | Auth | Body (JSON) | Respuesta |
|---|---|---|---|---|
| POST | `{{tickets}}/api/auth/login` | No | `{"carnet":"admin","password":"Admin123!"}` | `200 {token, user}` → guardar `token` |
| POST | `{{tickets}}/api/auth/register` | No | `{"nombre":"Ana","apellido":"Flujo","carnet":"FLUJO01","email":"ana@x.com","nacionalidad":"BO","password":"123456"}` | `201 {token, user}` |
| POST | `{{tickets}}/api/auth/bootstrap-admin` | No → solo si no hay admin | `{"nombre":"Admin","carnet":"ADM-001","password":"Admin123!","rol":"admin"}` | `201 {token, user}` |
| GET | `{{tickets}}/api/auth/search?q=PIL` | Sí | — | `200 [pilotos]` |
| GET | `{{tickets}}/api/eventos` | Sí | — | `200 [eventos]` |
| POST | `{{tickets}}/api/eventos` | Sí | `{"name":"Race 1","event_date":"2026-09-08","event_time":"18:00","race_mode":"position","laps_limit":10}` | `201 {evento}` |
| POST | `{{tickets}}/api/tickets` | Sí | `{"usuario_id":120,"evento_id":null}` | `201 {ticket estado=PENDIENTE}` |
| POST | `{{tickets}}/api/tickets/{id}/pagar` | Sí | — | `200 {estado=ASIGNADO}` |
| POST | `{{tickets}}/api/tickets/{id}/asignar` | Sí | `{"evento_id":1}` | `200 {estado=ASIGNADO}` + crea `colas` en `espera` |
| GET | `{{tickets}}/api/colas?evento_id=1` | Sí | — | `200 [colas]` |
| POST | `{{tickets}}/api/colas/siguiente` | Sí | `{"evento_id":1,"vestidor":1,"grupo":5}` | `200 {llamados, lista}` |
| POST | `{{tickets}}/api/colas/{ticket_id}/ready` | Sí | `{"ready":true}` | `200 {estado=ready}` |
| POST | `{{tickets}}/api/eventos/{id}/preparada` | Sí | — | `200 {estado=preparada}` |
| GET | `{{tickets}}/api/eventos/carrera-activa` | Sí | — | `200 {activa, session}` |
| GET | `{{tickets}}/api/eventos/resultados/ultima-carrera` | No | — | `200 {evento, resultados}` |
| GET | `{{tickets}}/api/reportes/resumen` | Sí (admin) | — | `200 {usuarios_total, tickets_por_estado…}` |

**Endpoints directos del core (control de carrera):**

| Método | URL | Body | Respuesta |
|---|---|---|---|
| GET | `{{core}}/api/status` | — | Estado de la sesión de carrera |
| POST | `{{core}}/api/events/{id}/start` | `{}` | `200 {success}` — requiere evento `preparada` |
| POST | `{{core}}/api/race/finish` | `{}` | `200 {success}` — sincroniza resultados a PostgreSQL |
| GET | `{{core}}/api/events` | — | Lista de eventos del core |
| GET | `{{core}}/api/drivers` | — | Lista de pilotos del core (con `uuid_global`) |

### 7.3 Flujo de prueba con Postman (resumen)

1. `POST /api/auth/login` → copiar `token`.
2. `POST /api/auth/register` (o reutilizar un piloto existente, ej. `FLOW-001`).
3. `POST /api/eventos` → guardar `id` del evento.
4. `POST /api/tickets` con `usuario_id` del piloto.
5. `POST /api/tickets/{id}/pagar`.
6. `POST /api/tickets/{id}/asignar` con el `evento_id`.
7. `POST /api/colas/siguiente` (`evento_id`, `vestidor`, `grupo`).
8. `POST /api/colas/{ticket_id}/ready`.
9. `POST /api/eventos/{id}/preparada`.
10. `POST {{core}}/api/events/{id}/start`.
11. `POST {{core}}/api/race/finish`.
12. `GET /api/eventos/resultados/ultima-carrera` → ver resultados.
13. Verificar en PostgreSQL: `SELECT * FROM resultados_carrera ORDER BY id DESC;`

---

## 8. Notas y advertencias

- **Roles permitidos por endpoint:** los endpoints tienen `requireRole(...)`. Por ejemplo `/api/colas` de lectura admite admin/cajero/coordinador; `/api/reportes/resumen` solo admin. `desarrollador` equivale a `admin`.
- **Regla de negocio del core:** la carrera **no se inicia** si el evento no está en `preparada`. El vestidor debe marcarlo cuando todos estén listos.
- **Resultados a PostgreSQL:** `sync_finished_session` es *best-effort*: si un piloto no tiene `uuid_global` resoluble en PostgreSQL, la fila se omite y se loguea (no debe romper el API).
- **Sesión del web-client (3001):** usa cookie `chronit_session` respaldada en Valkey (8 h). No usa JWT.
- **Sesión del frontend de tickets (3000):** usa JWT guardado en `localStorage` (`chronit_token`).
- Cambia `JWT_SECRET` y las contraseñas antes de producción.
```
