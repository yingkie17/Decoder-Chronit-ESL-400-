// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: consulta de la bitácora de auditoría
// -----------------------------------------------------------------------------
// Expone la bitácora `tickets_auditoria` para revisión de operaciones sensibles.
// Solo admin/desarrollador. Solo lectura.
//
//   GET /api/auditoria?accion=&entidad=&usuario_id=&desde=&hasta=&q=
//
// Respuesta: { datos: [...], paginacion: { total, page, limit, paginas } }
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const auditoriaRouter = Router();
auditoriaRouter.use(requireAuth, requireRole('admin'));

const LIMITE_MAX = 200;
const LIMITE_DEFECTO = 50;

auditoriaRouter.get('/', async (req, res) => {
  try {
    const { accion, entidad, usuario_id, desde, hasta, q } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || LIMITE_DEFECTO, 1), LIMITE_MAX);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;

    const cond = [];
    const params = [];
    const filtro = (plantilla, valor) => {
      params.push(valor);
      cond.push(plantilla.replace('$$', `$${params.length}`));
    };

    if (accion) filtro('a.accion = $$', accion);
    if (entidad) filtro('a.entidad = $$', entidad);
    if (usuario_id) filtro('a.usuario_id = $$', Number(usuario_id));
    if (desde) filtro('a.creado_en >= $$::timestamptz', desde);
    if (hasta) filtro('a.creado_en <= $$::timestamptz', hasta);
    if (q) {
      const like = `%${String(q).trim()}%`;
      params.push(like, like, like);
      const n = params.length;
      cond.push(
        `(a.accion ILIKE $${n - 2} OR a.entidad ILIKE $${n - 2} ` +
        `OR a.usuario_carnet ILIKE $${n - 1} OR a.datos_despues::text ILIKE $${n})`
      );
    }

    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const totalRes = await query(`SELECT COUNT(*)::int AS total FROM tickets_auditoria a ${where}`, params);
    const total = totalRes.rows[0]?.total ?? 0;

    const { rows } = await query(
      `SELECT a.id, a.usuario_id, a.usuario_carnet, a.accion, a.entidad, a.entidad_id,
              a.datos_antes, a.datos_despues, a.ip, a.creado_en,
              u.nombre || ' ' || u.apellido AS usuario, u.rol AS usuario_rol
         FROM tickets_auditoria a
         LEFT JOIN usuarios u ON u.id = a.usuario_id
         ${where}
        ORDER BY a.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({
      datos: rows,
      paginacion: { total, page, limit, paginas: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (e) {
    console.error('[tickets:auditoria]', e.message);
    res.status(500).json({ error: e.message });
  }
});
