'use client';

import { useState } from 'react';
import UserAvatar from './UserAvatar';

interface PilotoResult {
  id: number;
  nombre: string;
  apellido: string;
  carnet: string;
  foto: string | null;
  nacionalidad: string | null;
  flag: string;
}

export default function PilotoBusqueda() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PilotoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error en la búsqueda');
      setResults(data.results || []);
    } catch (err) {
      setError((err as Error).message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={buscar} className="card" style={{ display: 'flex', gap: 10, padding: 16 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre, carnet o teléfono…"
          className="input"
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-accent" disabled={loading || q.trim().length < 2}>
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {error && <p style={{ color: 'var(--red)', marginTop: 14 }}>⚠️ {error}</p>}

      {!loading && results.length === 0 && q.trim().length >= 2 && (
        <p className="muted" style={{ marginTop: 20 }}>Sin resultados para «{q.trim()}».</p>
      )}

      {results.length > 0 && (
        <section className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginTop: 20 }}>
          {results.map((p) => (
            <div key={p.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <UserAvatar
                  foto={p.foto}
                  alt={`${p.nombre} ${p.apellido}`}
                  style={{ width: 46, height: 46, borderRadius: 12, objectFit: 'cover' }}
                />
                <div>
                  <div style={{ fontWeight: 700 }}>{p.nombre} {p.apellido}</div>
                  <div className="muted small">Carnet: {p.carnet || '—'}</div>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
