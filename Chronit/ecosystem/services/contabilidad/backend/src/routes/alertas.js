// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: ALERTAS (consulta y configuración)
// -----------------------------------------------------------------------------
//   GET  /api/conta/alertas              -> listar (filtros)
//   GET  /api/conta/alertas/resumen      -> conteo por tipo/severidad
//   GET  /api/conta/alertas/config       -> configuración de canales y umbrales
//   PUT  /api/conta/alertas/config       -> actualizar configuración (supervisor+)
//   POST /api/conta/alertas/evaluar      -> ejecutar la detección ahora
//   POST /api/conta/alertas/leer-todas   -> marcar todas como leídas
//   POST /api/conta/alertas/:id/leer     -> marcar una como leída
//
// La DETECCIÓN la hace el worker (utils/alertas.js); aquí solo se consulta,
// se configura y se dispara manualmente. Cada alerta notificada se registra en
// conta_alertas (historial) y se envía por los canales configurados.
// =============================================================================
import { Router } from 'express';
import { db, query } from '../db/pool.js';
import { requireAuth, requireRole, FINANZAS, SUPERVISOR_PLUS } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num } from '../utils/helpers.js';
import { getConfigAlertas, evaluarAlertas } from '../utils/alertas.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const alertasRouter = Router();

export const TIPOS_ALERTA = [
  'diferencia_caja', 'descuento_sin_autorizacion', 'qr_sin_confirmar', 'caja_abierta',
  'propinas_pendientes', 'anticipo_vencido', 'depreciacion_pendiente', 'siat_rechazado',
  'stock_bajo', 'cxc_vencida', 'cxp_vencida',
  // Fiscal Bolivia: se emite desde registrarVenta al consumir >= 90% del rango
  // de una dosificación. Debe figurar aquí para que el filtro del panel de
  // alertas la liste (el frontend arma las opciones con `tipos_disponibles`).
  'dosificacion_por_agotarse',
];

alertasRouter.get('/', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const params = [sucursalId];
    let sql = 'SELECT * FROM conta_alertas WHERE (sucursal_id = $1 OR sucursal_id IS NULL)';
    if (req.query.leida === 'true') sql += ' AND leida = true';
    if (req.query.leida === 'false') sql += ' AND leida = false';
    if (req.query.tipo) { params.push(req.query.tipo); sql += ` AND tipo = $${params.length}`; }
    if (req.query.severidad) { params.push(req.query.severidad); sql += ` AND severidad = $${params.length}`; }
    if (req.query.desde) { params.push(req.query.desde); sql += ` AND creado_en >= $${params.length}::date`; }
    sql += ' ORDER BY leida, creado_en DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

alertasRouter.get('/resumen', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const { rows: porTipo } = await query(
      `SELECT tipo, severidad, COUNT(*)::int AS n
         FROM conta_alertas
        WHERE leida = false AND (sucursal_id = $1 OR sucursal_id IS NULL)
        GROUP BY tipo, severidad ORDER BY n DESC`,
      [sucursalId]
    );
    const { rows: totales } = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE leida = false)::int AS sin_leer,
              COUNT(*) FILTER (WHERE severidad = 'critica' AND leida = false)::int AS criticas
         FROM conta_alertas WHERE (sucursal_id = $1 OR sucursal_id IS NULL)`,
      [sucursalId]
    );
    res.json({ ...totales[0], por_tipo: porTipo, tipos_disponibles: TIPOS_ALERTA });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

alertasRouter.get('/config', requireAuth, requireRole(...FINANZAS), async (_req, res) => {
  try {
    res.json(await getConfigAlertas(db));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

alertasRouter.put('/config', requireAuth, requireRole(...SUPERVISOR_PLUS), async (req, res) => {
  try {
    const actual = await getConfigAlertas(db);
    const permitidas = ['canales', 'telegram_token', 'telegram_chat_id', 'email', 'email_webhook',
      'diferencia_caja_umbral', 'caja_abierta_horas', 'qr_sin_confirmar_horas',
      'propinas_pendientes_dias', 'stock_bajo_unidades', 'anticipo_aviso_dias'];
    const nueva = { ...actual };
    for (const c of permitidas) if (c in (req.body || {})) nueva[c] = req.body[c];
    const { rows } = await query(
      `INSERT INTO conta_configuracion (clave, valor, descripcion, actualizado_por, actualizado_en)
       VALUES ('alertas_config', $1::jsonb, 'Tipos y canales de alerta (in-app, Telegram, email) y sus umbrales.', $2, now())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por,
              actualizado_en = now()
       RETURNING *`,
      [JSON.stringify(nueva), req.user.id]
    );
    await auditar(db, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'configuracion', entidad_id: 'alertas_config',
      datos_antes: actual, datos_despues: nueva, ip: ipDe(req),
    });
    res.json({ ...nueva, _fila: rows[0].clave });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Fuerza un ciclo de detección (útil para probar la configuración). */
alertasRouter.post('/evaluar', requireAuth, requireRole(...SUPERVISOR_PLUS), async (req, res) => {
  try {
    const creadas = await evaluarAlertas(db);
    await auditar(db, {
      usuario_id: req.user.id, accion: 'evaluar', entidad: 'alertas',
      datos_despues: creadas, ip: ipDe(req),
    });
    res.json({ ok: true, creadas, total: Object.values(creadas).reduce((a, n) => a + num(n), 0) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

alertasRouter.post('/leer-todas', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE conta_alertas SET leida = true WHERE leida = false RETURNING id`
    );
    res.json({ ok: true, marcadas: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

alertasRouter.post('/:id/leer', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE conta_alertas SET leida = true WHERE id = $1 RETURNING *`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Alerta no encontrada' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
