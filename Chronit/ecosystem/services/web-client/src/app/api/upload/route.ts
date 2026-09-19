// =============================================================================
// CHRONIT WEB CLIENT — POST /api/upload
// -----------------------------------------------------------------------------
// Sube la foto de perfil del piloto. Recibe la imagen en base64 (data URL),
// la guarda en disco y actualiza `usuarios.foto`. Se sirve luego por
// GET /api/uploads/:name.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE, updateSession } from '@/lib/session';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

export async function POST(req: NextRequest) {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    const session = token ? await getSession(token) : null;
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { foto, tipo } = await req.json();
    if (!foto || typeof foto !== 'string') {
      return NextResponse.json({ error: 'Imagen requerida (base64)' }, { status: 400 });
    }
    const destino = tipo === 'cover' ? 'portada' : 'foto';

    // Soporta data URL ("data:image/png;base64,....") o base64 plano.
    let mime = 'image/jpeg';
    let b64 = foto;
    if (foto.startsWith('data:')) {
      const m = foto.match(/^data:(image\/[a-z]+);base64,(.*)$/i);
      if (!m) return NextResponse.json({ error: 'Formato de imagen inválido' }, { status: 400 });
      mime = m[1];
      b64 = m[2];
    }
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const buffer = Buffer.from(b64, 'base64');

    await mkdir(UPLOAD_DIR, { recursive: true });
    const name = `${session.id}-${destino}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    await writeFile(path.join(UPLOAD_DIR, name), buffer);

    // Ruta canónica GLOBAL: /uploads/<name> la sirve el contenedor nginx `images`
    // (:5001) y es accesible por todos los módulos (web, tickets y carrera).
    const url = `/uploads/${name}`;
    await query(`UPDATE usuarios SET ${destino} = $1, actualizado_en = now() WHERE id = $2`, [url, session.id]);

    // Refresca la sesión (Valkey) para que el avatar del navbar cambie en
    // tiempo real sin necesidad de volver a iniciar sesión.
    if (token && destino === 'foto') await updateSession(token, { foto: url });

    return NextResponse.json({ ok: true, foto: url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
