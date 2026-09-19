// =============================================================================
// CHRONIT WEB CLIENT — Registro de piloto (Client Component)
// -----------------------------------------------------------------------------
// Crea la cuenta desde la web (o desde el kiosco en local). Sube la foto en
// base64, envía los datos a /api/register y, al crearse la sesión (Valkey),
// redirige al feed.
// =============================================================================
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NATIONALITIES } from '@/lib/constants';
import ImagePicker from './ImagePicker';

export default function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    nombre: '',
    apellido: '',
    email: '',
    telefono: '',
    carnet: '',
    nacionalidad: '',
    edad: '',
    genero: '',
    password: '',
    password2: '',
  });
  const [foto, setFoto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const up = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (form.password !== form.password2) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre,
          apellido: form.apellido,
          email: form.email,
          telefono: form.telefono,
          carnet: form.carnet,
          nacionalidad: form.nacionalidad,
          edad: form.edad ? Number(form.edad) : null,
          genero: form.genero,
          foto,
          password: form.password,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo crear la cuenta');
      router.push('/feed');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid" style={{ gridTemplateColumns: '1fr', gap: 4 }}>
      {/* Foto */}
      <div style={{ marginBottom: 10 }}>
        <label className="label">Foto de perfil (opcional)</label>
        <ImagePicker
          value={foto}
          onChange={(d) => setFoto(d)}
          aspect={1}
          shape="circle"
          outputSize={512}
          label="Galería"
          disabled={loading}
        />
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Nombre *</label>
          <input className="input" value={form.nombre} onChange={up('nombre')} required />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Apellido</label>
          <input className="input" value={form.apellido} onChange={up('apellido')} />
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Email *</label>
          <input className="input" type="email" value={form.email} onChange={up('email')} required />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Celular</label>
          <input className="input" value={form.telefono} onChange={up('telefono')} />
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Carnet *</label>
          <input className="input" value={form.carnet} onChange={up('carnet')} required />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Edad</label>
          <input className="input" type="number" min={1} max={120} value={form.edad} onChange={up('edad')} />
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Nacionalidad</label>
          <select className="input" value={form.nacionalidad} onChange={up('nacionalidad')}>
            <option value="">—</option>
            {NATIONALITIES.map((n) => (
              <option key={n.code} value={n.code}>
                {n.flag} {n.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Género</label>
          <select className="input" value={form.genero} onChange={up('genero')}>
            <option value="">—</option>
            <option value="masculino">Masculino</option>
            <option value="femenino">Femenino</option>
            <option value="otro">Otro</option>
          </select>
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Contraseña *</label>
          <input className="input" type="password" value={form.password} onChange={up('password')} required />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Repetir contraseña *</label>
          <input className="input" type="password" value={form.password2} onChange={up('password2')} required />
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{error}</p>}

      <button type="submit" className="btn btn-accent btn-lg" disabled={loading} style={{ marginTop: 8 }}>
        {loading ? 'Creando cuenta…' : 'Crear cuenta'}
      </button>
    </form>
  );
}
