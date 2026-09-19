// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: runner de migraciones
// -----------------------------------------------------------------------------
// Ejecuta las migraciones .sql de services/tickets/db/migrations en orden.
// Uso: npm run migrate
// =============================================================================
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';
import { config } from 'dotenv';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// Localiza db/migrations subiendo en el árbol. Funciona tanto desde el código
// fuente (services/tickets/backend) como dentro del contenedor (/app/src).
function findMigrationsDir() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const cand = join(dir, 'db', 'migrations');
    if (existsSync(cand)) return cand;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('No se encontró el directorio db/migrations');
}
const MIGRATIONS_DIR = findMigrationsDir();

async function migrate() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Tabla de control de migraciones
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (rows.length) {
      console.log(`[migrate] ya aplicada: ${file}`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] aplicada: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  console.log('[migrate] listo');
  await pool.end();
}

migrate().catch((e) => {
  console.error('[migrate] error:', e);
  process.exit(1);
});
