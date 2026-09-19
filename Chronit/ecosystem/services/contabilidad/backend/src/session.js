// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: lectura de la sesión compartida (Valkey)
// -----------------------------------------------------------------------------
// El módulo contable NO tiene login propio: reutiliza EXACTAMENTE la misma
// sesión del backend de tickets (cookie httpOnly `chronit_tickets_session` y
// clave `TICKETS_SESSION:<token>` en Valkey). Así el usuario inicia sesión una
// sola vez y ambos backends validan la misma sesión (JWT + Valkey).
//
// La conexión a Valkey es perezosa (lazyConnect) para no romper el arranque.
// =============================================================================
import Redis from 'ioredis';
import crypto from 'crypto';

export const SESSION_COOKIE = 'chronit_tickets_session';
const SESSION_PREFIX = 'TICKETS_SESSION:';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 horas

let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL || 'redis://valkey:6379';
  _redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });
  _redis.on('error', (e) => console.error('[conta:redis] error:', e.message));
  return _redis;
}

export async function getSession(token) {
  if (!token) return null;
  try {
    const raw = await getRedis().get(`${SESSION_PREFIX}${token}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await getRedis().set(`${SESSION_PREFIX}${token}`, JSON.stringify(user), 'EX', SESSION_TTL_SECONDS);
  return token;
}

export async function destroySession(token) {
  if (!token) return;
  try { await getRedis().del(`${SESSION_PREFIX}${token}`); } catch { /* noop */ }
}

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}
