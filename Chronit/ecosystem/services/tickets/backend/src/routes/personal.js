// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: personal por turnos
// -----------------------------------------------------------------------------
// El administrador gestiona el PERSONAL (cajeros y coordinadores) que trabaja
// en distintos turnos. Cada trabajador puede tener:
//   * turno    -> etiqueta del turno (Mañana/Tarde/Noche...).
//   * vestidor -> 1 o 2 cuando es coordinador de vestidor.
//
// Endpoints:
//   GET    /api/personal      -> lista del personal con turno/vestidor
//   POST   /api/personal      -> crear trabajador (admin)
//   PUT    /api/personal/:id  -> editar trabajador (admin)
//   DELETE /api/personal/:id  -> eliminar trabajador (admin)
//
// Estos trabajadores crean eventos de carrera, llaman a vestidores y sus
// acciones quedan reportadas en el módulo de administración.
// =============================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uuid, flagOf } from '../utils/helpers.js';
import { auditar } from '../utils/audit.js';

export const personalRouter = Router();

// Roles que se consideran "personal" gestionable desde este módulo.
const PERSONAL_ROLES = ['cajero', 'coordinador'];

// Normaliza el vestidor: sólo los coordinadores operan un vestidor (1 o 2).
function normalizarVestidor(rol, vestidor) {
  if (rol !== 'coordinador') return null;
  const n = Number(vestidor);
  return n === 1 || n === 2 ? n : null;
}

const SELECT_PERSONAL = `
  id, uuid_global, nombre, apellido, email, telefono, carnet, foto,
  nacionalidad, rol, turno, vestidor, bloqueado, creado_en
`;

// Lista del personal + conteo por rol/turno/vestidor (para el reporte del admin).
personalRouter.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT ${SELECT_PERSONAL}
       FROM usuarios
       WHERE rol = ANY($1)
       ORDER BY turno NULLS LAST, rol, nombre`,
      [PERSONAL_ROLES]
    );
    const porRol = {};
    const porTurno = {};
    const porVestidor = { 1: 0, 2: 0 };
    for (const r of rows) {
      porRol[r.rol] = (porRol[r.rol] || 0) + 1;
      if (r.turno) porTurno[r.turno] = (porTurno[r.turno] || 0) + 1;
      if (r.vestidor) porVestidor[r.vestidor] = (porVestidor[r.vestidor] || 0) + 1;
    }
    res.json({
      personal: rows.map((r) => ({ ...r, flag: flagOf(r.nacionalidad) })),
      reporte: { total: rows.length, por_rol: porRol, por_turno: porTurno, por_vestidor: porVestidor },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear un trabajador (cajero o coordinador).
personalRouter.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, carnet, password, rol, turno, vestidor } = req.body;
    if (!nombre || !carnet || !password) {
      return res.status(400).json({ error: 'Nombre, carnet y contraseña son obligatorios' });
    }
    if (!PERSONAL_ROLES.includes(rol)) {
      return res.status(400).json({ error: 'El rol debe ser cajero o coordinador' });
    }
    const { rows: dup } = await query('SELECT 1 FROM usuarios WHERE carnet = $1', [carnet]);
    if (dup.length) return res.status(409).json({ error: 'Carnet ya registrado' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO usuarios
         (uuid_global, nombre, apellido, email, telefono, carnet, password_hash, foto, nacionalidad, rol, turno, vestidor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, $10)
       RETURNING ${SELECT_PERSONAL}`,
      [
        uuid(), nombre, apellido || '', email || null, telefono || null, carnet, hash,
        rol, turno || null, normalizarVestidor(rol, vestidor),
      ]
    );
    await auditar({
      req, accion: 'crear_personal', entidad: 'usuario', entidad_id: rows[0].id,
      datos_despues: {
        nombre: rows[0].nombre, apellido: rows[0].apellido, carnet: rows[0].carnet,
        rol: rows[0].rol, turno: rows[0].turno, vestidor: rows[0].vestidor,
      },
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Carnet ya registrado' });
    if (e.code === '23514') return res.status(400).json({ error: 'Vestidor inválido (1 o 2)' });
    res.status(500).json({ error: e.message });
  }
});

// Editar un trabajador (datos, rol, turno, vestidor y opcionalmente contraseña).
personalRouter.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, rol, turno, vestidor, bloqueado, password } = req.body;
    const { rows: cur } = await query('SELECT id, rol, turno, vestidor, bloqueado FROM usuarios WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: 'Usuario no encontrado' });

    const nuevoRol = PERSONAL_ROLES.includes(rol) ? rol : cur[0].rol;
    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (nombre !== undefined) add('nombre', nombre);
    if (apellido !== undefined) add('apellido', apellido);
    if (email !== undefined) add('email', email || null);
    if (telefono !== undefined) add('telefono', telefono || null);
    if (rol !== undefined) add('rol', nuevoRol);
    if (turno !== undefined) add('turno', turno || null);
    if (vestidor !== undefined || rol !== undefined) add('vestidor', normalizarVestidor(nuevoRol, vestidor));
    if (bloqueado !== undefined) add('bloqueado', Boolean(bloqueado));
    if (password) add('password_hash', await bcrypt.hash(password, 10));
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE usuarios SET ${sets.join(', ')}, actualizado_en = now()
       WHERE id = $${params.length}
       RETURNING ${SELECT_PERSONAL}`,
      params
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23514') return res.status(400).json({ error: 'Vestidor inválido (1 o 2)' });
    res.status(500).json({ error: e.message });
  }
});

// Eliminar un trabajador y sus registros asociados.
personalRouter.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query('SELECT id, carnet, rol, turno, vestidor FROM usuarios WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    await query('DELETE FROM colas WHERE ticket_id IN (SELECT id FROM tickets WHERE usuario_id = $1)', [req.params.id]);
    await query('DELETE FROM tickets WHERE usuario_id = $1', [req.params.id]);
    await query('DELETE FROM resultados_carrera WHERE usuario_id = $1', [req.params.id]);
    await query('DELETE FROM logros WHERE usuario_id = $1', [req.params.id]);
    await query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    await auditar({
      req, accion: 'eliminar_personal', entidad: 'usuario', entidad_id: req.params.id,
      datos_antes: rows[0],
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
