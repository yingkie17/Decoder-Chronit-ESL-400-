'use client';

import { useState } from 'react';
import { api, setSession } from '@/lib/api';
import { NATIONALITIES } from '@/lib/constants';
import Link from 'next/link';

export default function SetupAdminPage() {
  const [form, setForm] = useState({
    nombre: '', apellido: '', carnet: '', nacionalidad: '', password: '', rol: 'admin',
  });
  const [msg, setMsg] = useState('');
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Primer acceso: crear el primer admin (o taquilla/vestidor) del sistema.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      const data = await api<{ token?: string; user: unknown }>('/api/auth/bootstrap-admin', {
        method: 'POST',
        body: { ...form },
      });
      setSession(data.token ?? null, data.user);
      window.location.href = '/dashboard';
    } catch (err) {
      const errObj = err as Error & { status?: number };
      setMsg(errObj.status === 409
        ? 'El sistema ya tiene un administrador. Ve a /login e inicia sesión.'
        : errObj.message);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form className="card" style={{ width: 480 }} onSubmit={submit}>
        <h1 style={{ marginBottom: 8 }}>Primer acceso</h1>
        <p style={{ color: '#8aa4c7', fontSize: '0.85rem', marginBottom: 16 }}>
          Esta opción crea el primer usuario de administración del ecosistema.
          Solo está disponible si todavía no existe ninguno.
        </p>
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
            <input className="input" value={form.carnet} onChange={(e) => set('carnet', e.target.value)} placeholder="Ej: ADM-001" required />
          </div>
          <div>
            <label className="label">Rol inicial</label>
            <select className="input" value={form.rol} onChange={(e) => set('rol', e.target.value)}>
              <option value="admin">Admin</option>
              <option value="cajero">Cajero</option>
              <option value="coordinador">Coordinador</option>
              <option value="desarrollador">Desarrollador</option>
            </select>
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
            <label className="label">Contraseña *</label>
            <input className="input" type="password" value={form.password}
              onChange={(e) => set('password', e.target.value)} required />
          </div>
        </div>
        {msg && <p style={{ color: '#f87171', marginTop: 12, fontSize: '0.85rem' }}>{msg}</p>}
        <button className="btn btn-success" type="submit"
          style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>Crear usuario de administración</button>
        <p style={{ marginTop: 14, fontSize: '0.85rem', color: '#8aa4c7', textAlign: 'center' }}>
          ¿Ya tienes cuenta? <Link href="/login" style={{ color: '#3b82f6' }}>Inicia sesión</Link>
        </p>
      </form>
    </div>
  );
}
