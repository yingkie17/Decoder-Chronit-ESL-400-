// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: bitácora de auditoría
// -----------------------------------------------------------------------------
//   GET /api/conta/auditoria        -> listado con filtros
//   GET /api/conta/auditoria/:id    -> registro puntual (antes/después)
//
// Toda operación sensible (ventas, pagos, sesiones de caja, egresos, propinas,
// cuentas destino, configuración, usuarios) escribe aquí con datos_antes /
// datos_despues. Solo supervisor+ puede leerla.
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const auditoriaRouter = Router();

auditoriaRouter.get('/', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { usuario_id, entidad, accion, desde, hasta, q } = req.query;
    const params = [];
    let sql = `
      SELECT a.*,
             NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS usuario_nombre,
             u.carnet AS usuario_carnet, u.rol AS usuario_rol
        FROM conta_auditoria a
        LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE 1=1`;
    if (usuario_id) { params.push(Number(usuario_id)); sql += ` AND a.usuario_id = $${params.length}`; }
    if (entidad) { params.push(String(entidad)); sql += ` AND a.entidad = $${params.length}`; }
    if (accion) { params.push(String(accion)); sql += ` AND a.accion = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND a.creado_en >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); sql += ` AND a.creado_en < ($${params.length}::date + INTERVAL '1 day')`; }
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (a.entidad ILIKE $${params.length} OR a.accion ILIKE $${params.length}
                    OR u.carnet ILIKE $${params.length})`;
    }
    sql += ' ORDER BY a.id DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

auditoriaRouter.get('/entidades', requireAuth, requireRole('supervisor', 'admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT entidad, COUNT(*)::int AS n FROM conta_auditoria GROUP BY entidad ORDER BY entidad`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

auditoriaRouter.get('/:id', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_auditoria WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Registro de auditoría no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
