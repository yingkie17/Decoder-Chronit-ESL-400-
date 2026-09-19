'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Kart {
  id: number;
  numero: number;
  transponder: string | null;
  transponder_descripcion: string | null;
  estado: string;
  ticket_asignado: number | null;
  piloto_nombre: string | null;
  piloto_apellido: string | null;
}
interface Transponder {
  id: number;
  description: string | null;
  kart_id: string | null;
  kart_status: string | null;
  estado: string;
}

type EstadoBadge = { borderColor: string; color: string; label: string };

function estadoTransponderBadge(estado: string): EstadoBadge {
  if (estado === 'en_pista') return { borderColor: '#d97706', color: '#d97706', label: 'En pista' };
  if (estado === 'mantenimiento') return { borderColor: '#7c3aed', color: '#7c3aed', label: 'Mantenimiento' };
  if (estado === 'montado') return { borderColor: '#3b82f6', color: '#3b82f6', label: 'Montado' };
  return { borderColor: '#16a34a', color: '#16a34a', label: 'Disponible' };
}

export default function KartsTranspondersManager() {
  const [msg, setMsg] = useState('');
  const [karts, setKarts] = useState<Kart[]>([]);
  const [transponders, setTransponders] = useState<Transponder[]>([]);
  const [kartNombre, setKartNombre] = useState('');
  const [kartTp, setKartTp] = useState('');
  const [montarTp, setMontarTp] = useState('');
  const [montarKart, setMontarKart] = useState('');
  const [tpError, setTpError] = useState('');

  const refreshAll = useCallback(async () => {
    try { setKarts(await api<Kart[]>('/api/karts')); } catch { setKarts([]); }
    try {
      setTransponders(await api<Transponder[]>('/api/karts/transponders'));
      setTpError('');
    } catch (err) { setTransponders([]); setTpError((err as Error).message); }
  }, []);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  const crearKart = async () => {
    setMsg('');
    if (!kartNombre) return setMsg('Ingresa el número del kart.');
    try {
      await api('/api/karts', { method: 'POST', body: { numero: Number(kartNombre), transponder: kartTp || null } });
      setMsg(`Kart #${kartNombre} creado`);
      setKartNombre(''); setKartTp('');
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const montarTransponder = async () => {
    setMsg('');
    if (!montarTp || !montarKart) return setMsg('Selecciona un transponder y un kart.');
    try {
      await api(`/api/karts/${montarKart}/vincular-transponder`, { method: 'POST', body: { transponder_id: Number(montarTp) } });
      setMsg(`Transponder #${montarTp} montado en el kart #${montarKart}`);
      setMontarTp(''); setMontarKart('');
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const desmontarTransponder = async (kartNumero: string) => {
    setMsg('');
    try {
      await api(`/api/karts/${kartNumero}/desvincular-transponder`, { method: 'POST', body: {} });
      setMsg(`Transponder desmontado del kart #${kartNumero}`);
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  return (
    <section className="card" style={{ marginTop: 22, marginBottom: 20 }}>
      <h2>Karts / Transponders</h2>
      <p style={{ color: '#5f7095', fontSize: '0.85rem', margin: '4px 0 8px' }}>
        Lista sincronizada con control de carrera: los karts y transponders que ves aquí son los que están en el módulo de carrera.
      </p>
      {msg && <p style={{ marginBottom: 10 }}>{msg}</p>}

      {/* Crear kart */}
      <div className="row" style={{ alignItems: 'end', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <div>
          <label className="label">Nº Kart</label>
          <input className="input" type="number" placeholder="1" value={kartNombre} onChange={(e) => setKartNombre(e.target.value)} />
        </div>
        <div>
          <label className="label">Transponder</label>
          <input className="input" placeholder="TP-101" value={kartTp} onChange={(e) => setKartTp(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={crearKart}>Crear kart</button>
      </div>

      {/* Montar transponder en kart */}
      <div className="row" style={{ alignItems: 'end', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <div>
          <label className="label">Transponder libre</label>
          <select className="input" value={montarTp} onChange={(e) => setMontarTp(e.target.value)}>
            <option value="">— Sin transponder —</option>
            {transponders.filter((t) => t.estado === 'disponible').map((t) => (
              <option key={t.id} value={t.id}>#{t.id}{t.description ? ` · ${t.description}` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Kart destino</label>
          <select className="input" value={montarKart} onChange={(e) => setMontarKart(e.target.value)}>
            <option value="">— Elegir kart —</option>
            {karts.filter((k) => !k.transponder).map((k) => (
              <option key={k.id} value={k.numero}>#{k.numero}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={montarTransponder} disabled={!montarTp || !montarKart}>Montar en kart</button>
      </div>

      {/* Tabla de karts */}
      <div style={{ marginTop: 14, overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr><th>Kart</th><th>Transponder</th><th>Estado</th><th>Piloto</th></tr>
          </thead>
          <tbody>
            {karts.map((k) => (
              <tr key={k.id}>
                <td><b>#{k.numero}</b></td>
                <td>{k.transponder ? `${k.transponder}${k.transponder_descripcion ? ` · ${k.transponder_descripcion}` : ''}` : '—'}</td>
                <td>
                  <span className="badge" style={{ borderColor: k.estado === 'asignado' ? '#3b82f6' : '#16a34a', color: k.estado === 'asignado' ? '#3b82f6' : '#16a34a' }}>
                    {k.estado === 'asignado' ? 'Asignado' : 'Disponible'}
                  </span>
                </td>
                <td>{k.piloto_nombre ? `${k.piloto_nombre} ${k.piloto_apellido || ''}` : '—'}</td>
              </tr>
            ))}
            {!karts.length && <tr><td colSpan={4} style={{ color: '#5f7095' }}>No hay karts registrados. Crea uno arriba.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Tabla de transponders */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 8px' }}>
        <h3 style={{ margin: 0 }}>Transponders</h3>
        <button className="btn btn-sm" onClick={() => refreshAll()}>Actualizar</button>
      </div>
      {tpError && (
        <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: 8 }}>
          No se pudo cargar la lista desde control de carrera: {tpError}
        </p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr><th>ID</th><th>Descripción</th><th>Kart</th><th>Estado</th><th>Acción</th></tr>
          </thead>
          <tbody>
            {transponders.map((t) => {
              const badge = estadoTransponderBadge(t.estado);
              return (
                <tr key={t.id}>
                  <td><b>{t.id}</b></td>
                  <td>{t.description || '—'}</td>
                  <td>{t.kart_id ? `#${t.kart_id}` : '—'}</td>
                  <td>
                    <span className="badge" style={{ borderColor: badge.borderColor, color: badge.color }}>{badge.label}</span>
                  </td>
                  <td>{t.kart_id ? (
                    <button className="btn btn-sm" onClick={() => desmontarTransponder(t.kart_id!)}>Desmontar</button>
                  ) : (
                    <span style={{ color: '#5f7095', fontSize: '0.8rem' }}>—</span>
                  )}</td>
                </tr>
              );
            })}
            {!transponders.length && <tr><td colSpan={5} style={{ color: '#5f7095' }}>No hay transponders registrados en control de carrera.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
