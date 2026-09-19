// =============================================================================
// CHRONIT ECOSYSTEM — CRM: auditoría de operaciones sensibles
// -----------------------------------------------------------------------------
// El CRM sólo LEE datos, pero la lectura masiva (consultas filtradas y, sobre
// todo, las EXPORTACIONES) es una operación sensible: se registra en
// `crm_auditoria` con el usuario, los filtros aplicados, el recurso y el nº de
// filas devueltas.
//
// La auditoría NUNCA debe romper la petición del usuario: si falla el registro,
// se emite un warning y la consulta continúa.
// =============================================================================
import { escribirAuditoria } from '../db/pool.js';

/** IP del cliente, respetando proxies (X-Forwarded-For). */
export function ipDe(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

/**
 * Registra una operación del CRM.
 * @param {object} p
 * @param {object} p.req        petición Express (para usuario e IP)
 * @param {string} p.accion     'consultar' | 'exportar'
 * @param {string} p.recurso    'personas' | 'tickets' | ...
 * @param {object} [p.filtros]  filtros aplicados
 * @param {number} [p.filas]    filas devueltas
 * @param {string} [p.formato]  'json' | 'csv'
 */
export async function auditar({ req, accion, recurso, filtros = null, filas = null, formato = 'json' }) {
  try {
    await escribirAuditoria(
      `INSERT INTO crm_auditoria (usuario_id, accion, recurso, filtros, filas, formato, ip)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [
        req.user?.id || null,
        accion,
        recurso,
        filtros && Object.keys(filtros).length ? JSON.stringify(filtros) : null,
        filas,
        formato,
        ipDe(req),
      ]
    );
  } catch (e) {
    console.warn('[crm:auditoria] no se pudo registrar:', e.message);
  }
}

/** Extrae sólo los filtros relevantes de la query (descarta page/limit). */
export function filtrosDe(query) {
  const copia = { ...query };
  delete copia.page;
  delete copia.limit;
  delete copia.formato;
  return copia;
}
