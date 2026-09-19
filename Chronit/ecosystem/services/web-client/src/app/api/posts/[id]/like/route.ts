// =============================================================================
// CHRONIT WEB CLIENT — POST /api/posts/[id]/like
// -----------------------------------------------------------------------------
// Alterna el "me gusta" del usuario autenticado sobre una publicación.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE } from '@/lib/session';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  ctx: { params: { id: string } }
) {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    const session = token ? await getSession(token) : null;
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const postId = Number(ctx.params.id);
    if (!postId) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

    const del = await query('DELETE FROM post_likes WHERE post_id = $1 AND usuario_id = $2 RETURNING id', [
      postId,
      session.id,
    ]);

    let liked: boolean;
    if (del.rows.length) {
      liked = false; // estaba con like -> se quita
    } else {
      await query('INSERT INTO post_likes (post_id, usuario_id) VALUES ($1, $2)', [postId, session.id]);
      liked = true; // nuevo like
    }

    const cnt = await query('SELECT count(*) AS n FROM post_likes WHERE post_id = $1', [postId]);
    return NextResponse.json({ ok: true, liked: liked, likes: Number(cnt.rows[0].n) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
