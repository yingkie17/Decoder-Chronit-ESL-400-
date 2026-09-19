// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Cierres
// -----------------------------------------------------------------------------
//   GET  /api/conta/cajas?desde&hasta&estado        sesiones (cajero ve las suyas)
//   GET  /api/conta/cajas/:id                       detalle + movimientos + ventas
//   POST /api/conta/cajas/:id/reabrir               (solo supervisor+, auditado)
//   POST /api/conta/cajas/:id/movimiento            retiro / ingreso de efectivo
//   GET  /api/conta/cajas/reportes/diario?fecha=    cierre diario consolidado
//
// CIERRE: esperado = inicial + ventas efectivo - egresos efectivo - retiros
//                   + ingresos + propinas en efectivo
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { fechaHora, haceISO, hoyISO, money, type SesionCaja } from './comun';

interface DetalleCajaData {
  sesion: SesionCaja;
  por_metodo: { tipo: string; total: number; ventas: number }[];
  ventas_total: number; ventas_efectivo: number; egresos_total: number; propinas_total: number;
  retiros: number; ingresos: number; monto_esperado_efectivo: number;
  movimientos: Record<string, unknown>[];
  ventas: Record<string, unknown>[];
  egresos: Record<string, unknown>[];
}

interface SesionResumen {
  sesion: SesionCaja;
  monto_inicial: number; ventas_efectivo: number; ventas_total: number;
  egresos_total: number; propinas_total: number; monto_esperado_efectivo: number;
  monto_contado_efectivo: number | null; diferencia: number | null;
}

export default function Cierres({ esSupervisor, soloLectura, ok, ko }: {
  esSupervisor: boolean; soloLectura: boolean; ok: (m: string) => void; ko: (e: unknown) => void;
}) {
  const [filtros, setFiltros] = useState({ desde: haceISO(30), hasta: hoyISO(), estado: '' });
  const [sesiones, setSesiones] = useState<SesionCaja[]>([]);
  const [detalle, setDetalle] = useState<DetalleCajaData | null>(null);
  const [diario, setDiario] = useState<{ fecha: string; sesiones: SesionResumen[] } | null>(null);
  const [fechaDiario, setFechaDiario] = useState(hoyISO());

  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setSesiones(await contaApi<SesionCaja[]>(`/api/conta/cajas?${qs.toString()}`));
    } catch (e) { ko(e); }
  }, [filtros, ko]);

  useEffect(() => { void cargar(); }, [cargar]);

  const verDetalle = async (id: number) => {
    try { setDetalle(await contaApi<DetalleCajaData>(`/api/conta/cajas/${id}`)); } catch (e) { ko(e); }
  };

  const reabrir = async (s: SesionCaja) => {
    const motivo = window.prompt(`Motivo de reapertura de la caja #${s.id} (obligatorio):`);
    if (!motivo) return;
    try {
      await contaApi(`/api/conta/cajas/${s.id}/reabrir`, { method: 'POST', body: { motivo } });
      ok(`Caja #${s.id} reabierta (queda en auditoría).`);
      await cargar();
    } catch (e) { ko(e); }
  };

  const movimiento = async (s: SesionCaja) => {
    const tipo = window.prompt("Tipo de movimiento: 'retiro' o 'ingreso'");
    if (tipo !== 'retiro' && tipo !== 'ingreso') return;
    const monto = Number(window.prompt('Monto (BOB):'));
    if (!monto || monto <= 0) return;
    const motivo = window.prompt('Motivo (opcional):') || null;
    try {
      await contaApi(`/api/conta/cajas/${s.id}/movimiento`, { method: 'POST', body: { tipo, monto, motivo } });
      ok(`${tipo} de ${money(monto)} registrado.`);
      await cargar();
    } catch (e) { ko(e); }
  };

  const cargarDiario = async () => {
    try {
      setDiario(await contaApi(`/api/conta/cajas/reportes/diario?fecha=${fechaDiario}`));
    } catch (e) { ko(e); }
  };

  const totalDiferencia = sesiones.reduce((a, s) => a + (Number(s.diferencia) || 0), 0);

  return (
    <>
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" type="date" style={{ maxWidth: 160 }} value={filtros.desde}
            onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
          <input className="input" type="date" style={{ maxWidth: 160 }} value={filtros.hasta}
            onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
          <select className="input" style={{ maxWidth: 150 }} value={filtros.estado}
            onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
            <option value="">Todas</option>
            <option value="abierta">Abiertas</option>
            <option value="cerrada">Cerradas</option>
          </select>
          <button className="btn btn-primary" onClick={() => void cargar()}>Buscar</button>
          <span style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
            Suma de diferencias: <b>{money(totalDiferencia)}</b>
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>#</th><th>Cajero</th><th>Apertura</th><th>Cierre</th><th>Estado</th>
                <th>M. inicial</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sesiones.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td style={{ fontSize: '0.8rem' }}>
                    {s.cajero_nombre || '—'}
                    <div style={{ color: '#5f7095' }}>{s.cajero_carnet || ''}</div>
                  </td>
                  <td style={{ fontSize: '0.78rem' }}>{fechaHora(s.apertura_en)}</td>
                  <td style={{ fontSize: '0.78rem' }}>{s.cierre_en ? fechaHora(s.cierre_en) : '—'}</td>
                  <td>
                    {s.estado === 'abierta'
                      ? <span className="pill" style={{ background: '#22c55e22', color: '#22c55e' }}>Abierta</span>
                      : <span className="pill" style={{ background: '#3b82f622', color: '#3b82f6' }}>Cerrada</span>}
                  </td>
                  <td>{money(s.monto_inicial)}</td>
                  <td>{s.monto_esperado_efectivo == null ? '—' : money(s.monto_esperado_efectivo)}</td>
                  <td>{s.monto_contado_efectivo == null ? '—' : money(s.monto_contado_efectivo)}</td>
                  <td style={{ color: Number(s.diferencia) ? '#f59e0b' : undefined }}>
                    {s.diferencia == null ? '—' : money(s.diferencia)}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => void verDetalle(s.id)}>Detalle</button>
                      {esSupervisor && !soloLectura && s.estado === 'cerrada' && (
                        <button className="btn btn-sm btn-warn" onClick={() => void reabrir(s)}>Reabrir</button>
                      )}
                      {!soloLectura && s.estado === 'abierta' && (
                        <button className="btn btn-sm" onClick={() => void movimiento(s)}>Movimiento</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!sesiones.length && (
                <tr><td colSpan={10} style={{ color: '#5f7095' }}>Sin sesiones en el período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Cierre diario consolidado</h3>
          <input className="input" type="date" style={{ maxWidth: 170 }} value={fechaDiario}
            onChange={(e) => setFechaDiario(e.target.value)} />
          <button className="btn btn-primary" onClick={cargarDiario}>Generar</button>
        </div>
        {diario && <ResumenSesiones sesiones={diario.sesiones} etiqueta={`Cierre del ${diario.fecha}`} />}
      </section>

      {detalle && <DetalleCaja data={detalle} onClose={() => setDetalle(null)} />}
    </>
  );
}

/** Tabla consolidada de una o varias sesiones (usada en el cierre diario). */
function ResumenSesiones({ sesiones, etiqueta }: { sesiones: SesionResumen[]; etiqueta: string }) {
  const tot = sesiones.reduce((acc, s) => ({
    inicial: acc.inicial + (Number(s.monto_inicial) || 0),
    efectivo: acc.efectivo + (Number(s.ventas_efectivo) || 0),
    ventas: acc.ventas + (Number(s.ventas_total) || 0),
    egresos: acc.egresos + (Number(s.egresos_total) || 0),
    propinas: acc.propinas + (Number(s.propinas_total) || 0),
    esperado: acc.esperado + (Number(s.monto_esperado_efectivo) || 0),
    diferencia: acc.diferencia + (Number(s.diferencia) || 0),
  }), { inicial: 0, efectivo: 0, ventas: 0, egresos: 0, propinas: 0, esperado: 0, diferencia: 0 });

  return (
    <>
      <h4 style={{ marginBottom: 6 }}>{etiqueta}</h4>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Sesión</th><th>Cajero</th><th>M. inicial</th><th>Vta. efectivo</th><th>Vta. total</th>
              <th>Egresos</th><th>Propinas</th><th>Esperado</th><th>Contado</th><th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {sesiones.map((s) => (
              <tr key={s.sesion.id}>
                <td>{s.sesion.id}</td>
                <td style={{ fontSize: '0.78rem' }}>{s.sesion.cajero_nombre || '—'}</td>
                <td>{money(s.monto_inicial)}</td>
                <td>{money(s.ventas_efectivo)}</td>
                <td>{money(s.ventas_total)}</td>
                <td>{money(s.egresos_total)}</td>
                <td>{money(s.propinas_total)}</td>
                <td>{money(s.monto_esperado_efectivo)}</td>
                <td>{s.monto_contado_efectivo == null ? '—' : money(s.monto_contado_efectivo)}</td>
                <td>{s.diferencia == null ? '—' : money(s.diferencia)}</td>
              </tr>
            ))}
            {!sesiones.length && <tr><td colSpan={10} style={{ color: '#5f7095' }}>Sin sesiones ese día.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><b>TOTALES</b></td>
              <td><b>{money(tot.inicial)}</b></td>
              <td><b>{money(tot.efectivo)}</b></td>
              <td><b>{money(tot.ventas)}</b></td>
              <td><b>{money(tot.egresos)}</b></td>
              <td><b>{money(tot.propinas)}</b></td>
              <td><b>{money(tot.esperado)}</b></td>
              <td>—</td>
              <td><b>{money(tot.diferencia)}</b></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function DetalleCaja({ data, onClose }: { data: DetalleCajaData; onClose: () => void }) {
  const fichas: [string, string][] = [
    ['M. inicial', money(data.sesion.monto_inicial)],
    ['Ventas efectivo', money(data.ventas_efectivo)],
    ['Ventas total', money(data.ventas_total)],
    ['Egresos', money(data.egresos_total)],
    ['Propinas', money(data.propinas_total)],
    ['Retiros', money(data.retiros)],
    ['Ingresos', money(data.ingresos)],
    ['Esperado efectivo', money(data.monto_esperado_efectivo)],
    ['Contado', data.sesion.monto_contado_efectivo == null ? '—' : money(data.sesion.monto_contado_efectivo)],
    ['Diferencia', data.sesion.diferencia == null ? '—' : money(data.sesion.diferencia)],
  ];

  return (
    <div className="modal-overlay">
      <div className="card modal" style={{ maxWidth: 920, maxHeight: '86vh', overflow: 'auto' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginTop: 0 }}>Caja #{data.sesion.id} — {data.sesion.cajero_nombre || ''}</h3>
          <button className="btn btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
          {fechaHora(data.sesion.apertura_en)} → {data.sesion.cierre_en ? fechaHora(data.sesion.cierre_en) : 'abierta'}
          {' · '}{data.sesion.estado}
          {data.sesion.motivo_reapertura && <> · Reapertura: {data.sesion.motivo_reapertura}</>}
        </p>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          {fichas.map(([k, v]) => (
            <div key={k} className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 700 }}>{v}</div>
              <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>{k}</div>
            </div>
          ))}
        </div>

        <h4>Breakdown por método de pago</h4>
        <table className="tbl">
          <thead><tr><th>Método</th><th>Ventas</th><th>Total</th></tr></thead>
          <tbody>
            {data.por_metodo.map((m) => (
              <tr key={m.tipo}><td>{m.tipo}</td><td>{m.ventas}</td><td>{money(m.total)}</td></tr>
            ))}
            {!data.por_metodo.length && <tr><td colSpan={3} style={{ color: '#5f7095' }}>Sin pagos.</td></tr>}
          </tbody>
        </table>

        <h4>Movimientos de caja</h4>
        <table className="tbl">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Motivo</th><th>Por</th></tr></thead>
          <tbody>
            {data.movimientos.map((mv) => (
              <tr key={String(mv.id)}>
                <td style={{ fontSize: '0.76rem' }}>{fechaHora(mv.creado_en)}</td>
                <td>{String(mv.tipo)}</td>
                <td>{money(mv.monto)}</td>
                <td>{String(mv.motivo || '—')}</td>
                <td style={{ fontSize: '0.76rem' }}>{String(mv.creado_por_nombre || '—')}</td>
              </tr>
            ))}
            {!data.movimientos.length && <tr><td colSpan={5} style={{ color: '#5f7095' }}>Sin movimientos.</td></tr>}
          </tbody>
        </table>

        <h4>Ventas de la sesión</h4>
        <table className="tbl">
          <thead>
            <tr><th>#</th><th>Factura</th><th>Total</th><th>Desc.</th><th>Propina</th><th>NIT</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {data.ventas.map((v) => (
              <tr key={String(v.id)}>
                <td>{String(v.id)}</td>
                <td>{String(v.numero_factura || '—')}</td>
                <td>{money(v.total_final)}</td>
                <td>{money(v.descuento)}</td>
                <td>{money(v.propina)}</td>
                <td>{String(v.nit_cliente || '—')}</td>
                <td>{v.anulada ? 'Anulada' : 'Vigente'}</td>
              </tr>
            ))}
            {!data.ventas.length && <tr><td colSpan={7} style={{ color: '#5f7095' }}>Sin ventas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
