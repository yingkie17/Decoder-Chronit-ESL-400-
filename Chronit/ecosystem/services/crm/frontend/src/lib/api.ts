// =============================================================================
// CHRONIT ECOSYSTEM — CRM INTERNO: cliente API (proyecto independiente)
// -----------------------------------------------------------------------------
// Este proyecto NO comparte archivos de código con el resto de paneles.
// La única relación entre ambos es a nivel de API/sesión:
//
//   * Autenticación : tickets-backend (:4000) /api/auth/*  -> cookie httpOnly
//                     `chronit_tickets_session` (Valkey) + JWT Bearer.
//   * Datos          : crm-backend (:4200) /api/crm/*  (SOLO LECTURA).
//
// La sesión vive en el servidor (cookie httpOnly); la fuente de verdad es
// GET /api/auth/me y el usuario cacheado en localStorage solo pinta la UI.
// =============================================================================

// Resolución en TIEMPO DE EJECUCIÓN: el mismo build sirve en localhost o en
// cualquier IP/dominio. Si la URL configurada es localhost/127.0.0.1 se
// sustituye por el host desde el que se sirvió la página, conservando esquema.
function resolveUrl(configured: string, port: string, fallback: string): string {
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    const esLocal = /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/.test(configured);
    if (!configured || esLocal) return `${protocol}//${hostname}:${port}`;
    return configured;
  }
  return configured || fallback;
}

/** Backend del sistema de tickets: sólo para autenticación y enlaces cruzados. */
export const API_URL = resolveUrl(
  process.env.NEXT_PUBLIC_API_URL || '',
  process.env.NEXT_PUBLIC_API_PORT || '4000',
  'http://localhost:4000',
);

/** Backend del CRM interno (datos centralizados, solo lectura). */
export const CRM_API_URL = resolveUrl(
  process.env.NEXT_PUBLIC_CRM_API_URL || '',
  process.env.NEXT_PUBLIC_CRM_API_PORT || '4200',
  'http://localhost:4200',
);

/** Frontend del sistema de tickets: destino de enlaces cruzados. */
export const TICKETS_FRONTEND_URL = resolveUrl(
  process.env.NEXT_PUBLIC_TICKETS_FRONTEND_URL || '',
  process.env.NEXT_PUBLIC_TICKETS_FRONTEND_PORT || '3000',
  'http://localhost:3000',
);

/** Frontend del panel contable: destino de enlaces cruzados. */
export const CONTA_FRONTEND_URL = resolveUrl(
  process.env.NEXT_PUBLIC_CONTA_FRONTEND_URL || '',
  process.env.NEXT_PUBLIC_CONTA_FRONTEND_PORT || '3002',
  'http://localhost:3002',
);

/** Portal web (pantalla pública / portal del piloto): enlaces cruzados. */
export const WEB_FRONTEND_URL = resolveUrl(
  process.env.NEXT_PUBLIC_WEB_FRONTEND_URL || '',
  process.env.NEXT_PUBLIC_WEB_FRONTEND_PORT || '3001',
  'http://localhost:3001',
);

/** Roles con acceso al CRM centralizado (mismos que valida el backend). */
export const CRM_ROLES = [
  'admin', 'desarrollador', 'dueno', 'socio', 'supervisor', 'contador', 'coordinador',
];

export const TOKEN_KEY = 'chronit_token';
export const USER_KEY = 'chronit_user';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setSession(token?: string | null, user?: unknown) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

// Evento global: el guard lo escucha para reaccionar a la caída de la sesión.
export const AUTH_EXPIRED_EVENT = 'chronit:auth-expired';

export function forceLogout() {
  if (typeof window === 'undefined') return;
  clearSession();
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  if (window.location.pathname !== '/login') {
    window.location.replace('/login');
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

/** Llamada al backend de tickets (autenticación). */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method || 'GET',
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const esEntrada = path === '/api/auth/login' || path === '/api/auth/setup';
    if (res.status === 401 && !esEntrada) forceLogout();
    const err = new Error((data as { error?: string }).error || `Error ${res.status}`) as Error
      & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export async function fetchMe<T = unknown>(): Promise<T> {
  const data = await api<{ user: T }>('/api/auth/me');
  return data.user;
}

/** Llamada al backend del CRM (datos centralizados, solo lectura). */
export async function crmApi<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${CRM_API_URL}${path}`, {
    method: opts.method || 'GET',
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) forceLogout();
    const err = new Error((data as { error?: string }).error || `Error ${res.status}`) as Error
      & { status?: number; code?: string };
    err.status = res.status;
    err.code = (data as { code?: string }).code;
    throw err;
  }
  return data as T;
}

/** Descarga una exportación CSV del CRM respetando la cookie de sesión. */
export async function crmDescargar(path: string, nombreArchivo: string) {
  const res = await fetch(`${CRM_API_URL}${path}`, { credentials: 'include' });
  if (!res.ok) {
    if (res.status === 401) forceLogout();
    throw new Error(`No se pudo descargar el archivo (${res.status})`);
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
