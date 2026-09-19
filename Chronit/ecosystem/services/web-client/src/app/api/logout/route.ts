// =============================================================================
// CHRONIT WEB CLIENT — POST /api/logout
// -----------------------------------------------------------------------------
// Invalida la sesión en Valkey y borra la cookie.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destroySession, SESSION_COOKIE } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  return logout(req);
}

export async function POST(req: NextRequest) {
  return logout(req);
}

// Cierra la sesión y redirige a la portada (muestra el login) en vez de
// devolver JSON, para que el usuario vuelva a la web del cliente.
async function logout(req: NextRequest) {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    if (token) await destroySession(token);
  } catch {
    /* noop */
  }
  const res = NextResponse.redirect(new URL('/', req.url), 303);
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
