// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: auditoría obligatoria
// -----------------------------------------------------------------------------
// Registra quién hizo qué, sobre qué entidad, con el estado anterior y el nuevo.
// Es OBLIGATORIA en: ventas, pagos, sesiones_caja, egresos, propinas,
// cuentas_destino y configuración.
//
// `db` puede ser un client de transacción (para que la auditoría sea atómica
// con el cambio) o el pool.
// =============================================================================
import { pool } from '../db/pool.js';

export async function auditar(db, { usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues, ip }) {
  const exec = db || pool;
  try {
    await exec.query(
      `INSERT INTO conta_auditoria
         (usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        usuario_id || null,
        accion,
        entidad,
        entidad_id != null ? String(entidad_id) : null,
        datos_antes ? JSON.stringify(datos_antes) : null,
        datos_despues ? JSON.stringify(datos_despues) : null,
        ip || null,
      ]
    );
  } catch (e) {
    // La auditoría nunca debe tumbar la operación de negocio, pero sí avisar.
    console.error('[conta:auditoria] error:', e.message);
  }
}

/** IP del cliente (respeta X-Forwarded-For si hay proxy). */
export function ipDe(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}
