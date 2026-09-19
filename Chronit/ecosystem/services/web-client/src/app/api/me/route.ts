// =============================================================================
// CHRONIT WEB CLIENT — GET /api/me
// -----------------------------------------------------------------------------
// Devuelve el usuario autenticado (si hay sesión válida) junto con su ticket,
// el evento asignado, la cola de vestidor, sus tiempos y premios.
// =============================================================================
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE } from '@/lib/session';
import { query, type UsuarioRow } from '@/lib/db';
import { flagOf } from '@/lib/constants';

export const runtime = 'nodejs';

const PUBLIC_USER = (u: UsuarioRow) => ({
  id: u.id,
  uuid_global: u.uuid_global,
  nombre: u.nombre,
  apellido: u.apellido,
  email: u.email,
  telefono: u.telefono,
  carnet: u.carnet,
  foto: u.foto,
  nacionalidad: u.nacionalidad,
  edad: u.edad,
  genero: u.genero,
  rol: u.rol,
  creado_en: u.creado_en,
  flag: flagOf(u.nacionalidad),
});

export async function GET() {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    const session = token ? await getSession(token) : null;
    if (!session) return NextResponse.json({ user: null }, { status: 200 });

    const { rows } = await query('SELECT * FROM usuarios WHERE id = $1', [session.id]);
    const user = rows[0] as UsuarioRow | undefined;
    if (!user) {
      const r = NextResponse.json({ user: null });
      r.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
      return r;
    }

    // Último ticket del usuario (con su evento y cola)
    const ticket = await query(
      `SELECT t.id, t.numero, t.estado AS ticket_estado, t.creado_en, t.pagado_en, t.asignado_en,
              e.id AS evento_id, e.nombre AS evento_nombre, e.fecha AS evento_fecha,
              e.hora AS evento_hora, e.estado AS evento_estado, e.tipo_carrera,
              c.estado AS cola_estado, c.vestidor, c.llamada_en, c.ready_en
       FROM tickets t
       LEFT JOIN eventos e ON e.id = t.evento_id
       LEFT JOIN colas c ON c.ticket_id = t.id
       WHERE t.usuario_id = $1
       ORDER BY t.id DESC
       LIMIT 5`,
      [session.id]
    );

    // Tiempos (resultados de carrera)
    const resultados = await query(
      `SELECT id, fecha, posicion, tiempo_total, mejor_vuelta, circuito, vuelta_rapida
       FROM resultados_carrera WHERE usuario_id = $1 ORDER BY fecha DESC LIMIT 20`,
      [session.id]
    );

    // Premios (logros/palmarés)
    const premios = await query(
      `SELECT id, tipo, descripcion, fecha, imagen FROM logros
       WHERE usuario_id = $1 ORDER BY fecha DESC LIMIT 20`,
      [session.id]
    );

    return NextResponse.json({
      user: PUBLIC_USER(user),
      tickets: ticket.rows,
      resultados: resultados.rows,
      premios: premios.rows,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
