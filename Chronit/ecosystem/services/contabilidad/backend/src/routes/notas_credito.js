// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: NOTAS DE CRÉDITO (devoluciones)
// -----------------------------------------------------------------------------
//   GET  /api/conta/notas-credito              -> listar (filtros)
//   GET  /api/conta/notas-credito/:id          -> detalle + ítems
//   POST /api/conta/notas-credito              -> emitir (requiere PIN supervisor)
//   POST /api/conta/notas-credito/:id/anular   -> anular (supervisor+)
//
// Reglas:
//   * La venta original NUNCA se borra: solo se referencia y se acumula
//     conta_ventas.monto_notas_credito (no se recalcula en reportes).
//   * Numeración secuencial propia (NC-000001) y CUF-ready (columna cuf).
//   * Devolución TOTAL (tipo='total') o PARCIAL por ítems (tipo='parcial').
//   * Reembolso: efectivo | cortesia | saldo_favor.
//   * Genera ASIENTO CONTABLE automático y movimiento de caja si es efectivo.
//   * Requiere PIN de supervisor (requireSupervisorPin('nota_credito')).
// =============================================================================
import { Router } from 'express';
import { query, db, withTx } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireSupervisorPin } from '../middleware/pin.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, round2, fechaISO } from '../utils/helpers.js';
import { asientoDeNotaCredito } from '../utils/contabilidad.js';
import { generarCuf } from '../utils/finanzas.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const notasCreditoRouter = Router();

const REEMBOLSOS = ['efectivo', 'cortesia', 'saldo_favor'];

const numeroNC = (id) => `NC-${String(id).padStart(6, '0')}`;

// ---------------------------------------------------------------------------
// Listar
// ---------------------------------------------------------------------------
notasCreditoRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { desde, hasta, estado, venta_id } = req.query;
    const params = [];
    let sql = `
      SELECT nc.*,
             v.numero_factura,
             v.total_final AS venta_total,
             NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS creado_por_nombre,
             NULLIF(TRIM(COALESCE(a.nombre,'') || ' ' || COALESCE(a.apellido,'')), '') AS autorizado_por_nombre
        FROM conta_notas_credito nc
        LEFT JOIN conta_ventas v ON v.id = nc.venta_original_id
        LEFT JOIN usuarios u ON u.id = nc.creado_por
        LEFT JOIN usuarios a ON a.id = nc.autorizado_por
       WHERE 1=1`;
    if (estado) { params.push(estado); sql += ` AND nc.estado = $${params.length}`; }
    if (venta_id) { params.push(venta_id); sql += ` AND nc.venta_original_id = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND nc.creado_en >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); sql += ` AND nc.creado_en < ($${params.length}::date + INTERVAL '1 day')`; }
    sql += ' ORDER BY nc.creado_en DESC LIMIT 300';
    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({ ...r, monto: num(r.monto), venta_total: num(r.venta_total) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------
notasCreditoRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT nc.*, v.numero_factura, v.total_final AS venta_total,
              v.monto_notas_credito, v.nit_cliente, v.razon_social_cliente,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS creado_por_nombre
         FROM conta_notas_credito nc
         LEFT JOIN conta_ventas v ON v.id = nc.venta_original_id
         LEFT JOIN usuarios u ON u.id = nc.creado_por
        WHERE nc.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nota de crédito no encontrada' });
    const { rows: items } = await query(
      `SELECT nci.*, i.nombre_snapshot, i.precio_unitario, i.cantidad AS cantidad_vendida
         FROM conta_nota_credito_items nci
         LEFT JOIN conta_venta_items i ON i.id = nci.venta_item_id
        WHERE nci.nota_id = $1 ORDER BY nci.id`,
      [req.params.id]
    );
    res.json({
      nota: { ...rows[0], monto: num(rows[0].monto), venta_total: num(rows[0].venta_total),
        monto_notas_credito: num(rows[0].monto_notas_credito) },
      items: items.map((i) => ({
        ...i, cantidad: num(i.cantidad), monto: num(i.monto),
        precio_unitario: num(i.precio_unitario), cantidad_vendida: num(i.cantidad_vendida),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Emitir nota de crédito (PIN de supervisor)
// Handler exportado para poder montarlo también como
// POST /api/conta/ventas/:id/nota-credito (alias funcional equivalente).
// ---------------------------------------------------------------------------
export async function emitirNotaCredito(req, res) {
  try {
    const {
      venta_original_id, motivo, tipo, reembolso, items, moneda,
    } = req.body || {};
    if (!venta_original_id) return res.status(400).json({ error: 'La venta original es obligatoria' });
    if (!motivo) return res.status(400).json({ error: 'El motivo de la devolución es obligatorio' });
    const reembolsoFinal = REEMBOLSOS.includes(reembolso) ? reembolso : 'efectivo';
    const sucursalId = await sucursalDePeticion(db, req);

    const resultado = await withTx(async (client) => {
      const { rows: v } = await client.query('SELECT * FROM conta_ventas WHERE id = $1', [venta_original_id]);
      if (!v.length) { const e = new Error('Venta original no encontrada'); e.status = 404; throw e; }
      const venta = v[0];
      if (venta.anulada) { const e = new Error('La venta está anulada: no admite devoluciones'); e.status = 409; throw e; }

      const yaDevuelto = round2(num(venta.monto_notas_credito));
      const disponible = round2(num(venta.total_final) - yaDevuelto);
      if (disponible <= 0) {
        const e = new Error('La venta ya fue devuelta en su totalidad'); e.status = 409; throw e;
      }

      // --- Cálculo del monto a devolver ---
      let monto;
      let tipoFinal;
      const itemsEntrada = Array.isArray(items) ? items : [];
      if (itemsEntrada.length) {
        tipoFinal = 'parcial';
        const { rows: filasVenta } = await client.query(
          'SELECT * FROM conta_venta_items WHERE venta_id = $1', [venta.id]
        );
        const porId = new Map(filasVenta.map((i) => [i.id, i]));
        monto = 0;
        for (const it of itemsEntrada) {
          const fila = porId.get(Number(it.venta_item_id));
          if (!fila) { const e = new Error(`Ítem ${it.venta_item_id} no pertenece a la venta`); e.status = 400; throw e; }
          const cant = num(it.cantidad, num(fila.cantidad));
          if (cant <= 0 || cant > num(fila.cantidad)) {
            const e = new Error(`Cantidad inválida para el ítem ${it.venta_item_id}`); e.status = 400; throw e;
          }
          // Snapshot: se devuelve proporcionalmente al precio de línea aplicado.
          const montoLinea = round2((num(fila.subtotal) / num(fila.cantidad)) * cant);
          it._monto = montoLinea;
          monto = round2(monto + montoLinea);
        }
      } else {
        tipoFinal = tipo === 'parcial' ? 'parcial' : 'total';
        monto = round2(num(req.body?.monto));
        if (monto <= 0) monto = disponible;
        if (tipoFinal === 'total') monto = disponible;
      }

      if (monto <= 0) { const e = new Error('El monto a devolver debe ser mayor a 0'); e.status = 400; throw e; }
      if (monto > disponible + 0.02) {
        const e = new Error(
          `El monto (${monto}) supera el saldo devolvible de la venta (${disponible})`);
        e.status = 400; throw e;
      }

      // --- Insertar nota de crédito ---
      // Datos fiscales: si la venta original fue FACTURADA, la nota de crédito
      // hereda su régimen y devuelve IVA/IT en la misma proporción que el monto.
      const tipoOperacionNC = venta.tipo_operacion
        || (venta.tipo_factura === 'factura' ? 'facturado' : 'no_facturado');
      const esFacturadaNC = tipoOperacionNC === 'facturado';
      const factorNC = num(venta.total_final) > 0 ? monto / num(venta.total_final) : 0;
      const baseNC = round2(num(venta.base_imponible_iva) * factorNC);
      const ivaNC = round2(num(venta.iva_total) * factorNC);
      const itNC = round2(num(venta.it_total) * factorNC);

      const { rows: nc } = await client.query(
        `INSERT INTO conta_notas_credito
           (sucursal_id, venta_original_id, motivo, tipo, reembolso, monto, moneda,
            estado, creado_por, autorizado_por, siat_estado, tipo_operacion, iva_total, it_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'emitida',$8,$9,$10,$11,$12,$13) RETURNING *`,
        [sucursalId, venta.id, motivo, tipoFinal, reembolsoFinal, monto, moneda || venta.moneda || 'BOB',
         req.user.id, req.autorizador ? req.autorizador.id : req.user.id,
         esFacturadaNC ? 'pendiente' : 'no_aplica', tipoOperacionNC, ivaNC, itNC]
      );
      const nota = nc[0];
      const numero = numeroNC(nota.id);
      // CUF de la nota de crédito (placeholder integrable con el SIN).
      const cufNC = esFacturadaNC
        ? generarCuf({ dosificacion: { cuf_base: 'NC' }, numero: nota.id }) : null;
      await client.query(
        'UPDATE conta_notas_credito SET numero = $1, cuf = $2 WHERE id = $3', [numero, cufNC, nota.id]
      );
      nota.numero = numero;
      nota.cuf = cufNC;

      // --- Libro de Ventas: la NC entra con importes NEGATIVOS ---
      // Así el IVA débito fiscal y el IT del período quedan netos de devoluciones
      // sin que ningún reporte tenga que recalcular nada.
      if (esFacturadaNC) {
        const fechaNC = fechaISO(new Date());
        const [anioNC, mesNC] = fechaNC.split('-').map(Number);
        await client.query(
          `INSERT INTO conta_libro_ventas
             (sucursal_id, periodo_mes, periodo_anio, fecha_factura, numero_factura,
              nit_cliente, razon_social_cliente, importe_total, importe_base_iva, iva_total,
              it_total, tipo_factura, cuf, estado_sin, venta_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'nota_credito',$12,'pendiente',$13)
           ON CONFLICT (sucursal_id, periodo_anio, periodo_mes, numero_factura) DO NOTHING`,
          [sucursalId, mesNC, anioNC, fechaNC, numero, venta.nit_cliente, venta.razon_social_cliente,
           -monto, -baseNC, -ivaNC, -itNC, cufNC, venta.id]
        );
      }

      // --- Ítems devueltos ---
      for (const it of itemsEntrada) {
        await client.query(
          `INSERT INTO conta_nota_credito_items (nota_id, venta_item_id, cantidad, monto)
           VALUES ($1,$2,$3,$4)`,
          [nota.id, it.venta_item_id, num(it.cantidad), it._monto]
        );
      }

      // --- Acumulado en la venta original (snapshot para reportes) ---
      await client.query(
        `UPDATE conta_ventas SET monto_notas_credito = monto_notas_credito + $1 WHERE id = $2`,
        [monto, venta.id]
      );

      // --- Asiento contable automático ---
      const asiento = await asientoDeNotaCredito(client, {
        nota: { ...nota, sucursal_id: sucursalId }, ventaOriginal: venta, usuario_id: req.user.id,
      });
      if (asiento) {
        await client.query('UPDATE conta_notas_credito SET asiento_id = $1 WHERE id = $2', [asiento.id, nota.id]);
        nota.asiento_id = asiento.id;
      }

      // --- Movimiento de caja (solo si el reembolso sale del efectivo) ---
      let movimiento = null;
      if (reembolsoFinal === 'efectivo') {
        let sesionId = null;
        const { rows: abierta } = await client.query(
          `SELECT id FROM conta_sesiones_caja WHERE cajero_id = $1 AND estado = 'abierta' LIMIT 1`,
          [req.user.id]
        );
        sesionId = abierta.length ? abierta[0].id : null;
        if (sesionId) {
          const { rows: mv } = await client.query(
            `INSERT INTO conta_movimientos_caja
               (sesion_caja_id, tipo, monto, motivo, nota_credito_id, creado_por, sucursal_id)
             VALUES ($1,'devolucion',$2,$3,$4,$5,$6) RETURNING *`,
            [sesionId, monto, `Nota de crédito ${numero} (venta ${venta.numero_factura || venta.id})`,
             nota.id, req.user.id, sucursalId]
          );
          movimiento = mv[0];
        }
      }

      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'nota_credito', entidad_id: nota.id,
        datos_despues: {
          ...nota, autorizado_por_pin: req.autorizacionPor === 'pin' ? req.autorizador?.usuario_id : null,
          contexto: req.body?.contexto || null,
        },
        ip: ipDe(req),
      });
      // Auditoría de la OPERACIÓN FISCAL (nota de crédito).
      if (esFacturadaNC) {
        await auditar(client, {
          usuario_id: req.user.id, accion: 'nota_credito', entidad: 'conta_libro_ventas',
          entidad_id: nota.id,
          datos_antes: { venta_original: venta.id, numero_factura: venta.numero_factura },
          datos_despues: {
            numero: numero, cuf: cufNC, monto: -monto, iva_total: -ivaNC, it_total: -itNC,
            tipo_operacion: tipoOperacionNC,
          },
          ip: ipDe(req),
        });
      }

      return {
        nota,
        items: itemsEntrada,
        asiento,
        movimiento,
        fiscal: {
          tipo_operacion: tipoOperacionNC,
          base_imponible_iva: baseNC,
          iva_total: ivaNC,
          it_total: itNC,
          cuf: cufNC,
        },
      };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
}

// Ruta canónica: POST /api/conta/notas-credito
notasCreditoRouter.post('/', requireAuth, requireRole('cajero', 'supervisor', 'contador', 'admin'),
  requireSupervisorPin('nota_credito'), emitirNotaCredito);

// ---------------------------------------------------------------------------
// Anular nota de crédito (supervisor+)
// ---------------------------------------------------------------------------
notasCreditoRouter.post('/:id/anular', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { motivo } = req.body || {};
    if (!motivo) return res.status(400).json({ error: 'El motivo de anulación es obligatorio' });
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_notas_credito WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Nota de crédito no encontrada'); e.status = 404; throw e; }
      if (rows[0].estado === 'anulada') { const e = new Error('La nota ya está anulada'); e.status = 409; throw e; }
      const { rows: upd } = await client.query(
        `UPDATE conta_notas_credito SET estado = 'anulada' WHERE id = $1 RETURNING *`, [req.params.id]
      );
      // La fila del libro de ventas de la NC no se borra: se marca anulada.
      if (rows[0].numero) {
        await client.query(
          `UPDATE conta_libro_ventas SET estado_sin = 'anulado' WHERE numero_factura = $1`,
          [rows[0].numero]
        );
      }
      // Se libera el saldo devuelto en la venta original (nunca se borra nada).
      await client.query(
        `UPDATE conta_ventas SET monto_notas_credito = GREATEST(monto_notas_credito - $1, 0) WHERE id = $2`,
        [num(rows[0].monto), rows[0].venta_original_id]
      );
      if (rows[0].asiento_id) {
        await client.query(
          `UPDATE conta_asientos_contables SET estado = 'anulado' WHERE id = $1`, [rows[0].asiento_id]
        );
      }
      await auditar(client, {
        usuario_id: req.user.id, accion: 'anular', entidad: 'nota_credito', entidad_id: req.params.id,
        datos_antes: rows[0], datos_despues: { ...upd[0], motivo }, ip: ipDe(req),
      });
      return upd[0];
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
