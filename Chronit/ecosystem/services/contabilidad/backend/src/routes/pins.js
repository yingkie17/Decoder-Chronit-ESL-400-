// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: gestión de PIN de supervisor
// -----------------------------------------------------------------------------
//   GET    /api/conta/pins              -> lista de supervisores con PIN activo
//   PUT    /api/conta/pins/:usuario_id  -> asignar/rotar PIN (4-6 dígitos)
//   DELETE /api/conta/pins/:usuario_id  -> desactivar PIN
//
// Solo admin/desarrollador (y el propio supervisor para su PIN) pueden
// gestionarlo. El PIN se guarda hasheado con bcrypt: nunca se devuelve.
// Cada cambio queda auditado (sin exponer el PIN).
// =============================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, withTx } from '../db/pool.js';
import { requireAuth, requireRole, GESTORES_USUARIOS, esSupervisorPlus } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';

export const pinsRouter = Router();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

/** GET — supervisores con PIN activo (para la pantalla de usuarios). */
pinsRouter.get('/', requireAuth, requireRole(...GESTORES_USUARIOS, 'supervisor'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT sp.id, sp.usuario_id, sp.activo, sp.creado_en,
              u.nombre, u.apellido, u.carnet, u.rol
         FROM conta_supervisor_pins sp
         JOIN usuarios u ON u.id = sp.usuario_id
        ORDER BY sp.activo DESC, u.nombre`
    );
    res.json(rows.map((r) => ({
      ...r,
      nombre_completo: `${r.nombre || ''} ${r.apellido || ''}`.trim() || r.carnet,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** PUT — asignar o rotar el PIN de un supervisor. */
pinsRouter.put('/:usuario_id', requireAuth, async (req, res) => {
  try {
    const usuarioId = Number(req.params.usuario_id);
    const { pin } = req.body || {};
    if (!/^\d{4,6}$/.test(String(pin || '').trim())) {
      return res.status(400).json({ error: 'El PIN debe tener entre 4 y 6 dígitos' });
    }
    const esGestor = GESTORES_USUARIOS.includes(req.user.rol);
    const esPropio = Number(req.user.id) === usuarioId;
    if (!esGestor && !(esPropio && esSupervisorPlus(req.user.rol))) {
      return res.status(403).json({ error: 'No puedes gestionar el PIN de otro usuario' });
    }

    const hash = await bcrypt.hash(String(pin).trim(), BCRYPT_ROUNDS);
    const fila = await withTx(async (client) => {
      const { rows: u } = await client.query('SELECT id, nombre, apellido, carnet, rol FROM usuarios WHERE id = $1', [usuarioId]);
      if (!u.length) { const e = new Error('Usuario no encontrado'); e.status = 404; throw e; }
      if (!esSupervisorPlus(u[0].rol)) {
        const e = new Error('El PIN solo aplica a usuarios con rol supervisor o superior');
        e.status = 400; throw e;
      }
      // Un único PIN activo por usuario: se desactivan los anteriores.
      await client.query(
        `UPDATE conta_supervisor_pins SET activo = false WHERE usuario_id = $1 AND activo = true`,
        [usuarioId]
      );
      const { rows } = await client.query(
        `INSERT INTO conta_supervisor_pins (usuario_id, pin_hash, activo)
         VALUES ($1,$2,true) RETURNING id, usuario_id, activo, creado_en`,
        [usuarioId, hash]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'editar', entidad: 'supervisor_pin', entidad_id: usuarioId,
        datos_despues: { usuario_id: usuarioId, pin: '***', activo: true }, ip: ipDe(req),
      });
      return { ...rows[0], usuario: `${u[0].nombre || ''} ${u[0].apellido || ''}`.trim() };
    });
    res.json(fila);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** DELETE — desactivar el PIN de un supervisor. */
pinsRouter.delete('/:usuario_id', requireAuth, requireRole(...GESTORES_USUARIOS), async (req, res) => {
  try {
    const usuarioId = Number(req.params.usuario_id);
    const { rows } = await query(
      `UPDATE conta_supervisor_pins SET activo = false
        WHERE usuario_id = $1 AND activo = true
        RETURNING id, usuario_id`,
      [usuarioId]
    );
    if (!rows.length) return res.status(404).json({ error: 'El usuario no tiene PIN activo' });
    await auditar(null, {
      usuario_id: req.user.id, accion: 'desactivar', entidad: 'supervisor_pin', entidad_id: usuarioId,
      datos_despues: { activo: false }, ip: ipDe(req),
    });
    res.json({ ok: true, usuario_id: usuarioId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
