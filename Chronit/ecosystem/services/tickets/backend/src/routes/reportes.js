// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: rutas de reportes / dashboard admin
//   GET /api/reportes/resumen -> métricas agregadas para la vista de administración
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const reportesRouter = Router();

// Métricas del tablero de administración (requiere admin / desarrollador).
reportesRouter.get('/resumen', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const [usuarios, ticketsEstado, eventosEstado, resultados, hoy] = await Promise.all([
      query(`
        SELECT count(*)::int AS total, count(*)::int AS total_tickets
        FROM usuarios
      `),
      query(`
        SELECT estado, count(*)::int AS total FROM tickets GROUP BY estado ORDER BY estado
      `),
      query(`
        SELECT estado, count(*)::int AS total FROM eventos GROUP BY estado ORDER BY estado
      `),
      query(`SELECT count(*)::int AS total FROM resultados_carrera`),
      query(`
        SELECT
          count(*)::int AS creados_hoy,
          count(*) FILTER (WHERE pagado_en IS NOT NULL AND pagado_en::date = CURRENT_DATE)::int AS pagados_hoy
        FROM tickets
        WHERE creado_en::date = CURRENT_DATE
      `),
    ]);

    res.json({
      usuarios_total: usuarios.rows[0].total,
      tickets_por_estado: ticketsEstado.rows,
      eventos_por_estado: eventosEstado.rows,
      carreras_total: resultados.rows[0].total,
      hoy: hoy.rows[0],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
