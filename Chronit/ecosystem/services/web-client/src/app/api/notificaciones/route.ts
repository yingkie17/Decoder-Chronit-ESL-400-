// =============================================================================
// CHRONIT WEB CLIENT — GET /api/notificaciones
// -----------------------------------------------------------------------------
// Notificaciones del piloto autenticado: llamadas a vestidores, estado del
// ticket y de su cola. Se usan para la campanita del menú y la página de
// notificaciones.
// =============================================================================
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE } from '@/lib/session';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    const session = token ? await getSession(token) : null;
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { rows } = await query(
      `SELECT c.id, c.estado, c.vestidor, c.llamada_en, c.ready_en,
              t.numero AS ticket_numero, t.estado AS ticket_estado,
              e.nombre AS evento_nombre, e.fecha AS evento_fecha, e.hora AS evento_hora
       FROM colas c
       JOIN tickets t ON t.id = c.ticket_id
       LEFT JOIN eventos e ON e.id = t.evento_id
       WHERE t.usuario_id = $1
       ORDER BY COALESCE(c.llamada_en, c.ready_en, c.id) DESC NULLS LAST
       LIMIT 15`,
      [session.id]
    );

    type Fila = { estado: string };
    const activas = (rows as Fila[]).filter((r) => ['llamado', 'vestidor1', 'vestidor2', 'ready', 'en_pista'].includes(r.estado));
    return NextResponse.json({ notificaciones: rows, activas: activas.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
