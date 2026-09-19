// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Notas de crédito (devoluciones)
// -----------------------------------------------------------------------------
//   GET  /api/conta/notas-credito?desde&hasta&estado&venta_id
//   GET  /api/conta/notas-credito/:id                  detalle + ítems
//   POST /api/conta/notas-credito                      emitir (PIN supervisor)
//   POST /api/conta/notas-credito/:id/anular           anular (supervisor+)
//
// La venta original NUNCA se borra: solo se referencia y se acumula el monto
// devuelto. Reembolso: efectivo | cortesia | saldo_favor.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { fecha, fechaHora, haceISO, hoyISO, money } from './comun';

interface NotaCredito {
  id: number; numero: string | null; venta_original_id: number | null; anticipo_id?: number | null;
  motivo: string; tipo: string; reembolso: string; monto: number; moneda: string;
  estado: string; cuf: string | null; siat_estado: string | null; asiento_id: number | null;
  creado_en: string; numero_factura?: string | null; venta_total?: number | null;
  creado_por_nombre?: string | null; autorizado_por_nombre?: string | null;
}

interface NotaItem {
  id: number; venta_item_id: number; cantidad: number; monto: number;
  nombre_snapshot?: string | null; precio_unitario?: number | null; cantidad_vendida?: number | null;
}

interface DetalleNota { nota: NotaCredito; items: NotaItem[] }

interface VentaMini {
  id: number; numero_factura: string | null; total_final: number; monto_notas_credito?: number;
  creado_en: string; anulada: boolean;
}

interface VentaItem {
  id: number; cantidad: number; subtotal: number;
  nombre_snapshot?: string | null; producto_nombre?: string | null; combo_nombre?: string | null;
}

interface VentaDetalle { venta: VentaMini; items: VentaItem[] }

const COLOR_ESTADO: Record<string, string> = { emitida: '#22c55e', anulada: '#ef4444' };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const nombreItem = (i: VentaItem) =>
  i.nombre_snapshot || i.producto_nombre || i.combo_nombre || `Ítem #${i.id}`;

export default function NotasCredito({ ok, soloLectura, puedeGestion, esSupervisor }: {
  ok: (m: string) => void; soloLectura: boolean; puedeGestion: boolean; esSupervisor: boolean;
}) {
  const puedeCrear = !soloLectura && (puedeGestion || esSupervisor);

  const [filtros, setFiltros] = useState({ desde: haceISO(30), hasta: hoyISO(), estado: '' });
  const [rows, setRows] = useState<NotaCredito[]>([]);
  const [error, setError] = useState('');
  const [detalle, setDetalle] = useState<DetalleNota | null>(null);

  const [ventas, setVentas] = useState<VentaMini[]>([]);
  const [ventaSel, setVentaSel] = useState<VentaDetalle | null>(null);
  const [form, setForm] = useState({
    venta_id: '', motivo: '', modo: 'total', reembolso: 'efectivo', monto: '', pin: '',
  });
  const [cantidades, setCantidades] = useState<Record<number, string>>({});

  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setRows(await contaApi<NotaCredito[]>(`/api/conta/notas-credito?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [filtros]);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    (async () => {
      try {
        const vs = await contaApi<VentaMini[]>(`/api/conta/ventas?desde=${haceISO(60)}&hasta=${hoyISO()}`);
        setVentas(vs.filter((v) => !v.anulada));
      } catch { /* el selector de ventas es opcional */ }
    })();
  }, []);

  const elegirVenta = async (id: string) => {
    setForm((f) => ({ ...f, venta_id: id }));
    setCantidades({});
    setVentaSel(null);
    if (!id) return;
    try { setVentaSel(await contaApi<VentaDetalle>(`/api/conta/ventas/${id}`)); }
    catch (e) { setError(errMsg(e)); }
  };

  const verDetalle = async (id: number) => {
    try { setDetalle(await contaApi<DetalleNota>(`/api/conta/notas-credito/${id}`)); }
    catch (e) { setError(errMsg(e)); }
  };

  const disponible = ventaSel
    ? Number(ventaSel.venta.total_final) - Number(ventaSel.venta.monto_notas_credito || 0)
    : 0;

  const crear = async () => {
    setError('');
    if (!form.venta_id) { setError('Selecciona la venta original.'); return; }
    if (!form.motivo.trim()) { setError('El motivo de la devolución es obligatorio.'); return; }

    const body: Record<string, unknown> = {
      venta_original_id: Number(form.venta_id),
      motivo: form.motivo.trim(),
      reembolso: form.reembolso,
    };
    if (!esSupervisor && form.pin) body.pin = form.pin.trim();

    if (form.modo === 'items') {
      const items = Object.entries(cantidades)
        .map(([id, cant]) => ({ venta_item_id: Number(id), cantidad: Number(cant) }))
        .filter((i) => i.cantidad > 0);
      if (!items.length) { setError('Indica al menos una cantidad a devolver.'); return; }
      body.items = items;
    } else if (form.modo === 'monto') {
      const monto = Number(form.monto);
      if (!(monto > 0)) { setError('El monto a devolver debe ser mayor a 0.'); return; }
      body.tipo = 'parcial';
      body.monto = monto;
    } else {
      body.tipo = 'total';
    }

    try {
      await contaApi('/api/conta/notas-credito', { method: 'POST', body });
      ok('Nota de crédito emitida. La venta original se conserva (solo se referencia).');
      setForm({ venta_id: '', motivo: '', modo: 'total', reembolso: 'efectivo', monto: '', pin: '' });
      setCantidades({});
      setVentaSel(null);
      await cargar();
    } catch (e) { setError(errMsg(e)); }
  };

  const anular = async (n: NotaCredito) => {
    const motivo = window.prompt(`Motivo de anulación de la nota ${n.numero || n.id} (obligatorio):`);
    if (!motivo) return;
    try {
      await contaApi(`/api/conta/notas-credito/${n.id}/anular`, { method: 'POST', body: { motivo } });
      ok(`Nota ${n.numero || n.id} anulada.`);
      await cargar();
    } catch (e) { setError(errMsg(e)); }
  };

  return (
    <>
      {error && <p className="card" style={{ color: '#ef4444', padding: 12, marginBottom: 12 }}>{error}</p>}

      {puedeCrear && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Emitir nota de crédito</h3>
          <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
            La venta original <b>no se borra</b>: solo se referencia y se acumula el monto devuelto.
            Se genera el asiento contable automático y, si el reembolso es en efectivo, el
            movimiento de caja de la sesión abierta.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="input" style={{ flex: '1 1 320px' }} value={form.venta_id}
              onChange={(e) => void elegirVenta(e.target.value)}>
              <option value="">Venta original (últimos 60 días) *</option>
              {ventas.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.numero_factura || `Venta #${v.id}`} · {money(v.total_final)} · {fecha(v.creado_en)}
                </option>
              ))}
            </select>
            <select className="input" style={{ flex: '0 0 170px' }} value={form.modo}
              onChange={(e) => setForm({ ...form, modo: e.target.value })}>
              <option value="total">Devolución total</option>
              <option value="items">Parcial por ítems</option>
              <option value="monto">Parcial por monto</option>
            </select>
            <select className="input" style={{ flex: '0 0 160px' }} value={form.reembolso}
              onChange={(e) => setForm({ ...form, reembolso: e.target.value })}>
              <option value="efectivo">Reembolso: efectivo</option>
              <option value="cortesia">Reembolso: cortesía</option>
              <option value="saldo_favor">Reembolso: saldo a favor</option>
            </select>
            {form.modo === 'monto' && (
              <input className="input" type="number" step="0.01" placeholder="Monto a devolver *"
                style={{ flex: '0 0 170px' }} value={form.monto}
                onChange={(e) => setForm({ ...form, monto: e.target.value })} />
            )}
            {!esSupervisor && (
              <input className="input" type="password" placeholder="PIN supervisor *" style={{ flex: '0 0 170px' }}
                value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} />
            )}
            <input className="input" placeholder="Motivo de la devolución *" style={{ flex: '1 1 260px' }}
              value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} />
            <button className="btn btn-primary" onClick={() => void crear()}>Emitir nota</button>
          </div>

          {ventaSel && (
            <div style={{ marginTop: 12 }}>
              <p style={{ color: '#8aa4c7', fontSize: '0.82rem', margin: '0 0 6px' }}>
                Venta <b>{ventaSel.venta.numero_factura || `#${ventaSel.venta.id}`}</b> · total{' '}
                <b>{money(ventaSel.venta.total_final)}</b> · ya devuelto{' '}
                <b>{money(ventaSel.venta.monto_notas_credito || 0)}</b> · disponible{' '}
                <b>{money(disponible)}</b>
              </p>
              {form.modo === 'items' && (
                <table className="tbl">
                  <thead>
                    <tr><th>Ítem</th><th>Cant. vendida</th><th>Subtotal</th><th>Devolver</th></tr>
                  </thead>
                  <tbody>
                    {ventaSel.items.map((i) => (
                      <tr key={i.id}>
                        <td>{nombreItem(i)}</td>
                        <td>{i.cantidad}</td>
                        <td>{money(i.subtotal)}</td>
                        <td>
                          <input className="input" type="number" min={0} max={i.cantidad} step="1"
                            style={{ maxWidth: 110 }} placeholder="0"
                            value={cantidades[i.id] || ''}
                            onChange={(e) => setCantidades({ ...cantidades, [i.id]: e.target.value })} />
                        </td>
                      </tr>
                    ))}
                    {!ventaSel.items.length && (
                      <tr><td colSpan={4} style={{ color: '#5f7095' }}>La venta no tiene ítems.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" type="date" style={{ maxWidth: 160 }} value={filtros.desde}
            onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
          <input className="input" type="date" style={{ maxWidth: 160 }} value={filtros.hasta}
            onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
          <select className="input" style={{ maxWidth: 170 }} value={filtros.estado}
            onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
            <option value="">Todos los estados</option>
            <option value="emitida">Emitidas</option>
            <option value="anulada">Anuladas</option>
          </select>
          <button className="btn btn-primary" onClick={() => void cargar()}>Buscar</button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>N°</th><th>Fecha</th><th>Venta original</th><th>Motivo</th><th>Tipo</th>
                <th>Reembolso</th><th>Monto</th><th>Estado</th><th>CUF</th><th>SIAT</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td>{n.numero || `#${n.id}`}</td>
                  <td style={{ fontSize: '0.78rem' }}>{fechaHora(n.creado_en)}</td>
                  <td>{n.numero_factura || (n.venta_original_id ? `Venta #${n.venta_original_id}` : '—')}</td>
                  <td style={{ fontSize: '0.8rem' }}>{n.motivo}</td>
                  <td>{n.tipo}</td>
                  <td>{n.reembolso}</td>
                  <td><b>{money(n.monto)}</b></td>
                  <td>
                    <span className="pill" style={{
                      background: `${COLOR_ESTADO[n.estado] || '#8aa4c7'}22`,
                      color: COLOR_ESTADO[n.estado] || '#8aa4c7',
                    }}>{n.estado}</span>
                  </td>
                  <td style={{ fontSize: '0.72rem', maxWidth: 140, wordBreak: 'break-all' }}>{n.cuf || '—'}</td>
                  <td style={{ fontSize: '0.76rem' }}>{n.siat_estado || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => void verDetalle(n.id)}>Ver</button>
                      {esSupervisor && !soloLectura && n.estado !== 'anulada' && (
                        <button className="btn btn-sm btn-danger" onClick={() => void anular(n)}>Anular</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={11} style={{ color: '#5f7095' }}>Sin notas de crédito en el período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detalle && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 760, maxHeight: '84vh', overflow: 'auto' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ marginTop: 0 }}>
                Nota {detalle.nota.numero || `#${detalle.nota.id}`} — {money(detalle.nota.monto)}
              </h3>
              <button className="btn btn-sm" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              Venta {detalle.nota.numero_factura || detalle.nota.venta_original_id || '—'} · tipo{' '}
              {detalle.nota.tipo} · reembolso {detalle.nota.reembolso} · estado {detalle.nota.estado}
              {detalle.nota.cuf && <> · CUF {detalle.nota.cuf}</>}
            </p>
            <p style={{ fontSize: '0.84rem' }}><b>Motivo:</b> {detalle.nota.motivo}</p>
            <table className="tbl">
              <thead><tr><th>Ítem</th><th>Cant. devuelta</th><th>Monto</th></tr></thead>
              <tbody>
                {detalle.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.nombre_snapshot || `Ítem #${i.venta_item_id}`}</td>
                    <td>{i.cantidad}</td>
                    <td>{money(i.monto)}</td>
                  </tr>
                ))}
                {!detalle.items.length && (
                  <tr><td colSpan={3} style={{ color: '#5f7095' }}>Devolución total (sin ítems detallados).</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
