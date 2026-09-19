// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: propinas
// -----------------------------------------------------------------------------
//   GET  /api/conta/propinas                    -> listar
//   GET  /api/conta/propinas/beneficiarios      -> quién puede recibir propina
//   GET  /api/conta/propinas/:id                -> detalle + distribución
//   POST /api/conta/propinas                    -> registrar propina (cajero)
//   POST /api/conta/propinas/:id/distribuir     -> recalcular (supervisor+)
//   POST /api/conta/propinas/:id/pagar          -> marcar pagada (supervisor+)
//   POST /api/conta/propinas/:id/anular         -> anular (SUPERVISOR)
//
// La anulación de una propina SOLO la puede hacer un supervisor.
// =============================================================================
import { Router } from 'express';
import { query, withTx } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num } from '../utils/helpers.js';
import { getConfigMap, valorConfig, calcularDistribucionPropina } from '../utils/finanzas.js';
import { asientoDePropinaPagada } from '../utils/contabilidad.js';

export const propinasRouter = Router();

const PUEDE_REGISTRAR = ['cajero', 'supervisor', 'admin'];

propinasRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { desde, hasta, estado, sesion_caja_id, usuario_id } = req.query;
    const params = [];
    let sql = `
      SELECT p.*,
             v.numero_factura,
             NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS creado_por_nombre
        FROM conta_propinas p
        LEFT JOIN conta_ventas v ON v.id = p.venta_id
        LEFT JOIN usuarios u ON u.id = p.creado_por
       WHERE 1=1`;
    if (desde) { params.push(desde); sql += ` AND p.creado_en >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); sql += ` AND p.creado_en < ($${params.length}::date + INTERVAL '1 day')`; }
    if (estado) { params.push(estado); sql += ` AND p.estado = $${params.length}`; }
    if (sesion_caja_id) { params.push(sesion_caja_id); sql += ` AND p.sesion_caja_id = $${params.length}`; }
    if (usuario_id) {
      params.push(usuario_id);
      sql += ` AND EXISTS (SELECT 1 FROM conta_propina_distribucion d
                            WHERE d.propina_id = p.id AND d.usuario_id = $${params.length})`;
    }
    sql += ' ORDER BY p.creado_en DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map((p) => ({ ...p, monto: num(p.monto) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Beneficiarios posibles: cajeros (y roles 'kart' si existen).
propinasRouter.get('/beneficiarios', requireAuth, async (_req, res) => {
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

propinasRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_propinas WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Propina no encontrada' });
    const { rows: dist } = await query(
      `SELECT d.*,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS beneficiario_nombre,
              u.carnet AS beneficiario_carnet,
              NULLIF(TRIM(COALESCE(pg.nombre,'') || ' ' || COALESCE(pg.apellido,'')), '') AS pagado_por_nombre
         FROM conta_propina_distribucion d
         LEFT JOIN usuarios u ON u.id = d.usuario_id
         LEFT JOIN usuarios pg ON pg.id = d.pagado_por
        WHERE d.propina_id = $1 ORDER BY d.id`,
      [req.params.id]
    );
    res.json({
      propina: { ...rows[0], monto: num(rows[0].monto) },
      distribucion: dist.map((d) => ({ ...d, monto: num(d.monto) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Registrar propina suelta (sin venta): el cajero la ingresa manualmente.
propinasRouter.post('/', requireAuth, requireRole(...PUEDE_REGISTRAR), async (req, res) => {
  try {
    const { monto, metodo, modo, venta_id, detalle } = req.body || {};
    const m = num(monto);
    if (m <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

    const resultado = await withTx(async (client) => {
      const configMap = await getConfigMap(client);
      if (!valorConfig(configMap, 'propina_habilitada', true)) {
        const e = new Error('Las propinas están deshabilitadas en la configuración.');
        e.status = 400; throw e;
      }
      const modoConfig = String(valorConfig(configMap, 'propina_modo', 'acumulada'));
      const modoFinal = modoConfig === 'mixta'
        ? (modo === 'inmediata' ? 'inmediata' : 'acumulada')
        : (modo && ['inmediata', 'acumulada'].includes(modo) ? modo : modoConfig);

      let sesionId = null;
      const { rows: abierta } = await client.query(
        `SELECT id FROM conta_sesiones_caja WHERE cajero_id = $1 AND estado = 'abierta' LIMIT 1`,
        [req.user.id]
      );
      sesionId = abierta.length ? abierta[0].id : null;

      const { rows: cj } = await client.query('SELECT * FROM usuarios WHERE id = $1', [req.user.id]);
      const { rows: pr } = await client.query(
        `INSERT INTO conta_propinas (venta_id, sesion_caja_id, monto, metodo, modo, detalle, estado, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
        [venta_id || null, sesionId, m, metodo || 'efectivo', modoFinal,
         JSON.stringify(detalle || {}), modoFinal === 'inmediata' ? 'pagada' : 'distribuida', req.user.id]
      );
      const dist = await calcularDistribucionPropina(client, {
        modo: String(valorConfig(configMap, 'propina_distribucion', 'por_cajero')),
        monto: m, cajero: cj[0], usuariosTicket: [],
      });
      for (const d of dist) {
        await client.query(
          `INSERT INTO conta_propina_distribucion (propina_id, usuario_id, rol, monto, estado, pagado_en, pagado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [pr[0].id, d.usuario_id, d.rol, d.monto,
           modoFinal === 'inmediata' ? 'pagada' : 'pendiente',
           modoFinal === 'inmediata' ? new Date() : null,
           modoFinal === 'inmediata' ? req.user.id : null]
        );
      }
      if (sesionId && (metodo || 'efectivo') === 'efectivo') {
        await client.query(
          `INSERT INTO conta_movimientos_caja (sesion_caja_id, tipo, monto, motivo, propina_id, creado_por)
           VALUES ($1,'propina',$2,$3,$4,$5)`,
          [sesionId, m, 'Propina registrada manualmente', pr[0].id, req.user.id]
        );
      }
      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'propina', entidad_id: pr[0].id,
        datos_despues: pr[0], ip: ipDe(req),
      });
      return { propina: pr[0], distribucion: dist };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Recalcular la distribución de una propina (supervisor+).
propinasRouter.post('/:id/distribuir', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_propinas WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Propina no encontrada'); e.status = 404; throw e; }
      if (rows[0].estado === 'anulada') { const e = new Error('La propina está anulada'); e.status = 409; throw e; }
      const configMap = await getConfigMap(client);
      const modoDist = req.body?.modo_distribucion
        || String(valorConfig(configMap, 'propina_distribucion', 'por_cajero'));
      const { rows: cj } = await client.query('SELECT * FROM usuarios WHERE id = $1', [rows[0].creado_por]);
      const { rows: tk } = await client.query(
        `SELECT usuario_id FROM tickets WHERE venta_id = $1 AND usuario_id IS NOT NULL`,
        [rows[0].venta_id]
      );
      const dist = await calcularDistribucionPropina(client, {
        modo: modoDist, monto: num(rows[0].monto), cajero: cj[0] || { id: rows[0].creado_por },
        usuariosTicket: tk.map((t) => t.usuario_id),
      });
      await client.query('DELETE FROM conta_propina_distribucion WHERE propina_id = $1', [req.params.id]);
      for (const d of dist) {
        await client.query(
          `INSERT INTO conta_propina_distribucion (propina_id, usuario_id, rol, monto)
           VALUES ($1,$2,$3,$4)`,
          [req.params.id, d.usuario_id, d.rol, d.monto]
        );
      }
      await client.query(`UPDATE conta_propinas SET estado = 'distribuida' WHERE id = $1`, [req.params.id]);
      await auditar(client, {
        usuario_id: req.user.id, accion: 'distribuir', entidad: 'propina', entidad_id: req.params.id,
        datos_despues: { modo_distribucion: modoDist, distribucion: dist }, ip: ipDe(req),
      });
      return { modo_distribucion: modoDist, distribucion: dist };
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Pagar las propinas acumuladas (supervisor+).
propinasRouter.post('/:id/pagar', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_propinas WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Propina no encontrada'); e.status = 404; throw e; }
      if (rows[0].estado === 'anulada') { const e = new Error('La propina está anulada'); e.status = 409; throw e; }
      await client.query(
        `UPDATE conta_propina_distribucion
            SET estado = 'pagada', pagado_en = now(), pagado_por = $1
          WHERE propina_id = $2 AND estado = 'pendiente'`,
        [req.user.id, req.params.id]
      );
      const { rows: upd } = await client.query(
        `UPDATE conta_propinas SET estado = 'pagada' WHERE id = $1 RETURNING *`, [req.params.id]
      );
      // Asiento contable automático: se cancela el pasivo de propinas contra caja.
      await asientoDePropinaPagada(client, {
        propina: upd[0],
        monto: num(upd[0].monto),
        usuario_id: req.user.id,
        sucursal_id: upd[0].sucursal_id || rows[0].sucursal_id || null,
      });
      await auditar(client, {
        usuario_id: req.user.id, accion: 'pago', entidad: 'propina', entidad_id: req.params.id,
        datos_antes: rows[0], datos_despues: upd[0], ip: ipDe(req),
      });
      return upd[0];
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Anular propina: SOLO supervisor.
propinasRouter.post('/:id/anular', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { motivo } = req.body || {};
    if (!motivo) return res.status(400).json({ error: 'El motivo de anulación es obligatorio' });
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_propinas WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Propina no encontrada'); e.status = 404; throw e; }
      const { rows: upd } = await client.query(
        `UPDATE conta_propinas SET estado = 'anulada', anulada_por = $1, motivo_anulacion = $2
          WHERE id = $3 RETURNING *`,
        [req.user.id, motivo, req.params.id]
      );
      await client.query(
        `UPDATE conta_propina_distribucion SET estado = 'anulada' WHERE propina_id = $1`, [req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'anular', entidad: 'propina', entidad_id: req.params.id,
        datos_antes: rows[0], datos_despues: upd[0], ip: ipDe(req),
      });
      return upd[0];
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
