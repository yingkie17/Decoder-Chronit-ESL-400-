// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: runner de migraciones
// -----------------------------------------------------------------------------
// Ejecuta en orden los .sql de services/contabilidad/db/migrations.
// Idempotente: registra cada archivo aplicado en la tabla _migrations_conta.
//
// Algunas migraciones son ADITIVAS sobre tablas del módulo de tickets
// (p. ej. 0006_tickets_enrich.sql altera `tickets`). Ese esquema lo crea el
// backend de tickets, que arranca en paralelo; por eso cada migración se
// reintenta unas cuantas veces antes de darse por vencida.
//
// Uso: npm run migrate
// =============================================================================
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';
import { config } from 'dotenv';

config();

const REINTENTOS = Number(process.env.MIGRATE_REINTENTOS || 10);
const ESPERA_MS = Number(process.env.MIGRATE_ESPERA_MS || 3000);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const __dirname = dirname(fileURLToPath(import.meta.url));

// Localiza db/migrations subiendo en el árbol (funciona desde el código fuente
// services/contabilidad/backend y dentro del contenedor /app/src).
function findMigrationsDir() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const cand = join(dir, 'db', 'migrations');
    if (existsSync(cand)) return cand;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('No se encontró el directorio db/migrations de contabilidad');
}
const MIGRATIONS_DIR = findMigrationsDir();

async function migrate() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations_conta (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migrations_conta WHERE name = $1', [file]);
    if (rows.length) {
      console.log(`[conta:migrate] ya aplicada: ${file}`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    let ultimoError = null;
    for (let intento = 1; intento <= REINTENTOS; intento++) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations_conta (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[conta:migrate] aplicada: ${file}`);
        ultimoError = null;
        break;
      } catch (err) {
        await client.query('ROLLBACK');
        ultimoError = err;
        if (intento < REINTENTOS) {
          console.warn(
            `[conta:migrate] ${file} falló (intento ${intento}/${REINTENTOS}): ${err.message} — reintentando en ${ESPERA_MS} ms`
          );
          await dormir(ESPERA_MS);
        }
      } finally {
        client.release();
      }
    }
    if (ultimoError) throw ultimoError;
  }
  console.log('[conta:migrate] listo');
  await pool.end();
}

migrate().catch((e) => {
  console.error('[conta:migrate] error:', e.message);
  process.exit(1);
});
