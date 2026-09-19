// =============================================================================
// CHRONIT WEB CLIENT — Editor de perfil (Client Component)
// -----------------------------------------------------------------------------
// Permite cambiar la foto de perfil y la portada (subidas a /api/upload) y
// editar todos los datos del piloto (PUT /api/profile).
// =============================================================================
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NATIONALITIES } from '@/lib/constants';
import { useImageUrl } from '@/lib/imageClient';
import ImagePicker from './ImagePicker';

interface Props {
  user: {
    id: number;
    nombre: string;
    apellido: string;
    email: string | null;
    telefono: string | null;
    carnet: string;
    nacionalidad: string | null;
    edad: number | null;
    genero: string | null;
    foto: string | null;
    portada: string | null;
  };
}

export default function ProfileEditor({ user }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    nombre: user.nombre,
    apellido: user.apellido,
    email: user.email || '',
    telefono: user.telefono || '',
    carnet: user.carnet,
    nacionalidad: user.nacionalidad || '',
    edad: user.edad != null ? String(user.edad) : '',
    genero: user.genero || '',
  });
  const [foto, setFoto] = useState<string | null>(user.foto);
  const [portada, setPortada] = useState<string | null>(user.portada);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const fotoResolved = useImageUrl(foto);
  const portadaResolved = useImageUrl(portada);

  const up = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  // Recibe la imagen ya recortada (data URL) desde el selector de imagen.
  const subir = async (dataUrl: string, tipo: 'foto' | 'cover') => {
    if (!dataUrl) return;
    setErr('');
    setMsg('');
    setBusy(true);
    try {
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto: dataUrl, tipo }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo subir');
      if (tipo === 'foto') setFoto(data.foto);
      else setPortada(data.foto);
      setMsg(tipo === 'foto' ? 'Foto actualizada ✔' : 'Portada actualizada ✔');
      router.refresh();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, edad: form.edad ? Number(form.edad) : null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo guardar');
      setMsg('Perfil guardado ✔');
      router.refresh();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card grid" style={{ gridTemplateColumns: '1fr' }}>
      <div className="grid" style={{ gap: 16 }}>
        <div>
          <label className="label">Foto de perfil</label>
          <ImagePicker
            value={fotoResolved}
            onChange={(d) => d && subir(d, 'foto')}
            aspect={1}
            shape="circle"
            outputSize={512}
            label="Galería"
            disabled={busy}
          />
        </div>
        <div>
          <label className="label">Portada</label>
          <ImagePicker
            value={portadaResolved}
            onChange={(d) => d && subir(d, 'cover')}
            aspect={16 / 9}
            shape="rect"
            outputSize={1024}
            label="Galería"
            disabled={busy}
          />
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="label">Nombre</label>
          <input className="input" value={form.nombre} onChange={up('nombre')} />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="label">Apellido</label>
          <input className="input" value={form.apellido} onChange={up('apellido')} />
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="label">Email</label>
          <input className="input" value={form.email} onChange={up('email')} />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="label">Celular</label>
          <input className="input" value={form.telefono} onChange={up('telefono')} />
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="label">Carnet</label>
          <input className="input" value={form.carnet} onChange={up('carnet')} />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="label">Edad</label>
          <input className="input" type="number" min={1} max={120} value={form.edad} onChange={up('edad')} />
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 180 }}>
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
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="label">Género</label>
          <select className="input" value={form.genero} onChange={up('genero')}>
            <option value="">—</option>
            <option value="masculino">Masculino</option>
            <option value="femenino">Femenino</option>
            <option value="otro">Otro</option>
          </select>
        </div>
      </div>

      {err && <p style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{err}</p>}
      {msg && <p style={{ color: 'var(--green)', fontSize: '0.85rem' }}>{msg}</p>}

      <button className="btn btn-primary" onClick={save} disabled={busy} style={{ justifySelf: 'start' }}>
        Guardar cambios
      </button>
    </div>
  );
}
