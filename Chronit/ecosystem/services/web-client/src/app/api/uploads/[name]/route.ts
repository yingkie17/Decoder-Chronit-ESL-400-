// =============================================================================
// CHRONIT WEB CLIENT — GET /api/uploads/[name]
// -----------------------------------------------------------------------------
// Sirve las fotos de perfil subidas por los pilotos (guardadas en disco).
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

export async function GET(
  _req: NextRequest,
  ctx: { params: { name: string } }
) {
  try {
    const name = ctx.params.name;
    // Evitar path traversal
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      return NextResponse.json({ error: 'Nombre inválido' }, { status: 400 });
    }
    const file = await readFile(path.join(UPLOAD_DIR, name));
    const ext = path.extname(name).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return new NextResponse(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  }
}
