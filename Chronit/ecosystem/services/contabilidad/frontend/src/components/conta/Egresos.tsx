// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Egresos
// -----------------------------------------------------------------------------
//   GET  /api/conta/egresos?desde&hasta&categoria
//   GET  /api/conta/egresos/categorias
//   POST /api/conta/egresos   (si monto > umbral exige autorización supervisor)
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { fechaHora, haceISO, hoyISO, money } from './comun';

export default function Egresos({ soloLectura, ok, ko }: {
  soloLectura: boolean; ok: (m: string) => void; ko: (e: unknown) => void;
}) {
  const [filtros, setFiltros] = useState({ desde: haceISO(30), hasta: hoyISO(), categoria: '' });
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [form, setForm] = useState({ categoria: 'insumos', monto: '', descripcion: '', comprobante_url: '' });

  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setRows(await contaApi<Record<string, unknown>[]>(`/api/conta/egresos?${qs.toString()}`));
    } catch (e) { ko(e); }
  }, [filtros, ko]);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    (async () => {
      try { setCategorias(await contaApi<string[]>('/api/conta/egresos/categorias')); } catch { /* opcional */ }
    })();
  }, []);

  const registrar = async () => {
    if (!form.monto || Number(form.monto) <= 0) { ko(new Error('El monto debe ser mayor a 0.')); return; }
    try {
      await contaApi('/api/conta/egresos', {
        method: 'POST',
        body: {
          categoria: form.categoria,
          monto: Number(form.monto),
          descripcion: form.descripcion || null,
          comprobante_url: form.comprobante_url || null,
        },
      });
      ok('Egreso registrado.');
      setForm({ categoria: 'insumos', monto: '', descripcion: '', comprobante_url: '' });
      await cargar();
    } catch (e) { ko(e); }
  };

  return (
    <>
      {!soloLectura && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Registrar egreso</h3>
          <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
            Si el monto supera el umbral configurado se exige autorización de un supervisor
            (el egreso queda marcado como «sobre umbral»).
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="input" style={{ flex: '0 0 170px' }} value={form.categoria}
              onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
              {(categorias.length ? categorias : ['insumos', 'otros']).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input className="input" type="number" step="0.01" placeholder="Monto *" style={{ flex: '0 0 150px' }}
              value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
            <input className="input" placeholder="Descripción" style={{ flex: '1 1 240px' }}
              value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
            <input className="input" placeholder="URL del comprobante" style={{ flex: '1 1 200px' }}
              value={form.comprobante_url} onChange={(e) => setForm({ ...form, comprobante_url: e.target.value })} />
            <button className="btn btn-primary" onClick={registrar}>Registrar</button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" type="date" style={{ maxWidth: 160 }} value={filtros.desde}
            onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
          <input className="input" type="date" style={{ maxWidth: 160 }} value={filtros.hasta}
            onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
          <select className="input" style={{ maxWidth: 190 }} value={filtros.categoria}
            onChange={(e) => setFiltros({ ...filtros, categoria: e.target.value })}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => void cargar()}>Buscar</button>
        </div>

        <table className="tbl" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>#</th><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Monto</th>
              <th>Registró</th><th>Autorizó</th><th>Umbral</th><th>Sesión</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={String(e.id)}>
                <td>{String(e.id)}</td>
                <td style={{ fontSize: '0.78rem' }}>{fechaHora(e.creado_en)}</td>
                <td>{String(e.categoria)}</td>
                <td>{String(e.descripcion || '—')}</td>
                <td><b>{money(e.monto)}</b></td>
                <td style={{ fontSize: '0.78rem' }}>{String(e.creado_por_nombre || '—')}</td>
                <td style={{ fontSize: '0.78rem' }}>{String(e.autorizado_por_nombre || '—')}</td>
                <td>
                  {e.requiere_autorizacion
                    ? <span className="pill" style={{ background: '#f59e0b22', color: '#f59e0b' }}>Sobre umbral</span>
                    : '—'}
                </td>
                <td>{String(e.sesion_caja_id || '—')}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} style={{ color: '#5f7095' }}>Sin egresos en el período.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
