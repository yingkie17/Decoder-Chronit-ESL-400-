// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pool de conexión a PostgreSQL
// -----------------------------------------------------------------------------
// Comparte la MISMA base de datos PostgreSQL que el módulo de tickets.
// =============================================================================
import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

// La zona horaria de negocio es America/La_Paz. PostgreSQL arranca en UTC, así
// que la imponemos en cada conexión del pool: sin esto, comparaciones como
// `creado_en >= '2026-09-17'::date` (cierres, reportes, dashboard) resolvían el
// límite del día en UTC y desplazaban las ventas de la madrugada al día anterior.
const TZ_NEGOCIO = process.env.PGTZ || process.env.TZ || 'America/La_Paz';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  options: `-c timezone=${TZ_NEGOCIO}`,
});

/**
 * Acceso a la BD fuera de transacción, con la MISMA firma que un client de pg
 * (`db.query(text, params)`). Los helpers (resumenSesion, getConfigMap,
 * listaVigente, ejecutar de reportes, ...) reciben `db` o un `client` de
 * `withTx` indistintamente.
 */
export const db = { query: (text, params) => pool.query(text, params) };
export const query = db.query;

/**
 * Ejecuta `fn(client)` dentro de una transacción.
 * Toda lectura de configuración + escritura de una venta ocurre aquí, de modo
 * que el valor aplicado se snapshotea de forma consistente.
 */
/**
 * ¿El error indica que PostgreSQL no está disponible (y por tanto corresponde
 * encolar la operación en el outbox offline)? Cubre fallos de red y los
 * códigos SQLSTATE de la clase 08 (connection exception) y 57 (shutdown).
 */
const CODIGOS_CONEXION = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ECONNRESET',
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
  '57P01', '57P02', '57P03', '53300',
]);

export function esErrorDeConexion(e) {
  if (!e) return false;
  if (CODIGOS_CONEXION.has(e.code)) return true;
  const msg = String(e.message || '');
  return /ECONNREFUSED|Connection terminated|timeout exceeded when trying to connect|the database system is (starting up|shutting down)|Client has encountered a connection error/i.test(msg);
}

export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}
