// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: cola de operaciones OFFLINE (SQLite)
// -----------------------------------------------------------------------------
// Si PostgreSQL no está disponible, las operaciones críticas (ventas) se
// encolan en un SQLite local y se reconciliar contra la base cuando vuelve.
// Es el mismo patrón que usa el servicio `sync` del ecosistema (SQLite -> PG).
//
// El archivo vive en OUTBOX_SQLITE_PATH (por defecto /app/data/conta_outbox.sqlite)
// dentro de un volumen del contenedor, de modo que sobrevive a reinicios.
//
// API:
//   disponible()            -> bool (better-sqlite3 cargó y el archivo abre)
//   encolar(tipo, payload)  -> { id, creado_en }
//   pendientes(limite)      -> filas en estado 'pendiente' ordenadas por id
//   marcarOk(id)            -> marca 'procesado'
//   marcarError(id, err)    -> incrementa intentos y guarda el error
//   estado()                -> resumen por estado (para /api/conta/outbox)
// =============================================================================
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const require = createRequire(import.meta.url);

const RUTA = process.env.OUTBOX_SQLITE_PATH || '/app/data/conta_outbox.sqlite';
const HABILITADO = process.env.OUTBOX_ENABLED !== 'false';

let _db = null;
let _error = null;

function abrir() {
  if (_db) return _db;
  if (!HABILITADO) {
    _error = 'Outbox deshabilitado (OUTBOX_ENABLED=false)';
    throw new Error(_error);
  }
  let Database;
  try {
    // better-sqlite3 es CommonJS: `require()` devuelve el constructor directamente.
    // Algunos bundlers lo envuelven en `{ default: ... }`; se soportan ambos.
    const mod = require('better-sqlite3');
    Database = mod && mod.default ? mod.default : mod;
    if (typeof Database !== 'function') throw new Error('el módulo no exporta un constructor');
  } catch (e) {
    _error = `better-sqlite3 no disponible: ${e.message}`;
    throw new Error(_error);
  }
  try {
    mkdirSync(dirname(RUTA), { recursive: true });
  } catch { /* el volumen ya existe */ }
  try {
    const db = new Database(RUTA);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS conta_outbox (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo          TEXT    NOT NULL,
        payload       TEXT    NOT NULL,
        estado        TEXT    NOT NULL DEFAULT 'pendiente', -- pendiente|procesado|error
        intentos      INTEGER NOT NULL DEFAULT 0,
        ultimo_error  TEXT,
        resultado     TEXT,
        creado_en     TEXT    NOT NULL,
        procesado_en  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_conta_outbox_estado ON conta_outbox(estado, id);
    `);
    // Compatibilidad con archivos creados antes de añadir `resultado`.
    try {
      const cols = db.prepare('PRAGMA table_info(conta_outbox)').all().map((c) => c.name);
      if (!cols.includes('resultado')) db.exec('ALTER TABLE conta_outbox ADD COLUMN resultado TEXT');
    } catch { /* noop */ }
    _db = db;
    return _db;
  } catch (e) {
    _error = `no se pudo abrir el SQLite del outbox (${RUTA}): ${e.message}`;
    throw new Error(_error);
  }
}

/** ¿Se puede usar el outbox? (no lanza, solo informa) */
export function disponible() {
  try { abrir(); return true; } catch { return false; }
}

export function motivoNoDisponible() {
  return _error;
}

export function encolar(tipo, payload) {
  const db = abrir();
  const creado = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO conta_outbox (tipo, payload, estado, creado_en) VALUES (?, ?, 'pendiente', ?)`
  ).run(String(tipo), JSON.stringify(payload ?? {}), creado);
  return { id: info.lastInsertRowid, creado_en: creado };
}

/** Máximo de intentos antes de dejar de reintentar una operación corrupta. */
export const MAX_INTENTOS = Number(process.env.OUTBOX_MAX_INTENTOS || 10);

export function pendientes(limite = 20) {
  const db = abrir();
  return db.prepare(
    `SELECT * FROM conta_outbox
      WHERE estado IN ('pendiente','error') AND intentos < ?
      ORDER BY id LIMIT ?`
  ).all(MAX_INTENTOS, Number(limite)).map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

export function marcarOk(id, resultado = null) {
  const db = abrir();
  db.prepare(
    `UPDATE conta_outbox
        SET estado = 'procesado', procesado_en = ?, ultimo_error = NULL, resultado = ?
      WHERE id = ?`
  ).run(new Date().toISOString(), resultado, id);
}

export function marcarError(id, mensaje) {
  const db = abrir();
  db.prepare(
    `UPDATE conta_outbox
        SET estado = 'error', intentos = intentos + 1, ultimo_error = ?, procesado_en = ?
      WHERE id = ?`
  ).run(String(mensaje).slice(0, 500), new Date().toISOString(), id);
}

export function estado() {
  if (!disponible()) {
    return { habilitado: HABILITADO, disponible: false, motivo: motivoNoDisponible(), ruta: RUTA, total: 0, por_estado: {} };
  }
  const db = abrir();
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM conta_outbox').get();
  const porEstado = db.prepare(
    'SELECT estado, COUNT(*) AS n FROM conta_outbox GROUP BY estado'
  ).all();
  const ultimos = db.prepare(
    `SELECT id, tipo, estado, intentos, ultimo_error, creado_en, procesado_en
       FROM conta_outbox ORDER BY id DESC LIMIT 20`
  ).all();
  return {
    habilitado: HABILITADO,
    disponible: true,
    ruta: RUTA,
    total,
    por_estado: Object.fromEntries(porEstado.map((r) => [r.estado, r.n])),
    ultimos,
  };
}
