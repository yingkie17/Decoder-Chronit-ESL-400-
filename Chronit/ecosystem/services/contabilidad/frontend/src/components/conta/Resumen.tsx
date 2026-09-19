// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Resumen (tablero consolidado)
// -----------------------------------------------------------------------------
// GET /api/conta/dashboard?fecha=YYYY-MM-DD
// Todo se lee de snapshots; no se recalcula nada.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { fechaHora, hoyISO, money, TZ } from './comun';

interface Dashboard {
  fecha: string;
  kpis: Record<string, number>;
  cajas_abiertas: { id: number; cajero: string | null; monto_inicial: number; apertura_en: string }[];
  cajas_cerradas_hoy: number;
  diferencia_caja_hoy: number;
  serie: { fecha: string; total: number; n: number }[];
  top_productos: { nombre: string; cantidad: number; ingresos: number }[];
}

export default function Resumen({ onError }: { onError: (e: unknown) => void }) {
  const [fechaSel, setFechaSel] = useState(hoyISO());
  const [data, setData] = useState<Dashboard | null>(null);

  const cargar = useCallback(async () => {
    try {
      setData(await contaApi<Dashboard>(`/api/conta/dashboard?fecha=${fechaSel}`));
    } catch (e) { onError(e); }
  }, [fechaSel, onError]);

  useEffect(() => { void cargar(); }, [cargar]);

  const k = data?.kpis || {};
  const tarjetas: [string, string][] = [
    ['Ventas del día', money(k.ventas_total)],
    ['N° de ventas', String(k.ventas_n ?? 0)],
    ['Tickets emitidos', String(k.tickets ?? 0)],
    ['Ticket promedio', money(k.ticket_promedio)],
    ['Efectivo', money(k.efectivo)],
    ['QR', money(k.qr)],
    ['Transferencia', money(k.transferencia)],
    ['Cortesía', money(k.cortesia)],
    ['Descuentos', money(k.descuento)],
    ['Base imponible', money(k.base_imponible)],
    ['IVA', money(k.iva)],
    ['Propinas', money(k.propinas)],
    ['Propinas pendientes', money(k.propinas_pendientes)],
    ['Egresos', money(k.egresos)],
    ['Resultado', money(k.resultado)],
    ['Ventas anuladas', String(k.ventas_anuladas ?? 0)],
  ];

  return (
    <>
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Tablero consolidado</h3>
          <input className="input" type="date" style={{ maxWidth: 180 }} value={fechaSel}
            onChange={(e) => setFechaSel(e.target.value)} />
          <span style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>Zona horaria {TZ}</span>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', marginBottom: 16 }}>
        {tarjetas.map(([etiqueta, valor]) => (
          <div key={etiqueta} className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{valor}</div>
            <div style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>{etiqueta}</div>
          </div>
        ))}
      </section>

      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <section className="card" style={{ flex: '1 1 340px' }}>
          <h3 style={{ marginTop: 0 }}>Cajas abiertas ({data?.cajas_abiertas?.length ?? 0})</h3>
          <table className="tbl">
            <thead><tr><th>Cajero</th><th>Apertura</th><th>M. inicial</th></tr></thead>
            <tbody>
              {(data?.cajas_abiertas || []).map((c) => (
                <tr key={c.id}>
                  <td>{c.cajero || '—'}</td>
                  <td style={{ fontSize: '0.78rem' }}>{fechaHora(c.apertura_en)}</td>
                  <td>{money(c.monto_inicial)}</td>
                </tr>
              ))}
              {!data?.cajas_abiertas?.length && (
                <tr><td colSpan={3} style={{ color: '#5f7095' }}>Ninguna caja abierta.</td></tr>
              )}
            </tbody>
          </table>
          <p style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>
            Cajas cerradas hoy: <b>{data?.cajas_cerradas_hoy ?? 0}</b> · Suma de diferencias:{' '}
            <b>{money(data?.diferencia_caja_hoy)}</b>
          </p>
        </section>

        <section className="card" style={{ flex: '1 1 320px' }}>
          <h3 style={{ marginTop: 0 }}>Últimos 7 días</h3>
          <table className="tbl">
            <thead><tr><th>Fecha</th><th>Ventas</th><th>Total</th></tr></thead>
            <tbody>
              {(data?.serie || []).map((s) => (
                <tr key={s.fecha}><td>{s.fecha}</td><td>{s.n}</td><td>{money(s.total)}</td></tr>
              ))}
              {!data?.serie?.length && <tr><td colSpan={3} style={{ color: '#5f7095' }}>Sin ventas.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="card" style={{ flex: '1 1 320px' }}>
          <h3 style={{ marginTop: 0 }}>Top productos (30 días)</h3>
          <table className="tbl">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Ingresos</th></tr></thead>
            <tbody>
              {(data?.top_productos || []).map((p) => (
                <tr key={p.nombre}><td>{p.nombre}</td><td>{p.cantidad}</td><td>{money(p.ingresos)}</td></tr>
              ))}
              {!data?.top_productos?.length && <tr><td colSpan={3} style={{ color: '#5f7095' }}>Sin datos.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
