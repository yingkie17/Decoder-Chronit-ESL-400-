// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Propinas
// -----------------------------------------------------------------------------
//   GET  /api/conta/propinas?desde&hasta&estado
//   GET  /api/conta/propinas/:id              detalle + distribución
//   POST /api/conta/propinas                  registrar manual (cajero+)
//   POST /api/conta/propinas/:id/distribuir   recalcular (supervisor+)
//   POST /api/conta/propinas/:id/pagar        marcar pagada (supervisor+)
//   POST /api/conta/propinas/:id/anular       anular (SOLO supervisor)
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { fechaHora, haceISO, hoyISO, money } from './comun';

interface Propina {
  id: number; venta_id: number | null; sesion_caja_id: number | null; monto: number;
  metodo: string; modo: string; estado: string; numero_factura?: string | null;
  creado_por_nombre?: string | null; creado_en: string; motivo_anulacion?: string | null;
}

interface Distribucion {
  id: number; usuario_id: number; beneficiario_nombre?: string | null;
  beneficiario_carnet?: string | null; rol: string | null; monto: number;
  estado: string; pagado_en: string | null; pagado_por_nombre?: string | null;
}

interface DetallePropina { propina: Propina; distribucion: Distribucion[] }

const COLOR_ESTADO: Record<string, string> = {
  pendiente: '#f59e0b', distribuida: '#3b82f6', pagada: '#22c55e', anulada: '#ef4444',
};

export default function Propinas({ esSupervisor, soloLectura, ok, ko }: {
  esSupervisor: boolean; soloLectura: boolean; ok: (m: string) => void; ko: (e: unknown) => void;
}) {
  const [filtros, setFiltros] = useState({ desde: haceISO(30), hasta: hoyISO(), estado: '' });
  const [rows, setRows] = useState<Propina[]>([]);
  const [detalle, setDetalle] = useState<DetallePropina | null>(null);
  const [nueva, setNueva] = useState({ monto: '', metodo: 'efectivo', modo: 'acumulada' });

  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setRows(await contaApi<Propina[]>(`/api/conta/propinas?${qs.toString()}`));
    } catch (e) { ko(e); }
  }, [filtros, ko]);

  useEffect(() => { void cargar(); }, [cargar]);

  const verDetalle = async (id: number) => {
    try { setDetalle(await contaApi<DetallePropina>(`/api/conta/propinas/${id}`)); } catch (e) { ko(e); }
  };

  const registrar = async () => {
    if (!nueva.monto || Number(nueva.monto) <= 0) { ko(new Error('El monto debe ser mayor a 0.')); return; }
    try {
      await contaApi('/api/conta/propinas', {
        method: 'POST',
        body: { monto: Number(nueva.monto), metodo: nueva.metodo, modo: nueva.modo },
      });
      ok('Propina registrada.');
      setNueva({ monto: '', metodo: 'efectivo', modo: 'acumulada' });
      await cargar();
    } catch (e) { ko(e); }
  };

  const accion = async (id: number, verbo: 'distribuir' | 'pagar') => {
    try {
      await contaApi(`/api/conta/propinas/${id}/${verbo}`, { method: 'POST' });
      ok(`Propina #${id}: ${verbo === 'pagar' ? 'pagada' : 'distribución recalculada'}.`);
      await cargar();
    } catch (e) { ko(e); }
  };

  const anular = async (p: Propina) => {
    const motivo = window.prompt(`Motivo de anulación de la propina #${p.id} (obligatorio):`);
    if (!motivo) return;
    try {
      await contaApi(`/api/conta/propinas/${p.id}/anular`, { method: 'POST', body: { motivo } });
      ok(`Propina #${p.id} anulada (solo supervisor puede anular).`);
      await cargar();
    } catch (e) { ko(e); }
  };

  const pendienteTotal = rows.filter((p) => p.estado !== 'pagada' && p.estado !== 'anulada')
    .reduce((a, p) => a + p.monto, 0);

  return (
    <>
      {!soloLectura && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Registrar propina</h3>
          <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
            Según <b>propina_modo</b>: <b>inmediata</b> se paga en el acto, <b>acumulada</b> queda
            pendiente hasta que un supervisor autorice el pago, <b>mixta</b> permite elegir por venta.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" type="number" step="0.01" placeholder="Monto *" style={{ flex: '0 0 150px' }}
              value={nueva.monto} onChange={(e) => setNueva({ ...nueva, monto: e.target.value })} />
            <select className="input" style={{ flex: '0 0 150px' }} value={nueva.metodo}
              onChange={(e) => setNueva({ ...nueva, metodo: e.target.value })}>
              <option value="efectivo">efectivo</option>
              <option value="qr">qr</option>
              <option value="transferencia">transferencia</option>
            </select>
            <select className="input" style={{ flex: '0 0 160px' }} value={nueva.modo}
              onChange={(e) => setNueva({ ...nueva, modo: e.target.value })}>
              <option value="acumulada">acumulada</option>
              <option value="inmediata">inmediata</option>
            </select>
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
          <select className="input" style={{ maxWidth: 160 }} value={filtros.estado}
            onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendientes</option>
            <option value="distribuida">Distribuidas</option>
            <option value="pagada">Pagadas</option>
            <option value="anulada">Anuladas</option>
          </select>
          <button className="btn btn-primary" onClick={() => void cargar()}>Buscar</button>
          <span style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
            Pendiente de pago en el período: <b>{money(pendienteTotal)}</b>
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>#</th><th>Fecha</th><th>Monto</th><th>Método</th><th>Modo</th>
                <th>Estado</th><th>Venta</th><th>Caja</th><th>Registró</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td style={{ fontSize: '0.78rem' }}>{fechaHora(p.creado_en)}</td>
                  <td><b>{money(p.monto)}</b></td>
                  <td>{p.metodo}</td>
                  <td>{p.modo}</td>
                  <td>
                    <span className="pill" style={{
                      background: `${COLOR_ESTADO[p.estado] || '#8aa4c7'}22`,
                      color: COLOR_ESTADO[p.estado] || '#8aa4c7',
                    }}>{p.estado}</span>
                  </td>
                  <td>{p.numero_factura || p.venta_id || '—'}</td>
                  <td>{p.sesion_caja_id || '—'}</td>
                  <td style={{ fontSize: '0.78rem' }}>{p.creado_por_nombre || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => void verDetalle(p.id)}>Ver</button>
                      {esSupervisor && !soloLectura && p.estado !== 'anulada' && (
                        <>
                          <button className="btn btn-sm" onClick={() => void accion(p.id, 'distribuir')}>Distribuir</button>
                          {p.estado !== 'pagada' && (
                            <button className="btn btn-sm btn-success" onClick={() => void accion(p.id, 'pagar')}>Pagar</button>
                          )}
                          <button className="btn btn-sm btn-danger" onClick={() => void anular(p)}>Anular</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10} style={{ color: '#5f7095' }}>Sin propinas en el período.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {detalle && <DetallePropinaModal data={detalle} onClose={() => setDetalle(null)} />}
    </>
  );
}

function DetallePropinaModal({ data, onClose }: { data: DetallePropina; onClose: () => void }) {
  const p = data.propina;
  const total = data.distribucion.reduce((a, d) => a + d.monto, 0);
  return (
    <div className="modal-overlay">
      <div className="card modal" style={{ maxWidth: 720, maxHeight: '84vh', overflow: 'auto' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginTop: 0 }}>Propina #{p.id} — {money(p.monto)}</h3>
          <button className="btn btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
          {fechaHora(p.creado_en)} · método {p.metodo} · modo {p.modo} · estado {p.estado}
          {p.motivo_anulacion && <> · <span style={{ color: '#ef4444' }}>Anulada: {p.motivo_anulacion}</span></>}
        </p>

        <h4>Distribución por beneficiario</h4>
        <table className="tbl">
          <thead>
            <tr><th>Beneficiario</th><th>Carnet</th><th>Rol</th><th>Monto</th><th>Estado</th><th>Pagado</th><th>Por</th></tr>
          </thead>
          <tbody>
            {data.distribucion.map((d) => (
              <tr key={d.id}>
                <td>{d.beneficiario_nombre || `Usuario #${d.usuario_id}`}</td>
                <td>{d.beneficiario_carnet || '—'}</td>
                <td>{d.rol || '—'}</td>
                <td>{money(d.monto)}</td>
                <td>
                  <span className="pill" style={{
                    background: `${COLOR_ESTADO[d.estado] || '#8aa4c7'}22`,
                    color: COLOR_ESTADO[d.estado] || '#8aa4c7',
                  }}>{d.estado}</span>
                </td>
                <td style={{ fontSize: '0.76rem' }}>{d.pagado_en ? fechaHora(d.pagado_en) : '—'}</td>
                <td style={{ fontSize: '0.76rem' }}>{d.pagado_por_nombre || '—'}</td>
              </tr>
            ))}
            {!data.distribucion.length && (
              <tr><td colSpan={7} style={{ color: '#5f7095' }}>Sin distribución calculada.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}><b>TOTAL</b></td><td><b>{money(total)}</b></td><td colSpan={3} /></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
