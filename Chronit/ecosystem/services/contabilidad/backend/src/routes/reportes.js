// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: reportes (11) + exportación PDF/Excel
// -----------------------------------------------------------------------------
//   GET /api/conta/reportes                        -> catálogo de reportes
//   GET /api/conta/reportes/:tipo                  -> datos (JSON)
//   GET /api/conta/reportes/:tipo/export?formato=pdf|xlsx -> archivo
//
// REGLA DE ORO: los reportes NUNCA recalculan precios, IVA ni descuentos; leen
// los snapshots guardados en conta_ventas / conta_venta_items / conta_pagos.
// Por eso cambiar `iva_modo_default` o rotar el responsable de un QR no altera
// los reportes históricos.
//
// Las fechas de negocio se resuelven en America/La_Paz.
// =============================================================================
import { Router } from 'express';
import { db } from '../db/pool.js';
import { requireAuth, FINANZAS } from '../middleware/auth.js';
import { num, round2, fechaISO } from '../utils/helpers.js';
import { generarPdf, generarExcel, enviarArchivo, formatearMoneda } from '../utils/exportar.js';
import { saldosPorCuenta } from './contabilidad.js';

export const reportesRouter = Router();

const ES_SUPERVISOR = (rol) => ['supervisor', 'admin', 'desarrollador'].includes(rol);
const TZ = 'America/La_Paz';

/** Rango por defecto: últimos 30 días (inclusive) hasta hoy. */
function rango(req, diasDef = 30) {
  const hasta = String(req.query.hasta || fechaISO());
  const desde = String(req.query.desde || fechaISO(new Date(Date.now() - (diasDef - 1) * 86400000)));
  return { desde, hasta };
}

const subtituloRango = (t, { desde, hasta }) =>
  `${t} · período ${desde} a ${hasta} (America/La_Paz)`;

/**
 * Rango de fechas a partir de `periodo` (YYYY-MM) o de `desde`/`hasta`.
 * Lo usan los reportes fiscales, que se piden por mes (formato SIN).
 */
function rangoPeriodo(p, diasDef = 30) {
  const per = p && p.periodo ? String(p.periodo) : null;
  if (per && /^\d{4}-\d{2}$/.test(per)) {
    const [a, mm] = per.split('-').map(Number);
    const ultimo = new Date(a, mm, 0).getDate();   // último día del mes
    return { desde: `${per}-01`, hasta: `${per}-${String(ultimo).padStart(2, '0')}`, periodo: per };
  }
  return { ...rango({ query: p }, diasDef), periodo: null };
}

const COL_MONEDA = (clave, titulo, ancho = 1) => ({ clave, titulo, tipo: 'moneda', ancho });
const COL_ENTERO = (clave, titulo, ancho = 1) => ({ clave, titulo, tipo: 'entero', ancho });
const COL_TEXTO = (clave, titulo, ancho = 1) => ({ clave, titulo, tipo: 'texto', ancho });
const COL_FECHA_HORA = (clave, titulo, ancho = 1) => ({ clave, titulo, tipo: 'fecha_hora', ancho });
const COL_FECHA = (clave, titulo, ancho = 1) => ({ clave, titulo, tipo: 'fecha', ancho });

const m = (v) => formatearMoneda(v);

// La columna eventos.max_pilotos la agrega una migración del módulo de tickets.
// Se consulta su existencia para no romper si el esquema aún no la tiene.
let _cacheMaxPilotos = null;
async function eventosTieneMaxPilotos(db) {
  if (_cacheMaxPilotos !== null) return _cacheMaxPilotos;
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'eventos' AND column_name = 'max_pilotos' LIMIT 1`
  );
  _cacheMaxPilotos = rows.length > 0;
  return _cacheMaxPilotos;
}

// =============================================================================
// 1) CIERRE DE CAJA POR CAJERO (con diferencia)
// =============================================================================
const REPORTES = {};

REPORTES['cierre-caja'] = {
  titulo: 'Cierre de caja por cajero',
  roles: [...FINANZAS, 'cajero'],
  async ejecutar(db, p, user) {
    const { desde, hasta } = rango({ query: p });
    const soloPropio = !FINANZAS.includes(user.rol);
    const params = [desde, hasta];
    let filtroCajero = '';
    if (soloPropio) { params.push(user.id); filtroCajero = ` AND s.cajero_id = $${params.length}`; }
    else if (p.cajero_id) { params.push(Number(p.cajero_id)); filtroCajero = ` AND s.cajero_id = $${params.length}`; }

    const { rows } = await db.query(
      `SELECT s.id, s.estado,
              s.apertura_en, s.cierre_en,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS cajero,
              u.carnet AS cajero_carnet,
              s.monto_inicial,
              vp.n_ventas, vp.ventas_total, vp.ventas_efectivo,
              COALESCE(eg.total,0) AS egresos,
              COALESCE(pr.total,0) AS propinas,
              s.monto_esperado_efectivo,
              s.monto_contado_efectivo,
              s.diferencia
         FROM conta_sesiones_caja s
         LEFT JOIN usuarios u ON u.id = s.cajero_id
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT v.id)::int AS n_ventas,
                  COALESCE(SUM(pg.monto),0) AS ventas_total,
                  COALESCE(SUM(pg.monto) FILTER (WHERE mp.tipo = 'efectivo'),0) AS ventas_efectivo
             FROM conta_pagos pg
             JOIN conta_ventas v ON v.id = pg.venta_id AND v.anulada = false
             JOIN conta_metodos_pago mp ON mp.id = pg.metodo_pago_id
            WHERE v.sesion_caja_id = s.id
         ) vp ON true
         LEFT JOIN LATERAL (
           SELECT SUM(monto) AS total FROM conta_egresos WHERE sesion_caja_id = s.id
         ) eg ON true
         LEFT JOIN LATERAL (
           SELECT SUM(monto) AS total FROM conta_propinas
            WHERE sesion_caja_id = s.id AND estado <> 'anulada'
         ) pr ON true
        WHERE (s.apertura_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (s.apertura_en AT TIME ZONE '${TZ}')::date <= $2::date${filtroCajero}
        ORDER BY s.apertura_en DESC`,
      params
    );

    const filas = rows.map((r) => ({
      ...r,
      monto_inicial: num(r.monto_inicial),
      ventas_total: num(r.ventas_total),
      ventas_efectivo: num(r.ventas_efectivo),
      egresos: num(r.egresos),
      propinas: num(r.propinas),
      monto_esperado_efectivo: r.monto_esperado_efectivo == null ? null : num(r.monto_esperado_efectivo),
      monto_contado_efectivo: r.monto_contado_efectivo == null ? null : num(r.monto_contado_efectivo),
      diferencia: r.diferencia == null ? null : num(r.diferencia),
    }));

    const cerradas = filas.filter((f) => f.estado === 'cerrada');
    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('cajero', 'Cajero', 1.5), COL_TEXTO('cajero_carnet', 'Carnet', 1),
        COL_FECHA_HORA('apertura_en', 'Apertura', 1.2), COL_FECHA_HORA('cierre_en', 'Cierre', 1.2),
        COL_TEXTO('estado', 'Estado', 0.7),
        COL_MONEDA('monto_inicial', 'M. inicial'),
        COL_ENTERO('n_ventas', 'Ventas', 0.6),
        COL_MONEDA('ventas_efectivo', 'Vta. efectivo'),
        COL_MONEDA('ventas_total', 'Vta. total'),
        COL_MONEDA('egresos', 'Egresos'), COL_MONEDA('propinas', 'Propinas'),
        COL_MONEDA('monto_esperado_efectivo', 'Esperado'), COL_MONEDA('monto_contado_efectivo', 'Contado'),
        COL_MONEDA('diferencia', 'Diferencia'),
      ],
      filas,
      resumen: {
        'Sesiones en el período': String(filas.length),
        'Sesiones cerradas': String(cerradas.length),
        'Ventas totales': m(filas.reduce((a, f) => a + f.ventas_total, 0)),
        'Egresos': m(filas.reduce((a, f) => a + f.egresos, 0)),
        'Suma de diferencias': m(cerradas.reduce((a, f) => a + (f.diferencia || 0), 0)),
      },
      subtitulo: subtituloRango('Cierres de caja por cajero', { desde, hasta }),
      nombreArchivo: `cierre-caja_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 2) CIERRE DIARIO CONSOLIDADO
// =============================================================================
REPORTES['cierre-diario'] = {
  titulo: 'Cierre diario consolidado',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const fecha = String(p.fecha || fechaISO());

    const { rows: porMetodoCuenta } = await db.query(
      `SELECT mp.nombre AS metodo, mp.tipo,
              COALESCE(cd.nombre, '—') AS cuenta,
              COUNT(DISTINCT v.id)::int AS n_ventas,
              COALESCE(SUM(pg.monto),0) AS total
         FROM conta_pagos pg
         JOIN conta_ventas v ON v.id = pg.venta_id AND v.anulada = false
         JOIN conta_metodos_pago mp ON mp.id = pg.metodo_pago_id
         LEFT JOIN conta_cuentas_destino cd ON cd.id = pg.cuenta_destino_id
        WHERE (v.creado_en AT TIME ZONE '${TZ}')::date = $1::date
        GROUP BY 1,2,3
        ORDER BY mp.tipo, mp.nombre, cuenta`,
      [fecha]
    );

    const { rows: tot } = await db.query(
      `SELECT COUNT(*)::int AS n_ventas,
              COALESCE(SUM(conteo_tickets),0)::int AS tickets,
              COALESCE(SUM(descuento),0) AS descuento,
              COALESCE(SUM(base_imponible),0) AS base_imponible,
              COALESCE(SUM(iva_total),0) AS iva_total,
              COALESCE(SUM(propina),0) AS propina,
              COALESCE(SUM(total_final),0) AS total,
              COUNT(*) FILTER (WHERE anulada)::int AS anuladas
         FROM conta_ventas
        WHERE (creado_en AT TIME ZONE '${TZ}')::date = $1::date`,
      [fecha]
    );
    const { rows: eg } = await db.query(
      `SELECT COALESCE(SUM(monto),0) AS total, COUNT(*)::int AS n
         FROM conta_egresos WHERE (creado_en AT TIME ZONE '${TZ}')::date = $1::date`,
      [fecha]
    );
    const { rows: caj } = await db.query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM(monto_inicial),0) AS inicial,
              COALESCE(SUM(monto_contado_efectivo),0) AS contado,
              COALESCE(SUM(diferencia),0) AS diferencia
         FROM conta_sesiones_caja
        WHERE (apertura_en AT TIME ZONE '${TZ}')::date = $1::date`,
      [fecha]
    );
    const { rows: pr } = await db.query(
      `SELECT COALESCE(SUM(monto),0) AS total
         FROM conta_propinas
        WHERE estado <> 'anulada' AND (creado_en AT TIME ZONE '${TZ}')::date = $1::date`,
      [fecha]
    );

    const t = tot[0] || {};
    const efectivo = porMetodoCuenta
      .filter((r) => r.tipo === 'efectivo').reduce((a, r) => a + num(r.total), 0);
    const qr = porMetodoCuenta
      .filter((r) => r.tipo === 'qr').reduce((a, r) => a + num(r.total), 0);
    const transferencia = porMetodoCuenta
      .filter((r) => r.tipo === 'transferencia').reduce((a, r) => a + num(r.total), 0);
    const cortesia = porMetodoCuenta
      .filter((r) => r.tipo === 'cortesia').reduce((a, r) => a + num(r.total), 0);

    return {
      titulo: `${this.titulo} — ${fecha}`,
      columnas: [
        COL_TEXTO('metodo', 'Método de pago', 1.4), COL_TEXTO('tipo', 'Tipo', 1),
        COL_TEXTO('cuenta', 'Cuenta destino', 1.6), COL_ENTERO('n_ventas', 'Ventas', 0.7),
        COL_MONEDA('total', 'Total'),
      ],
      filas: porMetodoCuenta.map((r) => ({ ...r, total: num(r.total) })),
      resumen: {
        'Ventas del día': String(num(t.n_ventas)),
        'Ventas anuladas': String(num(t.anuladas)),
        'Tickets emitidos': String(num(t.tickets)),
        'Efectivo': m(efectivo),
        'QR': m(qr),
        'Transferencia': m(transferencia),
        'Cortesía': m(cortesia),
        'Total facturado': m(t.total),
        'Descuentos': m(t.descuento),
        'Base imponible': m(t.base_imponible),
        'IVA recaudado': m(t.iva_total),
        'Propinas': m(pr[0]?.total),
        'Egresos': m(eg[0]?.total),
        'Sesiones de caja abiertas': String(num(caj[0]?.n)),
        'Monto inicial': m(caj[0]?.inicial),
        'Efectivo contado': m(caj[0]?.contado),
        'Diferencia de caja': m(caj[0]?.diferencia),
      },
      subtitulo: `Cierre diario consolidado · ${fecha} (America/La_Paz)`,
      nombreArchivo: `cierre-diario_${fecha}`,
    };
  },
};

// =============================================================================
// 3) REPORTE POR CARRERA (evento)
// =============================================================================
REPORTES['carrera'] = {
  titulo: 'Reporte por carrera',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p }, 90);
    const params = [desde, hasta];
    let filtro = '';
    if (p.evento_id) { params.push(Number(p.evento_id)); filtro = ` AND e.id = $${params.length}`; }

    const tieneMax = await eventosTieneMaxPilotos(db);
    const { rows } = await db.query(
      `SELECT e.id, e.nombre AS evento, e.fecha, e.hora, e.modo,
              ${tieneMax ? 'e.max_pilotos' : 'NULL::int AS max_pilotos'},
              COUNT(DISTINCT t.id)::int AS tickets,
              COUNT(DISTINCT t.usuario_id)::int AS pilotos,
              COUNT(DISTINCT t.kart_id)::int AS karts,
              COUNT(DISTINCT t.id) FILTER (WHERE t.pagado_en IS NOT NULL)::int AS pagados,
              COALESCE(SUM(
                CASE WHEN v.id IS NOT NULL
                     THEN v.total_final / GREATEST(COALESCE(v.conteo_tickets,1),1) ELSE 0 END
              ),0) AS ingresos
         FROM eventos e
         LEFT JOIN tickets t ON t.evento_id = e.id
         LEFT JOIN conta_ventas v ON v.id = t.venta_id AND v.anulada = false
        WHERE e.fecha >= $1::date AND e.fecha <= $2::date${filtro}
        GROUP BY e.id, e.nombre, e.fecha, e.hora, e.modo
        ORDER BY e.fecha DESC, e.hora DESC`,
      params
    );

    const filas = rows.map((r) => {
      const tickets = num(r.tickets);
      const ingresos = num(r.ingresos);
      return {
        ...r,
        ingresos,
        ticket_promedio: tickets ? num(ingresos / tickets) : 0,
        ocupacion: r.max_pilotos ? num((tickets / r.max_pilotos) * 100) : null,
      };
    });

    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('evento', 'Evento', 1.8), COL_FECHA('fecha', 'Fecha'), COL_TEXTO('hora', 'Hora', 0.6),
        COL_TEXTO('modo', 'Modo', 0.8),
        COL_ENTERO('tickets', 'Tickets', 0.7), COL_ENTERO('pilotos', 'Pilotos', 0.7),
        COL_ENTERO('karts', 'Karts', 0.6), COL_ENTERO('pagados', 'Pagados', 0.7),
        COL_MONEDA('ingresos', 'Ingresos'), COL_MONEDA('ticket_promedio', 'Ticket prom.'),
      ],
      filas,
      resumen: {
        'Eventos': String(filas.length),
        'Tickets vendidos': String(filas.reduce((a, f) => a + num(f.tickets), 0)),
        'Ingresos atribuidos': m(filas.reduce((a, f) => a + num(f.ingresos), 0)),
        'Ticket promedio general': m(
          filas.reduce((a, f) => a + num(f.tickets), 0)
            ? filas.reduce((a, f) => a + num(f.ingresos), 0) / filas.reduce((a, f) => a + num(f.tickets), 0)
            : 0
        ),
      },
      subtitulo: subtituloRango('Reporte por carrera', { desde, hasta }),
      nombreArchivo: `carrera_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 4) REPORTE POR PRODUCTO Y COMBO
// =============================================================================
REPORTES['productos'] = {
  titulo: 'Reporte por producto y combo',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p });
    const { rows } = await db.query(
      `SELECT CASE WHEN i.combo_id IS NOT NULL AND i.es_componente_combo = false
                   THEN 'combo' ELSE 'producto' END AS tipo,
              COALESCE(i.nombre_snapshot, p.nombre, c.nombre, 'Ítem') AS nombre,
              SUM(i.cantidad)            AS cantidad,
              COUNT(DISTINCT i.venta_id)::int AS n_ventas,
              SUM(i.descuento)           AS descuento,
              SUM(i.subtotal)            AS ingresos,
              SUM(i.iva_linea)           AS iva
         FROM conta_venta_items i
         JOIN conta_ventas v ON v.id = i.venta_id AND v.anulada = false
         LEFT JOIN conta_productos p ON p.id = i.producto_id
         LEFT JOIN conta_combos c ON c.id = i.combo_id
        WHERE (v.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (v.creado_en AT TIME ZONE '${TZ}')::date <= $2::date
        GROUP BY 1,2
        ORDER BY ingresos DESC`,
      [desde, hasta]
    );
    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('tipo', 'Tipo', 0.8), COL_TEXTO('nombre', 'Producto / Combo', 2),
        COL_ENTERO('cantidad', 'Cantidad', 0.8), COL_ENTERO('n_ventas', 'En ventas', 0.8),
        COL_MONEDA('descuento', 'Descuento'), COL_MONEDA('ingresos', 'Ingresos'), COL_MONEDA('iva', 'IVA'),
      ],
      filas: rows.map((r) => ({
        ...r, cantidad: num(r.cantidad), descuento: num(r.descuento),
        ingresos: num(r.ingresos), iva: num(r.iva),
      })),
      resumen: {
        'Ítems distintos': String(rows.length),
        'Unidades vendidas': String(rows.reduce((a, r) => a + num(r.cantidad), 0)),
        'Ingresos': m(rows.reduce((a, r) => a + num(r.ingresos), 0)),
        'Descuentos': m(rows.reduce((a, r) => a + num(r.descuento), 0)),
        'IVA contenido': m(rows.reduce((a, r) => a + num(r.iva), 0)),
      },
      subtitulo: subtituloRango('Reporte por producto y combo', { desde, hasta }),
      nombreArchivo: `productos_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 5) REPORTE POR MÉTODO DE PAGO Y CUENTA DESTINO
// =============================================================================
REPORTES['metodos-pago'] = {
  titulo: 'Reporte por método de pago y cuenta destino',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p });
    const { rows } = await db.query(
      `SELECT mp.nombre AS metodo, mp.tipo,
              COALESCE(cd.nombre, '—') AS cuenta,
              COUNT(*)::int AS n_pagos,
              COUNT(DISTINCT pg.venta_id)::int AS n_ventas,
              COALESCE(SUM(pg.monto),0) AS total,
              COUNT(*) FILTER (WHERE pg.estado_confirmacion = 'pendiente')::int AS pendientes
         FROM conta_pagos pg
         JOIN conta_ventas v ON v.id = pg.venta_id AND v.anulada = false
         JOIN conta_metodos_pago mp ON mp.id = pg.metodo_pago_id
         LEFT JOIN conta_cuentas_destino cd ON cd.id = pg.cuenta_destino_id
        WHERE (pg.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (pg.creado_en AT TIME ZONE '${TZ}')::date <= $2::date
        GROUP BY 1,2,3
        ORDER BY mp.tipo, mp.nombre, cuenta`,
      [desde, hasta]
    );
    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('metodo', 'Método', 1.4), COL_TEXTO('tipo', 'Tipo', 1),
        COL_TEXTO('cuenta', 'Cuenta destino', 1.6),
        COL_ENTERO('n_pagos', 'Pagos', 0.7), COL_ENTERO('n_ventas', 'Ventas', 0.7),
        COL_ENTERO('pendientes', 'Sin confirmar', 0.9), COL_MONEDA('total', 'Total'),
      ],
      filas: rows.map((r) => ({ ...r, total: num(r.total) })),
      resumen: {
        'Métodos usados': String(new Set(rows.map((r) => r.metodo)).size),
        'Total cobrado': m(rows.reduce((a, r) => a + num(r.total), 0)),
        'Pagos sin confirmar': String(rows.reduce((a, r) => a + num(r.pendientes), 0)),
      },
      subtitulo: subtituloRango('Reporte por método de pago y cuenta destino', { desde, hasta }),
      nombreArchivo: `metodos-pago_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 6) REPORTE DE EGRESOS POR CATEGORÍA
// =============================================================================
REPORTES['egresos'] = {
  titulo: 'Reporte de egresos por categoría',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p });
    const { rows } = await db.query(
      `SELECT categoria,
              COUNT(*)::int AS n,
              COALESCE(SUM(monto),0) AS total,
              COUNT(*) FILTER (WHERE autorizado_por IS NOT NULL)::int AS autorizados,
              COUNT(*) FILTER (WHERE requiere_autorizacion)::int AS requirieron_autorizacion,
              to_char(MAX(creado_en AT TIME ZONE '${TZ}'), 'YYYY-MM-DD') AS ultimo
         FROM conta_egresos
        WHERE (creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (creado_en AT TIME ZONE '${TZ}')::date <= $2::date
        GROUP BY categoria
        ORDER BY total DESC`,
      [desde, hasta]
    );
    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('categoria', 'Categoría', 1.5), COL_ENTERO('n', 'Egresos', 0.7),
        COL_MONEDA('total', 'Total'),
        COL_ENTERO('autorizados', 'Autorizados', 0.9),
        COL_ENTERO('requirieron_autorizacion', 'Sobre umbral', 0.9),
        COL_FECHA('ultimo', 'Último'),
      ],
      filas: rows.map((r) => ({ ...r, total: num(r.total) })),
      resumen: {
        'Egresos registrados': String(rows.reduce((a, r) => a + num(r.n), 0)),
        'Total egresos': m(rows.reduce((a, r) => a + num(r.total), 0)),
        'Categorías': String(rows.length),
      },
      subtitulo: subtituloRango('Reporte de egresos por categoría', { desde, hasta }),
      nombreArchivo: `egresos_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 7) COMPARATIVO DÍA / SEMANA / MES
// =============================================================================
REPORTES['comparativo'] = {
  titulo: 'Comparativo día / semana / mes',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const periodo = ['dia', 'semana', 'mes'].includes(String(p.periodo)) ? String(p.periodo) : 'dia';
    const unidad = periodo === 'dia' ? 'day' : periodo === 'semana' ? 'week' : 'month';
    const diasDef = periodo === 'dia' ? 14 : periodo === 'semana' ? 84 : 365;
    const { desde, hasta } = rango({ query: p }, diasDef);

    const { rows } = await db.query(
      `WITH periodos AS (
         SELECT generate_series(
                  date_trunc($3, $1::timestamp),
                  date_trunc($3, $2::timestamp),
                  ('1 ' || $3)::interval
                ) AS inicio
       ),
       ventas AS (
         SELECT date_trunc($3, (creado_en AT TIME ZONE '${TZ}')) AS inicio,
                COALESCE(SUM(total_final),0) AS total,
                COUNT(*)::int               AS n_ventas,
                COALESCE(SUM(conteo_tickets),0)::int AS tickets,
                COALESCE(SUM(descuento),0)  AS descuento,
                COALESCE(SUM(iva_total),0)  AS iva,
                COALESCE(SUM(propina),0)    AS propina
           FROM conta_ventas
          WHERE anulada = false
          GROUP BY 1
       ),
       gastos AS (
         SELECT date_trunc($3, (creado_en AT TIME ZONE '${TZ}')) AS inicio,
                COALESCE(SUM(monto),0) AS egresos
           FROM conta_egresos
          GROUP BY 1
       )
       SELECT to_char(p.inicio, 'YYYY-MM-DD')      AS inicio,
              COALESCE(v.total,0)                  AS ventas,
              COALESCE(v.n_ventas,0)               AS n_ventas,
              COALESCE(v.tickets,0)                AS tickets,
              COALESCE(v.descuento,0)              AS descuento,
              COALESCE(v.iva,0)                    AS iva,
              COALESCE(v.propina,0)                AS propina,
              COALESCE(g.egresos,0)                AS egresos
         FROM periodos p
         LEFT JOIN ventas v ON v.inicio = p.inicio
         LEFT JOIN gastos g ON g.inicio = p.inicio
        ORDER BY p.inicio ASC`,
      [desde, hasta, unidad]
    );

    const filas = rows.map((r, i) => {
      const ventas = num(r.ventas);
      const anterior = i > 0 ? num(rows[i - 1].ventas) : null;
      return {
        ...r,
        ventas,
        ticket_promedio: num(r.n_ventas) ? num(ventas / num(r.n_ventas)) : 0,
        variacion: anterior == null || anterior === 0 ? null : num(((ventas - anterior) / anterior) * 100),
      };
    });

    const totalVentas = filas.reduce((a, f) => a + f.ventas, 0);
    return {
      titulo: `${this.titulo} (por ${periodo})`,
      columnas: [
        COL_FECHA('inicio', 'Inicio de período', 1.2),
        COL_MONEDA('ventas', 'Ventas'), COL_ENTERO('n_ventas', 'N° ventas', 0.8),
        COL_ENTERO('tickets', 'Tickets', 0.8), COL_MONEDA('ticket_promedio', 'Ticket prom.'),
        COL_MONEDA('descuento', 'Descuentos'), COL_MONEDA('iva', 'IVA'),
        COL_MONEDA('propina', 'Propinas'), COL_MONEDA('egresos', 'Egresos'),
        COL_MONEDA('variacion', 'Var. %'),
      ],
      filas,
      resumen: {
        'Períodos': String(filas.length),
        'Unidad': periodo,
        'Ventas acumuladas': m(totalVentas),
        'Promedio por período': m(filas.length ? totalVentas / filas.length : 0),
        'Egresos acumulados': m(filas.reduce((a, f) => a + num(f.egresos), 0)),
      },
      subtitulo: subtituloRango(`Comparativo por ${periodo}`, { desde, hasta }),
      nombreArchivo: `comparativo-${periodo}_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 8) CONCILIACIÓN QR POR CUENTA (con historial de responsables)
// =============================================================================
REPORTES['conciliacion-qr'] = {
  titulo: 'Conciliación QR por cuenta',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p });
    const params = [desde, hasta];
    let filtro = '';
    if (p.cuenta_id) { params.push(Number(p.cuenta_id)); filtro = ` AND pg.cuenta_destino_id = $${params.length}`; }

    const { rows } = await db.query(
      `SELECT (pg.creado_en AT TIME ZONE '${TZ}')::date AS fecha,
              cd.id AS cuenta_id, cd.nombre AS cuenta, cd.tipo,
              COUNT(*)::int AS n_pagos,
              COALESCE(SUM(pg.monto),0) AS monto_sistema,
              c.monto_reportado_banco,
              c.diferencia,
              c.conciliado_en,
              string_agg(DISTINCT NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), ''), ', ')
                AS responsables_snapshot
         FROM conta_pagos pg
         JOIN conta_ventas v ON v.id = pg.venta_id AND v.anulada = false
         JOIN conta_cuentas_destino cd ON cd.id = pg.cuenta_destino_id
         LEFT JOIN usuarios u ON u.id = pg.cuenta_responsable_id_snapshot
         LEFT JOIN conta_qr_conciliacion c
                ON c.cuenta_destino_id = pg.cuenta_destino_id
               AND c.fecha = (pg.creado_en AT TIME ZONE '${TZ}')::date
        WHERE (pg.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (pg.creado_en AT TIME ZONE '${TZ}')::date <= $2::date${filtro}
        GROUP BY 1,2,3,4, c.monto_reportado_banco, c.diferencia, c.conciliado_en
        ORDER BY 1 DESC, cd.nombre`,
      params
    );

    const filas = rows.map((r) => ({
      ...r,
      monto_sistema: num(r.monto_sistema),
      monto_reportado_banco: r.monto_reportado_banco == null ? null : num(r.monto_reportado_banco),
      diferencia: r.diferencia == null ? null : num(r.diferencia),
    }));
    const sistemaTotal = filas.reduce((a, f) => a + f.monto_sistema, 0);
    const bancoTotal = filas.reduce((a, f) => a + (f.monto_reportado_banco || 0), 0);

    return {
      titulo: this.titulo,
      columnas: [
        COL_FECHA('fecha', 'Fecha'), COL_TEXTO('cuenta', 'Cuenta', 1.6), COL_TEXTO('tipo', 'Tipo', 0.9),
        COL_ENTERO('n_pagos', 'Pagos', 0.6), COL_MONEDA('monto_sistema', 'Sistema'),
        COL_MONEDA('monto_reportado_banco', 'Banco'), COL_MONEDA('diferencia', 'Diferencia'),
        COL_TEXTO('responsables_snapshot', 'Responsable(s) al momento (snapshot)', 2),
      ],
      filas,
      resumen: {
        'Días-cuenta listados': String(filas.length),
        'Total sistema': m(sistemaTotal),
        'Total reportado por el banco': m(bancoTotal),
        'Diferencia total': m(bancoTotal - sistemaTotal),
      },
      subtitulo: subtituloRango('Conciliación QR por cuenta', { desde, hasta }),
      nombreArchivo: `conciliacion-qr_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 9) REPORTE DE PROPINAS POR BENEFICIARIO
// =============================================================================
REPORTES['propinas'] = {
  titulo: 'Reporte de propinas por beneficiario',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p });
    const params = [desde, hasta];
    let filtro = '';
    if (p.usuario_id) { params.push(Number(p.usuario_id)); filtro += ` AND d.usuario_id = $${params.length}`; }
    if (p.estado) { params.push(String(p.estado)); filtro += ` AND d.estado = $${params.length}`; }

    const { rows } = await db.query(
      `SELECT d.usuario_id,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS beneficiario,
              u.carnet, COALESCE(d.rol, u.rol) AS rol, d.estado,
              COUNT(*)::int AS n,
              COALESCE(SUM(d.monto),0) AS total,
              to_char(MAX(p.creado_en AT TIME ZONE '${TZ}'), 'YYYY-MM-DD HH24:MI') AS ultima
         FROM conta_propina_distribucion d
         JOIN conta_propinas p ON p.id = d.propina_id
         JOIN usuarios u ON u.id = d.usuario_id
        WHERE (p.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (p.creado_en AT TIME ZONE '${TZ}')::date <= $2::date${filtro}
        GROUP BY d.usuario_id, u.nombre, u.apellido, u.carnet, COALESCE(d.rol, u.rol), d.estado
        ORDER BY total DESC`,
      params
    );

    const filas = rows.map((r) => ({ ...r, total: num(r.total) }));
    const pendientes = filas.filter((f) => f.estado === 'pendiente');
    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('beneficiario', 'Beneficiario', 1.8), COL_TEXTO('carnet', 'Carnet', 1),
        COL_TEXTO('rol', 'Rol', 0.9), COL_TEXTO('estado', 'Estado', 0.9),
        COL_ENTERO('n', 'Propinas', 0.7), COL_MONEDA('total', 'Total'),
        COL_TEXTO('ultima', 'Última', 1),
      ],
      filas,
      resumen: {
        'Beneficiarios': String(new Set(filas.map((f) => f.usuario_id)).size),
        'Total distribuido': m(filas.reduce((a, f) => a + f.total, 0)),
        'Pendiente de pago': m(pendientes.reduce((a, f) => a + f.total, 0)),
        'Pagado': m(filas.filter((f) => f.estado === 'pagada').reduce((a, f) => a + f.total, 0)),
      },
      subtitulo: subtituloRango('Reporte de propinas por beneficiario', { desde, hasta }),
      nombreArchivo: `propinas_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 10) REPORTE DE IMPUESTOS — BOLIVIA (v3)
//     IVA débito fiscal (ventas FACTURADAS) − IVA crédito fiscal (compras)
//     = IVA a pagar.
//     El IT se declara sobre TODAS las ventas (facturadas o no): es un impuesto
//     a los ingresos brutos, no al consumo.
//     Todos los importes salen de los SNAPSHOTS de la venta: cambiar una tasa
//     hoy NO altera los períodos ya declarados.
// =============================================================================
REPORTES['impuestos'] = {
  titulo: 'Reporte de impuestos (IVA / IT / IUE — Bolivia)',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta, periodo } = rangoPeriodo(p, 365);

    const { rows } = await db.query(
      `SELECT to_char(date_trunc('month', (v.creado_en AT TIME ZONE '${TZ}')), 'YYYY-MM') AS periodo,
              COUNT(*)::int AS n_ventas,
              COUNT(*) FILTER (WHERE v.tipo_operacion = 'facturado')::int AS n_facturadas,
              COUNT(*) FILTER (WHERE v.tipo_operacion <> 'facturado')::int AS n_no_facturadas,
              COALESCE(SUM(v.base_imponible_iva),0) AS base_iva,
              COALESCE(SUM(v.iva_total),0)          AS iva_debito,
              COALESCE(SUM(v.base_imponible_it),0)  AS base_it,
              COALESCE(SUM(v.it_total),0)           AS it_total,
              COALESCE(SUM(v.iue_retenido),0)       AS iue_retenido,
              COALESCE(SUM(v.itf_total),0)          AS itf_total,
              COALESCE(SUM(v.total_final),0)        AS total
         FROM conta_ventas v
        WHERE v.anulada = false
          AND v.tipo_operacion <> 'cortesia'
          AND (v.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (v.creado_en AT TIME ZONE '${TZ}')::date <= $2::date
        GROUP BY 1 ORDER BY 1 DESC`,
      [desde, hasta]
    );

    // IVA crédito fiscal: compras confirmadas/pagadas del período.
    const { rows: compras } = await db.query(
      `SELECT COALESCE(SUM(c.subtotal),0) AS base, COALESCE(SUM(c.iva),0) AS iva_credito
         FROM conta_compras c
        WHERE c.estado NOT IN ('anulada','borrador')
          AND c.fecha >= $1::date AND c.fecha <= $2::date`,
      [desde, hasta]
    );

    // Desglose por régimen (general | siete_rg) para detectar el uso de SIETE-RG.
    const { rows: regimenes } = await db.query(
      `SELECT COALESCE(v.regimen_aplicado,'general') AS regimen, COUNT(*)::int AS n,
              COALESCE(SUM(v.total_final),0) AS total
         FROM conta_ventas v
        WHERE v.anulada = false
          AND (v.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (v.creado_en AT TIME ZONE '${TZ}')::date <= $2::date
        GROUP BY 1 ORDER BY 2 DESC`,
      [desde, hasta]
    );

    const ivaDebito = round2(rows.reduce((a, r) => a + num(r.iva_debito), 0));
    const itTotal = round2(rows.reduce((a, r) => a + num(r.it_total), 0));
    const iueRetenido = round2(rows.reduce((a, r) => a + num(r.iue_retenido), 0));
    const itfTotal = round2(rows.reduce((a, r) => a + num(r.itf_total), 0));
    const baseIt = round2(rows.reduce((a, r) => a + num(r.base_it), 0));
    const ivaCredito = round2(num(compras[0] && compras[0].iva_credito));
    const baseCompras = round2(num(compras[0] && compras[0].base));
    const regimenPrincipal = regimenes.length ? regimenes[0].regimen : 'general';

    const filas = rows.map((r) => ({
      periodo: r.periodo,
      n_ventas: r.n_ventas,
      n_facturadas: r.n_facturadas,
      n_no_facturadas: r.n_no_facturadas,
      base_iva: num(r.base_iva),
      iva_debito: num(r.iva_debito),
      base_it: num(r.base_it),
      it_total: num(r.it_total),
      iue_retenido: num(r.iue_retenido),
      itf_total: num(r.itf_total),
      total: num(r.total),
    }));

    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('periodo', 'Período', 0.9),
        COL_ENTERO('n_ventas', 'Ventas', 0.6),
        COL_ENTERO('n_facturadas', 'Facturadas', 0.7),
        COL_ENTERO('n_no_facturadas', 'No facturadas', 0.8),
        COL_MONEDA('base_iva', 'Base IVA'),
        COL_MONEDA('iva_debito', 'IVA débito 13%'),
        COL_MONEDA('base_it', 'Base IT'),
        COL_MONEDA('it_total', 'IT 3%'),
        COL_MONEDA('iue_retenido', 'IUE / SIETE-RG'),
        COL_MONEDA('itf_total', 'ITF 0,15%'),
        COL_MONEDA('total', 'Total vendido'),
      ],
      filas,
      resumen: {
        'Régimen aplicado': regimenPrincipal,
        'IVA débito fiscal (ventas)': m(ivaDebito),
        'IVA crédito fiscal (compras)': m(ivaCredito),
        'IVA a pagar (débito − crédito)': m(round2(ivaDebito - ivaCredito)),
        'IT a pagar (TODAS las ventas)': m(itTotal),
        'IUE retenido / unificado SIETE-RG': m(iueRetenido),
        ITF: m(itfTotal),
        'Base imponible IT': m(baseIt),
        'Base de compras': m(baseCompras),
        ...Object.fromEntries(regimenes.map((r) => [
          `Ventas régimen ${r.regimen}`, `${r.n} ventas · ${m(r.total)}`,
        ])),
        Nota: 'Importes leídos de los snapshots de cada venta: cambiar una tasa NO altera los períodos pasados.',
      },
      subtitulo: periodo
        ? `Reporte de impuestos · período ${periodo} (America/La_Paz)`
        : subtituloRango('Reporte de impuestos', { desde, hasta }),
      nombreArchivo: `impuestos_${periodo || `${desde}_${hasta}`}`,
    };
  },
};

// =============================================================================
// 11) REPORTE NIT DE CLIENTES
// =============================================================================
REPORTES['nit-clientes'] = {
  titulo: 'Reporte NIT de clientes',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p }, 365);
    const { rows } = await db.query(
      `SELECT v.nit_cliente,
              COALESCE(v.razon_social_cliente, '—') AS razon_social,
              COUNT(*)::int AS n_ventas,
              COALESCE(SUM(v.total_final),0) AS total,
              COALESCE(SUM(v.iva_total),0)   AS iva,
              to_char(MIN(v.creado_en AT TIME ZONE '${TZ}'), 'YYYY-MM-DD') AS primera_venta,
              to_char(MAX(v.creado_en AT TIME ZONE '${TZ}'), 'YYYY-MM-DD') AS ultima_venta
         FROM conta_ventas v
        WHERE v.anulada = false
          AND v.nit_cliente IS NOT NULL
          AND (v.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (v.creado_en AT TIME ZONE '${TZ}')::date <= $2::date
        GROUP BY 1,2
        ORDER BY total DESC`,
      [desde, hasta]
    );
    const filas = rows.map((r) => ({ ...r, total: num(r.total), iva: num(r.iva) }));
    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('nit_cliente', 'NIT', 1.2), COL_TEXTO('razon_social', 'Razón social', 2.2),
        COL_ENTERO('n_ventas', 'Ventas', 0.7), COL_MONEDA('total', 'Total'),
        COL_MONEDA('iva', 'IVA'), COL_FECHA('primera_venta', 'Primera', 1),
        COL_FECHA('ultima_venta', 'Última', 1),
      ],
      filas,
      resumen: {
        'NIT distintos': String(rows.length),
        'Ventas con NIT': String(filas.reduce((a, f) => a + num(f.n_ventas), 0)),
        'Monto facturado con NIT': m(filas.reduce((a, f) => a + f.total, 0)),
        Nota: 'Este reporte es informativo y NO alimenta todavía el módulo fiscal.',
      },
      subtitulo: subtituloRango('Reporte NIT de clientes', { desde, hasta }),
      nombreArchivo: `nit-clientes_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 12) LIBRO DIARIO (asientos registrados con sus líneas)
// =============================================================================
REPORTES['libro-diario'] = {
  titulo: 'Libro Diario',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p }, 30);
    const params = [desde, hasta];
    let filtro = '';
    if (p.referencia_tipo) {
      params.push(String(p.referencia_tipo));
      filtro = ` AND a.referencia_tipo = $${params.length}`;
    }

    const { rows } = await db.query(
      `SELECT a.fecha, a.id AS asiento_id, a.tipo, a.referencia_tipo, a.referencia_id,
              a.descripcion AS asiento_descripcion,
              l.cuenta_contable AS codigo,
              COALESCE(cc.nombre, l.cuenta_contable) AS cuenta_nombre,
              COALESCE(cc.tipo, 'otro') AS tipo_cuenta,
              l.descripcion AS detalle, l.debe, l.haber
         FROM conta_asientos_contables a
         JOIN conta_asiento_lineas l ON l.asiento_id = a.id
         LEFT JOIN conta_cuentas_contables cc ON cc.codigo = l.cuenta_contable
        WHERE a.estado = 'registrado'
          AND a.fecha >= $1::date AND a.fecha <= $2::date${filtro}
        ORDER BY a.fecha, a.id, l.id`,
      params
    );

    const filas = rows.map((r) => ({
      fecha: r.fecha,
      asiento_id: r.asiento_id,
      tipo: r.tipo,
      referencia: r.referencia_id
        ? `${r.referencia_tipo || '—'}#${r.referencia_id}`
        : (r.referencia_tipo || '—'),
      cuenta: `${r.codigo} · ${r.cuenta_nombre}`,
      detalle: r.detalle || r.asiento_descripcion,
      debe: num(r.debe),
      haber: num(r.haber),
    }));

    const totalDebe = round2(filas.reduce((a, f) => a + f.debe, 0));
    const totalHaber = round2(filas.reduce((a, f) => a + f.haber, 0));
    return {
      titulo: this.titulo,
      columnas: [
        COL_FECHA('fecha', 'Fecha'), COL_ENTERO('asiento_id', 'N° asiento', 0.7),
        COL_TEXTO('tipo', 'Tipo', 0.9), COL_TEXTO('referencia', 'Referencia', 1.2),
        COL_TEXTO('cuenta', 'Cuenta', 2.2), COL_TEXTO('detalle', 'Detalle', 2.2),
        COL_MONEDA('debe', 'Debe'), COL_MONEDA('haber', 'Haber'),
      ],
      filas,
      resumen: {
        'Asientos distintos': String(new Set(filas.map((f) => f.asiento_id)).size),
        'Líneas': String(filas.length),
        'Total debe': m(totalDebe),
        'Total haber': m(totalHaber),
        'Cuadra': Math.abs(totalDebe - totalHaber) <= 0.02 ? 'Sí' : 'No',
      },
      subtitulo: subtituloRango('Libro Diario', { desde, hasta }),
      nombreArchivo: `libro-diario_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 13) LIBRO MAYOR (saldo por cuenta)
// =============================================================================
REPORTES['libro-mayor'] = {
  titulo: 'Libro Mayor',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p }, 30);
    const params = [desde, hasta];
    let filtro = '';
    if (p.cuenta) { params.push(String(p.cuenta)); filtro = ` AND l.cuenta_contable = $${params.length}`; }

    const { rows } = await db.query(
      `SELECT l.cuenta_contable AS codigo,
              COALESCE(cc.nombre, l.cuenta_contable) AS nombre,
              COALESCE(cc.tipo, 'otro') AS tipo,
              COUNT(*)::int AS movimientos,
              COALESCE(SUM(l.debe),0)  AS debe,
              COALESCE(SUM(l.haber),0) AS haber
         FROM conta_asiento_lineas l
         JOIN conta_asientos_contables a ON a.id = l.asiento_id
         LEFT JOIN conta_cuentas_contables cc ON cc.codigo = l.cuenta_contable
        WHERE a.estado = 'registrado'
          AND a.fecha >= $1::date AND a.fecha <= $2::date${filtro}
        GROUP BY 1,2,3
        ORDER BY l.cuenta_contable`,
      params
    );

    const filas = rows.map((r) => {
      const debe = round2(num(r.debe));
      const haber = round2(num(r.haber));
      const deudora = ['activo', 'costo', 'gasto'].includes(r.tipo);
      return { ...r, debe, haber, saldo: round2(deudora ? debe - haber : haber - debe) };
    });

    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('codigo', 'Código', 0.8), COL_TEXTO('nombre', 'Cuenta', 2),
        COL_TEXTO('tipo', 'Tipo', 1), COL_ENTERO('movimientos', 'Movimientos', 0.9),
        COL_MONEDA('debe', 'Debe'), COL_MONEDA('haber', 'Haber'), COL_MONEDA('saldo', 'Saldo'),
      ],
      filas,
      resumen: {
        'Cuentas con movimiento': String(filas.length),
        'Total debe': m(filas.reduce((a, f) => a + f.debe, 0)),
        'Total haber': m(filas.reduce((a, f) => a + f.haber, 0)),
      },
      subtitulo: subtituloRango('Libro Mayor', { desde, hasta }),
      nombreArchivo: `libro-mayor_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 14) BALANCE GENERAL
// =============================================================================
REPORTES['balance-general'] = {
  titulo: 'Balance General',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const fecha = String(p.fecha || fechaISO());
    const saldos = await saldosPorCuenta(db, { hasta: fecha });

    const conSaldo = (tipo) => saldos.filter((s) => s.tipo === tipo && Math.abs(s.saldo) > 0.009);
    const activo = conSaldo('activo');
    const pasivo = conSaldo('pasivo');
    const patrimonio = conSaldo('patrimonio');
    const totalIngresos = round2(saldos.filter((s) => s.tipo === 'ingreso').reduce((a, s) => a + s.saldo, 0));
    const totalCostos = round2(saldos.filter((s) => s.tipo === 'costo').reduce((a, s) => a + s.saldo, 0));
    const totalGastos = round2(saldos.filter((s) => s.tipo === 'gasto').reduce((a, s) => a + s.saldo, 0));
    const resultadoEjercicio = round2(totalIngresos - totalCostos - totalGastos);

    const filas = [
      ...activo.map((s) => ({ grupo: 'ACTIVO', codigo: s.codigo, cuenta: s.nombre, saldo: s.saldo })),
      ...pasivo.map((s) => ({ grupo: 'PASIVO', codigo: s.codigo, cuenta: s.nombre, saldo: s.saldo })),
      ...patrimonio.map((s) => ({ grupo: 'PATRIMONIO', codigo: s.codigo, cuenta: s.nombre, saldo: s.saldo })),
    ];
    if (Math.abs(resultadoEjercicio) > 0.009) {
      filas.push({
        grupo: 'PATRIMONIO', codigo: '—',
        cuenta: 'Resultado del ejercicio (no distribuido)', saldo: resultadoEjercicio,
      });
    }

    const totalActivo = round2(activo.reduce((a, s) => a + s.saldo, 0));
    const totalPasivo = round2(pasivo.reduce((a, s) => a + s.saldo, 0));
    const totalPatrimonio = round2(patrimonio.reduce((a, s) => a + s.saldo, 0) + resultadoEjercicio);

    return {
      titulo: `${this.titulo} — al ${fecha}`,
      columnas: [
        COL_TEXTO('grupo', 'Grupo', 1), COL_TEXTO('codigo', 'Código', 0.8),
        COL_TEXTO('cuenta', 'Cuenta', 2.4), COL_MONEDA('saldo', 'Saldo'),
      ],
      filas,
      resumen: {
        'Total activo': m(totalActivo),
        'Total pasivo': m(totalPasivo),
        'Total patrimonio': m(totalPatrimonio),
        'Resultado del ejercicio': m(resultadoEjercicio),
        'Pasivo + patrimonio': m(totalPasivo + totalPatrimonio),
        'Cuadra': Math.abs(totalActivo - (totalPasivo + totalPatrimonio)) <= 0.02 ? 'Sí' : 'No',
      },
      subtitulo: `Balance General al ${fecha} (America/La_Paz)`,
      nombreArchivo: `balance-general_${fecha}`,
    };
  },
};

// =============================================================================
// 15) ESTADO DE RESULTADOS
// =============================================================================
REPORTES['estado-resultados'] = {
  titulo: 'Estado de Resultados',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const hasta = String(p.hasta || fechaISO());
    const desde = String(p.desde || `${hasta.slice(0, 4)}-01-01`);
    const saldos = await saldosPorCuenta(db, { desde, hasta });

    const grupo = (tipo, etiqueta) => saldos
      .filter((s) => s.tipo === tipo && Math.abs(s.saldo) > 0.009)
      .map((s) => ({ grupo: etiqueta, codigo: s.codigo, cuenta: s.nombre, saldo: s.saldo }));

    const filas = [
      ...grupo('ingreso', 'INGRESO'),
      ...grupo('costo', 'COSTO'),
      ...grupo('gasto', 'GASTO'),
    ];

    const totalIngresos = round2(saldos.filter((s) => s.tipo === 'ingreso').reduce((a, s) => a + s.saldo, 0));
    const totalCostos = round2(saldos.filter((s) => s.tipo === 'costo').reduce((a, s) => a + s.saldo, 0));
    const totalGastos = round2(saldos.filter((s) => s.tipo === 'gasto').reduce((a, s) => a + s.saldo, 0));
    const utilidadBruta = round2(totalIngresos - totalCostos);
    const resultadoNeto = round2(utilidadBruta - totalGastos);

    return {
      titulo: `${this.titulo} — ${desde} a ${hasta}`,
      columnas: [
        COL_TEXTO('grupo', 'Grupo', 1), COL_TEXTO('codigo', 'Código', 0.8),
        COL_TEXTO('cuenta', 'Cuenta', 2.4), COL_MONEDA('saldo', 'Importe'),
      ],
      filas,
      resumen: {
        'Total ingresos': m(totalIngresos),
        'Total costos': m(totalCostos),
        'Utilidad bruta': m(utilidadBruta),
        'Total gastos': m(totalGastos),
        'Resultado neto': m(resultadoNeto),
        'Margen (%)': totalIngresos > 0 ? `${round2((resultadoNeto / totalIngresos) * 100)} %` : '—',
      },
      subtitulo: `Estado de Resultados · ${desde} a ${hasta} (America/La_Paz)`,
      nombreArchivo: `estado-resultados_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 16) ANTIGÜEDAD DE CUENTAS POR COBRAR / PAGAR (30/60/90)
// =============================================================================
REPORTES['antiguedad'] = {
  titulo: 'Antigüedad de cuentas por cobrar / pagar',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const esCxc = String(p.tipo || 'cxc').toLowerCase() !== 'cxp';
    const tabla = esCxc ? 'conta_cuentas_cobrar' : 'conta_cuentas_pagar';
    const join = esCxc ? '' : 'LEFT JOIN conta_proveedores pr ON pr.id = t.proveedor_id';
    const entidad = esCxc
      ? `COALESCE(NULLIF(t.cliente_nombre, ''), '—')`
      : `COALESCE(pr.nombre, '—')`;
    const nit = esCxc ? 't.cliente_nit' : 'pr.nit';

    const params = [];
    let filtro = ` AND t.estado <> 'anulada'`;
    if (String(p.incluir_pagadas) !== 'true') filtro += ` AND t.saldo > 0`;

    const { rows } = await db.query(
      `SELECT ${entidad} AS entidad, ${nit} AS nit,
              COUNT(*)::int AS documentos,
              COALESCE(SUM(t.monto),0)        AS monto,
              COALESCE(SUM(t.monto_pagado),0) AS pagado,
              COALESCE(SUM(t.saldo),0)        AS saldo,
              COALESCE(SUM(t.saldo) FILTER (
                WHERE t.vencimiento IS NULL OR t.vencimiento >= CURRENT_DATE),0) AS corriente,
              COALESCE(SUM(t.saldo) FILTER (
                WHERE t.vencimiento < CURRENT_DATE
                  AND t.vencimiento >= CURRENT_DATE - INTERVAL '30 days'),0) AS d1_30,
              COALESCE(SUM(t.saldo) FILTER (
                WHERE t.vencimiento < CURRENT_DATE - INTERVAL '30 days'
                  AND t.vencimiento >= CURRENT_DATE - INTERVAL '60 days'),0) AS d31_60,
              COALESCE(SUM(t.saldo) FILTER (
                WHERE t.vencimiento < CURRENT_DATE - INTERVAL '60 days'
                  AND t.vencimiento >= CURRENT_DATE - INTERVAL '90 days'),0) AS d61_90,
              COALESCE(SUM(t.saldo) FILTER (
                WHERE t.vencimiento < CURRENT_DATE - INTERVAL '90 days'),0) AS mas_90
         FROM ${tabla} t
         ${join}
        WHERE 1=1${filtro}
        GROUP BY 1,2
        ORDER BY saldo DESC`,
      params
    );

    const filas = rows.map((r) => ({
      ...r,
      monto: num(r.monto), pagado: num(r.pagado), saldo: num(r.saldo),
      corriente: num(r.corriente), d1_30: num(r.d1_30), d31_60: num(r.d31_60),
      d61_90: num(r.d61_90), mas_90: num(r.mas_90),
    }));
    const suma = (k) => round2(filas.reduce((a, f) => a + f[k], 0));
    const vencido = round2(suma('d1_30') + suma('d31_60') + suma('d61_90') + suma('mas_90'));

    return {
      titulo: `${this.titulo} — ${esCxc ? 'por cobrar (clientes)' : 'por pagar (proveedores)'}`,
      columnas: [
        COL_TEXTO('entidad', esCxc ? 'Cliente' : 'Proveedor', 2), COL_TEXTO('nit', 'NIT', 1),
        COL_ENTERO('documentos', 'Docs.', 0.6), COL_MONEDA('monto', 'Monto'),
        COL_MONEDA('pagado', 'Pagado'), COL_MONEDA('saldo', 'Saldo'),
        COL_MONEDA('corriente', 'Corriente'), COL_MONEDA('d1_30', '1-30 d'),
        COL_MONEDA('d31_60', '31-60 d'), COL_MONEDA('d61_90', '61-90 d'),
        COL_MONEDA('mas_90', '+90 d'),
      ],
      filas,
      resumen: {
        'Tipo': esCxc ? 'Cuentas por cobrar' : 'Cuentas por pagar',
        'Entidades': String(filas.length),
        'Documentos': String(filas.reduce((a, f) => a + num(f.documentos), 0)),
        'Saldo total': m(suma('saldo')),
        'Corriente': m(suma('corriente')),
        'Vencido': m(vencido),
        '1-30 días': m(suma('d1_30')),
        '31-60 días': m(suma('d31_60')),
        '61-90 días': m(suma('d61_90')),
        'Más de 90 días': m(suma('mas_90')),
      },
      subtitulo: `Antigüedad ${esCxc ? 'CxC' : 'CxP'} al ${fechaISO()} (America/La_Paz)`,
      nombreArchivo: `antiguedad-${esCxc ? 'cxc' : 'cxp'}_${fechaISO()}`,
    };
  },
};

// =============================================================================
// 17) KARDEX + VALORIZACIÓN DE INVENTARIO
// =============================================================================
REPORTES['kardex'] = {
  titulo: 'Kardex y valorización de inventario',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p }, 30);
    const params = [desde, hasta];
    let filtro = '';
    if (p.producto_id) { params.push(Number(p.producto_id)); filtro = ` AND k.producto_id = $${params.length}`; }

    const { rows } = await db.query(
      `SELECT k.creado_en, k.tipo, pr.nombre AS producto, k.cantidad, k.costo_unitario,
              k.saldo_cantidad, k.saldo_valor, k.referencia_tipo, k.referencia_id
         FROM conta_kardex k
         JOIN conta_productos pr ON pr.id = k.producto_id
        WHERE (k.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (k.creado_en AT TIME ZONE '${TZ}')::date <= $2::date${filtro}
        ORDER BY k.creado_en DESC, k.id DESC`,
      params
    );

    // Valorización: último saldo snapshot por producto (nunca se recalcula).
    const { rows: valor } = await db.query(
      `SELECT pr.nombre AS producto, u.saldo_cantidad, u.saldo_valor, u.costo_unitario
         FROM (
           SELECT DISTINCT ON (producto_id) producto_id, saldo_cantidad, saldo_valor, costo_unitario
             FROM conta_kardex
            ORDER BY producto_id, id DESC
         ) u
         JOIN conta_productos pr ON pr.id = u.producto_id
        ORDER BY u.saldo_valor DESC`
    );

    const filas = rows.map((r) => ({
      ...r,
      cantidad: num(r.cantidad), costo_unitario: num(r.costo_unitario),
      saldo_cantidad: num(r.saldo_cantidad), saldo_valor: num(r.saldo_valor),
      referencia: r.referencia_id ? `${r.referencia_tipo || '—'}#${r.referencia_id}` : (r.referencia_tipo || '—'),
    }));

    return {
      titulo: this.titulo,
      columnas: [
        COL_FECHA_HORA('creado_en', 'Fecha', 1.3), COL_TEXTO('producto', 'Producto', 1.8),
        COL_TEXTO('tipo', 'Mov.', 0.7), COL_TEXTO('referencia', 'Referencia', 1),
        COL_MONEDA('cantidad', 'Cantidad', 0.8), COL_MONEDA('costo_unitario', 'Costo unit.'),
        COL_MONEDA('saldo_cantidad', 'Saldo cant.', 0.9), COL_MONEDA('saldo_valor', 'Saldo valor'),
      ],
      filas,
      resumen: {
        'Movimientos': String(filas.length),
        'Productos en inventario': String(valor.length),
        'Valor total del inventario': m(valor.reduce((a, r) => a + num(r.saldo_valor), 0)),
        ...Object.fromEntries(valor.slice(0, 10).map((r) => [
          r.producto, `${num(r.saldo_cantidad)} u · ${m(r.saldo_valor)}`,
        ])),
      },
      subtitulo: subtituloRango('Kardex y valorización de inventario', { desde, hasta }),
      nombreArchivo: `kardex_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 18) ACTIVOS FIJOS Y DEPRECIACIÓN
// =============================================================================
REPORTES['activos-fijos'] = {
  titulo: 'Activos fijos y depreciación',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const params = [];
    let filtro = '';
    if (String(p.incluir_baja) !== 'true') filtro = ` AND a.estado = 'activo'`;

    const { rows } = await db.query(
      `SELECT a.nombre, a.tipo, a.marca, a.modelo, a.numero_serie, a.fecha_adquisicion,
              a.costo, a.vida_util_meses, a.valor_residual, a.depreciacion_acumulada,
              a.valor_libro, a.estado,
              COUNT(d.id)::int AS meses_depreciados,
              COALESCE(MAX(d.periodo), '—') AS ultimo_periodo
         FROM conta_activos_fijos a
         LEFT JOIN conta_depreciaciones d ON d.activo_id = a.id
        WHERE 1=1${filtro}
        GROUP BY a.id, a.nombre, a.tipo, a.marca, a.modelo, a.numero_serie,
                 a.fecha_adquisicion, a.costo, a.vida_util_meses, a.valor_residual,
                 a.depreciacion_acumulada, a.valor_libro, a.estado
        ORDER BY a.nombre`,
      params
    );

    const filas = rows.map((r) => {
      const costo = num(r.costo);
      const residual = num(r.valor_residual);
      const vida = Number(r.vida_util_meses) || 0;
      return {
        ...r,
        costo, valor_residual: residual,
        depreciacion_acumulada: num(r.depreciacion_acumulada),
        valor_libro: num(r.valor_libro),
        cuota_mensual: vida > 0 ? round2((costo - residual) / vida) : 0,
      };
    });

    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('nombre', 'Activo', 2), COL_TEXTO('tipo', 'Tipo', 1),
        COL_TEXTO('marca', 'Marca', 1), COL_TEXTO('modelo', 'Modelo', 1),
        COL_FECHA('fecha_adquisicion', 'Adquisición', 1.1),
        COL_MONEDA('costo', 'Costo'), COL_ENTERO('vida_util_meses', 'Vida (meses)', 0.9),
        COL_MONEDA('depreciacion_acumulada', 'Dep. acum.'),
        COL_MONEDA('valor_libro', 'Valor libro'), COL_MONEDA('cuota_mensual', 'Cuota mensual'),
        COL_ENTERO('meses_depreciados', 'Meses dep.', 0.8),
        COL_TEXTO('ultimo_periodo', 'Último período', 1),
      ],
      filas,
      resumen: {
        'Activos listados': String(filas.length),
        'Costo total': m(filas.reduce((a, f) => a + f.costo, 0)),
        'Depreciación acumulada': m(filas.reduce((a, f) => a + f.depreciacion_acumulada, 0)),
        'Valor en libros': m(filas.reduce((a, f) => a + f.valor_libro, 0)),
        'Cuota mensual total': m(filas.reduce((a, f) => a + f.cuota_mensual, 0)),
      },
      subtitulo: `Activos fijos al ${fechaISO()} (America/La_Paz)`,
      nombreArchivo: `activos-fijos_${fechaISO()}`,
    };
  },
};

// =============================================================================
// 19) NÓMINA POR PERÍODO
// =============================================================================
REPORTES['nomina'] = {
  titulo: 'Nómina por período',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p }, 90);
    const params = [desde, hasta];
    let filtro = '';
    if (p.estado) { params.push(String(p.estado)); filtro += ` AND n.estado = $${params.length}`; }
    if (p.usuario_id) { params.push(Number(p.usuario_id)); filtro += ` AND n.usuario_id = $${params.length}`; }

    const { rows } = await db.query(
      `SELECT n.id, n.periodo_desde, n.periodo_hasta, n.estado,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS empleado,
              u.carnet, u.rol,
              n.sueldo_base, n.bonos, n.propinas_incluidas, n.descuentos, n.adelantos, n.total_pagar,
              n.pagado_en
         FROM conta_nomina n
         LEFT JOIN usuarios u ON u.id = n.usuario_id
        WHERE n.periodo_desde >= $1::date AND n.periodo_hasta <= $2::date${filtro}
        ORDER BY n.periodo_desde DESC, empleado`,
      params
    );

    const filas = rows.map((r) => ({
      ...r,
      periodo: `${r.periodo_desde ? String(r.periodo_desde).slice(0, 10) : '—'} → ${r.periodo_hasta ? String(r.periodo_hasta).slice(0, 10) : '—'}`,
      sueldo_base: num(r.sueldo_base), bonos: num(r.bonos),
      propinas_incluidas: num(r.propinas_incluidas), descuentos: num(r.descuentos),
      adelantos: num(r.adelantos), total_pagar: num(r.total_pagar),
    }));
    const suma = (k) => round2(filas.reduce((a, f) => a + f[k], 0));

    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('empleado', 'Empleado', 1.8), COL_TEXTO('carnet', 'Carnet', 1),
        COL_TEXTO('rol', 'Rol', 0.9), COL_TEXTO('periodo', 'Período', 1.8),
        COL_TEXTO('estado', 'Estado', 0.9),
        COL_MONEDA('sueldo_base', 'Sueldo base'), COL_MONEDA('bonos', 'Bonos'),
        COL_MONEDA('propinas_incluidas', 'Propinas'), COL_MONEDA('descuentos', 'Descuentos'),
        COL_MONEDA('adelantos', 'Adelantos'), COL_MONEDA('total_pagar', 'Total a pagar'),
        COL_FECHA_HORA('pagado_en', 'Pagado', 1.2),
      ],
      filas,
      resumen: {
        'Recibos': String(filas.length),
        'Empleados': String(new Set(filas.map((f) => f.carnet)).size),
        'Sueldos base': m(suma('sueldo_base')),
        'Bonos': m(suma('bonos')),
        'Propinas incluidas': m(suma('propinas_incluidas')),
        'Descuentos': m(suma('descuentos')),
        'Adelantos descontados': m(suma('adelantos')),
        'Total a pagar': m(suma('total_pagar')),
      },
      subtitulo: subtituloRango('Nómina por período', { desde, hasta }),
      nombreArchivo: `nomina_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 20) ANTICIPOS (pendientes / aplicados / devueltos / vencidos)
// =============================================================================
REPORTES['anticipos'] = {
  titulo: 'Anticipos de clientes',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta } = rango({ query: p }, 90);
    const params = [desde, hasta];
    let filtro = '';
    if (p.estado) { params.push(String(p.estado)); filtro += ` AND a.estado = $${params.length}`; }
    if (String(p.solo_vencidos) === 'true') {
      filtro += ` AND a.estado = 'pendiente' AND a.vencimiento IS NOT NULL AND a.vencimiento < CURRENT_DATE`;
    }

    const { rows } = await db.query(
      `SELECT a.creado_en, COALESCE(NULLIF(a.cliente_nombre,''), '—') AS cliente, a.cliente_nit,
              a.monto, a.monto_aplicado, a.saldo, a.moneda, a.estado, a.vencimiento,
              mp.nombre AS metodo, COALESCE(cd.nombre, '—') AS cuenta,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS creado_por_nombre,
              (SELECT COUNT(*)::int FROM conta_anticipo_aplicaciones ap WHERE ap.anticipo_id = a.id) AS n_aplicaciones
         FROM conta_anticipos a
         LEFT JOIN conta_metodos_pago mp ON mp.id = a.metodo_pago_id
         LEFT JOIN conta_cuentas_destino cd ON cd.id = a.cuenta_destino_id
         LEFT JOIN usuarios u ON u.id = a.creado_por
        WHERE (a.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (a.creado_en AT TIME ZONE '${TZ}')::date <= $2::date${filtro}
        ORDER BY a.creado_en DESC`,
      params
    );

    const filas = rows.map((r) => {
      const dias = r.vencimiento
        ? Math.round((new Date(r.vencimiento).getTime() - Date.now()) / 86400000)
        : null;
      return {
        ...r,
        monto: num(r.monto), monto_aplicado: num(r.monto_aplicado), saldo: num(r.saldo),
        dias_para_vencer: dias,
      };
    });
    const porEstado = (e) => round2(filas.filter((f) => f.estado === e).reduce((a, f) => a + f.saldo, 0));

    return {
      titulo: this.titulo,
      columnas: [
        COL_FECHA_HORA('creado_en', 'Registrado', 1.3),
        COL_TEXTO('cliente', 'Cliente', 1.8), COL_TEXTO('cliente_nit', 'NIT', 1),
        COL_MONEDA('monto', 'Monto'), COL_MONEDA('monto_aplicado', 'Aplicado'),
        COL_MONEDA('saldo', 'Saldo'), COL_TEXTO('moneda', 'Mon.', 0.5),
        COL_TEXTO('metodo', 'Método', 1), COL_TEXTO('cuenta', 'Cuenta destino', 1.4),
        COL_TEXTO('estado', 'Estado', 0.9), COL_FECHA('vencimiento', 'Vence', 1),
        COL_ENTERO('dias_para_vencer', 'Días', 0.6),
        COL_ENTERO('n_aplicaciones', 'Aplic.', 0.6),
        COL_TEXTO('creado_por_nombre', 'Registrado por', 1.4),
      ],
      filas,
      resumen: {
        'Anticipos': String(filas.length),
        'Monto total': m(filas.reduce((a, f) => a + f.monto, 0)),
        'Aplicado': m(filas.reduce((a, f) => a + f.monto_aplicado, 0)),
        'Saldo pendiente': m(filas.reduce((a, f) => a + f.saldo, 0)),
        'Pendientes': m(porEstado('pendiente')),
        'Aplicados': m(porEstado('aplicado')),
        'Devueltos': m(porEstado('devuelto')),
        'Vencidos': m(porEstado('vencido')),
      },
      subtitulo: subtituloRango('Anticipos de clientes', { desde, hasta }),
      nombreArchivo: `anticipos_${desde}_${hasta}`,
    };
  },
};

// =============================================================================
// 21) COMPARATIVO FACTURADO vs NO FACTURADO (cumplimiento fiscal Bolivia)
//     Permite ver cuánto de la venta se está facturando, por cajero, producto,
//     sucursal y período. Sale 100% de los snapshots de la venta.
// =============================================================================
REPORTES['facturado-vs-no'] = {
  titulo: 'Comparativo facturado vs no facturado',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const { desde, hasta, periodo } = rangoPeriodo(p, 30);
    const rangoFecha = `(v.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
                        AND (v.creado_en AT TIME ZONE '${TZ}')::date <= $2::date`;

    const { rows } = await db.query(
      `SELECT v.tipo_operacion,
              COUNT(*)::int AS n_ventas,
              COALESCE(SUM(v.total_final),0)        AS total,
              COALESCE(SUM(v.base_imponible_iva),0) AS base_iva,
              COALESCE(SUM(v.iva_total),0)          AS iva_total,
              COALESCE(SUM(v.it_total),0)           AS it_total
         FROM conta_ventas v
        WHERE v.anulada = false AND ${rangoFecha}
        GROUP BY 1 ORDER BY 3 DESC`,
      [desde, hasta]
    );

    const { rows: porCajero } = await db.query(
      `SELECT COALESCE(v.cajero_nombre_snapshot,'—') AS cajero,
              COUNT(*) FILTER (WHERE v.tipo_operacion = 'facturado')::int AS facturadas,
              COUNT(*) FILTER (WHERE v.tipo_operacion <> 'facturado')::int AS no_facturadas,
              COALESCE(SUM(v.total_final),0) AS total,
              COALESCE(SUM(v.total_final) FILTER (WHERE v.tipo_operacion = 'facturado'),0) AS total_facturado
         FROM conta_ventas v
        WHERE v.anulada = false AND ${rangoFecha}
        GROUP BY 1 ORDER BY 4 DESC LIMIT 50`,
      [desde, hasta]
    );

    const { rows: porProducto } = await db.query(
      `SELECT i.nombre_snapshot AS producto,
              COALESCE(i.producto_tipo_snapshot, 'otro') AS tipo,
              COUNT(*)::int AS n_lineas,
              COALESCE(SUM(i.precio_final),0) AS total,
              COALESCE(SUM(i.precio_final) FILTER (WHERE i.tipo_operacion_snapshot = 'facturado'),0)
                AS total_facturado
         FROM conta_venta_items i
         JOIN conta_ventas v ON v.id = i.venta_id AND v.anulada = false
        WHERE ${rangoFecha}
        GROUP BY 1,2 ORDER BY 4 DESC LIMIT 50`,
      [desde, hasta]
    );

    const { rows: porSucursal } = await db.query(
      `SELECT COALESCE(s.nombre, 'Sucursal ' || COALESCE(v.sucursal_id::text,'—')) AS sucursal,
              COUNT(*) FILTER (WHERE v.tipo_operacion = 'facturado')::int AS facturadas,
              COUNT(*) FILTER (WHERE v.tipo_operacion <> 'facturado')::int AS no_facturadas,
              COALESCE(SUM(v.total_final),0) AS total,
              COALESCE(SUM(v.total_final) FILTER (WHERE v.tipo_operacion = 'facturado'),0) AS total_facturado
         FROM conta_ventas v
         LEFT JOIN conta_sucursales s ON s.id = v.sucursal_id
        WHERE v.anulada = false AND ${rangoFecha}
        GROUP BY 1 ORDER BY 4 DESC`,
      [desde, hasta]
    );

    const { rows: porPeriodo } = await db.query(
      `SELECT to_char(date_trunc('month', (v.creado_en AT TIME ZONE '${TZ}')), 'YYYY-MM') AS periodo,
              COUNT(*) FILTER (WHERE v.tipo_operacion = 'facturado')::int AS facturadas,
              COUNT(*) FILTER (WHERE v.tipo_operacion <> 'facturado')::int AS no_facturadas,
              COALESCE(SUM(v.total_final),0) AS total,
              COALESCE(SUM(v.total_final) FILTER (WHERE v.tipo_operacion = 'facturado'),0) AS total_facturado
         FROM conta_ventas v
        WHERE v.anulada = false AND ${rangoFecha}
        GROUP BY 1 ORDER BY 1 DESC`,
      [desde, hasta]
    );

    const nFact = rows.filter((r) => r.tipo_operacion === 'facturado')
      .reduce((a, r) => a + num(r.n_ventas), 0);
    const nNoFact = rows.filter((r) => r.tipo_operacion !== 'facturado')
      .reduce((a, r) => a + num(r.n_ventas), 0);
    const nTotal = nFact + nNoFact;
    const totalFacturado = round2(rows.filter((r) => r.tipo_operacion === 'facturado')
      .reduce((a, r) => a + num(r.total), 0));
    const totalGeneral = round2(rows.reduce((a, r) => a + num(r.total), 0));

    const filas = rows.map((r) => ({
      tipo_operacion: r.tipo_operacion,
      n_ventas: r.n_ventas,
      total: num(r.total),
      base_iva: num(r.base_iva),
      iva_total: num(r.iva_total),
      it_total: num(r.it_total),
      pct_ventas: nTotal > 0 ? round2((num(r.n_ventas) / nTotal) * 100) : 0,
      pct_monto: totalGeneral > 0 ? round2((num(r.total) / totalGeneral) * 100) : 0,
    }));

    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('tipo_operacion', 'Tipo de operación', 1.2),
        COL_ENTERO('n_ventas', 'Ventas', 0.7),
        COL_MONEDA('total', 'Monto total'),
        COL_MONEDA('base_iva', 'Base IVA'), COL_MONEDA('iva_total', 'IVA'),
        COL_MONEDA('it_total', 'IT'),
        COL_MONEDA('pct_ventas', '% ventas', 0.8),
        COL_MONEDA('pct_monto', '% monto', 0.8),
      ],
      filas,
      por_cajero: porCajero.map((r) => ({
        cajero: r.cajero, facturadas: r.facturadas, no_facturadas: r.no_facturadas,
        total: num(r.total), total_facturado: num(r.total_facturado),
        pct_facturado: num(r.total) > 0 ? round2((num(r.total_facturado) / num(r.total)) * 100) : 0,
      })),
      por_producto: porProducto.map((r) => ({
        producto: r.producto, tipo: r.tipo, n_lineas: r.n_lineas,
        total: num(r.total), total_facturado: num(r.total_facturado),
        pct_facturado: num(r.total) > 0 ? round2((num(r.total_facturado) / num(r.total)) * 100) : 0,
      })),
      por_sucursal: porSucursal.map((r) => ({
        sucursal: r.sucursal, facturadas: r.facturadas, no_facturadas: r.no_facturadas,
        total: num(r.total), total_facturado: num(r.total_facturado),
        pct_facturado: num(r.total) > 0 ? round2((num(r.total_facturado) / num(r.total)) * 100) : 0,
      })),
      por_periodo: porPeriodo.map((r) => ({
        periodo: r.periodo, facturadas: r.facturadas, no_facturadas: r.no_facturadas,
        total: num(r.total), total_facturado: num(r.total_facturado),
        pct_facturado: num(r.total) > 0 ? round2((num(r.total_facturado) / num(r.total)) * 100) : 0,
      })),
      resumen: {
        'Ventas totales': String(nTotal),
        Facturadas: String(nFact),
        'No facturadas': String(nNoFact),
        '% de ventas facturadas': nTotal > 0 ? `${round2((nFact / nTotal) * 100)}%` : '0%',
        '% del monto facturado': totalGeneral > 0
          ? `${round2((totalFacturado / totalGeneral) * 100)}%` : '0%',
        'Monto facturado': m(totalFacturado),
        'Monto no facturado': m(round2(totalGeneral - totalFacturado)),
        'Monto total': m(totalGeneral),
        Nota: 'El IT se calcula sobre TODAS las ventas; el IVA solo sobre las facturadas.',
      },
      subtitulo: periodo
        ? `Comparativo facturado vs no facturado · ${periodo} (America/La_Paz)`
        : subtituloRango('Comparativo facturado vs no facturado', { desde, hasta }),
      nombreArchivo: `facturado-vs-no_${periodo || `${desde}_${hasta}`}`,
    };
  },
};

// =============================================================================
// 22) RÉGIMEN SIETE-RG — bimestres del año vs límite anual (Bs 400.000)
//     IVA + IT + IUE unificados al 5% bimestral.
// =============================================================================
REPORTES['siete-rg'] = {
  titulo: 'Régimen SIETE-RG — acumulado anual',
  roles: [...FINANZAS],
  async ejecutar(db, p) {
    const anio = Number((p && p.anio) || fechaISO().slice(0, 4));
    const { rows: cfg } = await db.query(
      `SELECT valor FROM conta_configuracion WHERE clave IN ('siete_rg_limite_anual','siete_rg_pct','regimen')`
    );
    const cfgMap = {};
    for (const r of cfg) cfgMap[r.clave] = r.valor;
    const limite = num(cfgMap.siete_rg_limite_anual, 400000);
    const pct = num(cfgMap.siete_rg_pct, 5);
    const regimen = String(cfgMap.regimen || 'general');

    const { rows } = await db.query(
      `SELECT to_char(date_trunc('month', (v.creado_en AT TIME ZONE '${TZ}')), 'YYYY-MM') AS periodo,
              COUNT(*)::int AS n_ventas,
              COALESCE(SUM(v.total_final),0)  AS total,
              COALESCE(SUM(v.iue_retenido),0) AS unificado
         FROM conta_ventas v
        WHERE v.anulada = false
          AND v.tipo_operacion <> 'cortesia'
          AND EXTRACT(YEAR FROM (v.creado_en AT TIME ZONE '${TZ}')) = $1
        GROUP BY 1 ORDER BY 1`,
      [anio]
    );

    const filas = rows.map((r) => ({
      periodo: r.periodo, n_ventas: r.n_ventas, total: num(r.total),
      unificado_5: num(r.unificado),
    }));
    const acumulado = round2(filas.reduce((a, f) => a + f.total, 0));
    const unificadoAnual = round2(filas.reduce((a, f) => a + f.unificado_5, 0));
    const pctUso = limite > 0 ? round2((acumulado / limite) * 100) : 0;

    // Bimestres (el SIETE-RG se declara cada 2 meses).
    const bimestres = [];
    for (let b = 0; b < 6; b += 1) {
      const meses = [`${anio}-${String(b * 2 + 1).padStart(2, '0')}`,
        `${anio}-${String(b * 2 + 2).padStart(2, '0')}`];
      const totalBim = round2(filas.filter((f) => meses.includes(f.periodo))
        .reduce((a, f) => a + f.total, 0));
      bimestres.push({
        bimestre: `${b + 1}º bimestre`,
        meses: meses.join(' a '),
        total: totalBim,
        a_pagar: round2((totalBim * pct) / 100),
      });
    }

    const alerta = pctUso >= 90
      ? (pctUso >= 100
        ? 'ALERTA: se superó el límite anual del SIETE-RG. Debe migrar al régimen general.'
        : 'ATENCIÓN: ya se consumió el 90% o más del límite anual del SIETE-RG.')
      : null;

    return {
      titulo: this.titulo,
      columnas: [
        COL_TEXTO('periodo', 'Período', 0.9),
        COL_ENTERO('n_ventas', 'Ventas', 0.7),
        COL_MONEDA('total', 'Venta del mes'),
        COL_MONEDA('unificado_5', `Unificado ${pct}%`),
      ],
      filas,
      bimestres,
      resumen: {
        Año: String(anio),
        'Régimen configurado': regimen,
        [`Alícuota unificada (${pct}%)`]: 'Sobre el total vendido del bimestre',
        'Acumulado anual': m(acumulado),
        'Límite anual SIETE-RG': m(limite),
        '% del límite consumido': `${pctUso}%`,
        'Unificado registrado': m(unificadoAnual),
        ...(alerta ? { '⚠ Alerta': alerta } : {}),
      },
      subtitulo: `Régimen SIETE-RG · año ${anio} · ${pctUso}% del límite consumido (America/La_Paz)`,
      nombreArchivo: `siete-rg_${anio}`,
    };
  },
};

// =============================================================================
// Rutas
// =============================================================================
function permitido(rol, roles) {
  if (!roles) return true;
  return roles.includes(rol) || (roles.includes('admin') && rol === 'desarrollador');
}

reportesRouter.get('/', requireAuth, (_req, res) => {
  res.json({
    reportes: Object.entries(REPORTES).map(([clave, r]) => ({ clave, titulo: r.titulo })),
  });
});

// Exportación (debe declararse antes de /:tipo)
reportesRouter.get('/:tipo/export', requireAuth, async (req, res) => {
  try {
    const def = REPORTES[req.params.tipo];
    if (!def) return res.status(404).json({ error: 'Reporte no encontrado' });
    if (!permitido(req.user.rol, def.roles)) {
      return res.status(403).json({ error: 'No tienes permiso para exportar este reporte' });
    }
    const formato = String(req.query.formato || 'pdf').toLowerCase() === 'xlsx' ? 'xlsx' : 'pdf';
    const data = await def.ejecutar(db, req.query, req.user);
    const contenido = formato === 'pdf'
      ? await generarPdf(data)
      : generarExcel(data);
    enviarArchivo(res, {
      formato,
      nombre: data.nombreArchivo || `reporte-${req.params.tipo}`,
      contenido,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

reportesRouter.get('/:tipo', requireAuth, async (req, res) => {
  try {
    const def = REPORTES[req.params.tipo];
    if (!def) return res.status(404).json({ error: 'Reporte no encontrado' });
    if (!permitido(req.user.rol, def.roles)) {
      return res.status(403).json({ error: 'No tienes permiso para ver este reporte' });
    }
    const data = await def.ejecutar(db, req.query, req.user);
    res.json({ clave: req.params.tipo, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
