// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: rutas de autenticación
//   POST /api/auth/register           -> crear usuario (rol piloto), genera uuid_global
//   POST /api/auth/login              -> login, devuelve token + datos de sesión
//   POST /api/auth/logout             -> cierra sesión (invalida token del cliente)
//   GET  /api/auth/me                 -> datos del usuario autenticado
//   POST /api/auth/bootstrap-admin    -> crea el PRIMER admin (o taquilla/vestidor) si no existe ninguno
//   POST /api/auth/setup              -> pilotos sincronizados sin password fijan su contraseña
//   PUT  /api/auth/rol                -> admin cambia el rol de un usuario
// =============================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { signToken, requireAuth, requireRole } from '../middleware/auth.js';
import { createSession, destroySession, setSessionCookie, clearSessionCookie, readCookie, SESSION_COOKIE } from '../session.js';
import { uuid, flagOf, NATIONALITIES } from '../utils/helpers.js';
import { auditar } from '../utils/audit.js';

export const authRouter = Router();

// Inicia la sesión de servidor (Valkey + cookie httpOnly) y devuelve también un
// JWT para compatibilidad con clientes que aún usen Authorization: Bearer.
async function startSession(res, user) {
  const token = await createSession({ id: user.id, rol: user.rol });
  setSessionCookie(res, token);
  return signToken({ id: user.id, rol: user.rol });
}

// Roles de personal permitidos (bootstrap y gestión de roles)
const STAFF_ROLES = ['admin', 'cajero', 'coordinador', 'desarrollador'];

// Campos de búsqueda: la variante "full" expone PII (solo personal autenticado);
// la variante "publico" omite email/telefono para el kiosco de cliente.
const SEARCH_FIELDS_FULL =
  'id, uuid_global, nombre, apellido, email, telefono, carnet, foto, nacionalidad, edad, genero, rol, creado_en';
const SEARCH_FIELDS_PUBLICO =
  'id, uuid_global, nombre, apellido, carnet, foto, nacionalidad, edad, genero, rol, creado_en';

// Buscar usuario por carnet/email/telefono/nombre/apellido (para kiosco y web).
// Los campos exactos (carnet/email/telefono) se comparan con ILIKE para soportar
// búsqueda parcial cuando el operador del kiosco escribe solo parte del carnet.
async function findUser(term, withPii = true) {
  const select = withPii ? SEARCH_FIELDS_FULL : SEARCH_FIELDS_PUBLICO;
  const { rows } = await query(
    `SELECT ${select}
     FROM usuarios
     WHERE carnet ILIKE $1 OR email ILIKE $1 OR telefono ILIKE $1
        OR nombre ILIKE $1 OR apellido ILIKE $1
        OR (nombre || ' ' || apellido) ILIKE $1
     ORDER BY creado_en DESC LIMIT 20`,
    [term]
  );
  return rows;
}

authRouter.post('/register', async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, carnet, password, foto, nacionalidad, edad, genero } = req.body;
    if (!nombre || !carnet || !password) {
      return res.status(400).json({ error: 'Nombre, carnet y contraseña son obligatorios' });
    }
    // Unicidad de carnet: validación explícita previa al INSERT (además del
    // índice único, por si la BD conserva duplicados históricos).
    const { rows: dupCarnet } = await query('SELECT 1 FROM usuarios WHERE carnet = $1', [carnet]);
    if (dupCarnet.length) return res.status(409).json({ error: 'Carnet ya registrado' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO usuarios (uuid_global, nombre, apellido, email, telefono, carnet, password_hash, foto, nacionalidad, edad, genero, rol)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'piloto')
       RETURNING id, uuid_global, nombre, apellido, email, telefono, carnet, foto, nacionalidad, edad, genero, rol`,
      [uuid(), nombre, apellido || '', email || null, telefono || null, carnet, hash, foto || null, nacionalidad || null, edad || null, genero || null]
    );
    const user = rows[0];
    const token = await startSession(res, user);
    res.status(201).json({ token, user: { ...user, flag: flagOf(user.nacionalidad) } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Carnet ya registrado' });
    res.status(500).json({ error: e.message });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const { carnet, password } = req.body;
    const { rows } = await query(
      'SELECT * FROM usuarios WHERE LOWER(carnet) = LOWER($1) OR LOWER(email) = LOWER($1)',
      [carnet]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    // Los invitados no tienen cuenta propia: no pueden iniciar sesión.
    if (user.es_invitado) {
      return res.status(403).json({ error: 'Los invitados no tienen una cuenta para iniciar sesión' });
    }

    // Cuenta bloqueada por el admin: no puede iniciar sesión.
    if (user.bloqueado) return res.status(403).json({ error: 'Cuenta bloqueada. Contacta al administrador.' });

    // Pilotos sincronizados desde Chronit llegan sin password_hash.
    // No pueden loguear todavía: se les pide definir su contraseña (setup).
    if (!user.password_hash) {
      const { password_hash, ...safe } = user;
      return res.json({ needs_setup: true, user: { ...safe, flag: flagOf(user.nacionalidad) } });
    }

    const ok = await bcrypt.compare(password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
    const token = await startSession(res, user);
    const { password_hash, ...safe } = user;
    res.json({ token, user: { ...safe, flag: flagOf(user.nacionalidad) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

authRouter.post('/logout', async (req, res) => {
  // Invalida la sesión de servidor (Valkey) y limpia la cookie.
  const token = readCookie(req, SESSION_COOKIE);
  await destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, uuid_global, nombre, apellido, email, telefono, carnet, foto, nacionalidad, rol, creado_en FROM usuarios WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user: { ...rows[0], flag: flagOf(rows[0].nacionalidad) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Búsqueda de pilotos para el kiosco de staff (requiere sesión: expone PII)
authRouter.get('/search', requireAuth, async (req, res) => {
  try {
    const term = req.query.q || req.query.term || '';
    const rows = await findUser(`%${term}%`, true);
    res.json(rows.map((r) => ({ ...r, flag: flagOf(r.nacionalidad) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Búsqueda pública para el kiosco CLIENTE: sin PII (no expone email/telefono).
// El piloto solo necesita identificarse (nombre + carnet) para generar su ticket.
authRouter.get('/search-publico', async (req, res) => {
  try {
    const term = (req.query.q || req.query.term || '').trim();
    if (!term) return res.json([]);
    const rows = await findUser(`%${term}%`, false);
    res.json(rows.map((r) => ({ ...r, flag: flagOf(r.nacionalidad) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lista de nacionalidades para el registro (banderas)
authRouter.get('/nationalities', (_req, res) => {
  res.json(NATIONALITIES);
});

// ---------------------------------------------------------------------------
// Correr como INVITADO (kiosco de cliente). Crea una cuenta de invitado
// (es_invitado = true) con un carnet auto-generado y su ticket PENDIENTE.
// Límite: 100 cuentas de invitado activas en el sistema (PROMPT FINAL).
// Requiere sesión de taquilla/admin (el dispositivo del kiosco).
// ---------------------------------------------------------------------------
authRouter.post('/invitado', requireAuth, requireRole('admin', 'cajero'), async (req, res) => {
  try {
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM usuarios WHERE es_invitado = true');
    if (cnt[0].c >= 100) {
      return res.status(409).json({ error: 'Se alcanzó el límite de 100 cuentas de invitado' });
    }
    // Carnet único de invitado. INV-IV-XXXXX para minimizar colisiones.
    let carnet = '';
    let user;
    for (let i = 0; i < 10; i++) {
      const suffix = Math.floor(1000 + Math.random() * 9000);
      carnet = `INV-${suffix}`;
      const { rows: dup } = await query('SELECT 1 FROM usuarios WHERE carnet = $1', [carnet]);
      if (!dup.length) break;
    }
    const num = cnt[0].c + 1;
    const hash = await bcrypt.hash(`invitado${num}`, 10);
    const { rows: ins } = await query(
      `INSERT INTO usuarios (uuid_global, nombre, apellido, email, telefono, carnet, password_hash, foto, nacionalidad, rol, es_invitado)
       VALUES ($1, 'Invitado', $2, NULL, NULL, $3, $4, NULL, NULL, 'piloto', true)
       RETURNING id, uuid_global, nombre, apellido, carnet, es_invitado`,
      [uuid(), `#${String(num).padStart(3, '0')}`, carnet, hash]
    );
    user = ins[0];
    // Número de ticket GLOBAL (secuencia de la BD): único entre todos los eventos.
    const ticket = await query(
      `INSERT INTO tickets (uuid_global, usuario_id, evento_id, estado)
       VALUES ($1, $2, NULL, 'PENDIENTE')
       RETURNING id, usuario_id, numero, estado, creado_en`,
      [uuid(), user.id]
    );
    res.status(201).json({ user, ticket: ticket.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'No se pudo generar el carnet de invitado, reintenta' });
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Correr como INVITADO desde el kiosco CLIENTE (sin sesión de staff).
// Misma lógica que /invitado pero accesible desde la pantalla del cliente.
// ---------------------------------------------------------------------------
authRouter.post('/invitado-publico', async (req, res) => {
  try {
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM usuarios WHERE es_invitado = true');
    if (cnt[0].c >= 100) {
      return res.status(409).json({ error: 'Se alcanzó el límite de 100 cuentas de invitado' });
    }
    let carnet = '';
    let user;
    for (let i = 0; i < 10; i++) {
      const suffix = Math.floor(1000 + Math.random() * 9000);
      carnet = `INV-${suffix}`;
      const { rows: dup } = await query('SELECT 1 FROM usuarios WHERE carnet = $1', [carnet]);
      if (!dup.length) break;
    }
    const num = cnt[0].c + 1;
    const hash = await bcrypt.hash(`invitado${num}`, 10);
    const { rows: ins } = await query(
      `INSERT INTO usuarios (uuid_global, nombre, apellido, email, telefono, carnet, password_hash, foto, nacionalidad, rol, es_invitado)
       VALUES ($1, 'Invitado', $2, NULL, NULL, $3, $4, NULL, NULL, 'piloto', true)
       RETURNING id, uuid_global, nombre, apellido, carnet, es_invitado`,
      [uuid(), `#${String(num).padStart(3, '0')}`, carnet, hash]
    );
    user = ins[0];
    // Número de ticket GLOBAL (secuencia de la BD): único entre todos los eventos.
    const ticket = await query(
      `INSERT INTO tickets (uuid_global, usuario_id, evento_id, estado)
       VALUES ($1, $2, NULL, 'PENDIENTE')
       RETURNING id, usuario_id, numero, estado, creado_en`,
      [uuid(), user.id]
    );
    res.status(201).json({ user, ticket: ticket.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'No se pudo generar el carnet de invitado, reintenta' });
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Crear el PRIMER admin / cajero / coordinador / desarrollador.
// Solo funciona si NO existe ningún usuario con ese rol (bootstrap de arranque).
// Se protege para que no pueda usarse en un sistema ya inicializado.
// ---------------------------------------------------------------------------
authRouter.post('/bootstrap-admin', async (req, res) => {
  try {
    const { nombre, apellido, carnet, password, nacionalidad, rol } = req.body;
    const targetRole = STAFF_ROLES.includes(rol) ? rol : 'admin';
    if (!nombre || !carnet || !password) {
      return res.status(400).json({ error: 'Nombre, carnet y contraseña son obligatorios' });
    }
    // No permitir crear un staff si ya existe alguien con ese rol.
    const { rows: existing } = await query('SELECT 1 FROM usuarios WHERE rol = $1 LIMIT 1', [targetRole]);
    if (existing.length) {
      return res.status(409).json({ error: `Ya existe un usuario con rol ${targetRole}` });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO usuarios (uuid_global, nombre, apellido, email, telefono, carnet, password_hash, foto, nacionalidad, rol)
       VALUES ($1, $2, $3, NULL, NULL, $4, $5, NULL, $6, $7)
       RETURNING id, uuid_global, nombre, apellido, email, telefono, carnet, foto, nacionalidad, rol`,
      [uuid(), nombre, apellido || '', carnet, hash, nacionalidad || null, targetRole]
    );
    const user = rows[0];
    const token = await startSession(res, user);
    res.status(201).json({ token, user: { ...user, flag: flagOf(user.nacionalidad) } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Carnet ya registrado' });
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Pilotos sincronizados desde Chronit (sin contraseña) fijan su contraseña.
// Se valida la identidad por carnet y que el usuario no tenga password aún.
// ---------------------------------------------------------------------------
authRouter.post('/setup', async (req, res) => {
  try {
    const { carnet, password } = req.body;
    if (!carnet || !password) {
      return res.status(400).json({ error: 'Carnet y contraseña son obligatorios' });
    }
    const { rows } = await query('SELECT * FROM usuarios WHERE carnet = $1', [carnet]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.password_hash) {
      return res.status(409).json({ error: 'Esta cuenta ya tiene contraseña configurada' });
    }
    const hash = await bcrypt.hash(password, 10);
    const upd = await query(
      'UPDATE usuarios SET password_hash = $1, actualizado_en = now() WHERE id = $2 RETURNING id, rol',
      [hash, user.id]
    );
    const token = await startSession(res, { id: upd.rows[0].id, rol: upd.rows[0].rol });
    res.json({ token, user: { ...user, password_hash: undefined, flag: flagOf(user.nacionalidad) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Admin cambia el rol de un usuario (promover/revocar permisos).
// ---------------------------------------------------------------------------
authRouter.put('/rol', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { usuario_id, rol } = req.body;
    if (!usuario_id || !STAFF_ROLES.includes(rol) && rol !== 'piloto') {
      return res.status(400).json({ error: 'usuario_id y rol válido son obligatorios' });
    }
    const { rows: antes } = await query('SELECT id, carnet, rol FROM usuarios WHERE id = $1', [usuario_id]);
    if (!antes.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { rows } = await query(
      'UPDATE usuarios SET rol = $1, actualizado_en = now() WHERE id = $2 RETURNING id, nombre, apellido, carnet, rol',
      [rol, usuario_id]
    );
    await auditar({
      req, accion: 'cambiar_rol', entidad: 'usuario', entidad_id: usuario_id,
      datos_antes: { rol: antes[0].rol }, datos_despues: { rol },
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Admin bloquea/desbloquea una cuenta. Un usuario bloqueado no puede iniciar
// sesión (se comprueba en /login) y se muestra con opacidad en las listas.
// ---------------------------------------------------------------------------
authRouter.put('/bloqueo', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { usuario_id, bloqueado } = req.body;
    if (!usuario_id || typeof bloqueado !== 'boolean') {
      return res.status(400).json({ error: 'usuario_id y bloqueado (boolean) son obligatorios' });
    }
    const { rows } = await query(
      'UPDATE usuarios SET bloqueado = $1, actualizado_en = now() WHERE id = $2 RETURNING id, nombre, apellido, carnet, bloqueado',
      [bloqueado, usuario_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    await auditar({
      req, accion: bloqueado ? 'bloquear_usuario' : 'desbloquear_usuario',
      entidad: 'usuario', entidad_id: usuario_id,
      datos_despues: { bloqueado },
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Admin elimina definitivamente un usuario y todos sus registros asociados
// (tickets, colas, resultados, logros).
// ---------------------------------------------------------------------------
authRouter.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query('SELECT id, nombre, apellido, carnet, rol FROM usuarios WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    await query('DELETE FROM colas WHERE ticket_id IN (SELECT id FROM tickets WHERE usuario_id = $1)', [req.params.id]);
    await query('DELETE FROM tickets WHERE usuario_id = $1', [req.params.id]);
    await query('DELETE FROM resultados_carrera WHERE usuario_id = $1', [req.params.id]);
    await query('DELETE FROM logros WHERE usuario_id = $1', [req.params.id]);
    await query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    await auditar({
      req, accion: 'eliminar_usuario', entidad: 'usuario', entidad_id: req.params.id,
      datos_antes: rows[0],
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
