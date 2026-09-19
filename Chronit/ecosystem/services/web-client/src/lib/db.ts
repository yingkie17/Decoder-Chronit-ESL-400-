// =============================================================================
// CHRONIT WEB CLIENT — Pool de conexión a PostgreSQL (base universal)
// -----------------------------------------------------------------------------
// El web de cliente lee/escribe la MISMA base de datos que usan todos los
// sistemas (kiosco, tickets, sync). Reutiliza la tabla `usuarios` para la
// sesión (login) y lee tickets/eventos/colas/resultados/logros del piloto.
// =============================================================================
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

export interface UsuarioRow {
  id: number;
  uuid_global: string;
  nombre: string;
  apellido: string;
  email: string | null;
  telefono: string | null;
  carnet: string;
  foto: string | null;
  portada: string | null;
  nacionalidad: string | null;
  edad: number | null;
  genero: string | null;
  rol: string;
  password_hash?: string | null;
  es_invitado?: boolean | null;
  creado_en: string;
  actualizado_en: string;
}

export const query = (text: string, params?: unknown[]) => pool.query(text, params);
