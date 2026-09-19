// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: combos, promociones y métodos de pago
// -----------------------------------------------------------------------------
//   /api/conta/combos          (GET, POST, PUT/:id, DELETE/:id)   contador+
//   /api/conta/promociones     (GET, POST, PUT/:id, DELETE/:id)   contador+
//   /api/conta/metodos-pago    (GET, POST, PUT/:id)               admin
//
// modo_facturacion del combo: 'unico' (1 línea) | 'desglosado' (N líneas con
// es_componente_combo = true y combo_padre_id apuntando a la línea padre).
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num } from '../utils/helpers.js';

const GESTION_CATALOGO = ['contador', 'supervisor', 'admin'];

export const combosRouter = Router();
export const promocionesRouter = Router();
export const metodosPagoRouter = Router();

// ---------------------------------------------------------------------------
// COMBOS
// ---------------------------------------------------------------------------
combosRouter.get('/', requireAuth, async (req, res) => {
  try {
    const inactivos = req.query.inactivos === 'true';
    const { rows } = await query(
      `SELECT * FROM conta_combos ${inactivos ? '' : 'WHERE activo = true'} ORDER BY nombre`
    );
    res.json(rows.map((c) => ({ ...c, precio: num(c.precio) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

combosRouter.post('/', requireAuth, requireRole(...GESTION_CATALOGO), async (req, res) => {
  try {
    const { nombre, items, precio, modo_facturacion, iva_modo_hereda, iva_modo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await query(
      `INSERT INTO conta_combos (nombre, items, precio, modo_facturacion, iva_modo_hereda, iva_modo)
       VALUES ($1,$2::jsonb,$3,$4,$5,$6) RETURNING *`,
      [nombre, JSON.stringify(items || []), num(precio), modo_facturacion || 'unico',
       iva_modo_hereda !== false, iva_modo || 'hereda']
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'combo', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un combo con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

combosRouter.put('/:id', requireAuth, requireRole(...GESTION_CATALOGO), async (req, res) => {
  try {
    const campos = ['nombre', 'items', 'precio', 'activo', 'modo_facturacion', 'iva_modo_hereda', 'iva_modo'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in req.body) {
        const val = c === 'items' ? JSON.stringify(req.body[c]) : req.body[c];
        params.push(val);
        sets.push(`${c} = $${params.length}${c === 'items' ? '::jsonb' : ''}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE conta_combos SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    if (!rows.length) return res.status(404).json({ error: 'Combo no encontrado' });
    await auditar(null, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'combo', entidad_id: req.params.id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

combosRouter.delete('/:id', requireAuth, requireRole(...GESTION_CATALOGO), async (req, res) => {
  try {
    const { rows } = await query('UPDATE conta_combos SET activo = false WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Combo no encontrado' });
    await auditar(null, {
      usuario_id: req.user.id, accion: 'desactivar', entidad: 'combo', entidad_id: req.params.id, ip: ipDe(req),
    });
    res.json({ ok: true, combo: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// PROMOCIONES
// ---------------------------------------------------------------------------
promocionesRouter.get('/', requireAuth, async (req, res) => {
  try {
    const inactivas = req.query.inactivas === 'true';
    const { rows } = await query(
      `SELECT * FROM conta_promociones ${inactivas ? '' : 'WHERE activo = true'} ORDER BY id DESC`
    );
    res.json(rows.map((p) => ({ ...p, descuento_valor: num(p.descuento_valor) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

promocionesRouter.post('/', requireAuth, requireRole(...GESTION_CATALOGO), async (req, res) => {
  try {
    const {
      nombre, tipo, condiciones, descuento_tipo, descuento_valor,
      vigencia_desde, vigencia_hasta, activo, requiere_autorizacion,
    } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await query(
      `INSERT INTO conta_promociones
        (nombre, tipo, condiciones, descuento_tipo, descuento_valor, vigencia_desde, vigencia_hasta, activo, requiere_autorizacion)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [nombre, tipo || 'descuento', JSON.stringify(condiciones || {}), descuento_tipo || 'monto',
       num(descuento_valor), vigencia_desde || null, vigencia_hasta || null, activo !== false,
       !!requiere_autorizacion]
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'promocion', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

promocionesRouter.put('/:id', requireAuth, requireRole(...GESTION_CATALOGO), async (req, res) => {
  try {
    const campos = ['nombre', 'tipo', 'condiciones', 'descuento_tipo', 'descuento_valor',
      'vigencia_desde', 'vigencia_hasta', 'activo', 'requiere_autorizacion'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in req.body) {
        const val = c === 'condiciones' ? JSON.stringify(req.body[c]) : req.body[c];
        params.push(val);
        sets.push(`${c} = $${params.length}${c === 'condiciones' ? '::jsonb' : ''}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE conta_promociones SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    if (!rows.length) return res.status(404).json({ error: 'Promoción no encontrada' });
    await auditar(null, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'promocion', entidad_id: req.params.id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

promocionesRouter.delete('/:id', requireAuth, requireRole(...GESTION_CATALOGO), async (req, res) => {
  try {
    const { rows } = await query('UPDATE conta_promociones SET activo = false WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Promoción no encontrada' });
    res.json({ ok: true, promocion: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// MÉTODOS DE PAGO
// ---------------------------------------------------------------------------
metodosPagoRouter.get('/', requireAuth, async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_metodos_pago ORDER BY id');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

metodosPagoRouter.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { nombre, tipo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await query(
      'INSERT INTO conta_metodos_pago (nombre, tipo) VALUES ($1,$2) RETURNING *',
      [nombre, tipo || 'efectivo']
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe ese método de pago' });
    res.status(500).json({ error: e.message });
  }
});

metodosPagoRouter.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { nombre, tipo } = req.body;
    const { rows } = await query(
      `UPDATE conta_metodos_pago SET nombre = COALESCE($1, nombre), tipo = COALESCE($2, tipo)
        WHERE id = $3 RETURNING *`,
      [nombre || null, tipo || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Método de pago no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
