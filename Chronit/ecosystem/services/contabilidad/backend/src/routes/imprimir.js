// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: ticket imprimible (servidor) + QR firmado
// -----------------------------------------------------------------------------
//   GET /imprimir/ticket/:id?foto=1   -> HTML listo para imprimir
//   GET /api/conta/imprimir/validar   -> verifica la firma del QR del ticket
//
// El QR se firma con el MISMO JWT_SECRET del ecosistema, así que cualquier
// servicio (o el propio core al escanear) puede validar que el ticket es
// auténtico y no fue alterado. La firma caduca a los 30 días.
//
// El ticket impreso muestra: nombre del cajero (snapshot), hora exacta de la
// venta (HH:MM:SS), evento, modo, piloto, carnet, kart #, transponder #,
// código único y QR. La FOTO del piloto se EXCLUYE por defecto (?foto=1 la
// incluye) porque ralentiza la impresión.
// =============================================================================
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

export const imprimirRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_env';
const TZ = 'America/La_Paz';

let _cacheKarts = null;
async function existeTabla(nombre) {
  if (nombre === 'karts' && _cacheKarts !== null) return _cacheKarts;
  const { rows } = await query(
    'SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1', [nombre]
  );
  const ok = rows.length > 0;
  if (nombre === 'karts') _cacheKarts = ok;
  return ok;
}

const escapar = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtHora = (d) => (d ? new Date(d).toLocaleTimeString('es-BO', {
  timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
}) : '—');

const fmtFecha = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }) : '—');

const fmtMoneda = (v) => Number(v || 0).toLocaleString('es-BO', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** Firma el contenido del QR del ticket (30 días de validez). */
export function firmarQr(contenido) {
  return jwt.sign(contenido, JWT_SECRET, { expiresIn: '30d' });
}

async function datosTicket(id) {
  const conKarts = await existeTabla('karts');
  const { rows } = await query(
    `SELECT t.id, t.numero, t.estado, t.uuid_global, t.hora_venta, t.numero_factura,
            t.cajero_nombre_snapshot, t.nit_cliente, t.razon_social_cliente,
            t.transponder_id, t.kart_id, t.evento_id, t.venta_id,
            t.tipo_operacion, t.cuf, t.iva_modo_aplicado, t.iva_pct_aplicado,
            t.cantidad_vueltas, t.duracion_min, t.tipo_promocion,
            t.promocion_nombre_snapshot, t.promocion_descuento, t.cajero_carnet_snapshot,
            t.impreso_en, t.veces_impreso,
            u.id AS usuario_id, u.nombre, u.apellido, u.carnet, u.foto, u.nacionalidad,
            e.nombre AS evento_nombre, e.fecha AS evento_fecha, e.hora AS evento_hora,
            e.modo AS evento_modo, e.tipo_carrera AS evento_tipo,
            ${conKarts ? '(SELECT k.numero FROM karts k WHERE k.id = t.kart_id)' : 'NULL::int'} AS kart_numero,
            p.nombre AS producto_nombre,
            v.total_final, v.subtotal, v.descuento, v.base_imponible, v.iva_total, v.propina,
            v.moneda, v.anulada, v.cajero_nombre_snapshot AS venta_cajero,
            v.tipo_operacion AS venta_tipo_operacion, v.regimen_aplicado,
            v.base_imponible_iva, v.base_imponible_it, v.it_total, v.it_pct_aplicado,
            v.iue_retenido, v.itf_total, v.cuf AS venta_cuf, v.siat_estado
       FROM tickets t
       JOIN usuarios u ON u.id = t.usuario_id
       LEFT JOIN eventos e ON e.id = t.evento_id
       LEFT JOIN conta_productos p ON p.id = t.producto_id
       LEFT JOIN conta_ventas v ON v.id = t.venta_id
      WHERE t.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// GET /api/conta/imprimir/validar?token=<jwt>
// ---------------------------------------------------------------------------
imprimirRouter.get('/validar', async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).json({ valido: false, error: 'Falta el token' });
  try {
    const datos = jwt.verify(token, JWT_SECRET);
    res.json({ valido: true, datos });
  } catch (e) {
    res.status(400).json({ valido: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /imprimir/ticket/:id — HTML imprimible
// ---------------------------------------------------------------------------
imprimirRouter.get('/ticket/:id', requireAuth, async (req, res) => {
  try {
    const t = await datosTicket(req.params.id);
    if (!t) return res.status(404).send('<h1>Ticket no encontrado</h1>');

    // Registro de impresión (migración 0020): este endpoint es el que genera el
    // HTML imprimible, así que aquí se sella la fecha/hora exacta de impresión y
    // se incrementa el contador (control de reimpresiones).
    const impresion = await query(
      `UPDATE tickets SET impreso_en = now(), veces_impreso = veces_impreso + 1
        WHERE id = $1 RETURNING impreso_en, veces_impreso`,
      [t.id]
    );
    t.impreso_en = impresion.rows[0] ? impresion.rows[0].impreso_en : null;
    t.veces_impreso = impresion.rows[0] ? impresion.rows[0].veces_impreso : 0;

    const incluirFoto = String(req.query.foto || '') === '1' || String(req.query.foto) === 'true';
    // Toggle fiscal: una venta FACTURADA imprime datos fiscales (NIT, razón
    // social, N° de factura, CUF y desglose IVA/IT). Una venta NO facturada
    // imprime solo subtotal + total + su número de ticket, sin datos fiscales
    // (aunque el IT se siga calculando y guardando internamente).
    const esFacturado = (t.tipo_operacion || t.venta_tipo_operacion) === 'facturado';
    const firma = firmarQr({
      v: 1,
      ticket: t.numero,
      ticket_id: t.id,
      uuid: t.uuid_global,
      carnet: t.carnet,
      evento_id: t.evento_id,
      venta_id: t.venta_id,
      factura: t.numero_factura,
      cuf: t.venta_cuf || null,
    });
    // QR fiscal (SIAT): incluye CUF + N° de factura para validación. En ventas
    // no facturadas el QR solo identifica el ticket.
    const contenidoQr = JSON.stringify(esFacturado
      ? {
        v: 1, tipo: 'factura', factura: t.numero_factura, cuf: t.venta_cuf || null,
        nit: t.nit_cliente || null, total: Number(t.total_final || 0), firma,
      }
      : { v: 1, tipo: 'ticket', ticket: t.numero, uuid: t.uuid_global, firma });
    const qrDataUrl = await QRCode.toDataURL(contenidoQr, { width: 320, margin: 1 });

    const filas = [
      ['Evento', t.evento_nombre || '—'],
      ['Modo', t.evento_modo || '—'],
      ['Fecha evento', t.evento_fecha ? `${fmtFecha(t.evento_fecha)} ${t.evento_hora || ''}`.trim() : '—'],
      ['Piloto', `${t.nombre || ''} ${t.apellido || ''}`.trim()],
      ['Carnet', t.carnet || '—'],
      ['Nacionalidad', t.nacionalidad || '—'],
      ['Kart #', t.kart_numero != null ? String(t.kart_numero) : (t.kart_id != null ? String(t.kart_id) : '—')],
      ['Transponder #', t.transponder_id != null ? String(t.transponder_id) : '—'],
      ['Producto', t.producto_nombre || '—'],
      ['Vueltas', t.cantidad_vueltas != null ? String(t.cantidad_vueltas) : '—'],
      ['Promoción', t.promocion_nombre_snapshot
        ? `${t.promocion_nombre_snapshot}${Number(t.promocion_descuento || 0) > 0
            ? ` (-${fmtMoneda(t.promocion_descuento)})` : ''}`
        : '—'],
      ['Código único', t.uuid_global || '—'],
    ];
    // Bloque de venta: FACTURADO muestra datos fiscales + desglose IVA/IT;
    // NO FACTURADO muestra solo subtotal, propina y total (sin datos fiscales).
    const comunVenta = t.venta_id ? [
      ['Cajero', t.cajero_nombre_snapshot || t.venta_cajero || '—'],
      ['Hora de venta', fmtHora(t.hora_venta)],
    ] : [];
    let filasVenta = [];
    if (t.venta_id && esFacturado) {
      const ivaPct = t.iva_pct_aplicado != null ? ` ${Number(t.iva_pct_aplicado)}%` : '';
      const itPct = t.it_pct_aplicado != null ? ` ${Number(t.it_pct_aplicado)}%` : '';
      filasVenta = [
        ...comunVenta,
        ['N° Factura', t.numero_factura || '—'],
        ['NIT / CI cliente', t.nit_cliente || '—'],
        ['Razón social', t.razon_social_cliente || '—'],
        ['Base imponible IVA', fmtMoneda(t.base_imponible_iva ?? t.base_imponible)],
        [`IVA${ivaPct}`, fmtMoneda(t.iva_total)],
        [`IT${itPct}`, fmtMoneda(t.it_total)],
        ['Propina', fmtMoneda(t.propina)],
        ['Total', `${fmtMoneda(t.total_final)} ${t.moneda || 'BOB'}`],
        ['CUF', t.venta_cuf || '—'],
      ];
    } else if (t.venta_id) {
      filasVenta = [
        ...comunVenta,
        ['Ticket', t.numero != null ? String(t.numero) : '—'],
        ['Subtotal', fmtMoneda(t.subtotal)],
        ['Propina', fmtMoneda(t.propina)],
        ['Total', `${fmtMoneda(t.total_final)} ${t.moneda || 'BOB'}`],
      ];
    }

    const tr = (par) => `<tr><th>${escapar(par[0])}</th><td>${escapar(par[1])}</td></tr>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ticket ${escapar(t.numero)} — CHRONIT</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         margin: 0; padding: 16px; background: #f3f4f6; color: #111827; }
  .ticket { width: 320px; margin: 0 auto; background: #fff; border-radius: 10px;
            padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
  .marca { font-size: 22px; font-weight: 800; letter-spacing: 2px; text-align: center; margin-bottom: 2px; }
  .sub { text-align: center; font-size: 11px; color: #6b7280; margin-bottom: 10px; }
  .num { text-align: center; font-size: 26px; font-weight: 800; letter-spacing: 1px; margin: 6px 0 2px; }
  .estado { text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 1px; color: #065f46; margin-bottom: 10px; }
  .estado.anulada { color: #b91c1c; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 8px; }
  th { text-align: left; color: #6b7280; font-weight: 600; padding: 3px 0; width: 42%;
       vertical-align: top; }
  td { text-align: right; padding: 3px 0; font-weight: 600; word-break: break-word; }
  hr { border: 0; border-top: 1px dashed #d1d5db; margin: 10px 0; }
  .qr { text-align: center; margin-top: 6px; }
  .qr img { width: 170px; height: 170px; }
  .qr small { display: block; color: #6b7280; font-size: 10px; margin-top: 4px; }
  .foto { text-align: center; margin: 8px 0; }
  .foto img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; }
  .pie { text-align: center; font-size: 10px; color: #9ca3af; margin-top: 10px; }
  .acciones { width: 320px; margin: 12px auto 0; display: flex; gap: 8px; }
  .acciones button { flex: 1; padding: 10px; border: 0; border-radius: 8px; font-weight: 700;
                     cursor: pointer; background: #2563eb; color: #fff; }
  @media print {
    body { background: #fff; padding: 0; }
    .ticket { box-shadow: none; width: 100%; max-width: 78mm; padding: 0; }
    .acciones { display: none; }
    @page { margin: 6mm; }
  }
</style>
</head>
<body>
  <div class="ticket" id="ticket">
    <div class="marca">CHRONIT</div>
    <div class="sub">${esFacturado ? 'FACTURA' : 'Comprobante de carrera'}</div>
    ${esFacturado && t.numero_factura
      ? `<div class="num">${escapar(t.numero_factura)}</div>`
      : (t.numero != null ? `<div class="num">#${escapar(t.numero)}</div>` : '')}
    <div class="estado ${t.anulada ? 'anulada' : ''}">${escapar(t.anulada ? 'ANULADA' : t.estado)}</div>
    ${incluirFoto && t.foto ? `<div class="foto"><img src="${escapar(t.foto)}" alt="Piloto" /></div>` : ''}
    <table>${filas.map(tr).join('')}</table>
    ${filasVenta.length ? `<hr /><table>${filasVenta.map(tr).join('')}</table>` : ''}
    <div class="qr">
      <img src="${qrDataUrl}" alt="QR de validación" />
      <small>${esFacturado
        ? 'QR fiscal (CUF + N° factura) · validación SIAT'
        : 'QR firmado · válido por 30 días'}</small>
    </div>
    <div class="pie">Impreso ${fmtFecha(new Date())} ${fmtHora(new Date())} · America/La_Paz</div>
  </div>
  <div class="acciones">
    <button onclick="window.print()">Imprimir</button>
  </div>
  <script>if (new URLSearchParams(location.search).get('auto') === '1') window.print();</script>
</body>
</html>`);
  } catch (e) {
    res.status(500).send(`<h1>Error</h1><pre>${escapar(e.message)}</pre>`);
  }
});

// ---------------------------------------------------------------------------
// GET /imprimir/factura/:id?auto=1 — factura imprimible (servidor, QR firmado)
// ---------------------------------------------------------------------------
async function datosFactura(id) {
  const { rows } = await query(
    `SELECT v.id, v.uuid_global, v.numero_factura, v.tipo_factura, v.cuf, v.cuis, v.cun,
            v.cajero_nombre_snapshot, v.nit_cliente, v.razon_social_cliente,
            v.subtotal, v.descuento, v.base_imponible, v.iva_total, v.propina, v.total_final,
            v.moneda, v.estado, v.anulada, v.motivo_anulacion, v.siat_estado, v.creado_en,
            v.tipo_operacion, v.regimen_aplicado, v.iva_modo_aplicado, v.iva_pct_aplicado,
            v.base_imponible_iva, v.base_imponible_it, v.it_pct_aplicado, v.it_total,
            v.iue_retenido, v.itf_total,
            s.nombre AS sucursal, s.direccion AS sucursal_direccion, s.telefono AS sucursal_telefono,
            t.id AS ticket_id, t.numero AS ticket_numero
       FROM conta_ventas v
       LEFT JOIN conta_sucursales s ON s.id = v.sucursal_id
       LEFT JOIN tickets t ON t.venta_id = v.id
      WHERE v.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const venta = rows[0];

  const { rows: items } = await query(
    `SELECT i.cantidad, i.precio_unitario, i.descuento, i.subtotal,
            i.iva_modo_aplicado, i.iva_porcentaje_aplicado, i.iva_linea,
            i.es_componente_combo,
            COALESCE(p.nombre, c.nombre, 'Ítem') AS nombre
       FROM conta_venta_items i
       LEFT JOIN conta_productos p ON p.id = i.producto_id
       LEFT JOIN conta_combos c ON c.id = i.combo_id
      WHERE i.venta_id = $1
      ORDER BY i.id`,
    [id]
  );

  const { rows: pagos } = await query(
    `SELECT pg.monto, mp.nombre AS metodo, COALESCE(cd.nombre, '—') AS cuenta
       FROM conta_pagos pg
       LEFT JOIN conta_metodos_pago mp ON mp.id = pg.metodo_pago_id
       LEFT JOIN conta_cuentas_destino cd ON cd.id = pg.cuenta_destino_id
      WHERE pg.venta_id = $1
      ORDER BY pg.id`,
    [id]
  );

  return { venta, items, pagos };
}

imprimirRouter.get('/factura/:id', requireAuth, async (req, res) => {
  try {
    const datos = await datosFactura(req.params.id);
    if (!datos) return res.status(404).send('<h1>Factura no encontrada</h1>');
    const { venta: v, items, pagos } = datos;

    const firma = firmarQr({
      v: 1, factura: v.numero_factura, venta_id: v.id, uuid: v.uuid_global,
      nit: v.nit_cliente, total: Number(v.total_final || 0),
    });
    const qrDataUrl = await QRCode.toDataURL(JSON.stringify({
      v: 1, factura: v.numero_factura, uuid: v.uuid_global, firma,
    }), { width: 320, margin: 1 });

    const filas = items.map((i) => `<tr>
      <td class="c">${escapar(i.cantidad)}</td>
      <td>${escapar(i.nombre)}${i.es_componente_combo ? ' <small>(combo)</small>' : ''}</td>
      <td class="r">${fmtMoneda(i.precio_unitario)}</td>
      <td class="r">${fmtMoneda(i.descuento)}</td>
      <td class="r">${fmtMoneda(i.subtotal)}</td>
    </tr>`).join('');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Factura ${escapar(v.numero_factura || v.id)} — CHRONIT</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         margin: 0; padding: 16px; background: #f3f4f6; color: #111827; }
  .factura { width: 720px; max-width: 100%; margin: 0 auto; background: #fff;
             border-radius: 10px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
  .cab { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111827;
         padding-bottom: 12px; margin-bottom: 14px; }
  .marca { font-size: 24px; font-weight: 800; letter-spacing: 3px; }
  .sub { font-size: 11px; color: #6b7280; white-space: pre-line; }
  .doc { text-align: right; font-size: 12px; }
  .doc .num { font-size: 20px; font-weight: 800; }
  .anulada { color: #b91c1c; font-weight: 800; letter-spacing: 1px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 12px; margin-bottom: 14px; }
  .grid b { color: #6b7280; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f3f4f6; text-align: left; padding: 6px; border-bottom: 1px solid #d1d5db; }
  td { padding: 6px; border-bottom: 1px solid #eef2f7; }
  td.r, th.r { text-align: right; }
  td.c, th.c { text-align: center; }
  .tot { width: 320px; margin-left: auto; margin-top: 10px; font-size: 12.5px; }
  .tot tr td { border: 0; padding: 3px 6px; }
  .tot .final td { font-size: 17px; font-weight: 800; border-top: 2px solid #111827; padding-top: 6px; }
  .qr { text-align: center; margin-top: 14px; }
  .qr img { width: 150px; height: 150px; }
  .qr small { display: block; color: #6b7280; font-size: 10px; margin-top: 4px; }
  .pie { text-align: center; font-size: 10px; color: #9ca3af; margin-top: 12px; }
  .acciones { width: 720px; max-width: 100%; margin: 12px auto 0; display: flex; gap: 8px; }
  .acciones button { flex: 1; padding: 10px; border: 0; border-radius: 8px; font-weight: 700;
                     cursor: pointer; background: #2563eb; color: #fff; }
  @media print {
    body { background: #fff; padding: 0; }
    .factura { box-shadow: none; width: 100%; padding: 0; }
    .acciones { display: none; }
    @page { margin: 10mm; }
  }
</style>
</head>
<body>
  <div class="factura">
    <div class="cab">
      <div>
        <div class="marca">CHRONIT</div>
        <div class="sub">${escapar(v.sucursal || 'Sucursal principal')}
${escapar(v.sucursal_direccion || '')}
${v.sucursal_telefono ? `Tel. ${escapar(v.sucursal_telefono)}` : ''}</div>
      </div>
      <div class="doc">
        <div>${escapar((v.tipo_factura || 'FACTURA').toUpperCase())}</div>
        <div class="num">${escapar(v.numero_factura || `#${v.id}`)}</div>
        <div>${escapar(fmtFecha(v.creado_en))} ${escapar(fmtHora(v.creado_en))}</div>
        ${v.anulada ? '<div class="anulada">ANULADA</div>' : ''}
        <div>CUF: ${escapar(v.cuf || '—')}</div>
        <div>CUIS: ${escapar(v.cuis || '—')} · CUN: ${escapar(v.cun || '—')}</div>
        <div>SIAT: ${escapar(v.siat_estado || 'no_aplica')}</div>
      </div>
    </div>

    <div class="grid">
      <div><b>NIT / CI:</b> ${escapar(v.nit_cliente || '—')}</div>
      <div><b>Razón social:</b> ${escapar(v.razon_social_cliente || '—')}</div>
      <div><b>Cajero:</b> ${escapar(v.cajero_nombre_snapshot || '—')}</div>
      <div><b>Hora de venta:</b> ${escapar(fmtHora(v.creado_en))}</div>
      <div><b>Tipo de operación:</b> ${escapar(v.tipo_operacion || 'no_facturado')}</div>
      <div><b>Régimen:</b> ${escapar(v.regimen_aplicado || 'general')}</div>
      <div><b>Ticket:</b> ${v.ticket_numero != null ? escapar(v.ticket_numero) : '—'}</div>
      <div><b>Código único:</b> ${escapar(v.uuid_global || '—')}</div>
    </div>

    <table>
      <thead><tr>
        <th class="c">Cant.</th><th>Detalle</th>
        <th class="r">P. unit.</th><th class="r">Desc.</th><th class="r">Subtotal</th>
      </tr></thead>
      <tbody>${filas || '<tr><td colspan="5" class="c">Sin ítems</td></tr>'}</tbody>
    </table>

    <table class="tot">
      <tr><td>Subtotal</td><td class="r">${fmtMoneda(v.subtotal)}</td></tr>
      <tr><td>Descuento</td><td class="r">${fmtMoneda(v.descuento)}</td></tr>
      <tr><td>Base imponible IVA${v.iva_pct_aplicado != null ? ` (${Number(v.iva_pct_aplicado)}%)` : ''}</td><td class="r">${fmtMoneda(v.base_imponible_iva ?? v.base_imponible)}</td></tr>
      <tr><td>IVA${v.iva_pct_aplicado != null ? ` ${Number(v.iva_pct_aplicado)}%` : ''}</td><td class="r">${fmtMoneda(v.iva_total)}</td></tr>
      <tr><td>Base imponible IT${v.it_pct_aplicado != null ? ` (${Number(v.it_pct_aplicado)}%)` : ''}</td><td class="r">${fmtMoneda(v.base_imponible_it ?? v.base_imponible)}</td></tr>
      <tr><td>IT${v.it_pct_aplicado != null ? ` ${Number(v.it_pct_aplicado)}%` : ''}</td><td class="r">${fmtMoneda(v.it_total)}</td></tr>
      ${Number(v.iue_retenido) > 0 ? `<tr><td>IUE / SIETE-RG</td><td class="r">${fmtMoneda(v.iue_retenido)}</td></tr>` : ''}
      ${Number(v.itf_total) > 0 ? `<tr><td>ITF</td><td class="r">${fmtMoneda(v.itf_total)}</td></tr>` : ''}
      <tr><td>Propina</td><td class="r">${fmtMoneda(v.propina)}</td></tr>
      <tr class="final"><td>Total ${escapar(v.moneda || 'BOB')}</td><td class="r">${fmtMoneda(v.total_final)}</td></tr>
    </table>

    <div class="grid" style="margin-top:14px">
      ${pagos.length ? pagos.map((p) => `<div><b>Pago ${escapar(p.metodo || '—')}:</b> ${fmtMoneda(p.monto)} · ${escapar(p.cuenta)}</div>`).join('') : '<div><b>Pagos:</b> —</div>'}
    </div>

    <div class="qr">
      <img src="${qrDataUrl}" alt="QR de validación" />
      <small>QR firmado · válido por 30 días</small>
    </div>
    <div class="pie">Impreso ${fmtFecha(new Date())} ${fmtHora(new Date())} · America/La_Paz</div>
  </div>
  <div class="acciones">
    <button onclick="window.print()">Imprimir</button>
  </div>
  <script>if (new URLSearchParams(location.search).get('auto') === '1') window.print();</script>
</body>
</html>`);
  } catch (e) {
    res.status(500).send(`<h1>Error</h1><pre>${escapar(e.message)}</pre>`);
  }
});
