// =============================================================================
// CHRONIT WEB CLIENT — /api/posts/[id]/comments
//   GET  -> lista de comentarios de la publicación
//   POST -> añade un comentario (usuario autenticado)
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE } from '@/lib/session';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const postId = Number(ctx.params.id);
    if (!postId) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    const { rows } = await query(
      `SELECT c.id, c.contenido, c.creado_en,
              u.id AS autor_id, u.nombre AS autor_nombre, u.apellido AS autor_apellido, u.foto AS autor_foto
       FROM post_comments c
       LEFT JOIN usuarios u ON u.id = c.autor_id
       WHERE c.post_id = $1
       ORDER BY c.creado_en ASC`,
      [postId]
    );
    return NextResponse.json({ comments: rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    const session = token ? await getSession(token) : null;
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const postId = Number(ctx.params.id);
    const { contenido } = await req.json();
    if (!contenido || !String(contenido).trim()) {
      return NextResponse.json({ error: 'El comentario no puede estar vacío' }, { status: 400 });
    }

    const { rows } = await query(
      `INSERT INTO post_comments (post_id, autor_id, contenido)
       VALUES ($1, $2, $3)
       RETURNING id, contenido, creado_en, autor_id`,
      [postId, session.id, String(contenido).trim()]
    );
    return NextResponse.json({ ok: true, comment: rows[0] }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
