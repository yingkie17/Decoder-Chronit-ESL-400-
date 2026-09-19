// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: SIAT-READY (Bolivia)
// -----------------------------------------------------------------------------
//   GET    /api/conta/siat/dosificaciones            -> listar rangos autorizados
//   POST   /api/conta/siat/dosificaciones            -> crear
//   PUT    /api/conta/siat/dosificaciones/:id        -> editar
//   DELETE /api/conta/siat/dosificaciones/:id        -> desactivar
//   POST   /api/conta/siat/dosificaciones/:id/reservar -> siguiente número + CUF
//   GET    /api/conta/siat/libro-ventas.csv          -> Libro de Ventas (formato SIN)
//   GET    /api/conta/siat/libro-compras.csv         -> Libro de Compras (formato SIN)
//
// IMPORTANTE: en esta versión NO hay integración SOAP con el SIN. Solo se deja
// la estructura (dosificaciones, CUF/CUIS/CUN, estado de envío) y los exports
// CSV en el formato del SIN para descarga manual.
// =============================================================================
import { Router } from 'express';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole, FINANZAS } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, fechaISO } from '../utils/helpers.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const siatRouter = Router();

const GESTION = ['contador', 'supervisor', 'admin'];
const TZ = 'America/La_Paz';

const mapDosif = (r) => ({
  ...r,
  rango_desde: num(r.rango_desde),
  rango_hasta: num(r.rango_hasta),
  numero_actual: num(r.numero_actual),
  restantes: Math.max(0, num(r.rango_hasta) - num(r.numero_actual)),
});

/** Escapa un valor para CSV (comillas dobles y separador). */
function csv(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function enviarCsv(res, nombre, encabezados, filas) {
  const lineas = [encabezados.map(csv).join(';'), ...filas.map((f) => f.map(csv).join(';'))];
  // BOM para que Excel abra el archivo en UTF-8.
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}.csv"`);
  res.send('\uFEFF' + lineas.join('\r\n'));
}

// =============================================================================
// DOSIFICACIONES
// =============================================================================
siatRouter.get('/dosificaciones', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const params = [sucursalId];
    let sql = 'SELECT * FROM conta_dosificaciones WHERE 1=1';
    if (req.query.todas !== 'true') sql += ' AND (sucursal_id = $1 OR sucursal_id IS NULL)';
    if (req.query.tipo_factura) { params.push(req.query.tipo_factura); sql += ` AND tipo_factura = $${params.length}`; }
    if (req.query.activo === 'true') sql += ' AND activo = true';
    if (req.query.activo === 'false') sql += ' AND activo = false';
    sql += ' ORDER BY activo DESC, tipo_factura, vigencia_desde DESC NULLS LAST, id DESC';
    const { rows } = await query(sql, params);
    res.json(rows.map(mapDosif));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

siatRouter.post('/dosificaciones', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const {
      tipo_factura, rango_desde, rango_hasta, cuf_base, cuis, cun,
      vigencia_desde, vigencia_hasta,
    } = req.body || {};
    const desde = num(rango_desde, 1);
    const hasta = num(rango_hasta);
    if (hasta <= desde) return res.status(400).json({ error: 'El rango "hasta" debe ser mayor que "desde"' });
    const sucursalId = await sucursalDePeticion(db, req);
    const { rows } = await query(
      `INSERT INTO conta_dosificaciones
         (sucursal_id, tipo_factura, rango_desde, rango_hasta, numero_actual, cuf_base, cuis, cun,
          vigencia_desde, vigencia_hasta, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING *`,
      [sucursalId, tipo_factura || 'factura', desde, hasta, desde - 1,
       cuf_base || null, cuis || null, cun || null, vigencia_desde || null, vigencia_hasta || null]
    );
    await auditar(db, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'dosificacion', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(mapDosif(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

siatRouter.put('/dosificaciones/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const campos = ['tipo_factura', 'cuf_base', 'cuis', 'cun', 'vigencia_desde', 'vigencia_hasta', 'activo'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in (req.body || {})) { params.push(req.body[c]); sets.push(`${c} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const { rows: antes } = await query('SELECT * FROM conta_dosificaciones WHERE id = $1', [req.params.id]);
    if (!antes.length) return res.status(404).json({ error: 'Dosificación no encontrada' });
    const { rows } = await query(
      `UPDATE conta_dosificaciones SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    await auditar(db, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'dosificacion', entidad_id: req.params.id,
      datos_antes: antes[0], datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(mapDosif(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

siatRouter.delete('/dosificaciones/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE conta_dosificaciones SET activo = false WHERE id = $1 RETURNING *`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Dosificación no encontrada' });
    await auditar(db, {
      usuario_id: req.user.id, accion: 'desactivar', entidad: 'dosificacion', entidad_id: req.params.id,
      datos_despues: { activo: false }, ip: ipDe(req),
    });
    res.json({ ok: true, dosificacion: mapDosif(rows[0]) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Reserva el siguiente número de la dosificación (atómico) y arma el número de
 * factura. El CUF que se devuelve es un PLACEHOLDER derivado de `cuf_base` +
 * número + fecha; la integración real con el SIN está desactivada.
 */
siatRouter.post('/dosificaciones/:id/reservar', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query(
        `UPDATE conta_dosificaciones
            SET numero_actual = numero_actual + 1
          WHERE id = $1 AND activo = true AND numero_actual + 1 <= rango_hasta
          RETURNING *`,
        [req.params.id]
      );
      if (!rows.length) {
        const { rows: existe } = await client.query('SELECT * FROM conta_dosificaciones WHERE id = $1', [req.params.id]);
        if (!existe.length) { const e = new Error('Dosificación no encontrada'); e.status = 404; throw e; }
        const e = new Error('La dosificación no está activa o agotó su rango autorizado');
        e.status = 409; throw e;
      }
      const d = rows[0];
      const nro = num(d.numero_actual);
      const numeroFactura = String(nro).padStart(8, '0');
      const cuf = d.cuf_base ? `${d.cuf_base}${numeroFactura}${fechaISO().replace(/-/g, '')}` : null;
      await auditar(client, {
        usuario_id: req.user.id, accion: 'reservar', entidad: 'dosificacion', entidad_id: d.id,
        datos_despues: { numero_actual: nro, numero_factura: numeroFactura }, ip: ipDe(req),
      });
      return {
        dosificacion_id: d.id, tipo_factura: d.tipo_factura,
        numero: nro, numero_factura: numeroFactura,
        cuf, cuis: d.cuis, cun: d.cun,
        restantes: Math.max(0, num(d.rango_hasta) - nro),
        siat_integracion: 'desactivada',
      };
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// =============================================================================
// LIBRO DE VENTAS (CSV formato SIN)
// =============================================================================
siatRouter.get('/libro-ventas.csv', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const hasta = String(req.query.hasta || fechaISO());
    const desde = String(req.query.desde || `${hasta.slice(0, 4)}-01-01`);
    const { rows } = await query(
      `SELECT v.id, v.numero_factura, v.tipo_factura, v.cuf, v.siat_estado,
              (v.creado_en AT TIME ZONE '${TZ}')::date AS fecha,
              v.nit_cliente, v.razon_social_cliente,
              v.total_final, v.base_imponible, v.iva_total, v.moneda,
              COALESCE((
                SELECT SUM(i.subtotal) FROM conta_venta_items i
                 WHERE i.venta_id = v.id AND i.iva_modo_aplicado = 'exento'
              ),0) AS no_gravadas
         FROM conta_ventas v
        WHERE v.anulada = false
          AND (v.creado_en AT TIME ZONE '${TZ}')::date >= $1::date
          AND (v.creado_en AT TIME ZONE '${TZ}')::date <= $2::date
        ORDER BY v.creado_en, v.id`,
      [desde, hasta]
    );
    const encabezados = [
      'N°', 'Fecha', 'NIT/CI Cliente', 'Nombre/Razón Social', 'Importe Total', 'Importe ICE/IEHD',
      'Ventas Gravadas', 'Ventas No Gravadas', 'Ventas Exentas', 'Importe IVA',
      'Código Autorización (CUF)', 'N° Factura', 'Tipo', 'Estado SIAT', 'Moneda',
    ];
    const filas = rows.map((r) => [
      r.id, fechaISO(r.fecha), r.nit_cliente || '0', r.razon_social_cliente || 'Sin nombre',
      num(r.total_final).toFixed(2), '0.00', num(r.base_imponible).toFixed(2),
      num(r.no_gravadas).toFixed(2), '0.00', num(r.iva_total).toFixed(2),
      r.cuf || '', r.numero_factura || String(r.id), r.tipo_factura || '', r.siat_estado, r.moneda,
    ]);
    enviarCsv(res, `libro-ventas_${desde}_${hasta}`, encabezados, filas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// LIBRO DE COMPRAS (CSV formato SIN)
// =============================================================================
siatRouter.get('/libro-compras.csv', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const hasta = String(req.query.hasta || fechaISO());
    const desde = String(req.query.desde || `${hasta.slice(0, 4)}-01-01`);
    const { rows } = await query(
      `SELECT c.id, c.numero_factura_prov, c.fecha, c.subtotal, c.iva, c.total, c.estado,
              p.nombre AS proveedor, p.nit AS proveedor_nit
         FROM conta_compras c
         LEFT JOIN conta_proveedores p ON p.id = c.proveedor_id
        WHERE c.estado <> 'anulada' AND c.fecha >= $1::date AND c.fecha <= $2::date
        ORDER BY c.fecha, c.id`,
      [desde, hasta]
    );
    const encabezados = [
      'N°', 'Fecha', 'NIT Proveedor', 'Razón Social Proveedor', 'N° Factura Proveedor',
      'Importe Total', 'Importe ICE/IEHD', 'Compras Gravadas', 'Compras No Gravadas',
      'Importe IVA', 'Estado',
    ];
    const filas = rows.map((r) => [
      r.id, fechaISO(r.fecha), r.proveedor_nit || '0', r.proveedor || 'Sin proveedor',
      r.numero_factura_prov || '', num(r.total).toFixed(2), '0.00',
      num(r.subtotal).toFixed(2), '0.00', num(r.iva).toFixed(2), r.estado,
    ]);
    enviarCsv(res, `libro-compras_${desde}_${hasta}`, encabezados, filas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
