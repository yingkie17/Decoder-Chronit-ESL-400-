// =============================================================================
// CHRONIT WEB CLIENT — POST /api/register
// -----------------------------------------------------------------------------
// Crea una cuenta de piloto en la base universal (PostgreSQL). Acepta foto en
// base64 (opcional) y los datos del perfil. Al crear, inicia sesión (Valkey)
// y expone la cookie httpOnly.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { saveImage } from '@/lib/image';
import { createSession, SESSION_COOKIE, sessionMaxAge } from '@/lib/session';
import { flagOf } from '@/lib/constants';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nombre, apellido, email, telefono, carnet, nacionalidad, edad, genero, foto, password } = body;

    if (!nombre || !carnet || !password) {
      return NextResponse.json(
        { error: 'Nombre, carnet y contraseña son obligatorios' },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json({ error: 'El correo electrónico es obligatorio' }, { status: 400 });
    }

    // Duplicados: carnet y email únicos
    const dup = await query('SELECT 1 FROM usuarios WHERE carnet = $1 OR email = $2 LIMIT 1', [carnet, email]);
    if (dup.rows.length) {
      return NextResponse.json(
        { error: 'Ya existe una cuenta con ese carnet o correo' },
        { status: 409 }
      );
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO usuarios
         (uuid_global, nombre, apellido, email, telefono, carnet, password_hash, nacionalidad, edad, genero, rol)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'piloto')
       RETURNING id, uuid_global, nombre, apellido, email, telefono, carnet, foto, nacionalidad, edad, genero, rol`,
      [
        crypto.randomUUID(),
        nombre,
        apellido || '',
        email,
        telefono || null,
        carnet,
        hash,
        nacionalidad || null,
        edad ? Number(edad) : null,
        genero || null,
      ]
    );
    const user = rows[0];

    // Subir foto si viene en base64
    if (foto) {
      const url = await saveImage(foto, String(user.id));
      if (url) {
        await query('UPDATE usuarios SET foto = $1, actualizado_en = now() WHERE id = $2', [url, user.id]);
        user.foto = url;
      }
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
    const err = e as Error;
    console.error('[web-client:register] error al registrar:', {
      message: err.message,
      name: err.name,
      stack: err.stack,
      code: (e as { code?: string }).code,
    });
    if ((e as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Carnet o correo ya registrado' }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
