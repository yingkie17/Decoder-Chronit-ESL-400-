// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: CUMPLIMIENTO FISCAL BOLIVIA (v3)
// -----------------------------------------------------------------------------
// Endpoints que pide la especificación fiscal:
//
//   GET  /api/conta/libro-ventas?periodo=YYYY-MM&sucursal=1  -> libro SIN (JSON)
//   GET  /api/conta/libro-ventas/export?formato=csv|pdf|xlsx -> descarga
//   GET  /api/conta/libro-compras?periodo=YYYY-MM&sucursal=1
//   GET  /api/conta/libro-compras/export?formato=csv|pdf|xlsx
//   GET  /api/conta/periodos                                 -> estado de cierre
//   POST /api/conta/periodos/cerrar                          -> genera libros y cierra (supervisor+)
//   GET  /api/conta/siete-rg/estado?anio=YYYY                -> acumulado anual vs límite
//   POST /api/conta/configuracion/facturacion                -> guardar config fiscal (supervisor+)
//
//   Las DOSIFICACIONES (GET/POST/PUT/DELETE + reservar) ya viven en
//   routes/siat.js y se exponen también en /api/conta/dosificaciones montando
//   ese router adicionalmente en index.js: no se duplica esa lógica.
//
// REGLAS DE ORO
//   * Los libros se leen de conta_libro_ventas / conta_libro_compras, que
//     guardan SNAPSHOTS: cambiar una tasa o el régimen NO altera lo ya
//     registrado.
//   * Un período fiscal CERRADO es inmutable: las ventas nuevas se bloquean y
//     la única vía de corrección es una nota de crédito.
//   * El IT se reporta sobre TODAS las ventas (facturadas o no); el IVA solo
//     sobre las facturadas.
// =============================================================================
import { Router } from 'express';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole, FINANZAS } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, round2, fechaISO } from '../utils/helpers.js';
import { generarPdf, generarExcel, enviarArchivo } from '../utils/exportar.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const fiscalRouter = Router();

const GESTION = ['supervisor', 'admin', 'desarrollador'];
const TZ = 'America/La_Paz';

// Claves de configuración que este router puede escribir (todas fiscales).
const CLAVES_FISCALES = new Set([
  'facturacion_habilitada', 'facturacion_modo_default', 'facturacion_requiere_nit',
  'facturacion_requiere_razon_social', 'iva_pct_default', 'it_pct_default',
  'iue_pct_default', 'itf_pct_default', 'regimen', 'siete_rg_pct', 'siete_rg_limite_anual',
]);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
/** `periodo=YYYY-MM` -> { anio, mes }. Si no viene, se usa el mes actual. */
function periodoDeQuery(q) {
  const per = q && q.periodo ? String(q.periodo) : null;
  if (per && /^\d{4}-\d{2}$/.test(per)) {
    const [anio, mes] = per.split('-').map(Number);
    return { anio, mes, periodo: per };
  }
  const hoy = fechaISO();
  return { anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)), periodo: hoy.slice(0, 7) };
}

/** Escapa un valor para CSV del SIN (separador ';' y comillas dobles). */
function csv(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Envía un CSV con BOM (Excel lo abre en UTF-8 y formato SIN). */
function enviarCsv(res, nombre, encabezados, filas) {
  const lineas = [encabezados.map(csv).join(';'), ...filas.map((f) => f.map(csv).join(';'))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}.csv"`);
  res.send('\uFEFF' + lineas.join('\r\n'));
}

const COL = (clave, titulo, tipo, ancho = 1) => ({ clave, titulo, tipo, ancho });

// =============================================================================
// LIBRO DE VENTAS (formato SIN) — desde conta_libro_ventas
// =============================================================================
async function libroVentas({ sucursal_id, anio, mes, desde, hasta }) {
  const params = [];
  let sql = `
    SELECT lv.id, lv.fecha_factura, lv.numero_factura, lv.nit_cliente, lv.razon_social_cliente,
           lv.importe_total, lv.importe_base_iva, lv.iva_total, lv.it_total,
           lv.tipo_factura, lv.cuf, lv.estado_sin, lv.venta_id,
           s.nombre AS sucursal
      FROM conta_libro_ventas lv
      LEFT JOIN conta_sucursales s ON s.id = lv.sucursal_id
     WHERE 1=1`;
  if (sucursal_id) { params.push(sucursal_id); sql += ` AND lv.sucursal_id = $${params.length}`; }
  if (desde) { params.push(desde); sql += ` AND lv.fecha_factura >= $${params.length}::date`; }
  if (hasta) { params.push(hasta); sql += ` AND lv.fecha_factura <= $${params.length}::date`; }
  if (anio) { params.push(anio); sql += ` AND lv.periodo_anio = $${params.length}`; }
  if (mes) { params.push(mes); sql += ` AND lv.periodo_mes = $${params.length}`; }
  sql += ' ORDER BY lv.fecha_factura, lv.numero_factura';

  const { rows } = await query(sql, params);
  const filas = rows.map((r) => ({
    ...r,
    fecha: r.fecha_factura,
    importe_total: num(r.importe_total),
    importe_base_iva: num(r.importe_base_iva),
    iva_total: num(r.iva_total),
    it_total: num(r.it_total),
  }));
  const suma = (k) => round2(filas.reduce((a, f) => a + num(f[k]), 0));
  return {
    filas,
    totales: {
      documentos: filas.length,
      importe_total: suma('importe_total'),
      importe_base_iva: suma('importe_base_iva'),
      iva_total: suma('iva_total'),
      it_total: suma('it_total'),
    },
  };
}

fiscalRouter.get('/libro-ventas', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = req.query.sucursal ? Number(req.query.sucursal)
      : await sucursalDePeticion(db, req);
    const { anio, mes, periodo } = periodoDeQuery(req.query);
    const usarPeriodo = req.query.periodo !== undefined || (!req.query.desde && !req.query.hasta);
    const data = await libroVentas({
      sucursal_id: sucursalId,
      anio: usarPeriodo ? anio : null,
      mes: usarPeriodo ? mes : null,
      desde: req.query.desde || null,
      hasta: req.query.hasta || null,
    });
    res.json({ periodo, sucursal_id: sucursalId, ...data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

fiscalRouter.get('/libro-ventas/export', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = req.query.sucursal ? Number(req.query.sucursal)
      : await sucursalDePeticion(db, req);
    const { anio, mes, periodo } = periodoDeQuery(req.query);
    const data = await libroVentas({
      sucursal_id: sucursalId, anio, mes,
      desde: req.query.desde || null, hasta: req.query.hasta || null,
    });
    const formato = String(req.query.formato || 'csv').toLowerCase();

    // Formato CSV oficial del SIN: una fila por factura emitida.
    if (formato === 'csv') {
      const encabezados = [
        'N°', 'Fecha', 'NIT/CI Cliente', 'Nombre/Razón Social', 'Importe Total',
        'Importe Base IVA', 'Importe IVA', 'Importe IT', 'N° Factura', 'Tipo',
        'Código Autorización (CUF)', 'Estado SIN',
      ];
      const filas = data.filas.map((r) => [
        r.id, fechaISO(r.fecha_factura), r.nit_cliente || '0', r.razon_social_cliente || 'Sin nombre',
        num(r.importe_total).toFixed(2), num(r.importe_base_iva).toFixed(2),
        num(r.iva_total).toFixed(2), num(r.it_total).toFixed(2),
        r.numero_factura || '', r.tipo_factura || '', r.cuf || '', r.estado_sin || '',
      ]);
      return enviarCsv(res, `libro-ventas_${periodo}`, encabezados, filas);
    }

    const reporte = {
      titulo: 'Libro de Ventas (formato SIN)',
      subtitulo: `Período ${periodo} · sucursal ${sucursalId} (America/La_Paz)`,
      columnas: [
        COL('fecha_factura', 'Fecha', 'fecha', 1),
        COL('numero_factura', 'N° Factura', 'texto', 1.1),
        COL('nit_cliente', 'NIT/CI', 'texto', 1),
        COL('razon_social_cliente', 'Razón social', 'texto', 2),
        COL('importe_total', 'Importe total', 'moneda', 1),
        COL('importe_base_iva', 'Base IVA', 'moneda', 1),
        COL('iva_total', 'IVA', 'moneda', 1),
        COL('it_total', 'IT', 'moneda', 1),
        COL('tipo_factura', 'Tipo', 'texto', 0.8),
        COL('cuf', 'CUF', 'texto', 1.6),
        COL('estado_sin', 'Estado SIN', 'texto', 0.9),
      ],
      filas: data.filas,
      resumen: {
        'Documentos': String(data.totales.documentos),
        'Importe total': data.totales.importe_total.toFixed(2),
        'Base IVA': data.totales.importe_base_iva.toFixed(2),
        'IVA': data.totales.iva_total.toFixed(2),
        'IT': data.totales.it_total.toFixed(2),
      },
      nombreArchivo: `libro-ventas_${periodo}`,
    };
    const contenido = formato === 'xlsx' ? generarExcel(reporte) : await generarPdf(reporte);
    enviarArchivo(res, {
      formato: formato === 'xlsx' ? 'xlsx' : 'pdf',
      nombre: reporte.nombreArchivo, contenido,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// =============================================================================
// LIBRO DE COMPRAS (formato SIN) — desde conta_libro_compras
// =============================================================================
async function libroCompras({ sucursal_id, anio, mes, desde, hasta }) {
  const params = [];
  let sql = `
    SELECT lc.id, lc.fecha_factura, lc.numero_factura, lc.nit_proveedor, lc.razon_social_proveedor,
           lc.importe_total, lc.importe_base_iva, lc.iva_total, lc.it_total,
           lc.tipo_factura, lc.cuf, lc.estado_sin, lc.compra_id,
           s.nombre AS sucursal
      FROM conta_libro_compras lc
      LEFT JOIN conta_sucursales s ON s.id = lc.sucursal_id
     WHERE 1=1`;
  if (sucursal_id) { params.push(sucursal_id); sql += ` AND lc.sucursal_id = $${params.length}`; }
  if (desde) { params.push(desde); sql += ` AND lc.fecha_factura >= $${params.length}::date`; }
  if (hasta) { params.push(hasta); sql += ` AND lc.fecha_factura <= $${params.length}::date`; }
  if (anio) { params.push(anio); sql += ` AND lc.periodo_anio = $${params.length}`; }
  if (mes) { params.push(mes); sql += ` AND lc.periodo_mes = $${params.length}`; }
  sql += ' ORDER BY lc.fecha_factura, lc.numero_factura';

  const { rows } = await query(sql, params);
  const filas = rows.map((r) => ({
    ...r,
    fecha: r.fecha_factura,
    importe_total: num(r.importe_total),
    importe_base_iva: num(r.importe_base_iva),
    iva_total: num(r.iva_total),
    it_total: num(r.it_total),
  }));
  const suma = (k) => round2(filas.reduce((a, f) => a + num(f[k]), 0));
  return {
    filas,
    totales: {
      documentos: filas.length,
      importe_total: suma('importe_total'),
      importe_base_iva: suma('importe_base_iva'),
      iva_total: suma('iva_total'),
      it_total: suma('it_total'),
    },
  };
}

fiscalRouter.get('/libro-compras', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = req.query.sucursal ? Number(req.query.sucursal)
      : await sucursalDePeticion(db, req);
    const { anio, mes, periodo } = periodoDeQuery(req.query);
    const usarPeriodo = req.query.periodo !== undefined || (!req.query.desde && !req.query.hasta);
    const data = await libroCompras({
      sucursal_id: sucursalId,
      anio: usarPeriodo ? anio : null,
      mes: usarPeriodo ? mes : null,
      desde: req.query.desde || null,
      hasta: req.query.hasta || null,
    });
    res.json({ periodo, sucursal_id: sucursalId, ...data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

fiscalRouter.get('/libro-compras/export', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = req.query.sucursal ? Number(req.query.sucursal)
      : await sucursalDePeticion(db, req);
    const { anio, mes, periodo } = periodoDeQuery(req.query);
    const data = await libroCompras({
      sucursal_id: sucursalId, anio, mes,
      desde: req.query.desde || null, hasta: req.query.hasta || null,
    });
    const formato = String(req.query.formato || 'csv').toLowerCase();

    if (formato === 'csv') {
      const encabezados = [
        'N°', 'Fecha', 'NIT Proveedor', 'Razón Social Proveedor', 'N° Factura',
        'Importe Total', 'Importe Base IVA', 'Importe IVA', 'Importe IT', 'Tipo',
        'Código Autorización (CUF)', 'Estado SIN',
      ];
      const filas = data.filas.map((r) => [
        r.id, fechaISO(r.fecha_factura), r.nit_proveedor || '0', r.razon_social_proveedor || 'Sin nombre',
        r.numero_factura || '', num(r.importe_total).toFixed(2),
        num(r.importe_base_iva).toFixed(2), num(r.iva_total).toFixed(2), num(r.it_total).toFixed(2),
        r.tipo_factura || '', r.cuf || '', r.estado_sin || '',
      ]);
      return enviarCsv(res, `libro-compras_${periodo}`, encabezados, filas);
    }

    const reporte = {
      titulo: 'Libro de Compras (formato SIN)',
      subtitulo: `Período ${periodo} · sucursal ${sucursalId} (America/La_Paz)`,
      columnas: [
        COL('fecha_factura', 'Fecha', 'fecha', 1),
        COL('numero_factura', 'N° Factura', 'texto', 1.1),
        COL('nit_proveedor', 'NIT', 'texto', 1),
        COL('razon_social_proveedor', 'Proveedor', 'texto', 2),
        COL('importe_total', 'Importe total', 'moneda', 1),
        COL('importe_base_iva', 'Base IVA', 'moneda', 1),
        COL('iva_total', 'IVA', 'moneda', 1),
        COL('it_total', 'IT', 'moneda', 1),
        COL('estado_sin', 'Estado SIN', 'texto', 0.9),
      ],
      filas: data.filas,
      resumen: {
        'Documentos': String(data.totales.documentos),
        'Importe total': data.totales.importe_total.toFixed(2),
        'Base IVA': data.totales.importe_base_iva.toFixed(2),
        'IVA': data.totales.iva_total.toFixed(2),
      },
      nombreArchivo: `libro-compras_${periodo}`,
    };
    const contenido = formato === 'xlsx' ? generarExcel(reporte) : await generarPdf(reporte);
    enviarArchivo(res, {
      formato: formato === 'xlsx' ? 'xlsx' : 'pdf',
      nombre: reporte.nombreArchivo, contenido,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// =============================================================================
// PERÍODOS FISCALES — cierre de mes (libros inmutables)
// =============================================================================
fiscalRouter.get('/periodos', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const params = [];
    let sql = `SELECT p.*, s.nombre AS sucursal,
                      NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS cerrado_por_nombre
                 FROM conta_periodos_fiscales p
                 LEFT JOIN conta_sucursales s ON s.id = p.sucursal_id
                 LEFT JOIN usuarios u ON u.id = p.cerrado_por
                WHERE 1=1`;
    if (req.query.anio) { params.push(Number(req.query.anio)); sql += ` AND p.periodo_anio = $${params.length}`; }
    if (req.query.sucursal) { params.push(Number(req.query.sucursal)); sql += ` AND p.sucursal_id = $${params.length}`; }
    sql += ' ORDER BY p.periodo_anio DESC, p.periodo_mes DESC, p.sucursal_id';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Cierra un período fiscal.
 *   1. "Genera" el libro: vuelca al libro de ventas TODAS las ventas facturadas
 *      del período que aún no estuvieran registradas (idempotente) y hace lo
 *      propio con las compras.
 *   2. Marca el período como cerrado (conta_periodos_fiscales).
 * A partir de ahí, ventas y anulaciones del período quedan bloqueadas.
 */
fiscalRouter.post('/periodos/cerrar', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { mes, anio, observacion } = req.body || {};
    const m = Number(mes);
    const a = Number(anio);
    if (!m || m < 1 || m > 12 || !a) {
      return res.status(400).json({ error: 'Indique "mes" (1-12) y "anio" válidos' });
    }
    const sucursalId = req.body.sucursal_id
      ? Number(req.body.sucursal_id) : await sucursalDePeticion(db, req);

    const resultado = await withTx(async (client) => {
      // 1a) Libro de VENTAS: vuelca las facturadas del período que falten.
      const { rowCount: ventasVolcadas } = await client.query(
        `INSERT INTO conta_libro_ventas
           (sucursal_id, periodo_mes, periodo_anio, fecha_factura, numero_factura,
            nit_cliente, razon_social_cliente, importe_total, importe_base_iva, iva_total,
            it_total, tipo_factura, cuf, estado_sin, venta_id)
         SELECT v.sucursal_id, $2, $1, (v.creado_en AT TIME ZONE '${TZ}')::date, v.numero_factura,
                v.nit_cliente_snapshot, v.razon_social_cliente_snapshot, v.total_final,
                v.base_imponible_iva, v.iva_total, v.it_total,
                COALESCE(v.tipo_factura_snapshot,'factura'), v.cuf, v.siat_estado, v.id
           FROM conta_ventas v
          WHERE v.anulada = false
            AND v.tipo_operacion = 'facturado'
            AND v.numero_factura IS NOT NULL
            AND EXTRACT(YEAR  FROM (v.creado_en AT TIME ZONE '${TZ}')) = $1
            AND EXTRACT(MONTH FROM (v.creado_en AT TIME ZONE '${TZ}')) = $2
            AND v.sucursal_id = $3
         ON CONFLICT (sucursal_id, periodo_anio, periodo_mes, numero_factura) DO NOTHING`,
        [a, m, sucursalId]
      );

      // 1b) Libro de COMPRAS: vuelca las compras confirmadas del período.
      const { rowCount: comprasVolcadas } = await client.query(
        `INSERT INTO conta_libro_compras
           (sucursal_id, periodo_mes, periodo_anio, fecha_factura, numero_factura,
            nit_proveedor, razon_social_proveedor, importe_total, importe_base_iva, iva_total,
            it_total, tipo_factura, cuf, estado_sin, compra_id)
         SELECT $3, $2, $1, c.fecha, c.numero_factura_prov,
                p.nit, p.nombre, c.total, c.subtotal, c.iva, 0,
                'factura', NULL, c.estado, c.id
           FROM conta_compras c
           LEFT JOIN conta_proveedores p ON p.id = c.proveedor_id
          WHERE c.estado NOT IN ('anulada','borrador')
            AND EXTRACT(YEAR  FROM c.fecha) = $1
            AND EXTRACT(MONTH FROM c.fecha) = $2
         ON CONFLICT (sucursal_id, periodo_anio, periodo_mes, numero_factura) DO NOTHING`,
        [a, m, sucursalId]
      );

      // 2) Cerrar el período (upsert idempotente).
      const { rows } = await client.query(
        `INSERT INTO conta_periodos_fiscales
           (sucursal_id, periodo_anio, periodo_mes, estado, cerrado_por, cerrado_en, observacion)
         VALUES ($1,$2,$3,'cerrado',$4, now(), $5)
         ON CONFLICT (sucursal_id, periodo_anio, periodo_mes)
         DO UPDATE SET estado = 'cerrado', cerrado_por = EXCLUDED.cerrado_por,
                       cerrado_en = now(), observacion = EXCLUDED.observacion
         RETURNING *`,
        [sucursalId, a, m, req.user.id, observacion || null]
      );

      await auditar(client, {
        usuario_id: req.user.id, accion: 'cerrar_periodo', entidad: 'conta_periodos_fiscales',
        entidad_id: rows[0].id,
        datos_despues: {
          periodo: `${a}-${String(m).padStart(2, '0')}`, sucursal_id: sucursalId,
          ventas_volcadas: ventasVolcadas, compras_volcadas: comprasVolcadas,
        },
        ip: ipDe(req),
      });
      return {
        periodo: rows[0], ventas_volcadas: ventasVolcadas, compras_volcadas: comprasVolcadas,
      };
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// =============================================================================
// SIETE-RG — acumulado anual vs límite (Bs 400.000 por defecto)
// =============================================================================
fiscalRouter.get('/siete-rg/estado', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const anio = Number(req.query.anio || fechaISO().slice(0, 4));
    const { rows: cfg } = await db.query(
      `SELECT clave, valor FROM conta_configuracion
        WHERE clave IN ('siete_rg_limite_anual','siete_rg_pct','regimen')`
    );
    const cfgMap = {};
    for (const r of cfg) cfgMap[r.clave] = r.valor;
    const limite = num(cfgMap.siete_rg_limite_anual, 400000);
    const pct = num(cfgMap.siete_rg_pct, 5);
    const regimen = String(cfgMap.regimen || 'general');

    const { rows } = await query(
      `SELECT COALESCE(SUM(v.total_final),0)  AS acumulado,
              COALESCE(SUM(v.iue_retenido),0) AS unificado,
              COUNT(*)::int                   AS n_ventas
         FROM conta_ventas v
        WHERE v.anulada = false AND v.tipo_operacion <> 'cortesia'
          AND EXTRACT(YEAR FROM (v.creado_en AT TIME ZONE '${TZ}')) = $1`,
      [anio]
    );
    const acumulado = round2(num(rows[0] && rows[0].acumulado));
    const unificado = round2(num(rows[0] && rows[0].unificado));
    const pctUso = limite > 0 ? round2((acumulado / limite) * 100) : 0;
    res.json({
      anio, regimen, pct_unificado: pct, limite_anual: limite,
      acumulado_anual: acumulado, unificado_registrado: unificado,
      n_ventas: num(rows[0] && rows[0].n_ventas),
      porcentaje_consumido: pctUso,
      disponible: round2(Math.max(0, limite - acumulado)),
      alerta: pctUso >= 100 ? 'limite_superado' : (pctUso >= 90 ? 'cerca_del_limite' : null),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// TASAS DE IMPUESTO — historial de alícuotas (conta_tasas_impuesto)
// -----------------------------------------------------------------------------
// La tasa OPERATIVA vive en conta_configuracion y se snapshotea en cada venta;
// esta tabla es el respaldo histórico/normativo (qué alícuota regía y desde
// cuándo). El alta/edición queda auditada en conta_auditoria.
// =============================================================================
fiscalRouter.get('/tasas', requireAuth, requireRole(...FINANZAS), async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM conta_tasas_impuesto ORDER BY codigo, vigencia_desde DESC NULLS LAST`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

fiscalRouter.post('/tasas', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const b = req.body || {};
    const codigo = b.codigo ? String(b.codigo).trim().toUpperCase() : null;
    if (!codigo) {
      return res.status(400).json({ error: 'Indique "codigo" (IVA | IT | IUE | ITF | SIETE_RG)' });
    }
    const resultado = await withTx(async (client) => {
      const { rows: antes } = await client.query(
        'SELECT * FROM conta_tasas_impuesto WHERE codigo = $1', [codigo]
      );
      const { rows } = await client.query(
        `INSERT INTO conta_tasas_impuesto (codigo, nombre, pct, vigencia_desde, vigencia_hasta, activo)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,true))
         ON CONFLICT (codigo) DO UPDATE
            SET nombre = EXCLUDED.nombre, pct = EXCLUDED.pct,
                vigencia_desde = EXCLUDED.vigencia_desde, vigencia_hasta = EXCLUDED.vigencia_hasta,
                activo = EXCLUDED.activo
         RETURNING *`,
        [codigo, b.nombre || codigo, num(b.pct), b.vigencia_desde || null,
         b.vigencia_hasta || null, typeof b.activo === 'boolean' ? b.activo : null]
      );
      await auditar(client, {
        usuario_id: req.user.id,
        accion: antes.length ? 'actualizar_tasa' : 'crear_tasa',
        entidad: 'conta_tasas_impuesto', entidad_id: rows[0].id,
        datos_antes: antes.length ? antes[0] : null, datos_despues: rows[0],
        ip: ipDe(req),
      });
      return rows[0];
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// =============================================================================
// CONFIGURACIÓN FISCAL — POST /api/conta/configuracion/facturacion (supervisor+)
// -----------------------------------------------------------------------------
// Acepta { cambios: { clave: valor, ... } } o directamente { clave: valor }.
// Solo admite claves fiscales y deja auditoría con datos_antes/datos_despues.
// =============================================================================
fiscalRouter.post('/configuracion/facturacion', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const body = req.body || {};
    const cambios = body.cambios && typeof body.cambios === 'object' ? body.cambios : body;
    const entradas = Object.entries(cambios).filter(([k]) => CLAVES_FISCALES.has(k));
    if (!entradas.length) {
      return res.status(400).json({
        error: 'No se recibió ninguna clave fiscal válida',
        claves_validas: [...CLAVES_FISCALES],
      });
    }
    const resultado = await withTx(async (client) => {
      const out = [];
      for (const [clave, valor] of entradas) {
        const { rows: antes } = await client.query(
          'SELECT valor FROM conta_configuracion WHERE clave = $1', [clave]
        );
        if (!antes.length) {
          const e = new Error(`Clave fiscal desconocida: ${clave}`); e.status = 404; throw e;
        }
        const { rows } = await client.query(
          `UPDATE conta_configuracion
              SET valor = $1::jsonb, actualizado_por = $2, actualizado_en = now()
            WHERE clave = $3 RETURNING *`,
          [JSON.stringify(valor), req.user.id, clave]
        );
        await auditar(client, {
          usuario_id: req.user.id, accion: 'editar', entidad: 'configuracion_fiscal',
          entidad_id: clave,
          datos_antes: { valor: antes[0].valor }, datos_despues: { valor: rows[0].valor },
          ip: ipDe(req),
        });
        out.push(rows[0]);
      }
      return out;
    });
    res.json({ actualizadas: resultado.length, configuracion: resultado });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
