// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: PROVEEDORES, COMPRAS e INVENTARIO (kardex)
// -----------------------------------------------------------------------------
//   PROVEEDORES
//     GET    /api/conta/proveedores
//     POST   /api/conta/proveedores
//     PUT    /api/conta/proveedores/:id
//     DELETE /api/conta/proveedores/:id      -> baja lógica
//
//   COMPRAS
//     GET  /api/conta/compras                -> listar
//     GET  /api/conta/compras/:id            -> detalle + ítems
//     POST /api/conta/compras                -> crear (borrador)
//     POST /api/conta/compras/:id/confirmar  -> entrada kardex + CxP + asiento
//     POST /api/conta/compras/:id/pagar      -> pago (total o parcial) de la CxP
//     POST /api/conta/compras/:id/anular     -> anular (solo borrador)
//
//   KARDEX
//     GET  /api/conta/kardex                 -> movimientos (filtros)
//     POST /api/conta/kardex/ajuste          -> ajuste de inventario físico
//     GET  /api/conta/kardex/valorizacion    -> valorización del inventario
//
// REGLA: al confirmar una compra se recalcula el COSTO PROMEDIO PONDERADO y se
// guarda el saldo (cantidad y valor) en cada movimiento: los reportes no
// recalculan la historia.
// =============================================================================
import { Router } from 'express';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, round2, fechaISO } from '../utils/helpers.js';
import { movimientoKardex, valorizacion } from '../utils/kardex.js';
import { asientoDeCompra, registrarAsiento, CUENTAS, cuentaDeMetodo } from '../utils/contabilidad.js';
import { getConfigMap, valorConfig } from '../utils/finanzas.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const proveedoresRouter = Router();
export const comprasRouter = Router();
export const kardexRouter = Router();

const GESTION = ['contador', 'supervisor', 'admin'];

// =============================================================================
// PROVEEDORES
// =============================================================================
proveedoresRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { activo, q } = req.query;
    const params = [];
    let sql = 'SELECT * FROM conta_proveedores WHERE 1=1';
    if (activo === 'true') sql += ' AND activo = true';
    if (activo === 'false') sql += ' AND activo = false';
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (nombre ILIKE $${params.length} OR nit ILIKE $${params.length}
                    OR contacto ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }
    sql += ' ORDER BY activo DESC, nombre LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

proveedoresRouter.post('/', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { nombre, nit, contacto, telefono, email, condiciones_pago } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const sucursalId = await sucursalDePeticion(db, req);
    const { rows } = await query(
      `INSERT INTO conta_proveedores (sucursal_id, nombre, nit, contacto, telefono, email, condiciones_pago)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [sucursalId, nombre, nit || null, contacto || null, telefono || null, email || null, condiciones_pago || null]
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'proveedor', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un proveedor con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

proveedoresRouter.put('/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const campos = ['nombre', 'nit', 'contacto', 'telefono', 'email', 'condiciones_pago', 'activo'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in req.body) { params.push(req.body[c]); sets.push(`${c} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const { rows: antes } = await query('SELECT * FROM conta_proveedores WHERE id = $1', [req.params.id]);
    if (!antes.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
    const { rows } = await query(
      `UPDATE conta_proveedores SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'proveedor', entidad_id: req.params.id,
      datos_antes: antes[0], datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un proveedor con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

proveedoresRouter.delete('/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { rows } = await query(
      'UPDATE conta_proveedores SET activo = false WHERE id = $1 RETURNING *', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
    await auditar(null, {
      usuario_id: req.user.id, accion: 'desactivar', entidad: 'proveedor', entidad_id: req.params.id,
      datos_despues: { activo: false }, ip: ipDe(req),
    });
    res.json({ ok: true, proveedor: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// COMPRAS
// =============================================================================
comprasRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { desde, hasta, estado, proveedor_id } = req.query;
    const params = [];
    let sql = `
      SELECT c.*, p.nombre AS proveedor,
             (SELECT COUNT(*)::int FROM conta_compra_items i WHERE i.compra_id = c.id) AS n_items
        FROM conta_compras c
        LEFT JOIN conta_proveedores p ON p.id = c.proveedor_id
       WHERE 1=1`;
    if (estado) { params.push(estado); sql += ` AND c.estado = $${params.length}`; }
    if (proveedor_id) { params.push(proveedor_id); sql += ` AND c.proveedor_id = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND c.fecha >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); sql += ` AND c.fecha <= $${params.length}::date`; }
    sql += ' ORDER BY c.fecha DESC, c.id DESC LIMIT 300';
    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({ ...r, subtotal: num(r.subtotal), iva: num(r.iva), total: num(r.total) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

comprasRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.*, p.nombre AS proveedor, p.nit AS proveedor_nit
         FROM conta_compras c LEFT JOIN conta_proveedores p ON p.id = c.proveedor_id
        WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Compra no encontrada' });
    const { rows: items } = await query(
      `SELECT i.*, pr.nombre AS producto_nombre
         FROM conta_compra_items i LEFT JOIN conta_productos pr ON pr.id = i.producto_id
        WHERE i.compra_id = $1 ORDER BY i.id`,
      [req.params.id]
    );
    const { rows: cxp } = await query(
      'SELECT * FROM conta_cuentas_pagar WHERE compra_id = $1 ORDER BY id', [req.params.id]
    );
    const c = rows[0];
    res.json({
      compra: { ...c, subtotal: num(c.subtotal), iva: num(c.iva), total: num(c.total) },
      items: items.map((i) => ({ ...i, cantidad: num(i.cantidad), costo_unitario: num(i.costo_unitario), subtotal: num(i.subtotal) })),
      cuentas_pagar: cxp.map((x) => ({ ...x, monto: num(x.monto), monto_pagado: num(x.monto_pagado), saldo: num(x.saldo) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear compra en BORRADOR (no mueve inventario ni contabilidad todavía).
comprasRouter.post('/', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { proveedor_id, numero_factura_prov, fecha, comprobante_url, items, iva } = req.body || {};
    const lineas = Array.isArray(items) ? items : [];
    if (!lineas.length) return res.status(400).json({ error: 'La compra debe tener al menos un ítem' });
    const sucursalId = await sucursalDePeticion(db, req);

    const resultado = await withTx(async (client) => {
      const subtotal = round2(lineas.reduce(
        (a, i) => a + round2(num(i.cantidad) * num(i.costo_unitario)), 0));
      const ivaMonto = iva != null ? round2(num(iva)) : 0;
      const total = round2(subtotal + ivaMonto);

      const { rows } = await client.query(
        `INSERT INTO conta_compras
           (sucursal_id, proveedor_id, numero_factura_prov, fecha, subtotal, iva, total,
            estado, comprobante_url, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'borrador',$8,$9) RETURNING *`,
        [sucursalId, proveedor_id || null, numero_factura_prov || null, fecha || fechaISO(),
         subtotal, ivaMonto, total, comprobante_url || null, req.user.id]
      );
      const compra = rows[0];
      for (const it of lineas) {
        await client.query(
          `INSERT INTO conta_compra_items (compra_id, producto_id, cantidad, costo_unitario, subtotal)
           VALUES ($1,$2,$3,$4,$5)`,
          [compra.id, it.producto_id || null, num(it.cantidad), num(it.costo_unitario),
           round2(num(it.cantidad) * num(it.costo_unitario))]
        );
      }
      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'compra', entidad_id: compra.id,
        datos_despues: compra, ip: ipDe(req),
      });
      return compra;
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Confirmar: entrada de kardex + cuenta por pagar + asiento contable.
comprasRouter.post('/:id/confirmar', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const resultado = await withTx(async (client) => {
      const { rows: c } = await client.query('SELECT * FROM conta_compras WHERE id = $1', [req.params.id]);
      if (!c.length) { const e = new Error('Compra no encontrada'); e.status = 404; throw e; }
      const compra = c[0];
      if (compra.estado !== 'borrador') {
        const e = new Error(`La compra está ${compra.estado}: solo se confirman los borradores`); e.status = 409; throw e;
      }
      const { rows: items } = await client.query(
        'SELECT * FROM conta_compra_items WHERE compra_id = $1 ORDER BY id', [compra.id]
      );
      if (!items.length) { const e = new Error('La compra no tiene ítems'); e.status = 400; throw e; }

      // Entradas de kardex (recalcula costo promedio ponderado).
      const movimientos = [];
      for (const it of items) {
        if (!it.producto_id) continue;
        // eslint-disable-next-line no-await-in-loop
        const mv = await movimientoKardex(client, {
          producto_id: it.producto_id, tipo: 'entrada', cantidad: num(it.cantidad),
          costo_unitario: num(it.costo_unitario), referencia_tipo: 'compra', referencia_id: compra.id,
          sucursal_id: compra.sucursal_id || null, usuario_id: req.user.id,
        });
        movimientos.push(mv);
      }

      // Cuenta por pagar al proveedor.
      const configMap = await getConfigMap(client);
      const dias = num(valorConfig(configMap, 'cxp_dias_vencimiento', 30));
      const venc = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
      const { rows: cxp } = await client.query(
        `INSERT INTO conta_cuentas_pagar
           (sucursal_id, proveedor_id, compra_id, monto, monto_pagado, saldo, vencimiento, estado, creado_por)
         VALUES ($1,$2,$3,$4,0,$4,$5,'pendiente',$6) RETURNING *`,
        [compra.sucursal_id || null, compra.proveedor_id || null, compra.id, num(compra.total), venc, req.user.id]
      );

      const asiento = await asientoDeCompra(client, { compra, usuario_id: req.user.id });

      const { rows: upd } = await client.query(
        `UPDATE conta_compras
            SET estado = 'confirmada', confirmado_por = $1, confirmado_en = now(), asiento_id = $2
          WHERE id = $3 RETURNING *`,
        [req.user.id, asiento ? asiento.id : null, compra.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'confirmar', entidad: 'compra', entidad_id: compra.id,
        datos_antes: { estado: compra.estado }, datos_despues: upd[0], ip: ipDe(req),
      });
      return { compra: upd[0], kardex: movimientos, cuenta_pagar: cxp[0], asiento };
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

// Pagar (total o parcial) la cuenta por pagar de la compra.
comprasRouter.post('/:id/pagar', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { monto, metodo_pago_id, cuenta_destino_id, observacion } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows: c } = await client.query('SELECT * FROM conta_compras WHERE id = $1', [req.params.id]);
      if (!c.length) { const e = new Error('Compra no encontrada'); e.status = 404; throw e; }
      const compra = c[0];
      if (!['confirmada', 'pagada'].includes(compra.estado)) {
        const e = new Error('La compra debe estar confirmada para poder pagarla'); e.status = 409; throw e;
      }
      const { rows: cxp } = await client.query(
        `SELECT * FROM conta_cuentas_pagar WHERE compra_id = $1 AND estado <> 'pagada' ORDER BY id LIMIT 1`,
        [compra.id]
      );
      if (!cxp.length) { const e = new Error('No hay cuenta por pagar pendiente'); e.status = 409; throw e; }
      const cuenta = cxp[0];
      const saldo = round2(num(cuenta.saldo));
      let montoPagar = round2(num(monto));
      if (montoPagar <= 0) montoPagar = saldo;
      if (montoPagar > saldo + 0.02) {
        const e = new Error(`El pago (${montoPagar}) supera el saldo (${saldo})`); e.status = 400; throw e;
      }

      const { rows: mp } = await client.query(
        'SELECT * FROM conta_metodos_pago WHERE id = $1', [metodo_pago_id]
      );
      const metodo = mp[0] || null;

      const nuevoPagado = round2(num(cuenta.monto_pagado) + montoPagar);
      const nuevoSaldo = round2(saldo - montoPagar);
      await client.query(
        `UPDATE conta_cuentas_pagar SET monto_pagado = $1, saldo = $2, estado = $3 WHERE id = $4`,
        [nuevoPagado, nuevoSaldo, nuevoSaldo <= 0.009 ? 'pagada' : 'pendiente', cuenta.id]
      );
      await client.query(
        `INSERT INTO conta_cobros_pagos (tipo, referencia_id, monto, metodo_pago_id, cuenta_destino_id, observacion, creado_por)
         VALUES ('pago',$1,$2,$3,$4,$5,$6)`,
        [cuenta.id, montoPagar, metodo ? metodo.id : null, cuenta_destino_id || null, observacion || null, req.user.id]
      );

      const asiento = await registrarAsiento(client, {
        descripcion: `Pago a proveedor (compra ${compra.numero_factura_prov || compra.id})`,
        referencia_tipo: 'compra', referencia_id: compra.id,
        lineas: [
          { cuenta: CUENTAS.CXP, debe: montoPagar, haber: 0, descripcion: 'Pago de cuenta por pagar' },
          { cuenta: cuentaDeMetodo(metodo ? metodo.tipo : 'efectivo'), debe: 0, haber: montoPagar,
            descripcion: `Salida ${metodo ? metodo.nombre : 'efectivo'}` },
        ],
        usuario_id: req.user.id, sucursal_id: compra.sucursal_id,
      });

      if (nuevoSaldo <= 0.009) {
        await client.query(`UPDATE conta_compras SET estado = 'pagada' WHERE id = $1`, [compra.id]);
      }
      await auditar(client, {
        usuario_id: req.user.id, accion: 'pago', entidad: 'compra', entidad_id: compra.id,
        datos_antes: { saldo }, datos_despues: { saldo: nuevoSaldo, monto: montoPagar }, ip: ipDe(req),
      });
      return { compra_id: compra.id, cuenta_pagar_id: cuenta.id, monto_pagado: montoPagar, saldo: nuevoSaldo, asiento };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Anular: solo un BORRADOR (una compra confirmada ya movió inventario y CxP).
comprasRouter.post('/:id/anular', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { motivo } = req.body || {};
    if (!motivo) return res.status(400).json({ error: 'El motivo de anulación es obligatorio' });
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_compras WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Compra no encontrada'); e.status = 404; throw e; }
      if (rows[0].estado !== 'borrador') {
        const e = new Error('Solo se pueden anular compras en borrador (una confirmada ya movió inventario)');
        e.status = 409; throw e;
      }
      const { rows: upd } = await client.query(
        `UPDATE conta_compras SET estado = 'anulada' WHERE id = $1 RETURNING *`, [req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'anular', entidad: 'compra', entidad_id: req.params.id,
        datos_antes: rows[0], datos_despues: { ...upd[0], motivo }, ip: ipDe(req),
      });
      return upd[0];
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// =============================================================================
// KARDEX
// =============================================================================
kardexRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { producto_id, tipo, desde, hasta } = req.query;
    const params = [];
    let sql = `
      SELECT k.*, p.nombre AS producto_nombre,
             NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS usuario
        FROM conta_kardex k
        JOIN conta_productos p ON p.id = k.producto_id
        LEFT JOIN usuarios u ON u.id = k.created_by
       WHERE 1=1`;
    if (producto_id) { params.push(producto_id); sql += ` AND k.producto_id = $${params.length}`; }
    if (tipo) { params.push(tipo); sql += ` AND k.tipo = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND (k.creado_en AT TIME ZONE 'America/La_Paz')::date >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); sql += ` AND (k.creado_en AT TIME ZONE 'America/La_Paz')::date <= $${params.length}::date`; }
    sql += ' ORDER BY k.creado_en DESC, k.id DESC LIMIT 1000';
    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({
      ...r,
      cantidad: num(r.cantidad), costo_unitario: num(r.costo_unitario),
      saldo_cantidad: num(r.saldo_cantidad), saldo_valor: num(r.saldo_valor),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

kardexRouter.get('/valorizacion', requireAuth, async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const soloBajo = String(req.query.stock_bajo || '') === 'true';
    res.json(await valorizacion(db, { sucursal_id: sucursalId, soloStockBajo: soloBajo }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Ajuste de inventario físico: `cantidad` es el stock contado. */
kardexRouter.post('/ajuste', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { producto_id, cantidad, motivo } = req.body || {};
    if (!producto_id) return res.status(400).json({ error: 'El producto es obligatorio' });
    const sucursalId = await sucursalDePeticion(db, req);
    const resultado = await withTx(async (client) => {
      const mv = await movimientoKardex(client, {
        producto_id, tipo: 'ajuste', cantidad: num(cantidad),
        referencia_tipo: 'ajuste', sucursal_id: sucursalId, usuario_id: req.user.id,
      });
      await auditar(client, {
        usuario_id: req.user.id, accion: 'ajuste', entidad: 'kardex', entidad_id: mv.kardex.id,
        datos_despues: { ...mv.kardex, motivo: motivo || null }, ip: ipDe(req),
      });
      return { ...mv, motivo: motivo || null };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});
