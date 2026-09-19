// =============================================================================
// CHRONIT WEB CLIENT — Compositor de publicaciones (Client Component)
// -----------------------------------------------------------------------------
// Crea una publicación en el feed (noticia / evento / foto / resultado). Solo
// lo usa personal autorizado para publicar novedades oficiales. Sube una imagen
// opcional en base64 y al crear la publica en la parte superior del feed.
// =============================================================================
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const TIPOS = [
  { value: 'noticia', label: '📰 Noticia' },
  { value: 'evento', label: '🏁 Evento' },
  { value: 'foto', label: '📷 Foto' },
  { value: 'resultado', label: '🏆 Resultado' },
];

export default function FeedComposer() {
  const router = useRouter();
  const [tipo, setTipo] = useState('noticia');
  const [titulo, setTitulo] = useState('');
  const [contenido, setContenido] = useState('');
  const [imagen, setImagen] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Solo se permiten imágenes.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      setImagen(data);
      setPreview(data);
    };
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim() && !contenido.trim()) {
      setError('Escribe al menos un título o un contenido.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, titulo, contenido, imagen }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No se pudo publicar');
      setTitulo(''); setContenido(''); setImagen(null); setPreview(null); setOpen(false);
      router.refresh();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="post-card fade-in">
      {!open ? (
        <button className="composer" style={{ background: 'transparent', border: 'none', width: '100%', color: 'var(--muted)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => setOpen(true)}>
          <span className="avatar avatar-sm">👤</span>
          <span style={{ flex: 1, padding: '8px 12px', background: 'var(--bg)', borderRadius: 12 }}>
            ¿Qué quieres compartir?
          </span>
        </button>
      ) : (
        <form onSubmit={submit}>
          <div className="composer">
            <span className="avatar avatar-sm">👤</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                {TIPOS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTipo(t.value)}
                    className={`btn btn-sm ${tipo === t.value ? 'btn-primary' : ''}`}
                    style={{ fontSize: '0.72rem' }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                className="input"
                style={{ marginBottom: 8 }}
                placeholder="Título"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
              />
              <textarea
                placeholder="Escribe la publicación…"
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
              />
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 12, marginTop: 8 }} />
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                  📷 Imagen
                  <input type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
                </label>
                {imagen && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setImagen(null); setPreview(null); }}>
                    🗑 Quitar
                  </button>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-sm" onClick={() => { setOpen(false); setError(''); }}>Cancelar</button>
                  <button type="submit" className="btn btn-sm btn-accent" disabled={busy}>
                    {busy ? 'Publicando…' : 'Publicar'}
                  </button>
                </div>
              </div>
              {error && <p style={{ color: 'var(--red)', fontSize: '0.8rem', marginTop: 8 }}>{error}</p>}
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
