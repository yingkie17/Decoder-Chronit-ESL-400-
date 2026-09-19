// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: DASHBOARD EJECUTIVO
// -----------------------------------------------------------------------------
//   GET /api/conta/dashboard-ejecutivo       -> métricas vivas del día
//   GET /api/conta/dashboard-ejecutivo/qs    -> solo QR por cuenta
//
// Pensado para los roles `dueno` y `socio` (solo lectura). El frontend lo
// refresca cada 30 s. Todas las cifras salen de snapshots (conta_ventas,
// conta_pagos, conta_sesiones_caja): no se recalcula nada histórico.
//
// Contenido:
//   * Ventas de hoy vs ayer vs el mismo día del mes pasado.
//   * Efectivo esperado en las cajas abiertas.
//   * QR por cuenta destino con la diferencia contra el banco.
//   * Top de productos del día.
//   * Pilotos que corrieron hoy (tickets + eventos del módulo de carrera).
//   * Alertas activas.
// =============================================================================
import { Router } from 'express';
import { db } from '../db/pool.js';
import { requireAuth, requireRole, FINANZAS } from '../middleware/auth.js';
import { num, round2, fechaISO } from '../utils/helpers.js';
import { getConfigAlertas } from '../utils/alertas.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const dashboardEjecutivoRouter = Router();

const TZ = 'America/La_Paz';
// dueno y socio (solo lectura ejecutiva) + admin/desarrollador para soporte.
const ROLES = [...FINANZAS];

const mapVenta = (r) => ({
  fecha: r.fecha,
  n_ventas: num(r.n_ventas),
  tickets: num(r.tickets),
  total: round2(num(r.total)),
  efectivo: round2(num(r.efectivo)),
  qr: round2(num(r.qr)),
  descuento: round2(num(r.descuento)),
  iva: round2(num(r.iva)),
  propina: round2(num(r.propina)),
  ticket_promedio: num(r.n_ventas) ? round2(num(r.total) / num(r.n_ventas)) : 0,
});

async function resumenDia(db, fecha, sucursalId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n_ventas,
            COALESCE(SUM(conteo_tickets),0)::int AS tickets,
            COALESCE(SUM(total_final),0) AS total,
            COALESCE(SUM(descuento),0)   AS descuento,
            COALESCE(SUM(iva_total),0)   AS iva,
            COALESCE(SUM(propina),0)     AS propina,
            COALESCE(SUM(tot.efectivo),0) AS efectivo,
            COALESCE(SUM(tot.qr),0)       AS qr
       FROM conta_ventas v
       LEFT JOIN LATERAL (
         SELECT SUM(pg.monto) FILTER (WHERE mp.tipo = 'efectivo') AS efectivo,
                SUM(pg.monto) FILTER (WHERE mp.tipo IN ('qr','transferencia')) AS qr
           FROM conta_pagos pg JOIN conta_metodos_pago mp ON mp.id = pg.metodo_pago_id
          WHERE pg.venta_id = v.id
       ) tot ON true
      WHERE v.anulada = false AND v.sucursal_id = $1
        AND (v.creado_en AT TIME ZONE '${TZ}')::date = $2::date`,
    [sucursalId, fecha]
  );
  return mapVenta(rows[0] || { fecha });
}

dashboardEjecutivoRouter.get('/', requireAuth, requireRole(...ROLES), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const hoy = String(req.query.fecha || fechaISO());
    const ayer = fechaISO(new Date(new Date(`${hoy}T12:00:00`).getTime() - 86400000));
    const mesPasado = (() => {
      const d = new Date(`${hoy}T12:00:00`);
      d.setMonth(d.getMonth() - 1);
      return fechaISO(d);
    })();

    const [ventasHoy, ventasAyer, ventasMesPasado] = await Promise.all([
      resumenDia(db, hoy, sucursalId),
      resumenDia(db, ayer, sucursalId),
      resumenDia(db, mesPasado, sucursalId),
    ]);

    // --- Efectivo esperado en cajas abiertas ---
    const { rows: cajas } = await db.query(
      `SELECT s.id, s.monto_inicial, s.cajero_id,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS cajero,
              COALESCE(v.ventas_efectivo,0) AS ventas_efectivo,
              COALESCE(eg.egresos_efectivo,0) AS egresos,
              COALESCE(pr.propinas,0) AS propinas,
              COALESCE(ret.retiros,0) AS retiros
         FROM conta_sesiones_caja s
         LEFT JOIN usuarios u ON u.id = s.cajero_id
         LEFT JOIN LATERAL (
           SELECT SUM(pg.monto) AS ventas_efectivo
             FROM conta_pagos pg JOIN conta_ventas v ON v.id = pg.venta_id AND v.anulada = false
             JOIN conta_metodos_pago mp ON mp.id = pg.metodo_pago_id
            WHERE v.sesion_caja_id = s.id AND mp.tipo = 'efectivo'
         ) v ON true
         LEFT JOIN LATERAL (
           SELECT SUM(monto) AS egresos_efectivo FROM conta_egresos WHERE sesion_caja_id = s.id
         ) eg ON true
         LEFT JOIN LATERAL (
           SELECT SUM(monto) AS propinas FROM conta_propinas WHERE sesion_caja_id = s.id AND estado <> 'anulada'
         ) pr ON true
         LEFT JOIN LATERAL (
           SELECT SUM(monto) AS retiros FROM conta_movimientos_caja
            WHERE sesion_caja_id = s.id AND tipo = 'retiro'
         ) ret ON true
        WHERE s.estado = 'abierta' AND s.sucursal_id = $1
        ORDER BY s.apertura_en`,
      [sucursalId]
    );
    const cajasAbiertas = cajas.map((c) => ({
      sesion_id: c.id, cajero: c.cajero,
      monto_inicial: round2(num(c.monto_inicial)),
      ventas_efectivo: round2(num(c.ventas_efectivo)),
      egresos: round2(num(c.egresos)),
      propinas: round2(num(c.propinas)),
      retiros: round2(num(c.retiros)),
      efectivo_esperado: round2(num(c.monto_inicial) + num(c.ventas_efectivo) - num(c.egresos) - num(c.retiros)),
    }));

    // --- QR por cuenta con diferencia vs banco ---
    const { rows: qr } = await db.query(
      `SELECT cd.id, cd.nombre AS cuenta, cd.tipo, cd.banco,
              COALESCE(pg.sistema,0) AS sistema,
              cdif.monto_reportado_banco,
              cdif.diferencia,
              cdif.conciliado_en
         FROM conta_cuentas_destino cd
         LEFT JOIN LATERAL (
           SELECT SUM(p.monto) AS sistema
             FROM conta_pagos p JOIN conta_ventas v ON v.id = p.venta_id AND v.anulada = false
            WHERE p.cuenta_destino_id = cd.id
              AND (p.creado_en AT TIME ZONE '${TZ}')::date = $2::date
              AND p.estado_confirmacion = 'confirmado'
         ) pg ON true
         LEFT JOIN conta_qr_conciliacion cdif
                ON cdif.cuenta_destino_id = cd.id AND cdif.fecha = $2::date
        WHERE cd.activo = true AND (cd.sucursal_id = $1 OR cd.sucursal_id IS NULL)
        ORDER BY cd.tipo, cd.nombre`,
      [sucursalId, hoy]
    );
    const qrCuentas = qr.map((r) => ({
      cuenta_id: r.id, cuenta: r.cuenta, tipo: r.tipo, banco: r.banco,
      monto_sistema: round2(num(r.sistema)),
      monto_banco: r.monto_reportado_banco == null ? null : round2(num(r.monto_reportado_banco)),
      diferencia: r.diferencia == null
        ? round2(num(r.sistema) - num(r.monto_reportado_banco))
        : round2(num(r.diferencia)),
      conciliado: !!r.conciliado_en,
    }));

    // --- Top productos del día ---
    const { rows: top } = await db.query(
      `SELECT COALESCE(i.nombre_snapshot, p.nombre, c.nombre, 'Ítem') AS producto,
              SUM(i.cantidad) AS cantidad,
              SUM(i.subtotal) AS ingresos
         FROM conta_venta_items i
         JOIN conta_ventas v ON v.id = i.venta_id AND v.anulada = false
         LEFT JOIN conta_productos p ON p.id = i.producto_id
         LEFT JOIN conta_combos c ON c.id = i.combo_id
        WHERE v.sucursal_id = $1 AND (v.creado_en AT TIME ZONE '${TZ}')::date = $2::date
        GROUP BY 1 ORDER BY ingresos DESC LIMIT 10`,
      [sucursalId, hoy]
    );

    // --- Pilotos que corrieron hoy (tickets + eventos del módulo de carrera) ---
    const { rows: pilotos } = await db.query(
      `SELECT COUNT(DISTINCT t.usuario_id)::int AS pilotos,
              COUNT(DISTINCT t.evento_id)::int  AS eventos,
              COUNT(t.id)::int                  AS tickets
         FROM tickets t
         JOIN eventos e ON e.id = t.evento_id
        WHERE e.fecha = $1::date`,
      [hoy]
    );
    const { rows: porEvento } = await db.query(
      `SELECT e.nombre AS evento, e.hora, e.modo,
              COUNT(DISTINCT t.usuario_id)::int AS pilotos,
              COUNT(t.id)::int AS tickets
         FROM eventos e
         LEFT JOIN tickets t ON t.evento_id = e.id
        WHERE e.fecha = $1::date
        GROUP BY e.id, e.nombre, e.hora, e.modo
        ORDER BY e.hora`,
      [hoy]
    );

    // --- Alertas activas ---
    const { rows: alertas } = await db.query(
      `SELECT id, tipo, severidad, mensaje, creado_en
         FROM conta_alertas
        WHERE leida = false AND (sucursal_id = $1 OR sucursal_id IS NULL)
        ORDER BY CASE severidad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                 creado_en DESC
        LIMIT 20`,
      [sucursalId]
    );

    const cfgAlertas = await getConfigAlertas(db);
    const totalEfectivo = round2(cajasAbiertas.reduce((a, c) => a + c.efectivo_esperado, 0));

    res.json({
      generado_en: new Date().toISOString(),
      fecha: hoy,
      sucursal_id: sucursalId,
      ventas: {
        hoy: ventasHoy,
        ayer: ventasAyer,
        mes_pasado_mismo_dia: { ...ventasMesPasado, fecha: mesPasado },
        variacion_vs_ayer: ventasAyer.total ? round2(((ventasHoy.total - ventasAyer.total) / ventasAyer.total) * 100) : null,
        variacion_vs_mes_pasado: ventasMesPasado.total
          ? round2(((ventasHoy.total - ventasMesPasado.total) / ventasMesPasado.total) * 100) : null,
      },
      efectivo: {
        cajas_abiertas: cajasAbiertas.length,
        efectivo_esperado_total: totalEfectivo,
        detalle: cajasAbiertas,
      },
      qr: {
        cuentas: qrCuentas,
        total_sistema: round2(qrCuentas.reduce((a, c) => a + c.monto_sistema, 0)),
        total_banco: round2(qrCuentas.reduce((a, c) => a + (c.monto_banco || 0), 0)),
        con_diferencia: qrCuentas.filter((c) => c.monto_banco != null && Math.abs(c.diferencia) > 0.009).length,
      },
      top_productos: top.map((t) => ({
        producto: t.producto, cantidad: num(t.cantidad), ingresos: round2(num(t.ingresos)),
      })),
      pilotos_hoy: {
        pilotos: num(pilotos[0]?.pilotos),
        eventos: num(pilotos[0]?.eventos),
        tickets: num(pilotos[0]?.tickets),
        por_evento: porEvento.map((e) => ({ ...e, pilotos: num(e.pilotos), tickets: num(e.tickets) })),
      },
      alertas: {
        sin_leer: alertas.length,
        criticas: alertas.filter((a) => a.severidad === 'critica').length,
        umbrales: {
          diferencia_caja: num(cfgAlertas.diferencia_caja_umbral),
          caja_abierta_horas: num(cfgAlertas.caja_abierta_horas),
        },
        items: alertas,
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Solo el bloque QR (para refrescar la sección sin recargar todo). */
dashboardEjecutivoRouter.get('/qr', requireAuth, requireRole(...ROLES), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const fecha = String(req.query.fecha || fechaISO());
    const { rows } = await db.query(
      `SELECT cd.id, cd.nombre AS cuenta, cd.tipo, cd.banco,
              COALESCE(pg.sistema,0) AS sistema,
              cdif.monto_reportado_banco, cdif.diferencia, cdif.conciliado_en
         FROM conta_cuentas_destino cd
         LEFT JOIN LATERAL (
           SELECT SUM(p.monto) AS sistema
             FROM conta_pagos p JOIN conta_ventas v ON v.id = p.venta_id AND v.anulada = false
            WHERE p.cuenta_destino_id = cd.id
              AND (p.creado_en AT TIME ZONE '${TZ}')::date = $2::date
              AND p.estado_confirmacion = 'confirmado'
         ) pg ON true
         LEFT JOIN conta_qr_conciliacion cdif
                ON cdif.cuenta_destino_id = cd.id AND cdif.fecha = $2::date
        WHERE cd.activo = true AND (cd.sucursal_id = $1 OR cd.sucursal_id IS NULL)
        ORDER BY cd.tipo, cd.nombre`,
      [sucursalId, fecha]
    );
    res.json(rows.map((r) => ({
      cuenta_id: r.id, cuenta: r.cuenta, tipo: r.tipo, banco: r.banco,
      monto_sistema: round2(num(r.sistema)),
      monto_banco: r.monto_reportado_banco == null ? null : round2(num(r.monto_reportado_banco)),
      diferencia: round2(r.diferencia == null ? num(r.sistema) - num(r.monto_reportado_banco) : num(r.diferencia)),
      conciliado: !!r.conciliado_en,
    })));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
