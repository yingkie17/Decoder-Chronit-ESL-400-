// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: ACTIVOS FIJOS y DEPRECIACIÓN
// -----------------------------------------------------------------------------
//   GET  /api/conta/activos                     -> listar (filtros)
//   GET  /api/conta/activos/depreciaciones      -> historial de depreciaciones
//   GET  /api/conta/activos/valor-libro         -> reporte de valor en libros
//   POST /api/conta/activos/depreciar           -> depreciación mensual (idempotente)
//   GET  /api/conta/activos/:id                 -> detalle + depreciaciones
//   POST /api/conta/activos                     -> crear
//   PUT  /api/conta/activos/:id                 -> editar
//   POST /api/conta/activos/:id/baja            -> dar de baja / vender
//
// DEPRECIACIÓN: línea recta mensual = (costo - valor_residual) / vida_util_meses.
// El acumulado se topa en (costo - valor_residual) y cada período genera su
// asiento contable. UNIQUE(activo_id, periodo) la hace idempotente.
// =============================================================================
import { Router } from 'express';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole, FINANZAS } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, round2, fechaISO } from '../utils/helpers.js';
import { asientoDeDepreciacion } from '../utils/contabilidad.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const activosRouter = Router();

const GESTION = ['contador', 'supervisor', 'admin'];
const PERIODO_RE = /^\d{4}-\d{2}$/;

const mapActivo = (r) => ({
  ...r,
  costo: num(r.costo),
  valor_residual: num(r.valor_residual),
  depreciacion_acumulada: num(r.depreciacion_acumulada),
  valor_libro: num(r.valor_libro),
});

/** Depreciación mensual teórica del activo (sin topar). */
function cuotaMensual(a) {
  const meses = Math.max(1, Number(a.vida_util_meses || 1));
  return round2((num(a.costo) - num(a.valor_residual)) / meses);
}

// =============================================================================
// RUTAS ESPECÍFICAS (antes de /:id)
// =============================================================================
activosRouter.get('/depreciaciones', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const params = [];
    let sql = `
      SELECT d.*, a.nombre AS activo, a.sucursal_id
        FROM conta_depreciaciones d
        JOIN conta_activos_fijos a ON a.id = d.activo_id
       WHERE 1=1`;
    if (req.query.activo_id) { params.push(req.query.activo_id); sql += ` AND d.activo_id = $${params.length}`; }
    if (req.query.periodo) { params.push(req.query.periodo); sql += ` AND d.periodo = $${params.length}`; }
    if (req.query.desde) { params.push(req.query.desde); sql += ` AND d.periodo >= $${params.length}`; }
    if (req.query.hasta) { params.push(req.query.hasta); sql += ` AND d.periodo <= $${params.length}`; }
    sql += ' ORDER BY d.periodo DESC, d.activo_id LIMIT 1000';
    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({ ...r, monto: num(r.monto), acumulada: num(r.acumulada) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

activosRouter.get('/valor-libro', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const params = [sucursalId];
    let filtro = ' WHERE sucursal_id = $1';
    if (req.query.estado) { params.push(req.query.estado); filtro += ` AND estado = $${params.length}`; }
    const { rows } = await query(
      `SELECT id, nombre, tipo, marca, modelo, fecha_adquisicion, costo, vida_util_meses,
              valor_residual, depreciacion_acumulada, valor_libro, estado
         FROM conta_activos_fijos${filtro} ORDER BY nombre`, params
    );
    const filas = rows.map(mapActivo);
    res.json({
      filas,
      resumen: {
        activos: filas.length,
        costo_total: round2(filas.reduce((a, f) => a + f.costo, 0)),
        depreciacion_acumulada: round2(filas.reduce((a, f) => a + f.depreciacion_acumulada, 0)),
        valor_libro: round2(filas.reduce((a, f) => a + f.valor_libro, 0)),
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * Depreciación mensual de todos los activos. Idempotente: si el activo ya tiene
 * una depreciación del período, se omite.
 */
activosRouter.post('/depreciar', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const periodo = PERIODO_RE.test(String(req.body?.periodo || ''))
      ? String(req.body.periodo)
      : fechaISO().slice(0, 7);   // YYYY-MM
    const sucursalId = await sucursalDePeticion(db, req);

    const resultado = await withTx(async (client) => {
      const { rows: activos } = await client.query(
        `SELECT * FROM conta_activos_fijos WHERE estado = 'activo' AND sucursal_id = $1 ORDER BY id`,
        [sucursalId]
      );
      const procesados = [];
      const omitidos = [];
      for (const a of activos) {
        const { rows: ya } = await client.query(
          `SELECT 1 FROM conta_depreciaciones WHERE activo_id = $1 AND periodo = $2`, [a.id, periodo]
        );
        if (ya.length) { omitidos.push({ activo_id: a.id, motivo: 'período ya depreciado' }); continue; }

        const tope = round2(num(a.costo) - num(a.valor_residual));
        const pendiente = round2(tope - num(a.depreciacion_acumulada));
        if (pendiente <= 0.009) { omitidos.push({ activo_id: a.id, motivo: 'totalmente depreciado' }); continue; }

        const monto = Math.min(cuotaMensual(a), pendiente);
        const acumulada = round2(num(a.depreciacion_acumulada) + monto);
        const valorLibro = round2(num(a.costo) - acumulada);

        const { rows: dep } = await client.query(
          `INSERT INTO conta_depreciaciones (activo_id, periodo, monto, acumulada, asiento_id)
           VALUES ($1,$2,$3,$4,NULL) RETURNING *`,
          [a.id, periodo, monto, acumulada]
        );
        const asiento = await asientoDeDepreciacion(client, {
          activo: a, monto, periodo, usuario_id: req.user.id,
        });
        await client.query(
          `UPDATE conta_depreciaciones SET asiento_id = $1 WHERE id = $2`,
          [asiento ? asiento.id : null, dep[0].id]
        );
        await client.query(
          `UPDATE conta_activos_fijos SET depreciacion_acumulada = $1, valor_libro = $2 WHERE id = $3`,
          [acumulada, valorLibro, a.id]
        );
        procesados.push({ activo_id: a.id, nombre: a.nombre, monto, acumulada, valor_libro: valorLibro, asiento_id: asiento ? asiento.id : null });
      }
      await auditar(client, {
        usuario_id: req.user.id, accion: 'depreciar', entidad: 'activo_fijo', entidad_id: periodo,
        datos_despues: { periodo, procesados: procesados.length, omitidos: omitidos.length }, ip: ipDe(req),
      });
      return { periodo, procesados, omitidos };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// =============================================================================
// CRUD
// =============================================================================
activosRouter.get('/', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const params = [sucursalId];
    let sql = 'SELECT * FROM conta_activos_fijos WHERE sucursal_id = $1';
    if (req.query.estado) { params.push(req.query.estado); sql += ` AND estado = $${params.length}`; }
    if (req.query.q) { params.push(`%${req.query.q}%`); sql += ` AND nombre ILIKE $${params.length}`; }
    sql += ' ORDER BY estado, nombre LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map(mapActivo));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

activosRouter.post('/', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const {
      nombre, tipo, marca, modelo, numero_serie, fecha_adquisicion,
      costo, vida_util_meses, valor_residual, foto_url,
    } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const c = round2(num(costo));
    if (c <= 0) return res.status(400).json({ error: 'El costo debe ser mayor a 0' });
    const sucursalId = await sucursalDePeticion(db, req);
    const { rows } = await query(
      `INSERT INTO conta_activos_fijos
         (sucursal_id, nombre, tipo, marca, modelo, numero_serie, fecha_adquisicion, costo,
          vida_util_meses, valor_residual, depreciacion_acumulada, valor_libro, estado, foto_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$8,'activo',$11) RETURNING *`,
      [sucursalId, nombre, tipo || null, marca || null, modelo || null, numero_serie || null,
       fecha_adquisicion || fechaISO(), c, Number(vida_util_meses || 60), round2(num(valor_residual)),
       foto_url || null]
    );
    await auditar(db, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'activo_fijo', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(mapActivo(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

activosRouter.get('/:id', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_activos_fijos WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Activo no encontrado' });
    const { rows: dep } = await query(
      `SELECT * FROM conta_depreciaciones WHERE activo_id = $1 ORDER BY periodo DESC`, [req.params.id]
    );
    res.json({
      activo: mapActivo(rows[0]),
      depreciaciones: dep.map((d) => ({ ...d, monto: num(d.monto), acumulada: num(d.acumulada) })),
      cuota_mensual: cuotaMensual(rows[0]),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

activosRouter.put('/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const campos = ['nombre', 'tipo', 'marca', 'modelo', 'numero_serie', 'fecha_adquisicion',
      'costo', 'vida_util_meses', 'valor_residual', 'foto_url'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in (req.body || {})) { params.push(req.body[c]); sets.push(`${c} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    const { rows: antes } = await query('SELECT * FROM conta_activos_fijos WHERE id = $1', [req.params.id]);
    if (!antes.length) return res.status(404).json({ error: 'Activo no encontrado' });

    // Si cambia el costo o el residual, se recalcula el valor en libros.
    const a = { ...antes[0], ...req.body };
    sets.push(`valor_libro = $${params.length + 1}`);
    params.push(round2(num(a.costo) - num(a.depreciacion_acumulada)));
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE conta_activos_fijos SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    await auditar(db, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'activo_fijo', entidad_id: req.params.id,
      datos_antes: antes[0], datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(mapActivo(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

activosRouter.post('/:id/baja', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const estado = ['baja', 'vendido'].includes(String(req.body?.estado)) ? String(req.body.estado) : 'baja';
    const { motivo } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_activos_fijos WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Activo no encontrado'); e.status = 404; throw e; }
      if (rows[0].estado !== 'activo') { const e = new Error(`El activo ya está ${rows[0].estado}`); e.status = 409; throw e; }
      const { rows: upd } = await client.query(
        `UPDATE conta_activos_fijos SET estado = $1 WHERE id = $2 RETURNING *`, [estado, req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: estado === 'vendido' ? 'vender' : 'dar_baja',
        entidad: 'activo_fijo', entidad_id: req.params.id,
        datos_antes: rows[0], datos_despues: { ...upd[0], motivo: motivo || null }, ip: ipDe(req),
      });
      return mapActivo(upd[0]);
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
