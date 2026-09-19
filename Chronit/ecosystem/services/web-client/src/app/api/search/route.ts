// =============================================================================
// CHRONIT WEB CLIENT — GET /api/search?q=
// -----------------------------------------------------------------------------
// Busca pilotos por nombre, apellido, carnet, teléfono o correo (búsqueda
// parcial). Se usa desde la página pública de clientes para encontrar a otros
// pilotos. Requiere sesión (portal).
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE } from '@/lib/session';
import { query } from '@/lib/db';
import { flagOf } from '@/lib/constants';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    const session = token ? await getSession(token) : null;
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const q = (req.nextUrl.searchParams.get('q') || '').trim();
    if (q.length < 2) return NextResponse.json({ results: [] });

    const term = `%${q}%`;
    const { rows } = await query(
      `SELECT id, uuid_global, nombre, apellido, carnet, foto, nacionalidad
       FROM usuarios
       WHERE rol = 'piloto'
         AND (nombre ILIKE $1 OR apellido ILIKE $1 OR carnet ILIKE $1
              OR telefono ILIKE $1 OR email ILIKE $1
              OR (nombre || ' ' || apellido) ILIKE $1)
       ORDER BY nombre ASC, apellido ASC
       LIMIT 25`,
      [term]
    );

    return NextResponse.json({
      results: rows.map((r) => ({ ...r, flag: flagOf(r.nacionalidad) })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
