// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Ventas
// -----------------------------------------------------------------------------
//   GET  /api/conta/ventas?desde&hasta&q&estado   (snapshots, nunca recalcula)
//   GET  /api/conta/ventas/:id                    detalle + ítems + pagos + tickets
//   POST /api/conta/ventas/:id/anular             (supervisor+; la venta NO se borra)
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi, urlImprimirTicket } from '@/lib/api';
import { fecha, fechaHora, haceISO, hora, hoyISO, money, type Venta } from './comun';

interface DetalleVentaData {
  venta: Venta;
  items: Record<string, unknown>[];
  pagos: Record<string, unknown>[];
  propinas: Record<string, unknown>[];
  tickets: Record<string, unknown>[];
}

export default function Ventas({ esSupervisor, soloLectura, ok, ko }: {
  esSupervisor: boolean; soloLectura: boolean; ok: (m: string) => void; ko: (e: unknown) => void;
}) {
  const [filtros, setFiltros] = useState({ desde: haceISO(30), hasta: hoyISO(), q: '', estado: '' });
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [detalle, setDetalle] = useState<DetalleVentaData | null>(null);

  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setVentas(await contaApi<Venta[]>(`/api/conta/ventas?${qs.toString()}`));
    } catch (e) { ko(e); }
  }, [filtros, ko]);

  useEffect(() => { void cargar(); }, [cargar]);

  const verDetalle = async (id: number) => {
    try { setDetalle(await contaApi<DetalleVentaData>(`/api/conta/ventas/${id}`)); } catch (e) { ko(e); }
  };

  const anular = async (v: Venta) => {
    const motivo = window.prompt(`Motivo de anulación de la venta #${v.id} (obligatorio):`);
    if (!motivo) return;
    try {
      await contaApi(`/api/conta/ventas/${v.id}/anular`, { method: 'POST', body: { motivo } });
      ok(`Venta #${v.id} anulada. La venta no se elimina: queda registrada y auditada.`);
      await cargar();
    } catch (e) { ko(e); }
  };

  return (
    <section className="card">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" type="date" style={{ maxWidth: 160 }} value={filtros.desde}
          onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
        <input className="input" type="date" style={{ maxWidth: 160 }} value={filtros.hasta}
          onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
        <select className="input" style={{ maxWidth: 150 }} value={filtros.estado}
          onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
          <option value="">Todas</option>
          <option value="pagada">Vigentes</option>
          <option value="anulada">Anuladas</option>
        </select>
        <input className="input" placeholder="Buscar NIT / razón social / n° de factura" style={{ flex: '1 1 240px' }}
          value={filtros.q} onChange={(e) => setFiltros({ ...filtros, q: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') void cargar(); }} />
        <button className="btn btn-primary" onClick={() => void cargar()}>Buscar</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>#</th><th>Factura</th><th>Fecha / hora</th><th>Cajero</th><th>NIT</th>
              <th>Subtotal</th><th>Desc.</th><th>Base</th><th>IVA</th><th>Propina</th><th>Total</th>
              <th>Tickets</th><th>Estado</th><th></th>
            </tr>
          </thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id} style={v.anulada ? { opacity: 0.55 } : undefined}>
                <td>{v.id}</td>
                <td>
                  {v.numero_factura || '—'}
                  <div style={{ color: '#5f7095', fontSize: '0.72rem' }}>{v.tipo_factura || ''}</div>
                </td>
                <td style={{ fontSize: '0.78rem' }}>
                  {fecha(v.creado_en)}
                  <div style={{ color: '#8aa4c7' }}>{hora(v.creado_en)}</div>
                </td>
                <td style={{ fontSize: '0.78rem' }}>{v.cajero_nombre_snapshot || '—'}</td>
                <td style={{ fontSize: '0.78rem' }}>
                  {v.nit_cliente || '—'}
                  {v.razon_social_cliente ? <div style={{ color: '#8aa4c7' }}>{v.razon_social_cliente}</div> : null}
                </td>
                <td>{money(v.subtotal)}</td>
                <td>{money(v.descuento)}</td>
                <td>{money(v.base_imponible)}</td>
                <td>{money(v.iva_total)}</td>
                <td>{money(v.propina)}</td>
                <td><b>{money(v.total_final)}</b></td>
                <td>{v.tickets}</td>
                <td>
                  {v.anulada
                    ? <span className="pill" style={{ background: '#ef444422', color: '#ef4444' }}>Anulada</span>
                    : <span className="pill" style={{ background: '#22c55e22', color: '#22c55e' }}>Vigente</span>}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-sm" onClick={() => void verDetalle(v.id)}>Detalle</button>
                    {esSupervisor && !soloLectura && !v.anulada && (
                      <button className="btn btn-sm btn-danger" onClick={() => void anular(v)}>Anular</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!ventas.length && <tr><td colSpan={14} style={{ color: '#5f7095' }}>Sin ventas en el período.</td></tr>}
          </tbody>
        </table>
      </div>

      {detalle && <DetalleVenta data={detalle} onClose={() => setDetalle(null)} />}
    </section>
  );
}

function DetalleVenta({ data, onClose }: { data: DetalleVentaData; onClose: () => void }) {
  const { venta } = data;
  return (
    <div className="modal-overlay">
      <div className="card modal" style={{ maxWidth: 920, maxHeight: '86vh', overflow: 'auto' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginTop: 0 }}>
            Venta #{venta.id} — {venta.numero_factura || 'sin factura'}
          </h3>
          <button className="btn btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
          {fechaHora(venta.creado_en)} · Cajero: {venta.cajero_nombre_snapshot || '—'}
          {venta.nit_cliente && <> · NIT: <b>{venta.nit_cliente}</b> {venta.razon_social_cliente || ''}</>}
          {venta.anulada && <> · <span style={{ color: '#ef4444' }}>ANULADA: {venta.motivo_anulacion}</span></>}
        </p>

        <h4>Ítems — IVA snapshot de cada línea</h4>
        <table className="tbl">
          <thead>
            <tr>
              <th>Ítem</th><th>Cant.</th><th>P. unit.</th><th>Desc.</th><th>Subtotal</th>
              <th>Modo IVA</th><th>%</th><th>IVA línea</th><th>Base</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={String(i.id)} style={i.es_componente_combo ? { opacity: 0.75 } : undefined}>
                <td>
                  {String(i.nombre_snapshot || i.producto_nombre || i.combo_nombre || 'Ítem')}
                  {i.es_componente_combo ? ' ↳' : ''}
                </td>
                <td>{String(i.cantidad)}</td>
                <td>{money(i.precio_unitario)}</td>
                <td>{money(i.descuento)}</td>
                <td>{money(i.subtotal)}</td>
                <td>{String(i.iva_modo_aplicado)}</td>
                <td>{String(i.iva_porcentaje_aplicado)}%</td>
                <td>{money(i.iva_linea)}</td>
                <td>{money(i.base_imponible_linea)}</td>
              </tr>
            ))}
            {!data.items.length && <tr><td colSpan={9} style={{ color: '#5f7095' }}>Sin ítems.</td></tr>}
          </tbody>
        </table>

        <h4>Pagos</h4>
        <table className="tbl">
          <thead>
            <tr><th>Método</th><th>Cuenta destino</th><th>Responsable (snapshot)</th><th>Referencia</th><th>Monto</th><th>Confirmación</th></tr>
          </thead>
          <tbody>
            {data.pagos.map((p) => (
              <tr key={String(p.id)}>
                <td>{String(p.metodo_nombre)}</td>
                <td>{String(p.cuenta_nombre || '—')}</td>
                <td>{String(p.responsable_nombre || '—')}</td>
                <td>{String(p.referencia_qr || '—')}</td>
                <td>{money(p.monto)}</td>
                <td>{String(p.estado_confirmacion || '—')}</td>
              </tr>
            ))}
            {!data.pagos.length && <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin pagos.</td></tr>}
          </tbody>
        </table>

        <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <h4>Propinas</h4>
            <table className="tbl">
              <thead><tr><th>Monto</th><th>Modo</th><th>Estado</th></tr></thead>
              <tbody>
                {data.propinas.map((p) => (
                  <tr key={String(p.id)}>
                    <td>{money(p.monto)}</td><td>{String(p.modo)}</td><td>{String(p.estado)}</td>
                  </tr>
                ))}
                {!data.propinas.length && <tr><td colSpan={3} style={{ color: '#5f7095' }}>Sin propinas.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <h4>Tickets</h4>
            <table className="tbl">
              <thead><tr><th>N°</th><th>Estado</th><th>Hora venta</th><th></th></tr></thead>
              <tbody>
                {data.tickets.map((t) => (
                  <tr key={String(t.id)}>
                    <td>{String(t.numero)}</td>
                    <td>{String(t.estado)}</td>
                    <td>{hora(t.hora_venta)}</td>
                    <td>
                      <a className="btn btn-sm" href={urlImprimirTicket(t.id as number)}
                        target="_blank" rel="noreferrer">Imprimir</a>
                    </td>
                  </tr>
                ))}
                {!data.tickets.length && <tr><td colSpan={4} style={{ color: '#5f7095' }}>Sin tickets.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <table className="tbl" style={{ marginTop: 12, maxWidth: 380 }}>
          <tbody>
            <tr><td>Subtotal</td><td style={{ textAlign: 'right' }}>{money(venta.subtotal)}</td></tr>
            <tr><td>Descuento</td><td style={{ textAlign: 'right' }}>{money(venta.descuento)}</td></tr>
            <tr><td>Base imponible</td><td style={{ textAlign: 'right' }}>{money(venta.base_imponible)}</td></tr>
            <tr><td>IVA</td><td style={{ textAlign: 'right' }}>{money(venta.iva_total)}</td></tr>
            <tr><td>Propina</td><td style={{ textAlign: 'right' }}>{money(venta.propina)}</td></tr>
            <tr>
              <td><b>Total</b></td>
              <td style={{ textAlign: 'right' }}><b>{money(venta.total_final)} {venta.moneda}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
