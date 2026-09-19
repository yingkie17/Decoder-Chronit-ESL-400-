// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: sesiones de caja
// -----------------------------------------------------------------------------
//   GET  /api/conta/cajas/actual          -> caja abierta del usuario + resumen
//   POST /api/conta/cajas/abrir           -> abrir caja (bloquea si ya tiene una)
//   POST /api/conta/cajas/:id/cerrar      -> cerrar caja (calcula diferencia)
//   POST /api/conta/cajas/:id/reabrir     -> reabrir (solo supervisor+)
//   GET  /api/conta/cajas                 -> listar sesiones
//   GET  /api/conta/cajas/:id             -> detalle + movimientos + ventas
//   POST /api/conta/cajas/:id/movimiento  -> retiro / ingreso manual de efectivo
//
// CIERRE:
//   monto_esperado_efectivo = monto_inicial + ventas efectivo - egresos efectivo
//                             - retiros + ingresos + propinas en efectivo
//   diferencia = monto_contado_efectivo - monto_esperado_efectivo
// =============================================================================
import { Router } from 'express';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, fechaISO } from '../utils/helpers.js';
import { getConfigMap, valorConfig } from '../utils/finanzas.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const cajasRouter = Router();

/** Resumen financiero de una sesión (usado en cierre, detalle y reportes). */
export async function resumenSesion(db, sesionId) {
  const { rows: s } = await db.query('SELECT * FROM conta_sesiones_caja WHERE id = $1', [sesionId]);
  if (!s.length) return null;
  const sesion = s[0];

  const { rows: porTipo } = await db.query(
    `SELECT mp.tipo, COALESCE(SUM(pg.monto),0) AS total, COUNT(DISTINCT v.id)::int AS ventas
       FROM conta_pagos pg
       JOIN conta_ventas v ON v.id = pg.venta_id AND v.anulada = false
       JOIN conta_metodos_pago mp ON mp.id = pg.metodo_pago_id
      WHERE v.sesion_caja_id = $1
      GROUP BY mp.tipo`,
    [sesionId]
  );
  const efectivo = num(porTipo.find((r) => r.tipo === 'efectivo')?.total);
  const totalVentas = porTipo.reduce((a, r) => a + num(r.total), 0);

  const { rows: eg } = await db.query(
    'SELECT COALESCE(SUM(monto),0) AS total, COUNT(*)::int AS n FROM conta_egresos WHERE sesion_caja_id = $1',
    [sesionId]
  );
  const { rows: mov } = await db.query(
    `SELECT tipo, COALESCE(SUM(monto),0) AS total
       FROM conta_movimientos_caja
      WHERE sesion_caja_id = $1 AND tipo IN ('retiro','ingreso')
      GROUP BY tipo`,
    [sesionId]
  );
  const retiros = num(mov.find((r) => r.tipo === 'retiro')?.total);
  const ingresos = num(mov.find((r) => r.tipo === 'ingreso')?.total);

  const { rows: prop } = await db.query(
    `SELECT COALESCE(SUM(monto),0) AS total
       FROM conta_propinas
      WHERE sesion_caja_id = $1 AND estado <> 'anulada' AND metodo = 'efectivo'`,
    [sesionId]
  );
  const propinasEfectivo = num(prop[0]?.total);
  const { rows: propTot } = await db.query(
    `SELECT COALESCE(SUM(monto),0) AS total FROM conta_propinas WHERE sesion_caja_id = $1 AND estado <> 'anulada'`,
    [sesionId]
  );

  const inicial = num(sesion.monto_inicial);
  const egresos = num(eg[0]?.total);
  const esperado = num(inicial + efectivo - egresos - retiros + ingresos + propinasEfectivo);

  return {
    sesion: { ...sesion, monto_inicial: inicial },
    por_metodo: porTipo.map((r) => ({ tipo: r.tipo, total: num(r.total), ventas: r.ventas })),
    ventas_total: num(totalVentas),
    ventas_efectivo: efectivo,
    egresos_total: egresos,
    egresos_count: num(eg[0]?.n),
    retiros,
    ingresos,
    propinas_efectivo: propinasEfectivo,
    propinas_total: num(propTot[0]?.total),
    monto_esperado_efectivo: esperado,
    monto_contado_efectivo: sesion.monto_contado_efectivo == null ? null : num(sesion.monto_contado_efectivo),
    diferencia: sesion.diferencia == null ? null : num(sesion.diferencia),
  };
}

// ---------------------------------------------------------------------------
// Caja abierta del usuario actual
// ---------------------------------------------------------------------------
cajasRouter.get('/actual', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id FROM conta_sesiones_caja WHERE cajero_id = $1 AND estado = 'abierta' LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.json({ sesion: null, resumen: null });
    const resumen = await resumenSesion(db, rows[0].id);
    res.json({ sesion: resumen.sesion, resumen });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Abrir caja
// ---------------------------------------------------------------------------
cajasRouter.post('/abrir', requireAuth, requireRole('cajero', 'supervisor', 'admin'), async (req, res) => {
  try {
    const monto = num(req.body?.monto_inicial);
    if (monto < 0) return res.status(400).json({ error: 'El monto inicial no puede ser negativo' });
    const sesion = await withTx(async (client) => {
      const { rows: abiertas } = await client.query(
        `SELECT id FROM conta_sesiones_caja WHERE cajero_id = $1 AND estado = 'abierta' LIMIT 1`,
        [req.user.id]
      );
      if (abiertas.length) {
        const e = new Error('Ya tienes una caja abierta. Ciérrala antes de abrir otra.');
        e.status = 409;
        throw e;
      }
      const sucursalId = await sucursalDePeticion(client, req);
      const { rows } = await client.query(
        `INSERT INTO conta_sesiones_caja (cajero_id, sucursal_id, monto_inicial, estado)
         VALUES ($1,$2,$3,'abierta') RETURNING *`,
        [req.user.id, sucursalId, monto]
      );
      await client.query(
        `INSERT INTO conta_movimientos_caja (sesion_caja_id, sucursal_id, tipo, monto, motivo, creado_por)
         VALUES ($1, $2, 'apertura', $3, 'Apertura de caja', $4)`,
        [rows[0].id, sucursalId, monto, req.user.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'sesion_caja', entidad_id: rows[0].id,
        datos_despues: rows[0], ip: ipDe(req),
      });
      return rows[0];
    });
    res.status(201).json(sesion);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Cerrar caja
// ---------------------------------------------------------------------------
cajasRouter.post('/:id/cerrar', requireAuth, requireRole('cajero', 'supervisor', 'admin'), async (req, res) => {
  try {
    const { monto_contado_efectivo, notas_cierre } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows: s } = await client.query('SELECT * FROM conta_sesiones_caja WHERE id = $1', [req.params.id]);
      if (!s.length) { const e = new Error('Sesión de caja no encontrada'); e.status = 404; throw e; }
      const sesion = s[0];
      if (sesion.estado !== 'abierta') {
        const e = new Error('La sesión ya está cerrada'); e.status = 409; throw e;
      }
      // Un cajero solo puede cerrar SU propia caja.
      const esDueno = sesion.cajero_id === req.user.id;
      if (!esDueno && !['supervisor', 'admin', 'desarrollador'].includes(req.user.rol)) {
        const e = new Error('Solo puedes cerrar tu propia caja'); e.status = 403; throw e;
      }
      const resumen = await resumenSesion(client, sesion.id);
      const contado = num(monto_contado_efectivo);
      const diferencia = num(contado - resumen.monto_esperado_efectivo);
      const { rows } = await client.query(
        `UPDATE conta_sesiones_caja
            SET cierre_en = now(), monto_esperado_efectivo = $1, monto_contado_efectivo = $2,
                diferencia = $3, estado = 'cerrada', notas_cierre = $4
          WHERE id = $5 RETURNING *`,
        [resumen.monto_esperado_efectivo, contado, diferencia, notas_cierre || null, sesion.id]
      );
      await client.query(
        `INSERT INTO conta_movimientos_caja (sesion_caja_id, sucursal_id, tipo, monto, motivo, creado_por)
         VALUES ($1, $2, 'cierre', $3, $4, $5)`,
        [sesion.id, sesion.sucursal_id, contado, `Cierre de caja (diferencia ${diferencia})`, req.user.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'cerrar', entidad: 'sesion_caja', entidad_id: sesion.id,
        datos_antes: { estado: 'abierta' },
        datos_despues: { estado: 'cerrada', monto_esperado: resumen.monto_esperado_efectivo, contado, diferencia },
        ip: ipDe(req),
      });
      return { sesion: rows[0], resumen };
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Reabrir caja (solo supervisor+)
// ---------------------------------------------------------------------------
cajasRouter.post('/:id/reabrir', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { motivo_reapertura } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows: s } = await client.query('SELECT * FROM conta_sesiones_caja WHERE id = $1', [req.params.id]);
      if (!s.length) { const e = new Error('Sesión de caja no encontrada'); e.status = 404; throw e; }
      if (s[0].estado === 'abierta') { const e = new Error('La sesión ya está abierta'); e.status = 409; throw e; }
      // Si el cajero ya abrió otra caja, no se puede reabrir la anterior (unicidad).
      const { rows: otras } = await client.query(
        `SELECT id FROM conta_sesiones_caja WHERE cajero_id = $1 AND estado = 'abierta' LIMIT 1`,
        [s[0].cajero_id]
      );
      if (otras.length) {
        const e = new Error('El cajero tiene otra caja abierta; ciérrala antes de reabrir esta.');
        e.status = 409;
        throw e;
      }
      const { rows } = await client.query(
        `UPDATE conta_sesiones_caja
            SET estado = 'abierta', cierre_en = NULL, reabierta_por = $1, motivo_reapertura = $2
          WHERE id = $3 RETURNING *`,
        [req.user.id, motivo_reapertura || 'Reapertura autorizada por supervisor', req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'reabrir', entidad: 'sesion_caja', entidad_id: req.params.id,
        datos_antes: { estado: 'cerrada' }, datos_despues: { estado: 'abierta', motivo: motivo_reapertura || null },
        ip: ipDe(req),
      });
      return rows[0];
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Listar sesiones
// ---------------------------------------------------------------------------
cajasRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { desde, hasta, cajero_id, estado } = req.query;
    const params = [];
    let sql = `
      SELECT s.*,
             NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS cajero_nombre,
             u.carnet AS cajero_carnet
        FROM conta_sesiones_caja s
        LEFT JOIN usuarios u ON u.id = s.cajero_id
       WHERE 1=1`;
    // El cajero solo ve sus propias cajas; supervisor+ ve todas.
    if (!['supervisor', 'admin', 'desarrollador', 'contador', 'socio', 'dueno'].includes(req.user.rol)) {
      params.push(req.user.id);
      sql += ` AND s.cajero_id = $${params.length}`;
    } else if (cajero_id) {
      params.push(cajero_id);
      sql += ` AND s.cajero_id = $${params.length}`;
    }
    if (estado) { params.push(estado); sql += ` AND s.estado = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND s.apertura_en >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); sql += ` AND s.apertura_en < ($${params.length}::date + INTERVAL '1 day')`; }
    sql += ' ORDER BY s.apertura_en DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({
      ...r,
      monto_inicial: num(r.monto_inicial),
      monto_esperado_efectivo: r.monto_esperado_efectivo == null ? null : num(r.monto_esperado_efectivo),
      monto_contado_efectivo: r.monto_contado_efectivo == null ? null : num(r.monto_contado_efectivo),
      diferencia: r.diferencia == null ? null : num(r.diferencia),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Detalle de una sesión
// ---------------------------------------------------------------------------
cajasRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const resumen = await resumenSesion(db, req.params.id);
    if (!resumen) return res.status(404).json({ error: 'Sesión de caja no encontrada' });
    const { rows: movimientos } = await query(
      `SELECT m.*, NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS creado_por_nombre
         FROM conta_movimientos_caja m
         LEFT JOIN usuarios u ON u.id = m.creado_por
        WHERE m.sesion_caja_id = $1 ORDER BY m.creado_en`,
      [req.params.id]
    );
    const { rows: ventas } = await query(
      `SELECT id, numero_factura, total_final, descuento, propina, anulada, creado_en, nit_cliente
         FROM conta_ventas WHERE sesion_caja_id = $1 ORDER BY creado_en`,
      [req.params.id]
    );
    const { rows: egresos } = await query(
      `SELECT * FROM conta_egresos WHERE sesion_caja_id = $1 ORDER BY creado_en`,
      [req.params.id]
    );
    res.json({
      ...resumen,
      movimientos: movimientos.map((m) => ({ ...m, monto: num(m.monto) })),
      ventas: ventas.map((v) => ({ ...v, total_final: num(v.total_final), descuento: num(v.descuento), propina: num(v.propina) })),
      egresos: egresos.map((e2) => ({ ...e2, monto: num(e2.monto) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Movimiento manual de efectivo (retiro / ingreso)
// ---------------------------------------------------------------------------
cajasRouter.post('/:id/movimiento', requireAuth, requireRole('cajero', 'supervisor', 'admin'), async (req, res) => {
  try {
    const { tipo, monto, motivo } = req.body || {};
    if (!['retiro', 'ingreso'].includes(tipo)) {
      return res.status(400).json({ error: "tipo debe ser 'retiro' o 'ingreso'" });
    }
    const m = num(monto);
    if (m <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

    const config = await getConfigMap(db);
    const umbral = num(valorConfig(config, 'umbral_egreso_cajero', 500));
    let autorizador = null;
    if (m > umbral && !['supervisor', 'admin', 'desarrollador'].includes(req.user.rol)) {
      const { validarAutorizacion } = await import('../utils/finanzas.js');
      autorizador = await validarAutorizacion(db, req.body.autorizacion);
      if (!autorizador) {
        return res.status(403).json({
          error: `El monto supera el umbral (${umbral}). Se requiere autorización de un supervisor.`,
          code: 'REQUIERE_AUTORIZACION',
        });
      }
    }
    const { rows: ses } = await query(
      'SELECT sucursal_id FROM conta_sesiones_caja WHERE id = $1', [req.params.id]
    );
    const { rows } = await query(
      `INSERT INTO conta_movimientos_caja (sesion_caja_id, sucursal_id, tipo, monto, motivo, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, ses.length ? ses[0].sucursal_id : null, tipo, m, motivo || null, req.user.id]
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: tipo, entidad: 'sesion_caja', entidad_id: req.params.id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Cierre diario consolidado (varias sesiones del día)
// ---------------------------------------------------------------------------
cajasRouter.get('/reportes/diario', requireAuth, async (req, res) => {
  try {
    const fecha = req.query.fecha || fechaISO();
    const { rows: sesiones } = await query(
      `SELECT id FROM conta_sesiones_caja
        WHERE apertura_en >= $1::date AND apertura_en < ($1::date + INTERVAL '1 day')
        ORDER BY apertura_en`,
      [fecha]
    );
    const resumenes = [];
    for (const s of sesiones) resumenes.push(await resumenSesion(db, s.id));
    res.json({ fecha, sesiones: resumenes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
