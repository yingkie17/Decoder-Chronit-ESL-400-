// =============================================================================
// CHRONIT WEB CLIENT — GET /api/feed
// -----------------------------------------------------------------------------
// Devuelve el feed social del piloto autenticado:
//   - publicaciones (posts) con autor, nº de likes/comentarios y like propio
//   - próximos eventos
//   - últimos resultados de carreras (con pilotos)
//   - notificaciones (llamadas a vestidores)
// =============================================================================
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE } from '@/lib/session';
import { query, type UsuarioRow } from '@/lib/db';
import { flagOf } from '@/lib/constants';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    const session = token ? await getSession(token) : null;
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { rows: urows } = await query('SELECT * FROM usuarios WHERE id = $1', [session.id]);
    const user = urows[0] as UsuarioRow | undefined;
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

    // Publicaciones del feed
    const posts = await query(
      `SELECT p.id, p.uuid_global, p.tipo, p.titulo, p.contenido, p.imagen, p.evento_id, p.creado_en,
              u.id AS autor_id, u.nombre AS autor_nombre, u.apellido AS autor_apellido,
              u.foto AS autor_foto, u.nacionalidad AS autor_nacionalidad,
              (SELECT count(*) FROM post_likes pl WHERE pl.post_id = p.id) AS likes,
              (SELECT count(*) FROM post_comments pc WHERE pc.post_id = p.id) AS comments,
              EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.usuario_id = $1) AS liked_by_me
       FROM posts p
       LEFT JOIN usuarios u ON u.id = p.autor_id
       ORDER BY p.creado_en DESC NULLS LAST
       LIMIT 30`,
      [session.id]
    );

    // Próximos eventos
    const eventos = await query(
      `SELECT id, nombre, fecha, hora, estado, tipo_carrera, tipo_pista FROM eventos
       WHERE estado IN ('pendiente', 'asignado', 'preparada')
       ORDER BY fecha ASC NULLS LAST
       LIMIT 10`
    );

    // Últimos resultados
    const resultados = await query(
      `SELECT r.id, r.fecha, r.posicion, r.tiempo_total, r.mejor_vuelta, r.circuito, r.vuelta_rapida,
              u.nombre, u.apellido, u.carnet, u.foto, u.nacionalidad
       FROM resultados_carrera r
       JOIN usuarios u ON u.id = r.usuario_id
       ORDER BY r.fecha DESC NULLS LAST
       LIMIT 20`
    );

    // Notificaciones de llamada a vestidores (del usuario autenticado)
    const notificaciones = await query(
      `SELECT c.id, c.estado, c.vestidor, c.llamada_en, c.ready_en,
              t.numero AS ticket_numero, e.nombre AS evento_nombre, e.fecha AS evento_fecha
       FROM colas c
       JOIN tickets t ON t.id = c.ticket_id
       LEFT JOIN eventos e ON e.id = t.evento_id
       WHERE t.usuario_id = $1 AND c.estado IN ('llamado', 'vestidor1', 'vestidor2', 'ready', 'en_pista')
       ORDER BY COALESCE(c.llamada_en, c.ready_en, c.id) DESC
       LIMIT 10`,
      [session.id]
    );

    return NextResponse.json({
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        carnet: user.carnet,
        foto: user.foto,
        nacionalidad: user.nacionalidad,
        rol: user.rol,
        flag: flagOf(user.nacionalidad),
      },
      posts: posts.rows,
      eventos: eventos.rows,
      resultados: resultados.rows,
      notificaciones: notificaciones.rows,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
