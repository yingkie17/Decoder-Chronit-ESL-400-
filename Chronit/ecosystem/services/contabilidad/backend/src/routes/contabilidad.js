// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: LIBRO DIARIO, MAYOR, BALANCE Y RESULTADOS
// -----------------------------------------------------------------------------
//   GET  /api/conta/contabilidad/cuentas          -> plan de cuentas
//   GET  /api/conta/contabilidad/asientos         -> libro diario (filtros)
//   GET  /api/conta/contabilidad/asientos/:id     -> asiento + líneas
//   POST /api/conta/contabilidad/asientos         -> asiento manual
//   POST /api/conta/contabilidad/asientos/:id/anular
//   GET  /api/conta/contabilidad/libro-diario     -> libro diario con líneas
//   GET  /api/conta/contabilidad/libro-mayor      -> mayor por cuenta
//   GET  /api/conta/contabilidad/balance-general  -> balance a una fecha
//   GET  /api/conta/contabilidad/estado-resultados-> resultado del período
//
// Todo asiento cuadra (debe = haber); `registrarAsiento` lo valida al crearlo.
// Los reportes leen los asientos registrados: nunca recalculan la operación.
// =============================================================================
import { Router } from 'express';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole, FINANZAS } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, round2, fechaISO } from '../utils/helpers.js';
import { registrarAsiento } from '../utils/contabilidad.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const contabilidadRouter = Router();

const GESTION = ['contador', 'supervisor', 'admin'];

/** "Nombre Apellido" del usuario, o NULL si no tiene nombre cargado. */
const NOMBRE_USUARIO =
  "NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '')";

/** Saldos por cuenta en un rango [desde, hasta] de fechas de asiento. */
async function saldosPorCuenta(db, { desde, hasta }) {
  const params = [];
  let filtro = ` WHERE a.estado = 'registrado'`;
  if (desde) { params.push(desde); filtro += ` AND a.fecha >= $${params.length}::date`; }
  if (hasta) { params.push(hasta); filtro += ` AND a.fecha <= $${params.length}::date`; }
  const { rows } = await query(
    `SELECT l.cuenta_contable AS codigo,
            COALESCE(cc.nombre, l.cuenta_contable) AS nombre,
            COALESCE(cc.tipo, 'otro') AS tipo,
            COALESCE(SUM(l.debe),0)  AS debe,
            COALESCE(SUM(l.haber),0) AS haber
       FROM conta_asiento_lineas l
       JOIN conta_asientos_contables a ON a.id = l.asiento_id
       LEFT JOIN conta_cuentas_contables cc ON cc.codigo = l.cuenta_contable
      ${filtro}
      GROUP BY l.cuenta_contable, cc.nombre, cc.tipo
      ORDER BY l.cuenta_contable`, params
  );
  return rows.map((r) => {
    const debe = round2(num(r.debe));
    const haber = round2(num(r.haber));
    const deudora = ['activo', 'costo', 'gasto'].includes(r.tipo);
    const saldo = round2(deudora ? debe - haber : haber - debe);
    return { ...r, debe, haber, saldo, deudora };
  });
}

// =============================================================================
// PLAN DE CUENTAS
// =============================================================================
contabilidadRouter.get('/cuentas', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM conta_cuentas_contables
        WHERE ($1::boolean IS NOT TRUE) OR activo = true
        ORDER BY codigo`,
      [req.query.activo === 'true']
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// ASIENTOS (libro diario)
// =============================================================================
contabilidadRouter.get('/asientos', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const params = [];
    let sql = `
      SELECT a.*, ${NOMBRE_USUARIO} AS creado_por_nombre,
             (SELECT COUNT(*)::int FROM conta_asiento_lineas l WHERE l.asiento_id = a.id) AS n_lineas
        FROM conta_asientos_contables a
        LEFT JOIN usuarios u ON u.id = a.creado_por
       WHERE 1=1`;
    if (req.query.desde) { params.push(req.query.desde); sql += ` AND a.fecha >= $${params.length}::date`; }
    if (req.query.hasta) { params.push(req.query.hasta); sql += ` AND a.fecha <= $${params.length}::date`; }
    if (req.query.referencia_tipo) { params.push(req.query.referencia_tipo); sql += ` AND a.referencia_tipo = $${params.length}`; }
    if (req.query.estado) { params.push(req.query.estado); sql += ` AND a.estado = $${params.length}`; }
    if (req.query.tipo) { params.push(req.query.tipo); sql += ` AND a.tipo = $${params.length}`; }
    sql += ' ORDER BY a.fecha DESC, a.id DESC LIMIT 1000';
    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({
      ...r, total_debe: num(r.total_debe), total_haber: num(r.total_haber),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

contabilidadRouter.get('/asientos/:id', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_asientos_contables WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Asiento no encontrado' });
    const { rows: lineas } = await query(
      `SELECT l.*, cc.nombre AS cuenta_nombre
         FROM conta_asiento_lineas l
         LEFT JOIN conta_cuentas_contables cc ON cc.codigo = l.cuenta_contable
        WHERE l.asiento_id = $1 ORDER BY l.id`,
      [req.params.id]
    );
    res.json({
      asiento: { ...rows[0], total_debe: num(rows[0].total_debe), total_haber: num(rows[0].total_haber) },
      lineas: lineas.map((l) => ({ ...l, debe: num(l.debe), haber: num(l.haber) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Asiento manual (ajustes del contador). */
contabilidadRouter.post('/asientos', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { fecha, descripcion, lineas, tipo } = req.body || {};
    if (!descripcion) return res.status(400).json({ error: 'La descripción es obligatoria' });
    if (!Array.isArray(lineas) || !lineas.length) {
      return res.status(400).json({ error: 'El asiento debe tener al menos una línea' });
    }
    const sucursalId = await sucursalDePeticion(db, req);
    const resultado = await withTx(async (client) => {
      const asiento = await registrarAsiento(client, {
        fecha: fecha || fechaISO(),
        descripcion,
        tipo: tipo === 'manual' || !tipo ? 'manual' : tipo,
        referencia_tipo: 'manual',
        lineas,
        usuario_id: req.user.id,
        sucursal_id: sucursalId,
      });
      if (!asiento) { const e = new Error('Las líneas del asiento no tienen importes'); e.status = 400; throw e; }
      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'asiento', entidad_id: asiento.id,
        datos_despues: { ...asiento, lineas }, ip: ipDe(req),
      });
      return asiento;
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

contabilidadRouter.post('/asientos/:id/anular', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_asientos_contables WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Asiento no encontrado'); e.status = 404; throw e; }
      if (rows[0].estado === 'anulado') { const e = new Error('El asiento ya está anulado'); e.status = 409; throw e; }
      if (rows[0].tipo === 'automatico') {
        const e = new Error('Un asiento automático se revierte anulando el documento que lo originó');
        e.status = 409; throw e;
      }
      const { rows: upd } = await client.query(
        `UPDATE conta_asientos_contables SET estado = 'anulado' WHERE id = $1 RETURNING *`, [req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'anular', entidad: 'asiento', entidad_id: req.params.id,
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
// LIBRO DIARIO (con líneas)
// =============================================================================
contabilidadRouter.get('/libro-diario', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const hasta = String(req.query.hasta || fechaISO());
    const desde = String(req.query.desde || fechaISO(new Date(Date.now() - 29 * 86400000)));
    const { rows: asientos } = await query(
      `SELECT a.id, a.fecha, a.tipo, a.descripcion, a.referencia_tipo, a.referencia_id,
              a.total_debe, a.total_haber, a.estado
         FROM conta_asientos_contables a
        WHERE a.fecha >= $1::date AND a.fecha <= $2::date AND a.estado = 'registrado'
        ORDER BY a.fecha, a.id`, [desde, hasta]
    );
    const { rows: lineas } = await query(
      `SELECT l.asiento_id, l.cuenta_contable, COALESCE(cc.nombre, l.cuenta_contable) AS cuenta_nombre,
              l.debe, l.haber, l.descripcion
         FROM conta_asiento_lineas l
         JOIN conta_asientos_contables a ON a.id = l.asiento_id
         LEFT JOIN conta_cuentas_contables cc ON cc.codigo = l.cuenta_contable
        WHERE a.fecha >= $1::date AND a.fecha <= $2::date AND a.estado = 'registrado'
        ORDER BY l.id`, [desde, hasta]
    );
    const porAsiento = new Map();
    for (const l of lineas) {
      if (!porAsiento.has(l.asiento_id)) porAsiento.set(l.asiento_id, []);
      porAsiento.get(l.asiento_id).push({ ...l, debe: num(l.debe), haber: num(l.haber) });
    }
    const filas = asientos.map((a) => ({
      ...a, total_debe: num(a.total_debe), total_haber: num(a.total_haber),
      lineas: porAsiento.get(a.id) || [],
    }));
    res.json({
      desde, hasta,
      asientos: filas,
      resumen: {
        asientos: filas.length,
        total_debe: round2(filas.reduce((s, a) => s + a.total_debe, 0)),
        total_haber: round2(filas.reduce((s, a) => s + a.total_haber, 0)),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// LIBRO MAYOR (movimientos y saldo por cuenta)
// =============================================================================
contabilidadRouter.get('/libro-mayor', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const hasta = String(req.query.hasta || fechaISO());
    const desde = String(req.query.desde || fechaISO(new Date(Date.now() - 29 * 86400000)));
    const params = [desde, hasta];
    let filtro = '';
    if (req.query.cuenta) { params.push(String(req.query.cuenta)); filtro = ` AND l.cuenta_contable = $${params.length}`; }
    const { rows } = await query(
      `SELECT l.cuenta_contable AS codigo, COALESCE(cc.nombre, l.cuenta_contable) AS nombre,
              COALESCE(cc.tipo, 'otro') AS tipo, a.fecha, a.id AS asiento_id,
              a.descripcion AS asiento_descripcion, l.descripcion,
              l.debe, l.haber
         FROM conta_asiento_lineas l
         JOIN conta_asientos_contables a ON a.id = l.asiento_id
         LEFT JOIN conta_cuentas_contables cc ON cc.codigo = l.cuenta_contable
        WHERE a.estado = 'registrado' AND a.fecha >= $1::date AND a.fecha <= $2::date${filtro}
        ORDER BY l.cuenta_contable, a.fecha, a.id, l.id`, params
    );

    const cuentas = new Map();
    for (const r of rows) {
      if (!cuentas.has(r.codigo)) {
        cuentas.set(r.codigo, {
          codigo: r.codigo, nombre: r.nombre, tipo: r.tipo,
          deudora: ['activo', 'costo', 'gasto'].includes(r.tipo),
          movimientos: [], total_debe: 0, total_haber: 0,
        });
      }
      const c = cuentas.get(r.codigo);
      const debe = num(r.debe);
      const haber = num(r.haber);
      c.total_debe = round2(c.total_debe + debe);
      c.total_haber = round2(c.total_haber + haber);
      c.movimientos.push({ ...r, debe, haber });
    }
    const resultado = [...cuentas.values()].map((c) => ({
      ...c, saldo: round2(c.deudora ? c.total_debe - c.total_haber : c.total_haber - c.total_debe),
    }));
    res.json({ desde, hasta, cuentas: resultado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// BALANCE GENERAL
// =============================================================================
contabilidadRouter.get('/balance-general', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const fecha = String(req.query.fecha || fechaISO());
    const saldos = await saldosPorCuenta(db, { hasta: fecha });

    const conSaldo = (tipo) => saldos.filter((s) => s.tipo === tipo && Math.abs(s.saldo) > 0.009);
    const activo = conSaldo('activo');
    const pasivo = conSaldo('pasivo');
    const patrimonio = conSaldo('patrimonio');
    // El resultado del período se incorpora al patrimonio para que el balance cuadre.
    const totalIngresos = round2(saldos.filter((s) => s.tipo === 'ingreso').reduce((a, s) => a + s.saldo, 0));
    const totalCostos = round2(saldos.filter((s) => s.tipo === 'costo').reduce((a, s) => a + s.saldo, 0));
    const totalGastos = round2(saldos.filter((s) => s.tipo === 'gasto').reduce((a, s) => a + s.saldo, 0));
    const resultadoEjercicio = round2(totalIngresos - totalCostos - totalGastos);

    const totalActivo = round2(activo.reduce((a, s) => a + s.saldo, 0));
    const totalPasivo = round2(pasivo.reduce((a, s) => a + s.saldo, 0));
    const totalPatrimonio = round2(patrimonio.reduce((a, s) => a + s.saldo, 0) + resultadoEjercicio);

    res.json({
      fecha,
      activo, pasivo, patrimonio,
      resumen: {
        total_activo: totalActivo,
        total_pasivo: totalPasivo,
        total_patrimonio: totalPatrimonio,
        resultado_ejercicio: resultadoEjercicio,
        total_pasivo_patrimonio: round2(totalPasivo + totalPatrimonio),
        cuadra: Math.abs(totalActivo - (totalPasivo + totalPatrimonio)) <= 0.02,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// ESTADO DE RESULTADOS
// =============================================================================
contabilidadRouter.get('/estado-resultados', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const hasta = String(req.query.hasta || fechaISO());
    const desde = String(req.query.desde || `${hasta.slice(0, 4)}-01-01`);
    const saldos = await saldosPorCuenta(db, { desde, hasta });
    const ingresos = saldos.filter((s) => s.tipo === 'ingreso');
    const costos = saldos.filter((s) => s.tipo === 'costo');
    const gastos = saldos.filter((s) => s.tipo === 'gasto');

    const totalIngresos = round2(ingresos.reduce((a, s) => a + s.saldo, 0));
    const totalCostos = round2(costos.reduce((a, s) => a + s.saldo, 0));
    const totalGastos = round2(gastos.reduce((a, s) => a + s.saldo, 0));
    const utilidadBruta = round2(totalIngresos - totalCostos);
    const resultado = round2(utilidadBruta - totalGastos);

    res.json({
      desde, hasta,
      ingresos, costos, gastos,
      resumen: {
        total_ingresos: totalIngresos,
        total_costos: totalCostos,
        utilidad_bruta: utilidadBruta,
        total_gastos: totalGastos,
        resultado_neto: resultado,
        margen: totalIngresos > 0 ? round2((resultado / totalIngresos) * 100) : 0,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Utilidad reutilizada por los reportes contables (libro diario/mayor/balance). */
export { saldosPorCuenta };
