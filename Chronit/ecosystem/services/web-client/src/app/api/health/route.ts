// =============================================================================
// CHRONIT WEB CLIENT — GET /api/health
// -----------------------------------------------------------------------------
// Healthcheck del propio servidor de la web de cliente: verifica que la base de
// datos PostgreSQL responde. Se usa desde el navegador (OfflineBanner) para
// avisar al piloto cuando el sistema deja de estar accesible.
// =============================================================================
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await query('SELECT 1');
    return NextResponse.json({ ok: true, service: 'web-client' });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message, service: 'web-client' },
      { status: 503 }
    );
  }
}
