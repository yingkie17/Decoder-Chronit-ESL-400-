// =============================================================================
// CHRONIT WEB CLIENT — Autenticación (lectura de sesión desde cookies)
// -----------------------------------------------------------------------------
// Helper para que las Server Components y las Route Handlers obtengan el
// usuario autenticado a partir de la cookie de sesión (respaldada en Valkey).
// =============================================================================
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE, type SessionUser } from './session';

export async function currentUser(): Promise<SessionUser | null> {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return await getSession(token);
  } catch {
    return null;
  }
}
