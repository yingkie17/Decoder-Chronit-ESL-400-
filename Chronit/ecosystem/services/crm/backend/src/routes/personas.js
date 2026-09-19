// =============================================================================
// CHRONIT ECOSYSTEM — CRM: PERSONAS (gestor de usuarios)
// -----------------------------------------------------------------------------
// Vista 360° de cada usuario del ecosistema con su actividad agregada
// (tickets y carreras). Filtros por rol, nacionalidad, género, estado,
// invitado/bloqueado, turno, rango de edad y fecha de alta.
//
//   GET /api/crm/personas                -> listado paginado (JSON)
//   GET /api/crm/personas?formato=csv    -> exportación CSV
// =============================================================================
import { Router } from 'express';
import { requireAuth, requireCrmRole } from '../middleware/auth.js';
import { Where } from '../utils/sql.js';
import { listar } from '../utils/listado.js';

export const personasRouter = Router();
personasRouter.use(requireAuth, requireCrmRole());

const COLUMNAS = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'nombre', titulo: 'Nombre' },
  { clave: 'apellido', titulo: 'Apellido' },
  { clave: 'carnet', titulo: 'Carnet' },
  { clave: 'email', titulo: 'Correo' },
  { clave: 'telefono', titulo: 'Teléfono' },
  { clave: 'nacionalidad', titulo: 'Nacionalidad' },
  { clave: 'genero', titulo: 'Género' },
  { clave: 'edad', titulo: 'Edad' },
  { clave: 'rol', titulo: 'Rol' },
  { clave: 'turno', titulo: 'Turno' },
  { clave: 'es_invitado', titulo: 'Invitado' },
  { clave: 'bloqueado', titulo: 'Bloqueado' },
  { clave: 'tickets_total', titulo: 'Tickets' },
  { clave: 'carreras_total', titulo: 'Carreras' },
  { clave: 'creado_en', titulo: 'Alta' },
];

function construir(q) {
  const w = new Where();
  w.eq('u.rol', q.rol)
    .eq('u.nacionalidad', q.nacionalidad)
    .eq('u.genero', q.genero)
    .eq('u.turno', q.turno)
    .bool('u.es_invitado', q.es_invitado)
    .bool('u.bloqueado', q.bloqueado)
    .min('u.edad', q.edad_min)
    .max('u.edad', q.edad_max)
    .desde('u.creado_en', q.desde, 'timestamptz')
    .hasta('u.creado_en', q.hasta, 'timestamptz')
    .texto(['u.nombre', 'u.apellido', 'u.carnet', 'u.email', 'u.telefono'], q.q);

  return {
    select: `u.id, u.uuid_global, u.nombre, u.apellido, u.carnet, u.email, u.telefono,
             u.nacionalidad, u.genero, u.edad, u.rol, u.turno, u.vestidor,
             u.es_invitado, u.bloqueado, u.creado_en,
             (SELECT COUNT(*)::int FROM tickets t WHERE t.usuario_id = u.id) AS tickets_total,
             (SELECT COUNT(*)::int FROM resultados_carrera r WHERE r.usuario_id = u.id) AS carreras_total`,
    from: `FROM usuarios u`,
    where: w,
    order: 'u.id DESC',
  };
}

personasRouter.get('/', (req, res) => listar(req, res, { recurso: 'personas', columnas: COLUMNAS, construir }));
