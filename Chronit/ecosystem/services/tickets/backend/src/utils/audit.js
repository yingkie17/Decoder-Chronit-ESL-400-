// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: auditoría de operaciones sensibles
// -----------------------------------------------------------------------------
// Registra quién hizo qué, sobre qué entidad, con el estado anterior y el nuevo.
// Se invoca desde las rutas sensibles (tickets, roles, bloqueos, personal).
//
// El `usuario_carnet` se resuelve en la misma sentencia: queda como snapshot,
// de modo que la bitácora conserva la identidad aunque el usuario se elimine.
//
// La auditoría NUNCA debe tumbar la operación de negocio: cualquier error se
// registra en consola y se continúa.
// =============================================================================
import { query } from '../db/pool.js';

/** IP del cliente (respeta X-Forwarded-For cuando hay proxy TLS). */
export function ipDe(req) {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req?.ip || req?.socket?.remoteAddress || null;
}

export async function auditar({ req, accion, entidad, entidad_id, datos_antes, datos_despues }) {
  try {
    const usuarioId = req?.user?.id || null;
    await query(
      `INSERT INTO tickets_auditoria
         (usuario_id, usuario_carnet, accion, entidad, entidad_id, datos_antes, datos_despues, ip)
       VALUES ($1,
               (SELECT carnet FROM usuarios WHERE id = $1),
               $2, $3, $4, $5, $6, $7)`,
      [
        usuarioId,
        accion,
        entidad,
        entidad_id != null ? String(entidad_id) : null,
        datos_antes ? JSON.stringify(datos_antes) : null,
        datos_despues ? JSON.stringify(datos_despues) : null,
        ipDe(req),
      ]
    );
  } catch (e) {
    console.error('[tickets:auditoria] error:', e.message);
  }
}
