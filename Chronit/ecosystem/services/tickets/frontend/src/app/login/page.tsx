'use client';

import { useState } from 'react';
import { api, setSession } from '@/lib/api';
import Link from 'next/link';

export default function LoginPage() {
  const [carnet, setCarnet] = useState('');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      const data = await api<{ token?: string; user: unknown; needs_setup?: boolean }>('/api/auth/login', {
        method: 'POST',
        body: { carnet, password },
      });
      // Pilotos sincronizados sin contraseña: pedir que la definan.
      if (data.needs_setup) {
        setSetup(true);
        setMsg('Tu cuenta fue creada desde el sistema de carrera. Define una contraseña para continuar.');
        return;
      }
      setSession(data.token ?? null, data.user);
      window.location.href = '/dashboard';
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const finalizarSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      const data = await api<{ token?: string; user: unknown }>('/api/auth/setup', {
        method: 'POST',
        body: { carnet, password },
      });
      setSession(data.token ?? null, data.user);
      window.location.href = '/dashboard';
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        position: 'relative',
        backgroundImage: "linear-gradient(rgba(11,15,25,0.70), rgba(11,15,25,0.84)), url('/images/login.jpeg')",
        backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
      }}
    >
      <form className="card" style={{ width: 360, position: 'relative', zIndex: 1 }} onSubmit={setup ? finalizarSetup : submit}>
        <h1 style={{ marginBottom: 16 }}>{setup ? 'Define tu contraseña' : 'Ingresar'}</h1>
        <label className="label">Carnet / Email</label>
        <input className="input" value={carnet}
          onChange={(e) => setCarnet(e.target.value)} placeholder="Ej: PIL-123" required />
        <label className="label">{setup ? 'Nueva contraseña' : 'Contraseña'}</label>
        <input className="input" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="••••••" required />
        {msg && <p style={{ color: setup ? '#f59e0b' : '#f87171', marginTop: 10, fontSize: '0.85rem' }}>{msg}</p>}
        <button className="btn btn-primary" type="submit"
          style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>
          {setup ? 'Guardar y continuar' : 'Ingresar'}
        </button>
        {!setup && (
          <p style={{ marginTop: 14, fontSize: '0.85rem', color: '#8aa4c7', textAlign: 'center' }}>
            ¿No tienes cuenta? <Link href="/register" style={{ color: '#3b82f6' }}>Regístrate aquí</Link>
          </p>
        )}
        {!setup && (
          <p style={{ marginTop: 8, fontSize: '0.8rem', color: '#5f7095', textAlign: 'center' }}>
            <Link href="/setup-admin" style={{ color: '#5f7095' }}>Primer acceso: crear administrador</Link>
          </p>
        )}
      </form>
    </div>
  );
}
