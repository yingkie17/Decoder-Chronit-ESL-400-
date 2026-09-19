'use client';

import { useState } from 'react';
import { api, setSession } from '@/lib/api';
import { NATIONALITIES } from '@/lib/constants';
import Link from 'next/link';

export default function RegisterPage() {
  const [form, setForm] = useState({
    nombre: '', apellido: '', carnet: '', email: '', telefono: '',
    nacionalidad: '', password: '',
  });
  const [msg, setMsg] = useState('');

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      const data = await api<{ token?: string; user: unknown }>('/api/auth/register', {
        method: 'POST',
        body: { ...form, foto: null },
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
        backgroundImage: "linear-gradient(rgba(11,15,25,0.70), rgba(11,15,25,0.84)), url('/images/backgroundjpeg4.jpeg')",
        backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
      }}
    >
      <form className="card" style={{ width: 480, position: 'relative', zIndex: 1 }} onSubmit={submit}>
        <h1 style={{ marginBottom: 16 }}>Registro de Piloto</h1>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Nombre *</label>
            <input className="input" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} required />
          </div>
          <div>
            <label className="label">Apellido</label>
            <input className="input" value={form.apellido} onChange={(e) => set('apellido', e.target.value)} />
          </div>
          <div>
            <label className="label">Carnet *</label>
            <input className="input" value={form.carnet} onChange={(e) => set('carnet', e.target.value)} required />
          </div>
          <div>
            <label className="label">Nacionalidad</label>
            <select className="input" value={form.nacionalidad} onChange={(e) => set('nacionalidad', e.target.value)}>
              <option value="">— Selecciona —</option>
              {NATIONALITIES.map((n) => (
                <option key={n.code} value={n.code}>{n.flag} {n.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input className="input" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="label">Contraseña *</label>
            <input className="input" type="password" value={form.password}
              onChange={(e) => set('password', e.target.value)} required />
          </div>
        </div>
        {msg && <p style={{ color: '#f87171', marginTop: 12, fontSize: '0.85rem' }}>{msg}</p>}
        <button className="btn btn-success" type="submit"
          style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>Crear cuenta</button>
        <p style={{ marginTop: 14, fontSize: '0.85rem', color: '#8aa4c7', textAlign: 'center' }}>
          ¿Ya tienes cuenta? <Link href="/login" style={{ color: '#3b82f6' }}>Inicia sesión</Link>
        </p>
      </form>
    </div>
  );
}
