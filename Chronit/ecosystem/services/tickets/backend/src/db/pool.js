// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: pool de conexión a PostgreSQL
// =============================================================================
import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

export const query = (text, params) => pool.query(text, params);
