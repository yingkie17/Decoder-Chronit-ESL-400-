// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: seed de usuarios de prueba del módulo
// -----------------------------------------------------------------------------
// Crea (si no existen) los usuarios de los nuevos roles para poder probar el
// módulo contable. NO toca los usuarios del módulo de tickets.
// Idempotente: verifica por `carnet` antes de insertar.
//
//   SUPERVISOR-001 / Supervisor123!
//   CONTADOR-001   / Contador123!
//   SOCIO-001      / Socio123!
//   DUENO-001      / Dueno123!
// =============================================================================
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';
import { config } from 'dotenv';

config();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

const USUARIOS = [
  { carnet: 'SUPERVISOR-001', password: 'Supervisor123!', rol: 'supervisor', nombre: 'Supervisor', apellido: 'Chronit' },
  { carnet: 'CONTADOR-001',   password: 'Contador123!',   rol: 'contador',   nombre: 'Contador',   apellido: 'Chronit' },
  { carnet: 'SOCIO-001',      password: 'Socio123!',      rol: 'socio',      nombre: 'Socio',      apellido: 'Chronit' },
  { carnet: 'DUENO-001',      password: 'Dueno123!',      rol: 'dueno',      nombre: 'Dueño',      apellido: 'Chronit' },
];

async function main() {
  if (process.env.SEED_ENABLED === 'false') {
    console.log('[conta:seed] desactivado (SEED_ENABLED=false)');
    return;
  }

  const { rows: t } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='usuarios'`
  );
  if (!t.length) throw new Error('La tabla usuarios no existe. Ejecuta primero las migraciones.');

  let creados = 0;
  for (const u of USUARIOS) {
    const { rows } = await pool.query('SELECT id FROM usuarios WHERE carnet = $1', [u.carnet]);
    if (rows.length) {
      console.log(`[conta:seed] ya existe: ${u.carnet}`);
      continue;
    }
    await pool.query(
      `INSERT INTO roles (nombre, permisos) VALUES ($1, '{}') ON CONFLICT (nombre) DO NOTHING`,
      [u.rol]
    );
    const hash = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
    await pool.query(
      `INSERT INTO usuarios (uuid_global, nombre, apellido, carnet, password_hash, rol)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), u.nombre, u.apellido, u.carnet, hash, u.rol]
    );
    creados++;
    console.log(`[conta:seed] creado: ${u.carnet} (rol: ${u.rol})`);
  }
  console.log(`[conta:seed] listo — ${creados} creado(s)`);
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error('[conta:seed] error:', e.message);
    process.exit(1);
  });
