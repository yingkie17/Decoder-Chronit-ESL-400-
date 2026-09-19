// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: configuración del sistema
// -----------------------------------------------------------------------------
//   GET  /api/conta/configuracion            -> listar claves (supervisor+)
//   GET  /api/conta/configuracion/:clave     -> leer una clave (supervisor+)
//   PUT  /api/conta/configuracion/:clave     -> actualizar (supervisor+)
//   PUT  /api/conta/configuracion            -> actualizar varias (bulk)
//
// LECTURA restringida a supervisor/admin: la configuración expone parámetros
// comerciales y tributarios que no corresponden al flujo de caja. Un cajero
// (o cualquier rol operativo) recibe 403.
// Cada cambio queda en conta_auditoria con datos_antes y datos_despues.
// Los valores se leen dentro de la transacción de venta, pero cada venta
// SNAPSHOTEA lo que aplicó (no se recalcula en reportes).
// =============================================================================
import { Router } from 'express';
import { query, withTx } from '../db/pool.js';
import { requireAuth, requireRole, puedeEditarConfiguracion } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';

export const configuracionRouter = Router();

configuracionRouter.get('/', requireAuth, requireRole('supervisor', 'admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.clave, c.valor, c.descripcion, c.editable_por_rol,
              c.actualizado_en,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS actualizado_por_nombre
         FROM conta_configuracion c
         LEFT JOIN usuarios u ON u.id = c.actualizado_por
        ORDER BY c.clave`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

configuracionRouter.get('/:clave', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_configuracion WHERE clave = $1', [req.params.clave]);
    if (!rows.length) return res.status(404).json({ error: 'Clave de configuración no encontrada' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function actualizarClave(client, clave, valor, usuario, ip) {
  const { rows: antes } = await client.query('SELECT * FROM conta_configuracion WHERE clave = $1', [clave]);
  if (!antes.length) {
    const err = new Error(`Clave de configuración desconocida: ${clave}`);
    err.status = 404;
    throw err;
  }
  const cfg = antes[0];
  const permitidos = cfg.editable_por_rol || [];
  if (!puedeEditarConfiguracion(usuario.rol) || !permitidos.includes(usuario.rol)) {
    const err = new Error(`Tu rol (${usuario.rol}) no puede editar la clave ${clave}`);
    err.status = 403;
    throw err;
  }
  const { rows } = await client.query(
    `UPDATE conta_configuracion
        SET valor = $1::jsonb, actualizado_por = $2, actualizado_en = now()
      WHERE clave = $3
      RETURNING *`,
    [JSON.stringify(valor), usuario.id, clave]
  );
  await auditar(client, {
    usuario_id: usuario.id, accion: 'editar', entidad: 'configuracion', entidad_id: clave,
    datos_antes: { valor: cfg.valor }, datos_despues: { valor: rows[0].valor }, ip,
  });
  return rows[0];
}

configuracionRouter.put('/:clave', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    if (!('valor' in req.body)) return res.status(400).json({ error: 'Falta el campo "valor"' });
    const row = await withTx((client) =>
      actualizarClave(client, req.params.clave, req.body.valor, req.user, ipDe(req)));
    res.json(row);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

configuracionRouter.put('/', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const cambios = req.body && req.body.cambios;
    if (!cambios || typeof cambios !== 'object') {
      return res.status(400).json({ error: 'Se espera { cambios: { clave: valor, ... } }' });
    }
    const resultado = await withTx(async (client) => {
      const out = [];
      for (const [clave, valor] of Object.entries(cambios)) {
        out.push(await actualizarClave(client, clave, valor, req.user, ipDe(req)));
      }
      return out;
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
