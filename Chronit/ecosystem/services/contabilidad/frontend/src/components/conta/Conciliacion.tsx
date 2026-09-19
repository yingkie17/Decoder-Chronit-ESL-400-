// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Conciliación QR
// -----------------------------------------------------------------------------
//   GET  /api/conta/conciliacion?desde&hasta&cuenta_id  grilla cuenta x día
//   POST /api/conta/conciliacion                        monto reportado por banco
//
// El "monto del sistema" sale del snapshot de cuenta destino de cada pago, así
// que rotar el responsable de una cuenta NO altera los períodos ya cerrados.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { fecha, fechaHora, haceISO, hoyISO, money, type Cuenta } from './comun';

interface FilaConciliacion {
  cuenta_destino_id: number; fecha: string; cuenta_nombre: string | null; cuenta_tipo: string | null;
  monto_sistema: number; monto_reportado_banco: number | null; diferencia: number | null;
  conciliado: boolean; conciliado_por_nombre: string | null; conciliado_en: string | null;
}

export default function Conciliacion({ puedeConciliar, ok, ko }: {
  puedeConciliar: boolean; ok: (m: string) => void; ko: (e: unknown) => void;
}) {
  const [rango, setRango] = useState({ desde: haceISO(15), hasta: hoyISO() });
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [filas, setFilas] = useState<FilaConciliacion[]>([]);
  const [form, setForm] = useState({
    cuenta_destino_id: '', fecha: hoyISO(), monto_reportado_banco: '', observaciones: '',
  });

  const cargar = useCallback(async () => {
    try {
      const data = await contaApi<{ filas: FilaConciliacion[] }>(
        `/api/conta/conciliacion?desde=${rango.desde}&hasta=${rango.hasta}`);
      setFilas(data.filas);
    } catch (e) { ko(e); }
  }, [rango, ko]);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    (async () => {
      try { setCuentas(await contaApi<Cuenta[]>('/api/conta/cuentas')); } catch { /* opcional */ }
    })();
  }, []);

  const conciliar = async () => {
    if (!form.cuenta_destino_id) { ko(new Error('Selecciona la cuenta destino.')); return; }
    try {
      await contaApi('/api/conta/conciliacion', {
        method: 'POST',
        body: {
          cuenta_destino_id: Number(form.cuenta_destino_id),
          fecha: form.fecha,
          monto_reportado_banco: Number(form.monto_reportado_banco) || 0,
          observaciones: form.observaciones || null,
        },
      });
      ok('Conciliación registrada (auditada).');
      setForm({ ...form, monto_reportado_banco: '', observaciones: '' });
      await cargar();
    } catch (e) { ko(e); }
  };

  const sistemaTotal = filas.reduce((a, f) => a + f.monto_sistema, 0);
  const bancoTotal = filas.reduce((a, f) => a + (f.monto_reportado_banco || 0), 0);

  return (
    <>
      {puedeConciliar && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Registrar monto reportado por el banco</h3>
          <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
            La diferencia se calcula como <b>reportado − sistema</b>. Volver a conciliar la misma
            cuenta y fecha actualiza el registro existente.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="input" style={{ flex: '1 1 200px' }} value={form.cuenta_destino_id}
              onChange={(e) => setForm({ ...form, cuenta_destino_id: e.target.value })}>
              <option value="">Cuenta destino *</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input className="input" type="date" style={{ maxWidth: 160 }} value={form.fecha}
              onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            <input className="input" type="number" step="0.01" placeholder="Monto reportado *"
              style={{ flex: '0 0 180px' }} value={form.monto_reportado_banco}
              onChange={(e) => setForm({ ...form, monto_reportado_banco: e.target.value })} />
            <input className="input" placeholder="Observaciones" style={{ flex: '1 1 200px' }}
              value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} />
            <button className="btn btn-primary" onClick={conciliar}>Conciliar</button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Conciliación por cuenta y día</h3>
          <input className="input" type="date" style={{ maxWidth: 160 }} value={rango.desde}
            onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
          <input className="input" type="date" style={{ maxWidth: 160 }} value={rango.hasta}
            onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
          <button className="btn btn-primary" onClick={() => void cargar()}>Buscar</button>
          <span style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
            Sistema: <b>{money(sistemaTotal)}</b> · Banco: <b>{money(bancoTotal)}</b> · Diferencia:{' '}
            <b>{money(bancoTotal - sistemaTotal)}</b>
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Fecha</th><th>Cuenta</th><th>Tipo</th><th>Sistema</th><th>Banco</th>
                <th>Diferencia</th><th>Estado</th><th>Conciliado por</th><th>Cuándo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={`${f.cuenta_destino_id}-${f.fecha}-${i}`}>
                  <td>{fecha(f.fecha)}</td>
                  <td>{f.cuenta_nombre || '—'}</td>
                  <td>{f.cuenta_tipo || '—'}</td>
                  <td>{money(f.monto_sistema)}</td>
                  <td>{f.monto_reportado_banco == null ? '—' : money(f.monto_reportado_banco)}</td>
                  <td style={{ color: Number(f.diferencia) ? '#f59e0b' : undefined, fontWeight: 700 }}>
                    {f.diferencia == null ? '—' : money(f.diferencia)}
                  </td>
                  <td>
                    {f.conciliado
                      ? <span className="pill" style={{ background: '#22c55e22', color: '#22c55e' }}>Conciliado</span>
                      : <span className="pill" style={{ background: '#f59e0b22', color: '#f59e0b' }}>Pendiente</span>}
                  </td>
                  <td style={{ fontSize: '0.78rem' }}>{f.conciliado_por_nombre || '—'}</td>
                  <td style={{ fontSize: '0.76rem' }}>{f.conciliado_en ? fechaHora(f.conciliado_en) : '—'}</td>
                </tr>
              ))}
              {!filas.length && (
                <tr><td colSpan={9} style={{ color: '#5f7095' }}>Sin movimientos ni conciliaciones en el rango.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
