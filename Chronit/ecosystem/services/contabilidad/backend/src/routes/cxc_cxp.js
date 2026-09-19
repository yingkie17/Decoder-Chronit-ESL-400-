// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: EMPRESAS/CONVENIOS + CUENTAS POR COBRAR/PAGAR
// -----------------------------------------------------------------------------
//   EMPRESAS (clientes corporativos)
//     GET/POST/PUT/DELETE  /api/conta/empresas
//   CONVENIOS (tarifa especial + cupo mensual por empresa)
//     GET/POST/PUT/DELETE  /api/conta/convenios
//
//   CUENTAS POR COBRAR (CxC)
//     GET  /api/conta/cxc                  -> listar (filtros)
//     GET  /api/conta/cxc/aging            -> antigüedad 30/60/90
//     GET  /api/conta/cxc/recordatorios    -> vencidas / por vencer
//     GET  /api/conta/cxc/:id              -> detalle + cobros
//     POST /api/conta/cxc                  -> registrar saldo a favor del negocio
//     POST /api/conta/cxc/:id/cobrar       -> cobro total o parcial
//     POST /api/conta/cxc/:id/recordatorio -> envía recordatorio (alerta)
//     POST /api/conta/cxc/:id/anular       -> anular (supervisor+)
//
//   CUENTAS POR PAGAR (CxP)
//     GET  /api/conta/cxp                  -> listar (filtros)
//     GET  /api/conta/cxp/aging            -> antigüedad 30/60/90
//     GET  /api/conta/cxp/recordatorios    -> vencidas / por vencer
//     GET  /api/conta/cxp/:id              -> detalle + pagos
//     POST /api/conta/cxp/:id/pagar        -> pago total o parcial
//     POST /api/conta/cxp/:id/recordatorio -> registro interno de recordatorio
//     POST /api/conta/cxp/:id/anular       -> anular (supervisor+)
//
// REGLA: los saldos (monto_pagado / saldo / estado) se mantienen en la fila de
// la cuenta; los reportes leen esa fila y NO recalculan la historia.
// =============================================================================
import { Router } from 'express';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole, FINANZAS } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, round2, fechaISO } from '../utils/helpers.js';
import { registrarAsiento, CUENTAS, cuentaDeMetodo } from '../utils/contabilidad.js';
import { getConfigMap, valorConfig } from '../utils/finanzas.js';
import { crearAlerta } from '../utils/alertas.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const empresasRouter = Router();
export const conveniosRouter = Router();
export const cxcRouter = Router();
export const cxpRouter = Router();

const GESTION = ['contador', 'supervisor', 'admin'];

/** Agrupa por antigüedad (30/60/90) a partir de la fecha de vencimiento. */
function bucket(diasVencidos) {
  const d = Number(diasVencidos || 0);
  if (d <= 0) return 'Por vencer';
  if (d <= 30) return '1-30 días';
  if (d <= 60) return '31-60 días';
  if (d <= 90) return '61-90 días';
  return 'más de 90 días';
}

function diasDeVencimiento(vencimiento) {
  if (!vencimiento) return 0;
  const v = new Date(vencimiento);
  const hoy = new Date(fechaISO());
  return Math.floor((hoy - v) / 86400000);
}

const mapCuenta = (r) => ({
  ...r,
  monto: num(r.monto),
  monto_pagado: num(r.monto_pagado),
  saldo: num(r.saldo),
});

// =============================================================================
// EMPRESAS
// =============================================================================
empresasRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { activo, q } = req.query;
    const params = [];
    let sql = 'SELECT * FROM conta_empresas WHERE 1=1';
    if (activo === 'true') sql += ' AND activo = true';
    if (activo === 'false') sql += ' AND activo = false';
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (nombre ILIKE $${params.length} OR nit ILIKE $${params.length})`;
    }
    sql += ' ORDER BY activo DESC, nombre LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

empresasRouter.post('/', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { nombre, nit, contacto, telefono, email, direccion } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await query(
      `INSERT INTO conta_empresas (nombre, nit, contacto, telefono, email, direccion)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [nombre, nit || null, contacto || null, telefono || null, email || null, direccion || null]
    );
    await auditar(db, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'empresa', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una empresa con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

empresasRouter.put('/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const campos = ['nombre', 'nit', 'contacto', 'telefono', 'email', 'direccion', 'activo'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in (req.body || {})) { params.push(req.body[c]); sets.push(`${c} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const { rows: antes } = await query('SELECT * FROM conta_empresas WHERE id = $1', [req.params.id]);
    if (!antes.length) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { rows } = await query(
      `UPDATE conta_empresas SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    await auditar(db, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'empresa', entidad_id: req.params.id,
      datos_antes: antes[0], datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una empresa con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

empresasRouter.delete('/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { rows } = await query(
      'UPDATE conta_empresas SET activo = false WHERE id = $1 RETURNING *', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empresa no encontrada' });
    await auditar(db, {
      usuario_id: req.user.id, accion: 'desactivar', entidad: 'empresa', entidad_id: req.params.id,
      datos_despues: { activo: false }, ip: ipDe(req),
    });
    res.json({ ok: true, empresa: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// CONVENIOS
// =============================================================================
conveniosRouter.get('/', requireAuth, async (req, res) => {
  try {
    const params = [];
    let sql = `
      SELECT cv.*, e.nombre AS empresa, e.nit AS empresa_nit
        FROM conta_convenios cv
        JOIN conta_empresas e ON e.id = cv.empresa_id
       WHERE 1=1`;
    if (req.query.empresa_id) { params.push(req.query.empresa_id); sql += ` AND cv.empresa_id = $${params.length}`; }
    if (req.query.activo === 'true') sql += ' AND cv.activo = true';
    if (req.query.activo === 'false') sql += ' AND cv.activo = false';
    sql += ' ORDER BY cv.activo DESC, e.nombre LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({
      ...r,
      tarifa_especial: r.tarifa_especial == null ? null : num(r.tarifa_especial),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

conveniosRouter.post('/', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const {
      empresa_id, tarifa_especial, cupo_mensual, vigencia_desde, vigencia_hasta,
    } = req.body || {};
    if (!empresa_id) return res.status(400).json({ error: 'La empresa es obligatoria' });
    const sucursalId = await sucursalDePeticion(db, req);
    const { rows } = await query(
      `INSERT INTO conta_convenios
         (sucursal_id, empresa_id, tarifa_especial, cupo_mensual, vigencia_desde, vigencia_hasta)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [sucursalId, empresa_id, tarifa_especial == null ? null : num(tarifa_especial),
       cupo_mensual == null ? null : Number(cupo_mensual), vigencia_desde || null, vigencia_hasta || null]
    );
    await auditar(db, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'convenio', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

conveniosRouter.put('/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const campos = ['tarifa_especial', 'cupo_mensual', 'vigencia_desde', 'vigencia_hasta', 'activo'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in (req.body || {})) { params.push(req.body[c]); sets.push(`${c} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE conta_convenios SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    if (!rows.length) return res.status(404).json({ error: 'Convenio no encontrado' });
    await auditar(db, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'convenio', entidad_id: req.params.id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

conveniosRouter.delete('/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { rows } = await query(
      'UPDATE conta_convenios SET activo = false WHERE id = $1 RETURNING *', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Convenio no encontrado' });
    res.json({ ok: true, convenio: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// CUENTAS POR COBRAR (CxC)
// =============================================================================
cxcRouter.get('/', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const { estado, desde, hasta, q } = req.query;
    const params = [sucursalId];
    let sql = 'SELECT * FROM conta_cuentas_cobrar WHERE sucursal_id = $1';
    if (estado) { params.push(estado); sql += ` AND estado = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND creado_en >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); sql += ` AND creado_en < ($${params.length}::date + INTERVAL '1 day')`; }
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (cliente_nombre ILIKE $${params.length} OR cliente_nit ILIKE $${params.length})`;
    }
    sql += ' ORDER BY (saldo > 0.009) DESC, vencimiento NULLS LAST, id DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map(mapCuenta));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

cxcRouter.get('/aging', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const params = [sucursalId];
    let filtro = ` AND estado <> 'anulada' AND saldo > 0.009 AND sucursal_id = $1`;
    if (req.query.cliente) {
      params.push(`%${req.query.cliente}%`);
      filtro += ` AND cliente_nombre ILIKE $${params.length}`;
    }
    const { rows } = await query(
      `SELECT id, cliente_nombre, cliente_nit, saldo, vencimiento, estado, sucursal_id
         FROM conta_cuentas_cobrar WHERE 1=1${filtro}`, params
    );
    const buckets = {};
    let total = 0;
    for (const r of rows) {
      const b = bucket(diasDeVencimiento(r.vencimiento));
      const saldo = num(r.saldo);
      buckets[b] = round2((buckets[b] || 0) + saldo);
      total += saldo;
    }
    res.json({
      total: round2(total),
      clientes: new Set(rows.map((r) => r.cliente_nombre)).size,
      cuentas: rows.length,
      buckets,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

cxcRouter.get('/recordatorios', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const { rows } = await query(
      `SELECT id, cliente_nombre, cliente_nit, saldo, vencimiento, estado
         FROM conta_cuentas_cobrar
        WHERE estado <> 'anulada' AND saldo > 0.009
          AND vencimiento IS NOT NULL AND vencimiento <= CURRENT_DATE
          AND sucursal_id = $1
        ORDER BY vencimiento`,
      [sucursalId]
    );
    res.json(rows.map((r) => ({
      ...r, saldo: num(r.saldo), dias_vencido: diasDeVencimiento(r.vencimiento),
    })));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

cxcRouter.get('/:id', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_cuentas_cobrar WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cuenta por cobrar no encontrada' });
    const { rows: cobros } = await query(
      `SELECT cp.*, mp.nombre AS metodo, cd.nombre AS cuenta
         FROM conta_cobros_pagos cp
         LEFT JOIN conta_metodos_pago mp ON mp.id = cp.metodo_pago_id
         LEFT JOIN conta_cuentas_destino cd ON cd.id = cp.cuenta_destino_id
        WHERE cp.tipo = 'cobro' AND cp.referencia_id = $1
        ORDER BY cp.creado_en DESC`,
      [req.params.id]
    );
    res.json({
      cuenta: mapCuenta(rows[0]),
      cobros: cobros.map((c) => ({ ...c, monto: num(c.monto) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Registrar una cuenta por cobrar (venta a crédito o ajuste manual). */
cxcRouter.post('/', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const {
      cliente_id, cliente_nombre, cliente_nit, venta_id, monto, base_imponible, iva,
      vencimiento, dias_vencimiento,
    } = req.body || {};
    const m = round2(num(monto));
    if (m <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    const sucursalId = await sucursalDePeticion(db, req);

    const resultado = await withTx(async (client) => {
      const cfg = await getConfigMap(client);
      const dias = num(dias_vencimiento ?? valorConfig(cfg, 'cxc_dias_vencimiento', 30));
      const venc = vencimiento || new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

      const { rows } = await client.query(
        `INSERT INTO conta_cuentas_cobrar
           (sucursal_id, cliente_id, cliente_nombre, cliente_nit, venta_id, monto, monto_pagado, saldo,
            vencimiento, estado, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,0,$6,$7,'pendiente',$8) RETURNING *`,
        [sucursalId, cliente_id || null, cliente_nombre || null, cliente_nit || null,
         venta_id || null, m, venc, req.user.id]
      );
      const cuenta = rows[0];

      // Asiento: nace el derecho de cobro contra el ingreso reconocido.
      const base = base_imponible != null ? round2(num(base_imponible)) : m;
      const ivaMonto = iva != null ? round2(num(iva)) : round2(m - base);
      const lineas = [
        { cuenta: CUENTAS.CXC, debe: m, haber: 0, descripcion: 'Cuenta por cobrar' },
        { cuenta: CUENTAS.INGRESOS, debe: 0, haber: base, descripcion: 'Ingreso a crédito' },
      ];
      if (ivaMonto > 0) {
        lineas.push({ cuenta: CUENTAS.IVA_POR_PAGAR, debe: 0, haber: ivaMonto, descripcion: 'IVA débito fiscal' });
      }
      const asiento = await registrarAsiento(client, {
        descripcion: `Cuenta por cobrar de ${cliente_nombre || 'cliente'}`,
        referencia_tipo: 'cxc', referencia_id: cuenta.id,
        lineas, usuario_id: req.user.id, sucursal_id: sucursalId,
      });

      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'cuenta_cobrar', entidad_id: cuenta.id,
        datos_despues: cuenta, ip: ipDe(req),
      });
      return { cuenta: mapCuenta(cuenta), asiento };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Cobro (total o parcial) de una cuenta por cobrar. */
cxcRouter.post('/:id/cobrar', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { monto, metodo_pago_id, cuenta_destino_id, observacion } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_cuentas_cobrar WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Cuenta por cobrar no encontrada'); e.status = 404; throw e; }
      const cuenta = rows[0];
      if (cuenta.estado === 'anulada') { const e = new Error('La cuenta está anulada'); e.status = 409; throw e; }
      const saldo = round2(num(cuenta.saldo));
      if (saldo <= 0.009) { const e = new Error('La cuenta ya está cobrada'); e.status = 409; throw e; }

      let m = round2(num(monto));
      if (m <= 0) m = saldo;
      if (m > saldo + 0.02) { const e = new Error(`El cobro (${m}) supera el saldo (${saldo})`); e.status = 400; throw e; }

      const { rows: mp } = await client.query('SELECT * FROM conta_metodos_pago WHERE id = $1', [metodo_pago_id]);
      const metodo = mp[0] || null;

      const nuevoPagado = round2(num(cuenta.monto_pagado) + m);
      const nuevoSaldo = round2(saldo - m);
      await client.query(
        `UPDATE conta_cuentas_cobrar SET monto_pagado = $1, saldo = $2, estado = $3 WHERE id = $4`,
        [nuevoPagado, nuevoSaldo, nuevoSaldo <= 0.009 ? 'pagada' : 'pendiente', cuenta.id]
      );
      await client.query(
        `INSERT INTO conta_cobros_pagos
           (tipo, referencia_id, monto, metodo_pago_id, cuenta_destino_id, observacion, creado_por)
         VALUES ('cobro',$1,$2,$3,$4,$5,$6)`,
        [cuenta.id, m, metodo ? metodo.id : null, cuenta_destino_id || null, observacion || null, req.user.id]
      );
      const asiento = await registrarAsiento(client, {
        descripcion: `Cobro de cuenta por cobrar #${cuenta.id}`,
        referencia_tipo: 'cxc', referencia_id: cuenta.id,
        lineas: [
          { cuenta: cuentaDeMetodo(metodo ? metodo.tipo : 'efectivo'), debe: m, haber: 0,
            descripcion: `Ingreso ${metodo ? metodo.nombre : 'efectivo'}` },
          { cuenta: CUENTAS.CXC, debe: 0, haber: m, descripcion: 'Cobro de cuenta por cobrar' },
        ],
        usuario_id: req.user.id, sucursal_id: cuenta.sucursal_id,
      });
      await auditar(client, {
        usuario_id: req.user.id, accion: 'cobro', entidad: 'cuenta_cobrar', entidad_id: cuenta.id,
        datos_antes: { saldo }, datos_despues: { saldo: nuevoSaldo, monto: m }, ip: ipDe(req),
      });
      return { cuenta_id: cuenta.id, monto_cobrado: m, saldo: nuevoSaldo, asiento };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

cxcRouter.post('/:id/recordatorio', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_cuentas_cobrar WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cuenta por cobrar no encontrada' });
    const c = rows[0];
    const dias = diasDeVencimiento(c.vencimiento);
    const alerta = await crearAlerta(db, {
      tipo: 'cxc_vencida', severidad: dias > 30 ? 'alta' : 'media',
      mensaje: `Recordatorio: ${c.cliente_nombre || 'cliente'} mantiene ${round2(num(c.saldo))} BOB ` +
               `pendientes${dias > 0 ? ` (vencido hace ${dias} días)` : ''}`,
      entidad: 'cuenta_cobrar', entidad_id: c.id,
      datos: { saldo: num(c.saldo), vencimiento: c.vencimiento, dias_vencido: dias },
      sucursal_id: c.sucursal_id,
    });
    await auditar(db, {
      usuario_id: req.user.id, accion: 'recordatorio', entidad: 'cuenta_cobrar', entidad_id: c.id,
      datos_despues: { dias_vencido: dias }, ip: ipDe(req),
    });
    res.json({ ok: true, alerta_creada: !!alerta, alerta });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

cxcRouter.post('/:id/anular', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_cuentas_cobrar WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Cuenta por cobrar no encontrada'); e.status = 404; throw e; }
      if (num(rows[0].monto_pagado) > 0) {
        const e = new Error('No se puede anular una cuenta con cobros registrados'); e.status = 409; throw e;
      }
      const { rows: upd } = await client.query(
        `UPDATE conta_cuentas_cobrar SET estado = 'anulada', saldo = 0 WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      await client.query(
        `UPDATE conta_asientos_contables SET estado = 'anulado'
          WHERE referencia_tipo = 'cxc' AND referencia_id = $1`, [req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'anular', entidad: 'cuenta_cobrar', entidad_id: req.params.id,
        datos_antes: rows[0], datos_despues: { ...upd[0], motivo: motivo || null }, ip: ipDe(req),
      });
      return upd[0];
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// =============================================================================
// CUENTAS POR PAGAR (CxP)
// =============================================================================
cxpRouter.get('/', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const params = [];
    let sql = `
      SELECT cp.*, p.nombre AS proveedor
        FROM conta_cuentas_pagar cp
        LEFT JOIN conta_proveedores p ON p.id = cp.proveedor_id
       WHERE 1=1`;
    if (req.query.estado) { params.push(req.query.estado); sql += ` AND cp.estado = $${params.length}`; }
    if (req.query.proveedor_id) { params.push(req.query.proveedor_id); sql += ` AND cp.proveedor_id = $${params.length}`; }
    if (req.query.desde) { params.push(req.query.desde); sql += ` AND cp.creado_en >= $${params.length}::date`; }
    if (req.query.hasta) { params.push(req.query.hasta); sql += ` AND cp.creado_en < ($${params.length}::date + INTERVAL '1 day')`; }
    sql += ' ORDER BY (cp.saldo > 0) DESC, cp.vencimiento NULLS LAST, cp.id DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map(mapCuenta));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

cxpRouter.get('/aging', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, proveedor_id, saldo, vencimiento, estado
         FROM conta_cuentas_pagar WHERE estado <> 'anulada' AND saldo > 0.009`
    );
    const buckets = {};
    let total = 0;
    for (const r of rows) {
      const b = bucket(diasDeVencimiento(r.vencimiento));
      const saldo = num(r.saldo);
      buckets[b] = round2((buckets[b] || 0) + saldo);
      total += saldo;
    }
    res.json({
      total: round2(total),
      proveedores: new Set(rows.map((r) => r.proveedor_id)).size,
      cuentas: rows.length,
      buckets,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

cxpRouter.get('/recordatorios', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT cp.id, cp.saldo, cp.vencimiento, cp.estado, p.nombre AS proveedor
         FROM conta_cuentas_pagar cp
         LEFT JOIN conta_proveedores p ON p.id = cp.proveedor_id
        WHERE cp.estado <> 'anulada' AND cp.saldo > 0.009
          AND cp.vencimiento IS NOT NULL AND cp.vencimiento <= CURRENT_DATE
        ORDER BY cp.vencimiento`
    );
    res.json(rows.map((r) => ({
      ...r, saldo: num(r.saldo), dias_vencido: diasDeVencimiento(r.vencimiento),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

cxpRouter.get('/:id', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT cp.*, p.nombre AS proveedor FROM conta_cuentas_pagar cp
        LEFT JOIN conta_proveedores p ON p.id = cp.proveedor_id WHERE cp.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cuenta por pagar no encontrada' });
    const { rows: pagos } = await query(
      `SELECT cp.*, mp.nombre AS metodo, cd.nombre AS cuenta
         FROM conta_cobros_pagos cp
         LEFT JOIN conta_metodos_pago mp ON mp.id = cp.metodo_pago_id
         LEFT JOIN conta_cuentas_destino cd ON cd.id = cp.cuenta_destino_id
        WHERE cp.tipo = 'pago' AND cp.referencia_id = $1
        ORDER BY cp.creado_en DESC`,
      [req.params.id]
    );
    res.json({ cuenta: mapCuenta(rows[0]), pagos: pagos.map((p) => ({ ...p, monto: num(p.monto) })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

cxpRouter.post('/:id/pagar', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { monto, metodo_pago_id, cuenta_destino_id, observacion } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_cuentas_pagar WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Cuenta por pagar no encontrada'); e.status = 404; throw e; }
      const cuenta = rows[0];
      if (cuenta.estado === 'anulada') { const e = new Error('La cuenta está anulada'); e.status = 409; throw e; }
      const saldo = round2(num(cuenta.saldo));
      if (saldo <= 0.009) { const e = new Error('La cuenta ya está pagada'); e.status = 409; throw e; }

      let m = round2(num(monto));
      if (m <= 0) m = saldo;
      if (m > saldo + 0.02) { const e = new Error(`El pago (${m}) supera el saldo (${saldo})`); e.status = 400; throw e; }

      const { rows: mp } = await client.query('SELECT * FROM conta_metodos_pago WHERE id = $1', [metodo_pago_id]);
      const metodo = mp[0] || null;

      const nuevoPagado = round2(num(cuenta.monto_pagado) + m);
      const nuevoSaldo = round2(saldo - m);
      await client.query(
        `UPDATE conta_cuentas_pagar SET monto_pagado = $1, saldo = $2, estado = $3 WHERE id = $4`,
        [nuevoPagado, nuevoSaldo, nuevoSaldo <= 0.009 ? 'pagada' : 'pendiente', cuenta.id]
      );
      await client.query(
        `INSERT INTO conta_cobros_pagos
           (tipo, referencia_id, monto, metodo_pago_id, cuenta_destino_id, observacion, creado_por)
         VALUES ('pago',$1,$2,$3,$4,$5,$6)`,
        [cuenta.id, m, metodo ? metodo.id : null, cuenta_destino_id || null, observacion || null, req.user.id]
      );
      const asiento = await registrarAsiento(client, {
        descripcion: `Pago de cuenta por pagar #${cuenta.id}`,
        referencia_tipo: 'cxp', referencia_id: cuenta.id,
        lineas: [
          { cuenta: CUENTAS.CXP, debe: m, haber: 0, descripcion: 'Pago de cuenta por pagar' },
          { cuenta: cuentaDeMetodo(metodo ? metodo.tipo : 'efectivo'), debe: 0, haber: m,
            descripcion: `Salida ${metodo ? metodo.nombre : 'efectivo'}` },
        ],
        usuario_id: req.user.id, sucursal_id: cuenta.sucursal_id,
      });
      await auditar(client, {
        usuario_id: req.user.id, accion: 'pago', entidad: 'cuenta_pagar', entidad_id: cuenta.id,
        datos_antes: { saldo }, datos_despues: { saldo: nuevoSaldo, monto: m }, ip: ipDe(req),
      });
      return { cuenta_id: cuenta.id, monto_pagado: m, saldo: nuevoSaldo, asiento };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

cxpRouter.post('/:id/recordatorio', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_cuentas_pagar WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cuenta por pagar no encontrada' });
    const c = rows[0];
    const dias = diasDeVencimiento(c.vencimiento);
    const alerta = await crearAlerta(db, {
      tipo: 'cxp_vencida', severidad: 'media',
      mensaje: `Cuenta por pagar #${c.id} vencida${dias > 0 ? ` hace ${dias} días` : ''}: ${round2(num(c.saldo))} BOB`,
      entidad: 'cuenta_pagar', entidad_id: c.id,
      datos: { saldo: num(c.saldo), vencimiento: c.vencimiento, dias_vencido: dias },
      sucursal_id: c.sucursal_id,
    });
    await auditar(db, {
      usuario_id: req.user.id, accion: 'recordatorio', entidad: 'cuenta_pagar', entidad_id: c.id,
      datos_despues: { dias_vencido: dias }, ip: ipDe(req),
    });
    res.json({ ok: true, alerta_creada: !!alerta, alerta });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

cxpRouter.post('/:id/anular', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_cuentas_pagar WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Cuenta por pagar no encontrada'); e.status = 404; throw e; }
      if (num(rows[0].monto_pagado) > 0) {
        const e = new Error('No se puede anular una cuenta con pagos registrados'); e.status = 409; throw e;
      }
      const { rows: upd } = await client.query(
        `UPDATE conta_cuentas_pagar SET estado = 'anulada', saldo = 0 WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      await client.query(
        `UPDATE conta_asientos_contables SET estado = 'anulado'
          WHERE referencia_tipo = 'cxp' AND referencia_id = $1`, [req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'anular', entidad: 'cuenta_pagar', entidad_id: req.params.id,
        datos_antes: rows[0], datos_despues: { ...upd[0], motivo: motivo || null }, ip: ipDe(req),
      });
      return upd[0];
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
