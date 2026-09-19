// =============================================================================
// CHRONIT ECOSYSTEM — CRM: pool de conexión a PostgreSQL
// -----------------------------------------------------------------------------
// El CRM lee la MISMA base de datos del ecosistema, pero en modo SOLO LECTURA:
// cada consulta se ejecuta dentro de una transacción marcada READ ONLY, de modo
// que un error de programación no pueda alterar datos de otros sistemas.
//
// La zona horaria de negocio (America/La_Paz) se impone en cada conexión: es la
// misma que usan contabilidad y reportes.
// =============================================================================
import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

const TZ_NEGOCIO = process.env.PGTZ || process.env.TZ || 'America/La_Paz';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 6,
  idleTimeoutMillis: 30000,
  options: `-c timezone=${TZ_NEGOCIO}`,
});

/**
 * Ejecuta una consulta dentro de una transacción READ ONLY.
 * Garantiza que el CRM nunca escriba en las tablas de los demás sistemas.
 */
export async function soloLectura(text, params = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Escritura permitida EXCLUSIVAMENTE en la auditoría del CRM (`crm_auditoria`).
 * Cualquier otro acceso de escritura debe pasar por aquí de forma explícita.
 */
export async function escribirAuditoria(text, params = []) {
  return pool.query(text, params);
}

export const db = { query: (text, params) => soloLectura(text, params) };
