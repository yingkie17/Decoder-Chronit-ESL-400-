// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Anticipos de clientes
// -----------------------------------------------------------------------------
//   GET  /api/conta/anticipos?estado&cliente_id&q
//   GET  /api/conta/anticipos/:id               detalle + aplicaciones + NC
//   POST /api/conta/anticipos                   registrar (sin venta)
//   POST /api/conta/anticipos/:id/aplicar       aplicar a una venta
//   POST /api/conta/anticipos/:id/devolver      devolver (emite nota de crédito)
//
// estado: pendiente | aplicado | devuelto | vencido (el worker de alertas marca
// 'vencido' al pasar la fecha de vencimiento).
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { Cuenta, fecha, fechaHora, hoyISO, money } from './comun';

interface Anticipo {
  id: number; cliente_id: number | null; cliente_nombre: string | null; cliente_nit: string | null;
  monto: number; monto_aplicado: number; saldo: number; moneda: string;
  metodo_pago_id: number | null; metodo_nombre?: string | null; metodo_tipo?: string | null;
  cuenta_destino_id: number | null; cuenta_nombre?: string | null;
  referencia_qr: string | null; estado: string; vencimiento: string | null;
  creado_por_nombre?: string | null; creado_en: string;
}

interface Aplicacion {
  id: number; venta_id: number; monto_aplicado: number;
  numero_factura?: string | null; total_final?: number | null; creado_en: string;
}

interface NotaAnticipo {
  id: number; numero: string | null; monto: number; reembolso: string; estado: string; creado_en: string;
}

interface DetalleAnticipo {
  anticipo: Anticipo; aplicaciones: Aplicacion[]; notas_credito: NotaAnticipo[];
}

interface MetodoPago { id: number; nombre: string; tipo: string }

interface VentaMini { id: number; numero_factura: string | null; total_final: number; anulada: boolean }

const COLOR_ESTADO: Record<string, string> = {
  pendiente: '#f59e0b', aplicado: '#22c55e', devuelto: '#3b82f6', vencido: '#ef4444',
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const diasParaVencer = (v: string | null) => (v
  ? Math.ceil((new Date(v).getTime() - new Date(hoyISO()).getTime()) / 86400000)
  : null);

export default function Anticipos({ ok, soloLectura, puedeGestion, esSupervisor }: {
  ok: (m: string) => void; soloLectura: boolean; puedeGestion: boolean; esSupervisor: boolean;
}) {
  const puedeRegistrar = !soloLectura && (puedeGestion || esSupervisor);

  const [filtros, setFiltros] = useState({ estado: '', q: '' });
  const [rows, setRows] = useState<Anticipo[]>([]);
  const [error, setError] = useState('');
  const [detalle, setDetalle] = useState<DetalleAnticipo | null>(null);

  const [metodos, setMetodos] = useState<MetodoPago[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [ventas, setVentas] = useState<VentaMini[]>([]);

  const [form, setForm] = useState({
    cliente_nombre: '', cliente_nit: '', monto: '', moneda: 'BOB',
    metodo_pago_id: '', cuenta_destino_id: '', referencia_qr: '', vencimiento: '',
  });
  const [aplicar, setAplicar] = useState<{ anticipo: Anticipo; venta_id: string; monto: string } | null>(null);
  const [devolver, setDevolver] = useState<{
    anticipo: Anticipo; motivo: string; reembolso: string; monto: string;
  } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setRows(await contaApi<Anticipo[]>(`/api/conta/anticipos?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [filtros]);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    (async () => {
      try {
        const [mp, cd, vs] = await Promise.all([
          contaApi<MetodoPago[]>('/api/conta/metodos-pago'),
          contaApi<Cuenta[]>('/api/conta/cuentas?activas=false'),
          contaApi<VentaMini[]>('/api/conta/ventas'),
        ]);
        setMetodos(mp);
        setCuentas(cd.filter((c) => c.activo));
        setVentas(vs.filter((v) => !v.anulada));
      } catch { /* catálogos opcionales para los formularios */ }
    })();
  }, []);

  const metodoSel = metodos.find((m) => String(m.id) === form.metodo_pago_id);
  const exigeCuenta = metodoSel ? ['qr', 'transferencia'].includes(metodoSel.tipo) : false;

  const registrar = async () => {
    setError('');
    if (!(Number(form.monto) > 0)) { setError('El monto debe ser mayor a 0.'); return; }
    if (!form.metodo_pago_id) { setError('El método de pago es obligatorio.'); return; }
    if (exigeCuenta && !form.cuenta_destino_id) { setError('El método seleccionado exige una cuenta destino.'); return; }
    try {
      await contaApi('/api/conta/anticipos', {
        method: 'POST',
        body: {
          cliente_nombre: form.cliente_nombre || null,
          cliente_nit: form.cliente_nit || null,
          monto: Number(form.monto),
          moneda: form.moneda,
          metodo_pago_id: Number(form.metodo_pago_id),
          cuenta_destino_id: form.cuenta_destino_id ? Number(form.cuenta_destino_id) : null,
          referencia_qr: form.referencia_qr || null,
          vencimiento: form.vencimiento || null,
        },
      });
      ok('Anticipo registrado (nace el pasivo «Anticipos de clientes»).');
      setForm({
        cliente_nombre: '', cliente_nit: '', monto: '', moneda: 'BOB',
        metodo_pago_id: '', cuenta_destino_id: '', referencia_qr: '', vencimiento: '',
      });
      await cargar();
    } catch (e) { setError(errMsg(e)); }
  };

  const verDetalle = async (id: number) => {
    try { setDetalle(await contaApi<DetalleAnticipo>(`/api/conta/anticipos/${id}`)); }
    catch (e) { setError(errMsg(e)); }
  };

  const confirmarAplicar = async () => {
    if (!aplicar) return;
    setError('');
    if (!aplicar.venta_id) { setError('Selecciona la venta a la que aplicar el anticipo.'); return; }
    try {
      await contaApi(`/api/conta/anticipos/${aplicar.anticipo.id}/aplicar`, {
        method: 'POST',
        body: {
          venta_id: Number(aplicar.venta_id),
          monto: Number(aplicar.monto) > 0 ? Number(aplicar.monto) : undefined,
        },
      });
      ok(`Anticipo #${aplicar.anticipo.id} aplicado a la venta.`);
      setAplicar(null);
      await cargar();
    } catch (e) { setError(errMsg(e)); }
  };

  const confirmarDevolver = async () => {
    if (!devolver) return;
    setError('');
    if (!devolver.motivo.trim()) { setError('El motivo de la devolución es obligatorio.'); return; }
    try {
      await contaApi(`/api/conta/anticipos/${devolver.anticipo.id}/devolver`, {
        method: 'POST',
        body: {
          motivo: devolver.motivo.trim(),
          reembolso: devolver.reembolso,
          monto: Number(devolver.monto) > 0 ? Number(devolver.monto) : undefined,
        },
      });
      ok(`Anticipo #${devolver.anticipo.id} devuelto (se emitió la nota de crédito).`);
      setDevolver(null);
      await cargar();
    } catch (e) { setError(errMsg(e)); }
  };

  const porVencer = rows.filter((a) => {
    if (!['pendiente', 'vencido'].includes(a.estado)) return false;
    const d = diasParaVencer(a.vencimiento);
    return d !== null && d <= 7;
  });

  return (
    <>
      {error && <p className="card" style={{ color: '#ef4444', padding: 12, marginBottom: 12 }}>{error}</p>}

      {porVencer.length > 0 && (
        <section className="card" style={{ marginBottom: 16, borderLeft: '4px solid #f59e0b' }}>
          <h3 style={{ marginTop: 0 }}>Recordatorio de vencimiento</h3>
          <p style={{ color: '#8aa4c7', fontSize: '0.82rem', marginTop: 0 }}>
            Hay <b>{porVencer.length}</b> anticipo(s) vencidos o que vencen en los próximos 7 días.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.84rem' }}>
            {porVencer.map((a) => {
              const d = diasParaVencer(a.vencimiento);
              return (
                <li key={a.id}>
                  #{a.id} · {a.cliente_nombre || 'Cliente'} · saldo <b>{money(a.saldo)}</b> ·{' '}
                  vence {fecha(a.vencimiento)}{' '}
                  <span style={{ color: (d ?? 0) < 0 ? '#ef4444' : '#f59e0b' }}>
                    ({(d ?? 0) < 0 ? `vencido hace ${Math.abs(d ?? 0)} días` : `en ${d} días`})
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {puedeRegistrar && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Registrar anticipo</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Cliente" style={{ flex: '1 1 180px' }}
              value={form.cliente_nombre} onChange={(e) => setForm({ ...form, cliente_nombre: e.target.value })} />
            <input className="input" placeholder="NIT / CI" style={{ flex: '0 0 140px' }}
              value={form.cliente_nit} onChange={(e) => setForm({ ...form, cliente_nit: e.target.value })} />
            <input className="input" type="number" step="0.01" placeholder="Monto *" style={{ flex: '0 0 140px' }}
              value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
            <select className="input" style={{ flex: '0 0 110px' }} value={form.moneda}
              onChange={(e) => setForm({ ...form, moneda: e.target.value })}>
              <option value="BOB">BOB</option>
              <option value="USD">USD</option>
            </select>
            <select className="input" style={{ flex: '0 0 190px' }} value={form.metodo_pago_id}
              onChange={(e) => setForm({ ...form, metodo_pago_id: e.target.value })}>
              <option value="">Método de pago *</option>
              {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.tipo})</option>)}
            </select>
            <select className="input" style={{ flex: '0 0 200px' }} value={form.cuenta_destino_id}
              onChange={(e) => setForm({ ...form, cuenta_destino_id: e.target.value })}>
              <option value="">{exigeCuenta ? 'Cuenta destino *' : 'Cuenta destino (opcional)'}</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input className="input" placeholder="Referencia QR" style={{ flex: '0 0 170px' }}
              value={form.referencia_qr} onChange={(e) => setForm({ ...form, referencia_qr: e.target.value })} />
            <input className="input" type="date" title="Vencimiento" style={{ maxWidth: 160 }}
              value={form.vencimiento} onChange={(e) => setForm({ ...form, vencimiento: e.target.value })} />
            <button className="btn btn-primary" onClick={() => void registrar()}>Registrar</button>
          </div>
          <p style={{ color: '#8aa4c7', fontSize: '0.78rem', marginBottom: 0 }}>
            Los métodos <b>qr</b> y <b>transferencia</b> exigen cuenta destino. Sin fecha de
            vencimiento se aplica el plazo configurado por defecto.
          </p>
        </section>
      )}

      <section className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="input" style={{ maxWidth: 180 }} value={filtros.estado}
            onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendientes</option>
            <option value="aplicado">Aplicados</option>
            <option value="devuelto">Devueltos</option>
            <option value="vencido">Vencidos</option>
          </select>
          <input className="input" placeholder="Buscar cliente / NIT / ref. QR" style={{ flex: '1 1 240px' }}
            value={filtros.q} onChange={(e) => setFiltros({ ...filtros, q: e.target.value })} />
          <button className="btn btn-primary" onClick={() => void cargar()}>Buscar</button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>#</th><th>Cliente</th><th>NIT</th><th>Monto</th><th>Aplicado</th><th>Saldo</th>
                <th>Método</th><th>Cuenta</th><th>Estado</th><th>Vence</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{a.cliente_nombre || '—'}</td>
                  <td style={{ fontSize: '0.8rem' }}>{a.cliente_nit || '—'}</td>
                  <td>{money(a.monto)}</td>
                  <td>{money(a.monto_aplicado)}</td>
                  <td><b>{money(a.saldo)}</b></td>
                  <td style={{ fontSize: '0.8rem' }}>{a.metodo_nombre || '—'}</td>
                  <td style={{ fontSize: '0.8rem' }}>{a.cuenta_nombre || '—'}</td>
                  <td>
                    <span className="pill" style={{
                      background: `${COLOR_ESTADO[a.estado] || '#8aa4c7'}22`,
                      color: COLOR_ESTADO[a.estado] || '#8aa4c7',
                    }}>{a.estado}</span>
                  </td>
                  <td style={{ fontSize: '0.78rem' }}>{a.vencimiento ? fecha(a.vencimiento) : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => void verDetalle(a.id)}>Ver</button>
                      {puedeRegistrar && ['pendiente', 'vencido'].includes(a.estado) && a.saldo > 0 && (
                        <button className="btn btn-sm btn-success"
                          onClick={() => setAplicar({ anticipo: a, venta_id: '', monto: '' })}>
                          Aplicar
                        </button>
                      )}
                      {(puedeGestion || esSupervisor) && !soloLectura && a.saldo > 0 && (
                        <button className="btn btn-sm btn-warn"
                          onClick={() => setDevolver({ anticipo: a, motivo: '', reembolso: 'efectivo', monto: '' })}>
                          Devolver
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={11} style={{ color: '#5f7095' }}>Sin anticipos.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {detalle && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 780, maxHeight: '84vh', overflow: 'auto' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ marginTop: 0 }}>
                Anticipo #{detalle.anticipo.id} — {money(detalle.anticipo.monto)}
              </h3>
              <button className="btn btn-sm" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              {detalle.anticipo.cliente_nombre || 'Cliente'} · estado {detalle.anticipo.estado} ·
              saldo <b>{money(detalle.anticipo.saldo)}</b>
            </p>
            <h4>Aplicaciones</h4>
            <table className="tbl">
              <thead><tr><th>Venta</th><th>Total venta</th><th>Aplicado</th><th>Fecha</th></tr></thead>
              <tbody>
                {detalle.aplicaciones.map((a) => (
                  <tr key={a.id}>
                    <td>{a.numero_factura || `Venta #${a.venta_id}`}</td>
                    <td>{money(a.total_final || 0)}</td>
                    <td>{money(a.monto_aplicado)}</td>
                    <td style={{ fontSize: '0.76rem' }}>{fechaHora(a.creado_en)}</td>
                  </tr>
                ))}
                {!detalle.aplicaciones.length && (
                  <tr><td colSpan={4} style={{ color: '#5f7095' }}>Sin aplicaciones.</td></tr>
                )}
              </tbody>
            </table>
            <h4>Notas de crédito</h4>
            <table className="tbl">
              <thead><tr><th>N°</th><th>Monto</th><th>Reembolso</th><th>Estado</th><th>Fecha</th></tr></thead>
              <tbody>
                {detalle.notas_credito.map((n) => (
                  <tr key={n.id}>
                    <td>{n.numero || `#${n.id}`}</td>
                    <td>{money(n.monto)}</td>
                    <td>{n.reembolso}</td>
                    <td>{n.estado}</td>
                    <td style={{ fontSize: '0.76rem' }}>{fechaHora(n.creado_en)}</td>
                  </tr>
                ))}
                {!detalle.notas_credito.length && (
                  <tr><td colSpan={5} style={{ color: '#5f7095' }}>Sin notas de crédito.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aplicar && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 480 }}>
            <h3 style={{ marginTop: 0 }}>Aplicar anticipo #{aplicar.anticipo.id}</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              Saldo disponible: <b>{money(aplicar.anticipo.saldo)}</b>. Deja el monto vacío para
              aplicar el máximo posible.
            </p>
            <select className="input" value={aplicar.venta_id}
              onChange={(e) => setAplicar({ ...aplicar, venta_id: e.target.value })}>
              <option value="">Venta a la que aplicar *</option>
              {ventas.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.numero_factura || `Venta #${v.id}`} · {money(v.total_final)}
                </option>
              ))}
            </select>
            <input className="input" type="number" step="0.01" placeholder="Monto (opcional)"
              style={{ marginTop: 8 }} value={aplicar.monto}
              onChange={(e) => setAplicar({ ...aplicar, monto: e.target.value })} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => void confirmarAplicar()}>Aplicar</button>
              <button className="btn" onClick={() => setAplicar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {devolver && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 480 }}>
            <h3 style={{ marginTop: 0 }}>Devolver anticipo #{devolver.anticipo.id}</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              Saldo: <b>{money(devolver.anticipo.saldo)}</b>. Se emite una nota de crédito. Deja el
              monto vacío para devolver el saldo completo.
            </p>
            <input className="input" placeholder="Motivo *" value={devolver.motivo}
              onChange={(e) => setDevolver({ ...devolver, motivo: e.target.value })} />
            <select className="input" style={{ marginTop: 8 }} value={devolver.reembolso}
              onChange={(e) => setDevolver({ ...devolver, reembolso: e.target.value })}>
              <option value="efectivo">Reembolso: efectivo</option>
              <option value="cortesia">Reembolso: cortesía</option>
              <option value="saldo_favor">Reembolso: saldo a favor</option>
            </select>
            <input className="input" type="number" step="0.01" placeholder="Monto (opcional)"
              style={{ marginTop: 8 }} value={devolver.monto}
              onChange={(e) => setDevolver({ ...devolver, monto: e.target.value })} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => void confirmarDevolver()}>Devolver</button>
              <button className="btn" onClick={() => setDevolver(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
