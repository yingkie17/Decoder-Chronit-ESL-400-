// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: egresos (gastos de caja)
// -----------------------------------------------------------------------------
//   GET  /api/conta/egresos        -> listar (filtros)
//   POST /api/conta/egresos        -> registrar (cajero/supervisor/contador)
//   GET  /api/conta/egresos/:id    -> detalle
//
// REGLA: si el monto supera configuracion.umbral_egreso_cajero y quien registra
// no es supervisor+, se exige `autorizacion: { carnet, password }` de un
// supervisor. El egreso queda marcado con requiere_autorizacion = true.
// =============================================================================
import { Router } from 'express';
import { query, withTx } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num } from '../utils/helpers.js';
import { getConfigMap, valorConfig, validarAutorizacion } from '../utils/finanzas.js';
import { asientoDeEgreso } from '../utils/contabilidad.js';

export const egresosRouter = Router();

const PUEDE_REGISTRAR = ['cajero', 'supervisor', 'contador', 'admin'];

export const CATEGORIAS_EGRESO = [
  'insumos', 'mantenimiento', 'combustible', 'personal', 'servicios',
  'publicidad', 'impuestos', 'viaticos', 'otros',
];

egresosRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { desde, hasta, categoria, sesion_caja_id } = req.query;
    const params = [];
    let sql = `
      SELECT e.*,
             NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS creado_por_nombre,
             NULLIF(TRIM(COALESCE(a.nombre,'') || ' ' || COALESCE(a.apellido,'')), '') AS autorizado_por_nombre
        FROM conta_egresos e
        LEFT JOIN usuarios u ON u.id = e.creado_por
        LEFT JOIN usuarios a ON a.id = e.autorizado_por
       WHERE 1=1`;
    if (desde) { params.push(desde); sql += ` AND e.creado_en >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); sql += ` AND e.creado_en < ($${params.length}::date + INTERVAL '1 day')`; }
    if (categoria) { params.push(categoria); sql += ` AND e.categoria = $${params.length}`; }
    if (sesion_caja_id) { params.push(sesion_caja_id); sql += ` AND e.sesion_caja_id = $${params.length}`; }
    sql += ' ORDER BY e.creado_en DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({ ...r, monto: num(r.monto) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

egresosRouter.get('/categorias', requireAuth, (_req, res) => res.json(CATEGORIAS_EGRESO));

egresosRouter.post('/', requireAuth, requireRole(...PUEDE_REGISTRAR), async (req, res) => {
  try {
    const { categoria, monto, descripcion, comprobante_url, sesion_caja_id } = req.body || {};
    const m = num(monto);
    if (m <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

    const resultado = await withTx(async (client) => {
      const config = await getConfigMap(client);
      const umbral = num(valorConfig(config, 'umbral_egreso_cajero', 500));
      const esSupervisor = ['supervisor', 'admin', 'desarrollador'].includes(req.user.rol);
      const requiere = m > umbral;

      let autorizador = null;
      if (requiere && !esSupervisor) {
        autorizador = await validarAutorizacion(client, req.body.autorizacion);
        if (!autorizador) {
          const e = new Error(
            `El egreso supera el umbral de ${umbral}. Se requiere autorización de un supervisor.`);
          e.status = 403;
          e.code = 'REQUIERE_AUTORIZACION';
          throw e;
        }
      } else if (requiere && esSupervisor) {
        autorizador = { id: req.user.id };
      }

      // Sesión de caja: la indicada o la caja abierta del usuario.
      let sesion = sesion_caja_id || null;
      let sucursalId = null;
      if (sesion) {
        const { rows: s } = await client.query(
          'SELECT sucursal_id FROM conta_sesiones_caja WHERE id = $1', [sesion]
        );
        sucursalId = s.length ? s[0].sucursal_id : null;
      }
      if (!sesion) {
        const { rows: abierta } = await client.query(
          `SELECT id, sucursal_id FROM conta_sesiones_caja WHERE cajero_id = $1 AND estado = 'abierta' LIMIT 1`,
          [req.user.id]
        );
        sesion = abierta.length ? abierta[0].id : null;
        sucursalId = abierta.length ? abierta[0].sucursal_id : null;
      }
      if (!sucursalId) {
        const { rows: suc } = await client.query(
          'SELECT id FROM conta_sucursales WHERE activo = true ORDER BY id LIMIT 1'
        );
        sucursalId = suc.length ? suc[0].id : null;
      }

      const { rows } = await client.query(
        `INSERT INTO conta_egresos
           (sesion_caja_id, sucursal_id, categoria, monto, descripcion, comprobante_url, creado_por,
            autorizado_por, requiere_autorizacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [sesion, sucursalId, categoria || 'otros', m, descripcion || null, comprobante_url || null,
         req.user.id, autorizador ? autorizador.id : null, requiere]
      );
      if (sesion) {
        await client.query(
          `INSERT INTO conta_movimientos_caja (sesion_caja_id, sucursal_id, tipo, monto, motivo, egreso_id, creado_por)
           VALUES ($1,$2,'egreso',$3,$4,$5,$6)`,
          [sesion, sucursalId, m, descripcion || `Egreso ${categoria || 'otros'}`, rows[0].id, req.user.id]
        );
      }
      // Asiento contable automático: Gasto contra Caja (misma transacción).
      await asientoDeEgreso(client, {
        egreso: { ...rows[0], sucursal_id: sucursalId },
        usuario_id: autorizador ? autorizador.id : req.user.id,
      });
      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'egreso', entidad_id: rows[0].id,
        datos_despues: rows[0], ip: ipDe(req),
      });
      return { ...rows[0], autorizado_por_nombre: autorizador ? `${autorizador.nombre || ''} ${autorizador.apellido || ''}`.trim() : null };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

egresosRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_egresos WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Egreso no encontrado' });
    res.json({ ...rows[0], monto: num(rows[0].monto) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
