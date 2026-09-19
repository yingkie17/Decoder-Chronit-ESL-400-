// =============================================================================
// CHRONIT ECOSYSTEM — PANEL CONTABLE: cliente API (proyecto independiente)
// -----------------------------------------------------------------------------
// Este proyecto NO comparte archivos de código con el sistema de tickets.
// La única relación entre ambos es a nivel de API/sesión:
//
//   * Autenticación : tickets-backend (:4000) /api/auth/*  -> cookie httpOnly
//                     `chronit_tickets_session` (Valkey) + JWT Bearer.
//   * Datos          : contabilidad-backend (:4100) /api/conta/*  y /imprimir/*.
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

/** Backend del módulo de contabilidad (datos financieros). */
export const CONTA_API_URL = resolveUrl(
  process.env.NEXT_PUBLIC_CONTA_API_URL || '',
  process.env.NEXT_PUBLIC_CONTA_API_PORT || '4100',
  'http://localhost:4100',
);

/** Frontend del sistema de tickets: destino de los enlaces cruzados (Caja). */
export const TICKETS_FRONTEND_URL = resolveUrl(
  process.env.NEXT_PUBLIC_TICKETS_FRONTEND_URL || '',
  process.env.NEXT_PUBLIC_TICKETS_FRONTEND_PORT || '3000',
  'http://localhost:3000',
);

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

/** Llamada al backend de contabilidad. */
export async function contaApi<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${CONTA_API_URL}${path}`, {
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

/** Descarga un reporte exportado (CSV/PDF/Excel) respetando la cookie de sesión. */
export async function contaDescargar(path: string, nombreArchivo: string) {
  const res = await fetch(`${CONTA_API_URL}${path}`, { credentials: 'include' });
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

/** URL del ticket imprimible (lo renderiza el backend de contabilidad). */
export function urlImprimirTicket(ticketId: number | string, auto = true) {
  return `${CONTA_API_URL}/imprimir/ticket/${ticketId}${auto ? '?auto=1' : ''}`;
}

/** Abre el ticket imprimible en una pestaña nueva (el navegador lanza print). */
export function imprimirTicket(ticketId: number | string) {
  window.open(urlImprimirTicket(ticketId), '_blank');
}

export function cacheSet(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`chronit_cache_${key}`, JSON.stringify(value));
  } catch {
    /* noop */
  }
}

export function cacheGet<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`chronit_cache_${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
