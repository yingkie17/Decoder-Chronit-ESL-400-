// =============================================================================
// CHRONIT ECOSYSTEM — CRM: lectura de la sesión compartida (Valkey)
// -----------------------------------------------------------------------------
// El CRM NO tiene login propio: reutiliza EXACTAMENTE la misma sesión del
// backend de tickets (cookie httpOnly `chronit_tickets_session` y clave
// `TICKETS_SESSION:<token>` en Valkey). Un usuario inicia sesión una sola vez
// en el ecosistema y el CRM valida esa misma sesión (JWT + Valkey).
//
// Conexión perezosa (lazyConnect) para no romper el arranque si Valkey tarda.
// =============================================================================
import Redis from 'ioredis';

export const SESSION_COOKIE = 'chronit_tickets_session';
const SESSION_PREFIX = 'TICKETS_SESSION:';

let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL || 'redis://valkey:6379';
  _redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });
  _redis.on('error', (e) => console.error('[crm:redis] error:', e.message));
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
