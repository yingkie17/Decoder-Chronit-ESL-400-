// =============================================================================
// CHRONIT ECOSYSTEM — CRM: CAJA (sesiones del módulo contable)
// -----------------------------------------------------------------------------
// Cruza cada sesión de caja con su cajera, su sucursal y el resultado de sus
// ventas. Filtros por estado de sesión, cajera, sucursal y rango de apertura.
//
//   GET /api/crm/caja                -> listado paginado (JSON)
//   GET /api/crm/caja?formato=csv    -> exportación CSV
// =============================================================================
import { Router } from 'express';
import { requireAuth, requireCrmRole } from '../middleware/auth.js';
import { Where } from '../utils/sql.js';
import { listar } from '../utils/listado.js';

export const cajaRouter = Router();
cajaRouter.use(requireAuth, requireCrmRole());

const COLUMNAS = [
  { clave: 'id', titulo: 'Sesión' },
  { clave: 'estado', titulo: 'Estado' },
  { clave: 'apertura_en', titulo: 'Apertura' },
  { clave: 'cierre_en', titulo: 'Cierre' },
  { clave: 'cajero', titulo: 'Cajera' },
  { clave: 'cajero_carnet', titulo: 'Carnet' },
  { clave: 'sucursal', titulo: 'Sucursal' },
  { clave: 'monto_inicial', titulo: 'Monto inicial' },
  { clave: 'ventas', titulo: 'Nº de ventas' },
  { clave: 'total_vendido', titulo: 'Total vendido' },
  { clave: 'monto_esperado_efectivo', titulo: 'Esperado en efectivo' },
  { clave: 'monto_contado_efectivo', titulo: 'Contado' },
  { clave: 'diferencia', titulo: 'Diferencia' },
];

function construir(q) {
  const w = new Where();
  w.eq('s.estado', q.estado)
    .eq('s.cajero_id', q.cajero_id)
    .eq('s.sucursal_id', q.sucursal_id)
    .desde('s.apertura_en', q.desde, 'timestamptz')
    .hasta('s.apertura_en', q.hasta, 'timestamptz')
    .texto(['c.nombre', 'c.apellido', 'c.carnet', 'su.nombre'], q.q);

  return {
    select: `s.id, s.estado, s.apertura_en, s.cierre_en, s.monto_inicial,
             s.monto_esperado_efectivo, s.monto_contado_efectivo, s.diferencia,
             s.sucursal_id, s.notas_cierre,
             c.nombre || ' ' || c.apellido AS cajero,
             c.carnet AS cajero_carnet,
             su.nombre AS sucursal,
             (SELECT COUNT(*)::int FROM conta_ventas v
               WHERE v.sesion_caja_id = s.id AND v.estado <> 'anulada') AS ventas,
             (SELECT COALESCE(SUM(v.total_final), 0) FROM conta_ventas v
               WHERE v.sesion_caja_id = s.id AND v.estado <> 'anulada') AS total_vendido`,
    from: `FROM conta_sesiones_caja s
           LEFT JOIN usuarios c ON c.id = s.cajero_id
           LEFT JOIN conta_sucursales su ON su.id = s.sucursal_id`,
    where: w,
    order: 's.apertura_en DESC NULLS LAST, s.id DESC',
  };
}

cajaRouter.get('/', (req, res) => listar(req, res, { recurso: 'caja', columnas: COLUMNAS, construir }));
