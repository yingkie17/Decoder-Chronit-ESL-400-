// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: sesiones con Valkey
// -----------------------------------------------------------------------------
// La sesión del staff se guarda en el SERVIDOR (Valkey) y se expone al navegador
// en una cookie httpOnly. Así la sesión sobrevive a recargas de página y se
// puede invalidar desde el servidor (logout), sin depender de JWT guardado en
// localStorage (que se perdía al refrescar cuando el API_URL no coincidía).
//
// La conexión a Valkey es perezosa (lazyConnect): no se conecta hasta el primer
// comando, para no romper el arranque si Valkey aún no está listo.
//
// NOTA: el nombre de la cookie (chronit_tickets_session) es DISTINTO al de
// web-client (chronit_session) a propósito: las cookies ignoran el puerto, por
// lo que ambos servicios comparten el host `localhost` y NO deben pisarse.
// =============================================================================
import Redis from 'ioredis';
import crypto from 'crypto';

export const SESSION_COOKIE = 'chronit_tickets_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 horas

let _redis = null;

// Conexión a Valkey (singleton), creada solo al primer uso (runtime).
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL || 'redis://valkey:6379';
  _redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });
  // No romper la app si Valkey está caído; loguear y continuar.
  _redis.on('error', (e) => console.error('[tickets:redis] error:', e.message));
  return _redis;
}

// Crea la sesión del usuario en Valkey y devuelve el token opaco.
export async function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await getRedis().set(`TICKETS_SESSION:${token}`, JSON.stringify(user), 'EX', SESSION_TTL_SECONDS);
  return token;
}

// Lee los datos de la sesión por token. Devuelve null si no existe o expiró.
export async function getSession(token) {
  if (!token) return null;
  try {
    const raw = await getRedis().get(`TICKETS_SESSION:${token}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Invalida la sesión (logout).
export async function destroySession(token) {
  if (!token) return;
  try {
    await getRedis().del(`TICKETS_SESSION:${token}`);
  } catch {
    /* noop */
  }
}

// --- Configuración de cookie ---
// Secure requiere HTTPS: se activa con COOKIE_SECURE=true (detrás de un proxy TLS).
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
// SameSite=Lax funciona para localhost:3000 -> localhost:4000 y para subdominios
// del mismo dominio (mismo "site"). Para dominios cruzados usar COOKIE_SAMESITE=none.
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'lax';

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res) {
  res.cookie(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: 0,
  });
}

// Lee una cookie del header sin dependencias externas.
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
