// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: seed de usuarios iniciales
// -----------------------------------------------------------------------------
// Se ejecuta automáticamente al arrancar el backend (después de migrate.js):
//   node src/db/migrate.js && node src/db/seed.js && node src/index.js
//
// Garantiza que SIEMPRE existan las credenciales de prueba al levantar el
// sistema, incluso tras `docker compose down -v` (que borra el volumen de la BD):
// la migración recrea las tablas vacías y el seed vuelve a sembrar los usuarios.
//
// Es IDEMPOTENTE: si un usuario ya existe por su `carnet`, lo salta. Seguro de
// ejecutar cualquier cantidad de veces.
//
// Configuración (variables de entorno):
//   SEED_ENABLED          -> 'false' desactiva el seed (recomendado en prod)
//   SEED_USERS_JSON       -> JSON con el array de usuarios (override del default)
//   BCRYPT_ROUNDS         -> coste del hash (default 10)
// =============================================================================
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';
import { config } from 'dotenv';

config();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

// Usuarios por defecto (credenciales de prueba del sistema).
const DEFAULT_USERS = [
  { carnet: 'ADMIN-001', password: 'Admin123!', rol: 'admin', nombre: 'Administrador', apellido: 'Chronit' },
  { carnet: 'CAJERO-001', password: 'Cajero123!', rol: 'cajero', nombre: 'Cajero', apellido: 'Chronit' },
  { carnet: 'COORD-001', password: 'Coord123!', rol: 'coordinador', nombre: 'Coordinador', apellido: 'Chronit' },
];

// Si SEED_USERS_JSON trae una lista, la usamos en su lugar. Formato:
//   SEED_USERS_JSON='[{"carnet":"X","password":"Y","rol":"admin","nombre":"Z"}]'
function loadUsers() {
  if (process.env.SEED_USERS_JSON) {
    try {
      const parsed = JSON.parse(process.env.SEED_USERS_JSON);
      if (Array.isArray(parsed) && parsed.length) return parsed;
      console.warn('[seed] SEED_USERS_JSON no es un array válido; usando defaults');
    } catch (e) {
      console.warn('[seed] SEED_USERS_JSON inválido; usando defaults');
    }
  }
  return DEFAULT_USERS;
}

// Asegura que el rol exista en la tabla `roles` antes de insertar el usuario
// (hay FK rol -> roles(nombre)). Idempotente.
async function ensureRole(rol) {
  await pool.query(
    `INSERT INTO roles (nombre, permisos) VALUES ($1, '{}')
     ON CONFLICT (nombre) DO NOTHING`,
    [rol]
  );
}

// Verifica que la tabla exista (por si el seed se corre sin las migraciones).
async function tableExists(table) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return rows.length > 0;
}

async function seedDefaultUsers() {
  if (process.env.SEED_ENABLED === 'false') {
    console.log('[seed] desactivado (SEED_ENABLED=false)');
    return;
  }

  if (!(await tableExists('usuarios'))) {
    throw new Error('La tabla "usuarios" no existe. Ejecuta primero "npm run migrate".');
  }

  const users = loadUsers();
  let creados = 0;

  for (const user of users) {
    // Verificar si existe (por carnet). Si existe, saltar.
    const { rows } = await pool.query('SELECT id FROM usuarios WHERE carnet = $1', [user.carnet]);
    if (rows.length) {
      console.log(`[seed] ya existe: ${user.carnet}`);
      continue;
    }
    await ensureRole(user.rol);
    const hash = await bcrypt.hash(user.password, BCRYPT_ROUNDS);
    await pool.query(
      `INSERT INTO usuarios (uuid_global, nombre, apellido, carnet, password_hash, rol)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), user.nombre || user.carnet, user.apellido || '', user.carnet, hash, user.rol || 'piloto']
    );
    creados += 1;
    console.log(`[seed] creado: ${user.carnet} (rol: ${user.rol})`);
  }

  console.log(`[seed] listo — ${creados} usuario(s) creado(s), ${users.length - creados} ya existentes`);
}

seedDefaultUsers()
  .then(() => pool.end())
  .catch((e) => {
    console.error('[seed] error:', e.message);
    process.exit(1);
  });
