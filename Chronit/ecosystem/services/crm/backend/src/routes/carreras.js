// =============================================================================
// CHRONIT ECOSYSTEM — CRM: CARRERAS (sistema de carrera)
// -----------------------------------------------------------------------------
// Resultados de carrera registrados por el Chronit Core, cruzados con el piloto
// y el evento. Filtros por evento, piloto, circuito, posición y rango de fecha.
//
//   GET /api/crm/carreras               -> listado paginado (JSON)
//   GET /api/crm/carreras?formato=csv   -> exportación CSV
// =============================================================================
import { Router } from 'express';
import { requireAuth, requireCrmRole } from '../middleware/auth.js';
import { Where } from '../utils/sql.js';
import { listar } from '../utils/listado.js';

export const carrerasRouter = Router();
carrerasRouter.use(requireAuth, requireCrmRole());

const COLUMNAS = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'fecha', titulo: 'Fecha' },
  { clave: 'evento_nombre', titulo: 'Evento' },
  { clave: 'piloto', titulo: 'Piloto' },
  { clave: 'piloto_carnet', titulo: 'Carnet' },
  { clave: 'posicion', titulo: 'Posición' },
  { clave: 'tiempo_total', titulo: 'Tiempo total' },
  { clave: 'mejor_vuelta', titulo: 'Mejor vuelta' },
  { clave: 'vuelta_rapida', titulo: 'Vuelta rápida' },
  { clave: 'circuito', titulo: 'Circuito' },
];

function construir(q) {
  const w = new Where();
  w.eq('r.evento_id', q.evento_id)
    .eq('r.usuario_id', q.usuario_id)
    .eq('r.circuito', q.circuito)
    .min('r.posicion', q.posicion_min)
    .max('r.posicion', q.posicion_max)
    .desde('r.fecha', q.desde)
    .hasta('r.fecha', q.hasta)
    .texto(['u.nombre', 'u.apellido', 'u.carnet', 'r.circuito', 'e.nombre'], q.q);

  return {
    select: `r.id, r.uuid_global, r.fecha, r.posicion, r.tiempo_total, r.mejor_vuelta,
             r.vuelta_rapida, r.circuito, r.evento_id, r.usuario_id,
             u.nombre || ' ' || u.apellido AS piloto,
             u.carnet AS piloto_carnet,
             e.nombre AS evento_nombre,
             e.tipo_carrera,
             e.vueltas AS evento_vueltas`,
    from: `FROM resultados_carrera r
           LEFT JOIN usuarios u ON u.id = r.usuario_id
           LEFT JOIN eventos e ON e.id = r.evento_id`,
    where: w,
    order: 'r.fecha DESC, r.posicion ASC',
  };
}

carrerasRouter.get('/', (req, res) => listar(req, res, { recurso: 'carreras', columnas: COLUMNAS, construir }));
