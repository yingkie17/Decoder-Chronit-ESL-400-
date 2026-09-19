// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: impuestos
// -----------------------------------------------------------------------------
//   GET /api/conta/impuestos        (autenticado)
//   POST /api/conta/impuestos       (contador+)
//   PUT  /api/conta/impuestos/:id   (contador+)
//
// El NIT del cliente se guarda SIEMPRE (desacoplado de impuestos): no se
// calcula ni reporta impuesto alguno en función del NIT hasta que se habilite
// explícitamente el módulo fiscal.
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num } from '../utils/helpers.js';

export const impuestosRouter = Router();

impuestosRouter.get('/', requireAuth, async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_impuestos ORDER BY tipo, nombre');
    res.json(rows.map((i) => ({ ...i, porcentaje: num(i.porcentaje) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

impuestosRouter.post('/', requireAuth, requireRole('contador', 'supervisor', 'admin'), async (req, res) => {
  try {
    const { nombre, porcentaje, tipo, aplica_a, activo, vigencia_desde, vigencia_hasta } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await query(
      `INSERT INTO conta_impuestos (nombre, porcentaje, tipo, aplica_a, activo, vigencia_desde, vigencia_hasta)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [nombre, num(porcentaje), tipo || 'iva', aplica_a || ['productos'], activo !== false,
       vigencia_desde || null, vigencia_hasta || null]
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'impuesto', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un impuesto con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

impuestosRouter.put('/:id', requireAuth, requireRole('contador', 'supervisor', 'admin'), async (req, res) => {
  try {
    const campos = ['nombre', 'porcentaje', 'tipo', 'aplica_a', 'activo', 'vigencia_desde', 'vigencia_hasta'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in req.body) { params.push(req.body[c]); sets.push(`${c} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const { rows: antes } = await query('SELECT * FROM conta_impuestos WHERE id = $1', [req.params.id]);
    if (!antes.length) return res.status(404).json({ error: 'Impuesto no encontrado' });
    const { rows } = await query(
      `UPDATE conta_impuestos SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'impuesto', entidad_id: req.params.id,
      datos_antes: antes[0], datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
