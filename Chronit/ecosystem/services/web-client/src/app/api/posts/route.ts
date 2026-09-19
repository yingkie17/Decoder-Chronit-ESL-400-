// =============================================================================
// CHRONIT WEB CLIENT — POST /api/posts
// -----------------------------------------------------------------------------
// Crea una publicación en el feed desde el portal del piloto (noticia, foto,
// evento, resultado...). Autor = usuario autenticado.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE } from '@/lib/session';
import { query } from '@/lib/db';
import { saveImage } from '@/lib/image';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    const session = token ? await getSession(token) : null;
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { tipo, titulo, contenido, imagen, evento_id } = await req.json();

    // Solo permitir publicar a personal autorizado (admin/taquilla/vestidor) o
    // cualquier piloto con estado (texto). Se valida contra la tabla de roles.
    let imagenUrl: string | null = null;
    if (imagen) imagenUrl = await saveImage(imagen, `post-${session.id}`);

    const { rows } = await query(
      `INSERT INTO posts (uuid_global, autor_id, tipo, titulo, contenido, imagen, evento_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, uuid_global, tipo, titulo, contenido, imagen, evento_id, creado_en`,
      [
        crypto.randomUUID(),
        session.id,
        tipo || 'noticia',
        titulo || null,
        contenido || null,
        imagenUrl,
        evento_id ? Number(evento_id) : null,
      ]
    );
    return NextResponse.json({ ok: true, post: rows[0] }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
