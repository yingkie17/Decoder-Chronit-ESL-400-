// =============================================================================
// CHRONIT WEB CLIENT — Formulario de inicio de sesión (Client Component)
// -----------------------------------------------------------------------------
// Envía correo electrónico (o carnet) + contraseña a /api/login. Al loguear, el
// servidor crea la sesión en Valkey y la guarda en cookie httpOnly.
// =============================================================================
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo iniciar sesión');
      router.push('/feed');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid" style={{ gridTemplateColumns: '1fr' }}>
      <div>
        <label className="label">Correo electrónico</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.com"
          required
        />
      </div>
      <div>
        <label className="label">Contraseña</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Tu contraseña"
          required
        />
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{error}</p>}
      <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
        {loading ? 'Ingresando…' : 'Iniciar sesión'}
      </button>
      <p className="muted small">
        ¿No tienes cuenta?{' '}
        <Link href="/register" style={{ color: 'var(--blue)', fontWeight: 600 }}>
          Crea una aquí
        </Link>
      </p>
    </form>
  );
}
