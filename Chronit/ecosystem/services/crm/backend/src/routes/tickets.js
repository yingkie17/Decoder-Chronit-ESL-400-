// =============================================================================
// CHRONIT ECOSYSTEM — CRM: TICKETS (sistema de tickets + datos contables)
// -----------------------------------------------------------------------------
// Une el ticket operativo con su venta y sus datos de control contable
// (vueltas, promoción, impresión, cajera) gracias a los campos añadidos en la
// Fase 0. Filtros por estado, evento, cajera, sucursal, tipo de operación,
// promoción, impresión y rango de fechas.
//
//   GET /api/crm/tickets                -> listado paginado (JSON)
//   GET /api/crm/tickets?formato=csv    -> exportación CSV
// =============================================================================
import { Router } from 'express';
import { requireAuth, requireCrmRole } from '../middleware/auth.js';
import { Where } from '../utils/sql.js';
import { listar } from '../utils/listado.js';

export const ticketsRouter = Router();
ticketsRouter.use(requireAuth, requireCrmRole());

const COLUMNAS = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'numero', titulo: 'Número' },
  { clave: 'estado', titulo: 'Estado' },
  { clave: 'creado_en', titulo: 'Creado' },
  { clave: 'hora_venta', titulo: 'Hora de venta' },
  { clave: 'impreso_en', titulo: 'Impreso en' },
  { clave: 'veces_impreso', titulo: 'Veces impreso' },
  { clave: 'piloto', titulo: 'Piloto' },
  { clave: 'piloto_carnet', titulo: 'Carnet piloto' },
  { clave: 'evento_nombre', titulo: 'Evento' },
  { clave: 'cantidad_vueltas', titulo: 'Vueltas' },
  { clave: 'duracion_min', titulo: 'Duración (min)' },
  { clave: 'tipo_promocion', titulo: 'Tipo promoción' },
  { clave: 'promocion_nombre_snapshot', titulo: 'Promoción' },
  { clave: 'promocion_descuento', titulo: 'Descuento' },
  { clave: 'tipo_operacion', titulo: 'Operación' },
  { clave: 'numero_factura', titulo: 'Factura' },
  { clave: 'cajero_carnet_snapshot', titulo: 'Cajera (carnet)' },
  { clave: 'venta_total', titulo: 'Total venta' },
  { clave: 'sucursal_id', titulo: 'Sucursal' },
];

function construir(q) {
  const w = new Where();
  w.eq('t.estado', q.estado)
    .eq('t.evento_id', q.evento_id)
    .eq('t.cajero_id', q.cajero_id)
    .eq('t.sucursal_id', q.sucursal_id)
    .eq('t.tipo_operacion', q.tipo_operacion)
    .eq('t.promocion_id', q.promocion_id)
    .eq('t.tipo_promocion', q.tipo_promocion)
    .desde('t.creado_en', q.desde, 'timestamptz')
    .hasta('t.creado_en', q.hasta, 'timestamptz')
    .texto(
      ['t.numero', 't.uuid_global', 't.cajero_carnet_snapshot', 't.piloto_nombre_snapshot',
       't.piloto_carnet_snapshot', 't.evento_nombre_snapshot', 't.numero_factura'],
      q.q
    );

  // Impresión: el estado se deduce del sello de impresión (Fase 0).
  if (q.impreso === 'true' || q.impreso === true) w.raw('t.impreso_en IS NOT NULL');
  else if (q.impreso === 'false' || q.impreso === false) w.raw('t.impreso_en IS NULL');

  return {
    select: `t.id, t.numero, t.uuid_global, t.estado, t.creado_en, t.pagado_en, t.hora_venta,
             t.impreso_en, t.veces_impreso, t.cantidad_vueltas, t.duracion_min,
             t.tipo_promocion, t.promocion_nombre_snapshot, t.promocion_descuento,
             t.tipo_operacion, t.numero_factura, t.sucursal_id,
             t.cajero_carnet_snapshot, t.cajero_nombre_snapshot,
             t.piloto_nombre_snapshot, t.piloto_carnet_snapshot, t.evento_nombre_snapshot,
             u.nombre || ' ' || u.apellido AS piloto,
             u.carnet AS piloto_carnet,
             u.nacionalidad AS piloto_nacionalidad,
             e.nombre AS evento_nombre,
             e.tipo_carrera,
             v.total_final AS venta_total,
             v.estado AS venta_estado`,
    from: `FROM tickets t
           LEFT JOIN usuarios u ON u.id = t.usuario_id
           LEFT JOIN eventos e ON e.id = t.evento_id
           LEFT JOIN conta_ventas v ON v.id = t.venta_id`,
    where: w,
    order: 't.id DESC',
  };
}

ticketsRouter.get('/', (req, res) => listar(req, res, { recurso: 'tickets', columnas: COLUMNAS, construir }));
