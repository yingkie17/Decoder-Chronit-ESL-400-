// =============================================================================
// CHRONIT WEB CLIENT — Sesiones con Valkey (Lazy Loading)
// -----------------------------------------------------------------------------
// El usuario inicia sesión en la web y recibe un token opaco (random) que se
// guarda en Valkey (SESSION:<token> => datos del usuario). Se expone en una
// cookie httpOnly. Así la sesión se mantiene "iniciada" y se puede invalidar
// desde el servidor (logout) sin depender de JWT sin estado.
//
// La conexión a Valkey se establece en RUNTIME (lazyConnect), NO durante el
// build de Next.js. Esto evita errores "getaddrinfo ENOTFOUND valkey" al
// construir (npm run build) cuando el servicio aún no está levantado.
// =============================================================================
import Redis from 'ioredis';
import crypto from 'crypto';

// Conexión a Valkey (singleton): se crea solo al primer uso, en runtime.
let _redis: Redis | null = null;

// Durante el build de Next.js, NEXT_PHASE toma valores de fase de build
// (p.ej. 'phase-production-build'). En ese caso usamos un mock que no conecta.
let _isBuild =
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.NEXT_PHASE === 'phase-development-build' ||
  process.env.NEXT_PHASE === 'phase-export';

export interface SessionUser {
  id: number;
  rol: string;
  nombre?: string;
  apellido?: string;
  foto?: string | null;
  flag?: string;
  email?: string | null;
  carnet?: string;
}

export const SESSION_COOKIE = 'chronit_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 horas

/**
 * Devuelve la conexión a Valkey (solo en RUNTIME).
 * Durante el BUILD devuelve un mock que no conecta, para no fallar.
 */
function getRedis(): Redis {
  // BUILD: mock que no hace nada (evita ENOTFOUND valkey durante npm run build).
  if (_isBuild) {
    console.log('[web-client:redis] Modo BUILD - usando mock de Redis');
    // @ts-ignore - mock para build (no conecta realmente)
    return {
      get: async () => null,
      set: async () => {},
      del: async () => {},
      on: () => {},
      connect: async () => {},
      quit: async () => {},
    } as Redis;
  }

  if (_redis) return _redis;

  const url = process.env.REDIS_URL || 'redis://valkey:6379';
  _redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: true, // ⬅️ no conecta hasta el primer comando (runtime)
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  // No romper la app si Valkey está caído; loguear y continuar.
  _redis.on('error', (e) => {
    console.error('[web-client:redis] error:', e.message);
  });

  return _redis;
}

// Crea una sesión y devuelve el token opaco.
export async function createSession(
  user: SessionUser,
  data: Record<string, unknown> = {}
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const payload = JSON.stringify({ ...user, ...data });
  const redis = getRedis();
  await redis.set(`SESSION:${token}`, payload, 'EX', SESSION_TTL_SECONDS);
  return token;
}

// Lee los datos de la sesión por token. Devuelve null si no existe/expiro.
export async function getSession(token: string): Promise<SessionUser | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get(`SESSION:${token}`);
    if (!raw) return null;
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

// Invalida la sesión (logout).
export async function destroySession(token: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`SESSION:${token}`);
}

// Actualiza (merge) los datos de una sesión existente sin cambiar el token.
// Se usa, por ejemplo, al cambiar la foto de perfil para que el avatar del
// navbar se refresque en tiempo real en el siguiente render.
export async function updateSession(token: string, patch: Partial<SessionUser>): Promise<void> {
  try {
    const redis = getRedis();
    const raw = await redis.get(`SESSION:${token}`);
    if (!raw) return;
    const data = JSON.parse(raw) as SessionUser;
    await redis.set(`SESSION:${token}`, JSON.stringify({ ...data, ...patch }), 'EX', SESSION_TTL_SECONDS);
  } catch {
    /* la actualización de sesión no debe bloquear la operación principal */
  }
}

export const sessionMaxAge = SESSION_TTL_SECONDS;
