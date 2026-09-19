// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: GESTIÓN DE USUARIOS (/admin/usuarios)
// -----------------------------------------------------------------------------
//   GET    /api/conta/usuarios                     -> listar (filtros)
//   GET    /api/conta/usuarios/roles               -> catálogo de roles
//   GET    /api/conta/usuarios/beneficiarios-propina -> cajeros/karts
//   POST   /api/conta/usuarios                     -> crear
//   PUT    /api/conta/usuarios/:id                 -> editar
//   PUT    /api/conta/usuarios/:id/rol             -> cambiar rol
//   POST   /api/conta/usuarios/:id/reset-password  -> resetear contraseña
//   POST   /api/conta/usuarios/:id/desactivar      -> baja lógica (bloqueado)
//   POST   /api/conta/usuarios/:id/activar         -> reactivar
//   GET    /api/conta/usuarios/:id/auditoria       -> bitácora del usuario
//
// REGLA: solo admin/desarrollador pueden asignar roles SUPERVISOR o superiores
// (supervisor, contador, socio, dueno, admin, desarrollador).
//
// El campo "activo" se expone como espejo invertido de usuarios.bloqueado, para
// no alterar el modelo existente del módulo de tickets.
// =============================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, withTx } from '../db/pool.js';
import { requireAuth, requireRole, ROLES, GESTORES_USUARIOS } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { uuid } from '../utils/helpers.js';

export const usuariosRouter = Router();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

// Roles que solo admin/desarrollador pueden asignar.
const ROLES_ELEVADOS = ['supervisor', 'contador', 'socio', 'dueno', 'admin', 'desarrollador'];

const CAMPOS_SELECT = `
  id, uuid_global, nombre, apellido, carnet, email, telefono, nacionalidad, foto, rol,
  COALESCE(bloqueado, false) AS bloqueado, COALESCE(es_invitado, false) AS es_invitado,
  nit_personal, creado_en, actualizado_en
`;

const conActivo = (u) => ({ ...u, activo: !u.bloqueado });

usuariosRouter.get('/roles', requireAuth, async (_req, res) => {
  try {
    const { rows } = await query('SELECT nombre, permisos FROM roles ORDER BY nombre');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

usuariosRouter.get('/beneficiarios-propina', requireAuth, async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, nombre, apellido, carnet, rol FROM usuarios
        WHERE rol IN ('cajero', 'kart') ORDER BY nombre`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

usuariosRouter.get('/', requireAuth, requireRole(...GESTORES_USUARIOS, 'supervisor', 'contador'), async (req, res) => {
  try {
    const { rol, activo, q } = req.query;
    const params = [];
    let sql = `SELECT ${CAMPOS_SELECT} FROM usuarios WHERE 1=1`;
    if (rol) { params.push(rol); sql += ` AND rol = $${params.length}`; }
    if (activo === 'true') sql += ' AND bloqueado = false';
    if (activo === 'false') sql += ' AND bloqueado = true';
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (nombre ILIKE $${params.length} OR apellido ILIKE $${params.length}
                    OR carnet ILIKE $${params.length} OR email ILIKE $${params.length}
                    OR telefono ILIKE $${params.length} OR nit_personal ILIKE $${params.length})`;
    }
    sql += ' ORDER BY creado_en DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map(conActivo));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

usuariosRouter.get('/:id/auditoria', requireAuth, requireRole(...GESTORES_USUARIOS, 'supervisor'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.*, NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS usuario_nombre
         FROM conta_auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.usuario_id = $1 OR (a.entidad = 'usuario' AND a.entidad_id = $1::text)
        ORDER BY a.creado_en DESC LIMIT 300`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Crear usuario
// ---------------------------------------------------------------------------
usuariosRouter.post('/', requireAuth, requireRole(...GESTORES_USUARIOS), async (req, res) => {
  try {
    const {
      nombre, apellido, carnet, email, telefono, nacionalidad, foto,
      rol, activo, password, nit_personal,
    } = req.body || {};
    if (!nombre || !carnet || !password) {
      return res.status(400).json({ error: 'Nombre, carnet y contraseña son obligatorios' });
    }
    const rolFinal = ROLES.includes(rol) ? rol : 'piloto';
    if (ROLES_ELEVADOS.includes(rolFinal) && !GESTORES_USUARIOS.includes(req.user.rol)) {
      return res.status(403).json({ error: 'Solo admin/desarrollador pueden asignar roles de supervisor o superiores' });
    }
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const rows = await withTx(async (client) => {
      const ins = await client.query(
        `INSERT INTO usuarios
           (uuid_global, nombre, apellido, carnet, email, telefono, nacionalidad, foto, rol,
            password_hash, bloqueado, nit_personal)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING ${CAMPOS_SELECT}`,
        [uuid(), nombre, apellido || '', carnet, email || null, telefono || null,
         nacionalidad || null, foto || null, rolFinal, hash, activo === false, nit_personal || null]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'usuario', entidad_id: ins.rows[0].id,
        datos_despues: { ...ins.rows[0], password_hash: undefined }, ip: ipDe(req),
      });
      return ins.rows;
    });
    res.status(201).json(conActivo(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Carnet ya registrado' });
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Editar usuario
// ---------------------------------------------------------------------------
usuariosRouter.put('/:id', requireAuth, requireRole(...GESTORES_USUARIOS), async (req, res) => {
  try {
    const campos = ['nombre', 'apellido', 'carnet', 'email', 'telefono', 'nacionalidad',
      'foto', 'nit_personal'];
    const rows = await withTx(async (client) => {
      const { rows: antes } = await client.query(`SELECT ${CAMPOS_SELECT} FROM usuarios WHERE id = $1`, [req.params.id]);
      if (!antes.length) { const e = new Error('Usuario no encontrado'); e.status = 404; throw e; }
      const sets = [];
      const params = [];
      for (const c of campos) {
        if (c in req.body) { params.push(req.body[c]); sets.push(`${c} = $${params.length}`); }
      }
      if ('activo' in req.body) { params.push(!req.body.activo); sets.push(`bloqueado = $${params.length}`); }
      if (!sets.length) { const e = new Error('Nada que actualizar'); e.status = 400; throw e; }
      sets.push('actualizado_en = now()');
      params.push(req.params.id);
      const upd = await client.query(
        `UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${CAMPOS_SELECT}`,
        params
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'editar', entidad: 'usuario', entidad_id: req.params.id,
        datos_antes: antes[0], datos_despues: upd.rows[0], ip: ipDe(req),
      });
      return upd.rows;
    });
    res.json(conActivo(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Carnet ya registrado' });
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Cambiar rol
// ---------------------------------------------------------------------------
usuariosRouter.put('/:id/rol', requireAuth, requireRole(...GESTORES_USUARIOS), async (req, res) => {
  try {
    const { rol } = req.body || {};
    if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    if (ROLES_ELEVADOS.includes(rol) && !GESTORES_USUARIOS.includes(req.user.rol)) {
      return res.status(403).json({ error: 'Solo admin/desarrollador pueden asignar roles de supervisor o superiores' });
    }
    const rows = await withTx(async (client) => {
      const { rows: antes } = await client.query(`SELECT ${CAMPOS_SELECT} FROM usuarios WHERE id = $1`, [req.params.id]);
      if (!antes.length) { const e = new Error('Usuario no encontrado'); e.status = 404; throw e; }
      const upd = await client.query(
        `UPDATE usuarios SET rol = $1, actualizado_en = now() WHERE id = $2 RETURNING ${CAMPOS_SELECT}`,
        [rol, req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'cambiar_rol', entidad: 'usuario', entidad_id: req.params.id,
        datos_antes: { rol: antes[0].rol }, datos_despues: { rol }, ip: ipDe(req),
      });
      return upd.rows;
    });
    res.json(conActivo(rows[0]));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Resetear contraseña
// ---------------------------------------------------------------------------
usuariosRouter.post('/:id/reset-password', requireAuth, requireRole(...GESTORES_USUARIOS), async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    const { rows } = await query(
      'UPDATE usuarios SET password_hash = $1, actualizado_en = now() WHERE id = $2 RETURNING id, carnet',
      [hash, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    await auditar(null, {
      usuario_id: req.user.id, accion: 'reset_password', entidad: 'usuario', entidad_id: req.params.id,
      datos_despues: { carnet: rows[0].carnet }, ip: ipDe(req),
    });
    res.json({ ok: true, usuario_id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Baja lógica / reactivación
// ---------------------------------------------------------------------------
async function cambiarActivo(req, res, bloqueado, accion) {
  try {
    const { rows } = await query(
      `UPDATE usuarios SET bloqueado = $1, actualizado_en = now() WHERE id = $2 RETURNING ${CAMPOS_SELECT}`,
      [bloqueado, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    await auditar(null, {
      usuario_id: req.user.id, accion, entidad: 'usuario', entidad_id: req.params.id,
      datos_despues: { bloqueado }, ip: ipDe(req),
    });
    res.json(conActivo(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

usuariosRouter.post('/:id/desactivar', requireAuth, requireRole(...GESTORES_USUARIOS),
  (req, res) => cambiarActivo(req, res, true, 'desactivar'));
usuariosRouter.post('/:id/activar', requireAuth, requireRole(...GESTORES_USUARIOS),
  (req, res) => cambiarActivo(req, res, false, 'activar'));

// Baja lógica por DELETE (nunca se borra físicamente un usuario del sistema).
usuariosRouter.delete('/:id', requireAuth, requireRole(...GESTORES_USUARIOS),
  (req, res) => cambiarActivo(req, res, true, 'desactivar'));
