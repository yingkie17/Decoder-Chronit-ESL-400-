// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: catálogo de productos, listas y precios
// -----------------------------------------------------------------------------
//   GET    /api/conta/catalogo                   -> productos + precio vigente
//   POST   /api/conta/catalogo                   -> crear producto (contador+)
//   PUT    /api/conta/catalogo/:id               -> editar producto
//   DELETE /api/conta/catalogo/:id               -> desactivar (soft delete)
//   GET    /api/conta/catalogo/listas            -> listas de precios + precios
//   POST   /api/conta/catalogo/listas            -> crear lista
//   PUT    /api/conta/catalogo/listas/:id        -> editar lista
//   POST   /api/conta/catalogo/listas/:id/precios-> upsert masivo de precios
//   GET    /api/conta/catalogo/pos               -> catálogo listo para el POS
// =============================================================================
import { Router } from 'express';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { getConfigMap, valorConfig, resolverIvaModo, resolverIvaPorcentaje } from '../utils/finanzas.js';
import { num, fechaISO } from '../utils/helpers.js';

export const catalogoRouter = Router();

// Roles con permiso de gestión de catálogo/precios.
const GESTION = ['contador', 'supervisor', 'admin'];

/** Lista de precios vigente hoy (la de vigencia_desde más reciente). */
export async function listaVigente(db) {
  const hoy = fechaISO();
  const { rows } = await db.query(
    `SELECT * FROM conta_listas_precios
      WHERE activo = true
        AND (vigencia_desde IS NULL OR vigencia_desde <= $1)
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= $1)
      ORDER BY COALESCE(vigencia_desde, DATE '1900-01-01') DESC, id DESC
      LIMIT 1`,
    [hoy]
  );
  const lista = rows[0] || null;
  if (!lista) return null;
  // Filtro por día de la semana si la lista lo define (0=domingo … 6=sábado).
  if (Array.isArray(lista.dias_semana) && lista.dias_semana.length) {
    const dow = new Date(`${hoy}T12:00:00`).getDay();
    if (!lista.dias_semana.includes(dow)) return null;
  }
  return lista;
}

/** Mapa producto_id -> precio de una lista. */
export async function preciosDeLista(db, listaId) {
  if (!listaId) return new Map();
  const { rows } = await db.query('SELECT producto_id, precio, moneda FROM conta_precios WHERE lista_id = $1', [listaId]);
  return new Map(rows.map((r) => [r.producto_id, { precio: num(r.precio), moneda: r.moneda }]));
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------
catalogoRouter.get('/', requireAuth, async (req, res) => {
  try {
    const incluirInactivos = req.query.inactivos === 'true';
    const lista = await listaVigente(db);
    const precios = await preciosDeLista(db, lista ? lista.id : null);
    const { rows } = await query(
      `SELECT * FROM conta_productos ${incluirInactivos ? '' : 'WHERE activo = true'} ORDER BY categoria, nombre`
    );
    res.json({
      lista_vigente: lista,
      productos: rows.map((p) => ({
        ...p,
        iva_porcentaje: p.iva_porcentaje == null ? null : num(p.iva_porcentaje),
        precio: precios.get(p.id)?.precio ?? null,
        moneda: precios.get(p.id)?.moneda ?? 'BOB',
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

catalogoRouter.post('/', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { nombre, tipo, vueltas, duracion_min, categoria, iva_modo, iva_porcentaje } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await query(
      `INSERT INTO conta_productos (nombre, tipo, vueltas, duracion_min, categoria, iva_modo, iva_porcentaje)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [nombre, tipo || 'producto', vueltas ?? null, duracion_min ?? null, categoria || 'otro',
       iva_modo || 'hereda', iva_porcentaje ?? null]
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'producto', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un producto con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

catalogoRouter.put('/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const campos = ['nombre', 'tipo', 'vueltas', 'duracion_min', 'categoria', 'activo', 'iva_modo', 'iva_porcentaje'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in req.body) { params.push(req.body[c]); sets.push(`${c} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const { rows: antes } = await query('SELECT * FROM conta_productos WHERE id = $1', [req.params.id]);
    if (!antes.length) return res.status(404).json({ error: 'Producto no encontrado' });
    const { rows } = await query(
      `UPDATE conta_productos SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'producto', entidad_id: req.params.id,
      datos_antes: antes[0], datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Las ventas son inmutables: un producto NO se borra, se desactiva.
catalogoRouter.delete('/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { rows } = await query(
      'UPDATE conta_productos SET activo = false WHERE id = $1 RETURNING *', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    await auditar(null, {
      usuario_id: req.user.id, accion: 'desactivar', entidad: 'producto', entidad_id: req.params.id,
      datos_despues: { activo: false }, ip: ipDe(req),
    });
    res.json({ ok: true, producto: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Listas de precios
// ---------------------------------------------------------------------------
catalogoRouter.get('/listas', requireAuth, async (_req, res) => {
  try {
    const { rows: listas } = await query('SELECT * FROM conta_listas_precios ORDER BY activo DESC, id DESC');
    const { rows: precios } = await query(
      `SELECT pr.*, p.nombre AS producto_nombre FROM conta_precios pr
        JOIN conta_productos p ON p.id = pr.producto_id`
    );
    res.json(listas.map((l) => ({
      ...l,
      precios: precios.filter((p) => p.lista_id === l.id)
        .map((p) => ({ ...p, precio: num(p.precio) })),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

catalogoRouter.post('/listas', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { nombre, vigencia_desde, vigencia_hasta, dias_semana, activo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await query(
      `INSERT INTO conta_listas_precios (nombre, vigencia_desde, vigencia_hasta, dias_semana, activo)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nombre, vigencia_desde || null, vigencia_hasta || null, dias_semana || null, activo !== false]
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'lista_precios', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una lista con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

catalogoRouter.put('/listas/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const campos = ['nombre', 'vigencia_desde', 'vigencia_hasta', 'dias_semana', 'activo'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in req.body) { params.push(req.body[c]); sets.push(`${c} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE conta_listas_precios SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    if (!rows.length) return res.status(404).json({ error: 'Lista no encontrada' });
    await auditar(null, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'lista_precios', entidad_id: req.params.id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Upsert masivo de precios de una lista: [{ producto_id, precio, moneda }]
catalogoRouter.post('/listas/:id/precios', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.precios) ? req.body.precios : [];
    if (!items.length) return res.status(400).json({ error: 'Se espera { precios: [{producto_id, precio}] }' });
    const aplicados = await withTx(async (client) => {
      const out = [];
      for (const it of items) {
        if (!it.producto_id) continue;
        const { rows } = await client.query(
          `INSERT INTO conta_precios (lista_id, producto_id, precio, moneda)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (lista_id, producto_id) DO UPDATE SET precio = EXCLUDED.precio, moneda = EXCLUDED.moneda
           RETURNING *`,
          [req.params.id, it.producto_id, num(it.precio), it.moneda || 'BOB']
        );
        out.push(rows[0]);
      }
      await auditar(client, {
        usuario_id: req.user.id, accion: 'editar', entidad: 'lista_precios', entidad_id: req.params.id,
        datos_despues: { precios: out }, ip: ipDe(req),
      });
      return out;
    });
    res.json(aplicados);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Catálogo para el POS: productos + combos + precios + métodos de pago + config
// ---------------------------------------------------------------------------
catalogoRouter.get('/pos', requireAuth, async (_req, res) => {
  try {
    const configMap = await getConfigMap(db);
    const lista = await listaVigente(db);
    const precios = await preciosDeLista(db, lista ? lista.id : null);

    const { rows: productos } = await query(
      `SELECT * FROM conta_productos WHERE activo = true ORDER BY categoria, nombre`
    );
    const { rows: combos } = await query(`SELECT * FROM conta_combos WHERE activo = true ORDER BY nombre`);
    const { rows: metodos } = await query(`SELECT * FROM conta_metodos_pago ORDER BY id`);
    const { rows: cuentas } = await query(
      `SELECT id, nombre, tipo, es_efectivo_caja FROM conta_cuentas_destino WHERE activo = true ORDER BY es_efectivo_caja DESC, nombre`
    );
    const { rows: promociones } = await query(
      `SELECT * FROM conta_promociones WHERE activo = true ORDER BY id DESC`
    );

    res.json({
      lista_vigente: lista,
      config: {
        iva_modo_default: valorConfig(configMap, 'iva_modo_default', 'incluido'),
        iva_porcentaje_default: num(valorConfig(configMap, 'iva_porcentaje_default', 13)),
        umbral_descuento_supervisor: num(valorConfig(configMap, 'umbral_descuento_supervisor', 50)),
        umbral_egreso_cajero: num(valorConfig(configMap, 'umbral_egreso_cajero', 500)),
        propina_habilitada: !!valorConfig(configMap, 'propina_habilitada', true),
        propina_modo: valorConfig(configMap, 'propina_modo', 'acumulada'),
        propina_porcentaje_sugerido: num(valorConfig(configMap, 'propina_porcentaje_sugerido', 10)),
        propina_distribucion: valorConfig(configMap, 'propina_distribucion', 'por_cajero'),
        propina_distribucion_pesos: valorConfig(configMap, 'propina_distribucion_pesos', { cajero: 0.5, equipo: 0.5 }),
        combo_modo_default: valorConfig(configMap, 'combo_modo_default', 'unico'),
        requiere_nit_por_defecto: !!valorConfig(configMap, 'requiere_nit_por_defecto', false),
        tipo_factura_default: valorConfig(configMap, 'tipo_factura_default', 'factura'),
        promociones_auto: !!valorConfig(configMap, 'promociones_auto', true),
        promociones_acumulables: !!valorConfig(configMap, 'promociones_acumulables', false),
        // --- Cumplimiento fiscal Bolivia (v3): el POS decide con esto si
        //     muestra el toggle "Facturar" y qué exige al cliente. ---
        facturacion_habilitada: !!valorConfig(configMap, 'facturacion_habilitada', false),
        facturacion_modo_default: valorConfig(configMap, 'facturacion_modo_default', 'no_facturado'),
        facturacion_requiere_nit: !!valorConfig(configMap, 'facturacion_requiere_nit', false),
        facturacion_requiere_razon_social:
          !!valorConfig(configMap, 'facturacion_requiere_razon_social', false),
        regimen: valorConfig(configMap, 'regimen', 'general'),
        iva_pct_default: num(valorConfig(configMap, 'iva_pct_default',
          valorConfig(configMap, 'iva_porcentaje_default', 13))),
        it_pct_default: num(valorConfig(configMap, 'it_pct_default', 3)),
        iue_pct_default: num(valorConfig(configMap, 'iue_pct_default', 25)),
        itf_pct_default: num(valorConfig(configMap, 'itf_pct_default', 0.15)),
        siete_rg_pct: num(valorConfig(configMap, 'siete_rg_pct', 5)),
      },
      productos: productos.map((p) => {
        const modo = resolverIvaModo(p.iva_modo, configMap);
        return {
          ...p,
          iva_porcentaje: p.iva_porcentaje == null ? null : num(p.iva_porcentaje),
          precio: precios.get(p.id)?.precio ?? null,
          moneda: precios.get(p.id)?.moneda ?? 'BOB',
          iva_modo_efectivo: modo,
          iva_porcentaje_efectivo: resolverIvaPorcentaje(p, configMap, modo),
        };
      }),
      combos: combos.map((c) => ({
        ...c,
        precio: num(c.precio),
        iva_modo_efectivo: resolverIvaModo(c.iva_modo_hereda ? 'hereda' : c.iva_modo, configMap),
      })),
      metodos_pago: metodos,
      cuentas_destino: cuentas,
      promociones,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
