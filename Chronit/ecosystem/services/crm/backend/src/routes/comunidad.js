// =============================================================================
// CHRONIT ECOSYSTEM — CRM: COMUNIDAD (página web principal)
// -----------------------------------------------------------------------------
// Publicaciones del feed del portal, con su autor, su evento asociado y la
// interacción generada (comentarios y "me gusta"). Filtros por tipo, autor,
// evento, rango de fechas y búsqueda libre.
//
//   GET /api/crm/comunidad                -> listado paginado (JSON)
//   GET /api/crm/comunidad?formato=csv    -> exportación CSV
// =============================================================================
import { Router } from 'express';
import { requireAuth, requireCrmRole } from '../middleware/auth.js';
import { Where } from '../utils/sql.js';
import { listar } from '../utils/listado.js';

export const comunidadRouter = Router();
comunidadRouter.use(requireAuth, requireCrmRole());

const COLUMNAS = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'tipo', titulo: 'Tipo' },
  { clave: 'titulo', titulo: 'Título' },
  { clave: 'contenido', titulo: 'Contenido' },
  { clave: 'autor', titulo: 'Autor' },
  { clave: 'autor_carnet', titulo: 'Carnet autor' },
  { clave: 'autor_rol', titulo: 'Rol autor' },
  { clave: 'evento_nombre', titulo: 'Evento' },
  { clave: 'comentarios', titulo: 'Comentarios' },
  { clave: 'me_gusta', titulo: 'Me gusta' },
  { clave: 'creado_en', titulo: 'Creado' },
];

function construir(q) {
  const w = new Where();
  w.eq('p.tipo', q.tipo)
    .eq('p.autor_id', q.autor_id)
    .eq('p.evento_id', q.evento_id)
    .desde('p.creado_en', q.desde, 'timestamptz')
    .hasta('p.creado_en', q.hasta, 'timestamptz')
    .texto(['p.titulo', 'p.contenido', 'a.nombre', 'a.apellido', 'a.carnet'], q.q);

  return {
    select: `p.id, p.uuid_global, p.tipo, p.titulo, p.contenido, p.evento_id, p.creado_en,
             a.nombre || ' ' || a.apellido AS autor,
             a.carnet AS autor_carnet,
             a.rol AS autor_rol,
             e.nombre AS evento_nombre,
             (SELECT COUNT(*)::int FROM post_comments c WHERE c.post_id = p.id) AS comentarios,
             (SELECT COUNT(*)::int FROM post_likes l WHERE l.post_id = p.id) AS me_gusta`,
    from: `FROM posts p
           LEFT JOIN usuarios a ON a.id = p.autor_id
           LEFT JOIN eventos e ON e.id = p.evento_id`,
    where: w,
    order: 'p.creado_en DESC NULLS LAST, p.id DESC',
  };
}

comunidadRouter.get('/', (req, res) => listar(req, res, { recurso: 'comunidad', columnas: COLUMNAS, construir }));
