// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: lista unificada de usuarios
// -----------------------------------------------------------------------------
// PROMPT FINAL: "Es VITAL que TODOS los roles tengan la lista completa de
// usuarios con todos sus datos (foto, ticket, kart, evento, transponder, rol)."
//
// GET /api/usuarios
//   Devuelve por CADA usuario su foto, nombre, apellido, carnet, email, teléfono,
//   ticket actual (número y estado), evento asignado, kart y transponder, y rol.
//   Accesible por admin, cajero, coordinador y desarrollador (no pilotos).
//
// Filtros (query params):
//   estado      -> estado del ticket (PENDIENTE|ASIGNADO|LLAMANDO|PREPARADO|ACTIVO|FINALIZADO|AUSENTE)
//   evento_id   -> id de evento
//   kart        -> número de kart
//   transponder -> código de transponder
//   rol         -> rol del usuario
//   q           -> búsqueda por nombre/apellido/carnet/email/teléfono
//   bloqueado   -> 'true' | 'false' (solo bloqueados / solo activos)
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { flagOf } from '../utils/helpers.js';

export const usuariosRouter = Router();

// Prioridad del ticket "actual" de un usuario: un ACTIVO vale más que un
// ASIGNADO/LLAMANDO/PREPARADO, y un PENDIENTE queda al final; dentro del mismo
// estado se elige el más reciente. AUSENTE/FINALIZADO van al final (no son
// "actuales" para la operación).
const TICKET_PRIORITY = `
  ORDER BY CASE t2.estado
    WHEN 'ACTIVO' THEN 0
    WHEN 'LLAMANDO' THEN 1
    WHEN 'PREPARADO' THEN 2
    WHEN 'ASIGNADO' THEN 3
    WHEN 'PENDIENTE' THEN 4
    ELSE 5 END,
  t2.creado_en DESC
  LIMIT 1
`;

usuariosRouter.get('/', requireAuth, requireRole('admin', 'cajero', 'coordinador', 'desarrollador'), async (req, res) => {
  try {
    const { estado, evento_id, kart, transponder, rol, q, bloqueado } = req.query;
    const params = [];
    let sql = `
      SELECT
        u.id, u.uuid_global, u.nombre, u.apellido, u.email, u.telefono, u.carnet,
        u.foto, u.nacionalidad, u.rol, u.es_invitado, u.bloqueado,
        t.id                AS ticket_id,
        t.numero            AS ticket_numero,
        t.estado            AS ticket_estado,
        t.pagado_en,
        t.evento_id,
        e.nombre            AS evento_nombre,
        e.fecha             AS evento_fecha,
        e.hora              AS evento_hora,
        e.modo              AS evento_modo,
        e.tipo_carrera      AS evento_tipo_carrera,
        k.id                AS kart_id,
        k.numero            AS kart_numero,
        k.transponder       AS kart_transponder
      FROM usuarios u
      LEFT JOIN tickets t ON t.id = (
        SELECT t2.id FROM tickets t2
        WHERE t2.usuario_id = u.id
        ${TICKET_PRIORITY}
      )
      LEFT JOIN eventos e ON e.id = t.evento_id
      LEFT JOIN karts k   ON k.id = t.kart_id
      WHERE 1=1
    `;

    if (estado) { params.push(estado); sql += ` AND t.estado = $${params.length}`; }
    if (evento_id) { params.push(evento_id); sql += ` AND t.evento_id = $${params.length}`; }
    if (kart) { params.push(kart); sql += ` AND k.numero = $${params.length}`; }
    if (transponder) { params.push(transponder); sql += ` AND k.transponder = $${params.length}`; }
    if (rol) { params.push(rol); sql += ` AND u.rol = $${params.length}`; }
    if (bloqueado === 'true') sql += ` AND u.bloqueado = true`;
    if (bloqueado === 'false') sql += ` AND u.bloqueado = false`;
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (u.nombre ILIKE $${params.length} OR u.apellido ILIKE $${params.length}
                  OR u.carnet ILIKE $${params.length} OR u.email ILIKE $${params.length}
                  OR u.telefono ILIKE $${params.length})`;
    }
    sql += ` ORDER BY u.creado_en DESC, u.id DESC`;

    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({ ...r, flag: flagOf(r.nacionalidad) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
