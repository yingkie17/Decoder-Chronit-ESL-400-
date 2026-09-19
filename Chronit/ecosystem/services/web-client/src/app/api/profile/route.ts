// =============================================================================
// CHRONIT WEB CLIENT — PUT /api/profile
// -----------------------------------------------------------------------------
// Edita los datos del perfil del piloto autenticado (nombre, apellido, email,
// telefono, nacionalidad). Requiere sesión en Valkey.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE } from '@/lib/session';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function PUT(req: NextRequest) {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    const session = token ? await getSession(token) : null;
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { nombre, apellido, email, telefono, nacionalidad, edad, genero, carnet } = await req.json();
    // Validar unicidad si se cambia el carnet/email
    const dup = await query(
      'SELECT id FROM usuarios WHERE (carnet = $1 OR email = $2) AND id != $3 LIMIT 1',
      [carnet ?? null, email ?? null, session.id]
    );
    if (dup.rows.length) {
      return NextResponse.json({ error: 'Ese carnet o correo ya está en uso' }, { status: 409 });
    }
    const { rows } = await query(
      `UPDATE usuarios SET
         nombre = COALESCE($1, nombre),
         apellido = COALESCE($2, apellido),
         email = COALESCE($3, email),
         telefono = COALESCE($4, telefono),
         nacionalidad = COALESCE($5, nacionalidad),
         carnet = COALESCE($6, carnet),
         edad = COALESCE($7, edad),
         genero = COALESCE($8, genero),
         actualizado_en = now()
       WHERE id = $9
       RETURNING id, nombre, apellido, email, telefono, carnet, nacionalidad, edad, genero, foto, rol`,
      [
        nombre ?? null,
        apellido ?? null,
        email ?? null,
        telefono ?? null,
        nacionalidad ?? null,
        carnet ?? null,
        edad ? Number(edad) : null,
        genero ?? null,
        session.id,
      ]
    );
    if (!rows.length) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true, user: rows[0] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
