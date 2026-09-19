// =============================================================================
// CHRONIT WEB CLIENT — POST /api/login
// -----------------------------------------------------------------------------
// Valida carnet + contraseña contra la tabla universal `usuarios` (bcryptjs),
// crea una sesión en Valkey y la expone en una cookie httpOnly.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, type UsuarioRow } from '@/lib/db';
import { createSession, SESSION_COOKIE, sessionMaxAge } from '@/lib/session';
import { flagOf } from '@/lib/constants';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { email, carnet, password } = await req.json();
    const ident = email?.trim() || carnet?.trim();
    if (!ident || !password) {
      return NextResponse.json({ error: 'Correo y contraseña son obligatorios' }, { status: 400 });
    }

    // Login principalmente por correo electrónico; si el valor no parece un
    // correo, se busca también por carnet (para pilotos sin email registrado).
    const { rows } = await query(
      `SELECT * FROM usuarios
       WHERE ($1 ~ '^[^@]+@[^@]+$' AND (lower(email) = lower($1) OR carnet = $1))
          OR email = $1 OR carnet = $1
       ORDER BY id DESC LIMIT 1`,
      [ident]
    );
    const user = rows[0] as UsuarioRow | undefined;
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 401 });
    }
    // Los invitados no tienen cuenta propia: no pueden iniciar sesión.
    if (user.es_invitado) {
      return NextResponse.json(
        { error: 'Los invitados no tienen una cuenta para iniciar sesión' },
        { status: 403 }
      );
    }
    if (!user.password_hash) {
      return NextResponse.json(
        { error: 'Esta cuenta aún no tiene contraseña. Regístrate desde la web.' },
        { status: 401 }
      );
    }
    const ok = await bcrypt.compare(password || '', user.password_hash);
    if (!ok) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 });
    }

    const token = await createSession({
      id: user.id,
      rol: user.rol,
      nombre: user.nombre,
      apellido: user.apellido,
      foto: user.foto,
      flag: flagOf(user.nacionalidad),
      email: user.email,
      carnet: user.carnet,
    });
    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        carnet: user.carnet,
        rol: user.rol,
        flag: flagOf(user.nacionalidad),
      },
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: sessionMaxAge,
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
