// =============================================================================
// CHRONIT ECOSYSTEM — Cliente API (frontend Next.js)
// -----------------------------------------------------------------------------
// Envuelve las llamadas al backend de tickets. La sesión vive en el servidor
// (cookie httpOnly `chronit_tickets_session` + Valkey), por lo que todas las
// peticiones se envían con `credentials: 'include'`. El usuario se cachea en
// localStorage solo para pintar la UI mientras se revalida contra /api/auth/me.
// =============================================================================

// Base de la API resuelta en TIEMPO DE EJECUCIÓN para que el mismo build sirva
// tanto en localhost como al abrir la app desde otra IP o dominio:
//   - Si NEXT_PUBLIC_API_URL apunta a un host real (no localhost), se usa tal cual.
//   - Si apunta a localhost/127.0.0.1 (valor por defecto del build), se sustituye
//     por el host desde el que se sirve la página, conservando el esquema
//     (http/https). Así el navegador nunca llama a "su propio" localhost.
// El puerto del backend se puede cambiar con NEXT_PUBLIC_API_PORT (default 4000).
function resolveApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL || '';
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    const esLocal = /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/.test(configured);
    if (!configured || esLocal) {
      const port = process.env.NEXT_PUBLIC_API_PORT || '4000';
      return `${protocol}//${hostname}:${port}`;
    }
    return configured;
  }
  return configured || 'http://localhost:4000';
}

export const API_URL = resolveApiUrl();

// ---------------------------------------------------------------------------
// Backend de CONTABILIDAD (puerto 4100) — caja, ventas, reportes, usuarios.
// Mismo criterio de resolución en tiempo de ejecución que API_URL, pero con su
// propio puerto (NEXT_PUBLIC_CONTA_API_PORT, default 4100). La sesión es la
// MISMA cookie httpOnly que la del backend de tickets.
// ---------------------------------------------------------------------------
function resolveContaApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_CONTA_API_URL || '';
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    const esLocal = /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/.test(configured);
    if (!configured || esLocal) {
      const port = process.env.NEXT_PUBLIC_CONTA_API_PORT || '4100';
      return `${protocol}//${hostname}:${port}`;
    }
    return configured;
  }
  return configured || 'http://localhost:4100';
}

export const CONTA_API_URL = resolveContaApiUrl();

// ---------------------------------------------------------------------------
// Panel contable INDEPENDIENTE (puerto 3002). El módulo contable ya no vive en
// este frontend: se accede a él por enlace cruzado, en su propio proyecto.
// ---------------------------------------------------------------------------
function resolveContaFrontendUrl(): string {
  const configured = process.env.NEXT_PUBLIC_CONTA_FRONTEND_URL || '';
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    const esLocal = /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/.test(configured);
    if (!configured || esLocal) {
      const port = process.env.NEXT_PUBLIC_CONTA_FRONTEND_PORT || '3002';
      return `${protocol}//${hostname}:${port}`;
    }
    return configured;
  }
  return configured || 'http://localhost:3002';
}

export const CONTA_FRONTEND_URL = resolveContaFrontendUrl();

export const TOKEN_KEY = 'chronit_token';
export const USER_KEY = 'chronit_user';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setSession(token?: string | null, user?: unknown) {
  if (typeof window === 'undefined') return;
  // El token ya no es necesario (la sesión va en cookie), pero se conserva por
  // compatibilidad con clientes que envíen Authorization: Bearer.
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

// Evento global que dispara el guard cuando la sesión deja de ser válida.
// Permite que varias pestañas/ventanas se sincronicen sin recargar a mano.
export const AUTH_EXPIRED_EVENT = 'chronit:auth-expired';

// Cierra la sesión local y (si no estamos ya en /login) fuerza el regreso al
// login. Se usa tanto desde el interceptor de 401 como desde el guard.
export function forceLogout() {
  if (typeof window === 'undefined') return;
  clearSession();
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  if (window.location.pathname !== '/login') {
    window.location.replace('/login');
  }
}

// Re-valida el token contra el backend. Devuelve el usuario fresco o lanza
// (con `.status`) si el token no existe, expiró o fue revocado.
export async function fetchMe<T = unknown>(): Promise<T> {
  const data = await api<{ user: T }>('/api/auth/me');
  return data.user;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method || 'GET',
    headers,
    // La sesión va en cookie httpOnly: enviarla siempre (cross-origin incluido).
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Interceptor global: si la sesión expiró o fue revocada (401) en una ruta
    // protegida, limpiar y volver al login. No aplica al propio login/setup,
    // donde un 401 significa credenciales incorrectas (no sesión caída).
    const esEntrada = path === '/api/auth/login' || path === '/api/auth/setup';
    if (res.status === 401 && !esEntrada) forceLogout();
    const err = new Error((data as { error?: string }).error || `Error ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Cliente del backend de contabilidad (/api/conta/*) + impresión de tickets.
// ---------------------------------------------------------------------------
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

/** Descarga un reporte exportado (PDF/Excel) respetando la sesión por cookie. */
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

// Guarda/lee en localStorage como caché local para el modo offline.
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

// ---------------------------------------------------------------------------
// Cliente Socket.io para notificaciones en tiempo real (llamado a vestidores).
// Se carga dinámicamente para no romper el build si no se usa.
// ---------------------------------------------------------------------------
export interface LiveSocket {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  emit: (event: string, payload?: unknown) => void;
  disconnect: () => void;
}

export async function connectLive(): Promise<LiveSocket | null> {
  if (typeof window === 'undefined') return null;
  try {
    const { io } = await import('socket.io-client');
    const socket = io(API_URL, { transports: ['websocket', 'polling'] });
    return socket as unknown as LiveSocket;
  } catch {
    return null;
  }
}
