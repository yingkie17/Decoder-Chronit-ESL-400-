// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: tablero consolidado (dashboard)
// -----------------------------------------------------------------------------
//   GET /api/conta/dashboard        -> KPIs del día + serie + top productos
//
// Pensado para los roles ejecutivos (socio / dueño / contador / supervisor) y
// para la pestaña de inicio del módulo. Todo se lee de los snapshots.
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole, FINANZAS } from '../middleware/auth.js';
import { num, fechaISO } from '../utils/helpers.js';

export const dashboardRouter = Router();

const TZ = 'America/La_Paz';

dashboardRouter.get('/', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const hoy = String(req.query.fecha || fechaISO());

    const { rows: k } = await query(
      `SELECT COUNT(*)::int AS ventas_n,
              COALESCE(SUM(conteo_tickets),0)::int AS tickets,
              COALESCE(SUM(total_final),0) AS total,
              COALESCE(SUM(descuento),0)  AS descuento,
              COALESCE(SUM(base_imponible),0) AS base_imponible,
              COALESCE(SUM(iva_total),0)  AS iva,
              COALESCE(SUM(propina),0)    AS propina,
              COUNT(*) FILTER (WHERE anulada)::int AS anuladas
         FROM conta_ventas
        WHERE (creado_en AT TIME ZONE '${TZ}')::date = $1::date`,
      [hoy]
    );

    const { rows: metodos } = await query(
      `SELECT mp.tipo, COALESCE(SUM(pg.monto),0) AS total
         FROM conta_pagos pg
         JOIN conta_ventas v ON v.id = pg.venta_id AND v.anulada = false
         JOIN conta_metodos_pago mp ON mp.id = pg.metodo_pago_id
        WHERE (pg.creado_en AT TIME ZONE '${TZ}')::date = $1::date
        GROUP BY 1`,
      [hoy]
    );

    const { rows: eg } = await query(
      `SELECT COALESCE(SUM(monto),0) AS total, COUNT(*)::int AS n
         FROM conta_egresos WHERE (creado_en AT TIME ZONE '${TZ}')::date = $1::date`,
      [hoy]
    );

    const { rows: cajas } = await query(
      `SELECT s.id, s.monto_inicial, s.apertura_en,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS cajero
         FROM conta_sesiones_caja s
         LEFT JOIN usuarios u ON u.id = s.cajero_id
        WHERE s.estado = 'abierta'
        ORDER BY s.apertura_en`,
      []
    );

    const { rows: cerradas } = await query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(diferencia),0) AS diferencia
         FROM conta_sesiones_caja
        WHERE estado = 'cerrada'
          AND (apertura_en AT TIME ZONE '${TZ}')::date = $1::date`,
      [hoy]
    );

    const { rows: serie } = await query(
      `SELECT to_char((creado_en AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS fecha,
              COALESCE(SUM(total_final),0) AS total,
              COUNT(*)::int AS n
         FROM conta_ventas
        WHERE anulada = false
          AND (creado_en AT TIME ZONE '${TZ}')::date > ($1::date - INTERVAL '7 days')
          AND (creado_en AT TIME ZONE '${TZ}')::date <= $1::date
        GROUP BY 1 ORDER BY 1`,
      [hoy]
    );

    const { rows: top } = await query(
      `SELECT COALESCE(i.nombre_snapshot, p.nombre, 'Ítem') AS nombre,
              SUM(i.cantidad) AS cantidad,
              COALESCE(SUM(i.subtotal),0) AS ingresos
         FROM conta_venta_items i
         JOIN conta_ventas v ON v.id = i.venta_id AND v.anulada = false
         LEFT JOIN conta_productos p ON p.id = i.producto_id
        WHERE (v.creado_en AT TIME ZONE '${TZ}')::date >= ($1::date - INTERVAL '29 days')
          AND (v.creado_en AT TIME ZONE '${TZ}')::date <= $1::date
        GROUP BY 1 ORDER BY ingresos DESC LIMIT 5`,
      [hoy]
    );

    const porTipo = (t) => num(metodos.find((x) => x.tipo === t)?.total);
    const { rows: propPend } = await query(
      `SELECT COALESCE(SUM(monto),0) AS total
         FROM conta_propina_distribucion WHERE estado = 'pendiente'`,
      []
    );

    res.json({
      fecha: hoy,
      kpis: {
        ventas_total: num(k[0]?.total),
        ventas_n: num(k[0]?.ventas_n),
        ventas_anuladas: num(k[0]?.anuladas),
        tickets: num(k[0]?.tickets),
        ticket_promedio: num(k[0]?.ventas_n) ? num(num(k[0]?.total) / num(k[0]?.ventas_n)) : 0,
        efectivo: porTipo('efectivo'),
        qr: porTipo('qr'),
        transferencia: porTipo('transferencia'),
        cortesia: porTipo('cortesia'),
        descuento: num(k[0]?.descuento),
        base_imponible: num(k[0]?.base_imponible),
        iva: num(k[0]?.iva),
        propinas: num(k[0]?.propina),
        propinas_pendientes: num(propPend[0]?.total),
        egresos: num(eg[0]?.total),
        egresos_n: num(eg[0]?.n),
        resultado: num(num(k[0]?.total) - num(eg[0]?.total)),
      },
      cajas_abiertas: cajas.map((c) => ({ ...c, monto_inicial: num(c.monto_inicial) })),
      cajas_cerradas_hoy: num(cerradas[0]?.n),
      diferencia_caja_hoy: num(cerradas[0]?.diferencia),
      serie: serie.map((s) => ({ fecha: s.fecha, total: num(s.total), n: num(s.n) })),
      top_productos: top.map((t) => ({ ...t, cantidad: num(t.cantidad), ingresos: num(t.ingresos) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
