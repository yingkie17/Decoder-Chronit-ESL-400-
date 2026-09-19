// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Cartera (CxC / CxP + Empresas/Convenios)
// -----------------------------------------------------------------------------
//   CxC: GET/POST /api/conta/cxc, GET /cxc/aging, /cxc/recordatorios,
//        POST /cxc/:id/cobrar, /cxc/:id/recordatorio, /cxc/:id/anular
//   CxP: GET /api/conta/cxp, /cxp/aging, /cxp/recordatorios,
//        POST /cxp/:id/pagar, /cxp/:id/recordatorio, /cxp/:id/anular
//   Empresas y Convenios: CRUD en /api/conta/empresas y /api/conta/convenios
//
// REGLA: el saldo vive en la fila de la cuenta; aquí solo se lee y se registran
// cobros/pagos parciales o totales (el backend mantiene monto_pagado y saldo).
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { Cuenta, fecha, fechaHora, haceISO, hoyISO, money } from './comun';

interface CuentaCobrar {
  id: number; cliente_id: number | null; cliente_nombre: string | null; cliente_nit: string | null;
  venta_id: number | null; monto: number; monto_pagado: number; saldo: number;
  vencimiento: string | null; estado: string; creado_en: string;
}

interface CuentaPagar {
  id: number; proveedor_id: number | null; proveedor?: string | null;
  compra_id: number | null; monto: number; monto_pagado: number; saldo: number;
  vencimiento: string | null; estado: string; creado_en: string;
}

interface Aging {
  total: number; clientes?: number; proveedores?: number; cuentas: number;
  buckets: Record<string, number>;
}

interface Recordatorio {
  id: number; cliente_nombre?: string | null; proveedor?: string | null;
  saldo: number; vencimiento: string | null; estado: string; dias_vencido: number;
}

interface Empresa {
  id: number; nombre: string; nit: string | null; contacto: string | null;
  telefono: string | null; email: string | null; direccion: string | null; activo: boolean;
}

interface Convenio {
  id: number; empresa_id: number; empresa?: string | null; empresa_nit?: string | null;
  tarifa_especial: number | null; cupo_mensual: number | null;
  vigencia_desde: string | null; vigencia_hasta: string | null; activo: boolean;
}

interface MetodoPago { id: number; nombre: string; tipo: string }

const COLOR_ESTADO: Record<string, string> = {
  pendiente: '#f59e0b', pagada: '#22c55e', anulada: '#ef4444', vencida: '#ef4444',
};

const BUCKETS = ['Por vencer', '1-30 días', '31-60 días', '61-90 días', 'más de 90 días'];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Cartera({ ok, soloLectura, puedeGestion }: {
  ok: (m: string) => void; soloLectura: boolean; puedeGestion: boolean;
}) {
  const puedeGestionar = !soloLectura && puedeGestion;

  const [seccion, setSeccion] = useState<'cxc' | 'cxp' | 'empresas' | 'convenios'>('cxc');
  const [error, setError] = useState('');

  // Catálogos comunes
  const [metodos, setMetodos] = useState<MetodoPago[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);

  // CxC
  const [fCxc, setFCxc] = useState({ estado: '', desde: haceISO(90), hasta: hoyISO(), q: '' });
  const [cxc, setCxc] = useState<CuentaCobrar[]>([]);
  const [agingCxc, setAgingCxc] = useState<Aging | null>(null);
  const [recCxc, setRecCxc] = useState<Recordatorio[] | null>(null);
  const [cobrar, setCobrar] = useState<{
    cuenta: CuentaCobrar; monto: string; metodo_pago_id: string; cuenta_destino_id: string; observacion: string;
  } | null>(null);

  // CxP
  const [fCxp, setFCxp] = useState({ estado: '', desde: haceISO(90), hasta: hoyISO() });
  const [cxp, setCxp] = useState<CuentaPagar[]>([]);
  const [agingCxp, setAgingCxp] = useState<Aging | null>(null);
  const [recCxp, setRecCxp] = useState<Recordatorio[] | null>(null);
  const [pagar, setPagar] = useState<{
    cuenta: CuentaPagar; monto: string; metodo_pago_id: string; cuenta_destino_id: string; observacion: string;
  } | null>(null);

  // Empresas / Convenios
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [nuevaEmpresa, setNuevaEmpresa] = useState({
    nombre: '', nit: '', contacto: '', telefono: '', email: '', direccion: '',
  });
  const [editEmpresa, setEditEmpresa] = useState<Empresa | null>(null);

  const [convenios, setConvenios] = useState<Convenio[]>([]);
  const [nuevoConvenio, setNuevoConvenio] = useState({
    empresa_id: '', tarifa_especial: '', cupo_mensual: '', vigencia_desde: '', vigencia_hasta: '',
  });

  const cargarCxc = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(fCxc).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setCxc(await contaApi<CuentaCobrar[]>(`/api/conta/cxc?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [fCxc]);

  const cargarCxp = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(fCxp).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setCxp(await contaApi<CuentaPagar[]>(`/api/conta/cxp?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [fCxp]);

  const cargarEmpresas = useCallback(async () => {
    try { setEmpresas(await contaApi<Empresa[]>('/api/conta/empresas')); }
    catch (e) { setError(errMsg(e)); }
  }, []);

  const cargarConvenios = useCallback(async () => {
    try { setConvenios(await contaApi<Convenio[]>('/api/conta/convenios')); }
    catch (e) { setError(errMsg(e)); }
  }, []);

  useEffect(() => { void cargarCxc(); }, [cargarCxc]);
  useEffect(() => { void cargarCxp(); }, [cargarCxp]);
  useEffect(() => { void cargarEmpresas(); }, [cargarEmpresas]);
  useEffect(() => { void cargarConvenios(); }, [cargarConvenios]);

  useEffect(() => {
    (async () => {
      try { setMetodos(await contaApi<MetodoPago[]>('/api/conta/metodos-pago')); } catch { /* opcional */ }
      try {
        const cd = await contaApi<Cuenta[]>('/api/conta/cuentas?activas=false');
        setCuentas(cd.filter((c) => c.activo));
      } catch { /* opcional */ }
    })();
  }, []);

  // --- CxC ---
  const cargarAgingCxc = async () => {
    try { setAgingCxc(await contaApi<Aging>('/api/conta/cxc/aging')); }
    catch (e) { setError(errMsg(e)); }
  };

  const cargarRecordatoriosCxc = async () => {
    try { setRecCxc(await contaApi<Recordatorio[]>('/api/conta/cxc/recordatorios')); }
    catch (e) { setError(errMsg(e)); }
  };

  const confirmarCobro = async () => {
    if (!cobrar) return;
    setError('');
    try {
      await contaApi(`/api/conta/cxc/${cobrar.cuenta.id}/cobrar`, {
        method: 'POST',
        body: {
          monto: Number(cobrar.monto) > 0 ? Number(cobrar.monto) : undefined,
          metodo_pago_id: cobrar.metodo_pago_id ? Number(cobrar.metodo_pago_id) : null,
          cuenta_destino_id: cobrar.cuenta_destino_id ? Number(cobrar.cuenta_destino_id) : null,
          observacion: cobrar.observacion || null,
        },
      });
      ok(`Cobro registrado en la CxC #${cobrar.cuenta.id}.`);
      setCobrar(null);
      await cargarCxc();
    } catch (e) { setError(errMsg(e)); }
  };

  const recordatorioCxc = async (c: CuentaCobrar) => {
    try {
      await contaApi(`/api/conta/cxc/${c.id}/recordatorio`, { method: 'POST' });
      ok(`Recordatorio enviado para la CxC #${c.id} (se creó la alerta).`);
    } catch (e) { setError(errMsg(e)); }
  };

  const anularCxc = async (c: CuentaCobrar) => {
    const motivo = window.prompt(`Motivo de anulación de la CxC #${c.id} (obligatorio):`);
    if (!motivo) return;
    try {
      await contaApi(`/api/conta/cxc/${c.id}/anular`, { method: 'POST', body: { motivo } });
      ok(`CxC #${c.id} anulada.`);
      await cargarCxc();
    } catch (e) { setError(errMsg(e)); }
  };

  // --- CxP ---
  const cargarAgingCxp = async () => {
    try { setAgingCxp(await contaApi<Aging>('/api/conta/cxp/aging')); }
    catch (e) { setError(errMsg(e)); }
  };

  const cargarRecordatoriosCxp = async () => {
    try { setRecCxp(await contaApi<Recordatorio[]>('/api/conta/cxp/recordatorios')); }
    catch (e) { setError(errMsg(e)); }
  };

  const confirmarPago = async () => {
    if (!pagar) return;
    setError('');
    try {
      await contaApi(`/api/conta/cxp/${pagar.cuenta.id}/pagar`, {
        method: 'POST',
        body: {
          monto: Number(pagar.monto) > 0 ? Number(pagar.monto) : undefined,
          metodo_pago_id: pagar.metodo_pago_id ? Number(pagar.metodo_pago_id) : null,
          cuenta_destino_id: pagar.cuenta_destino_id ? Number(pagar.cuenta_destino_id) : null,
          observacion: pagar.observacion || null,
        },
      });
      ok(`Pago registrado en la CxP #${pagar.cuenta.id}.`);
      setPagar(null);
      await cargarCxp();
    } catch (e) { setError(errMsg(e)); }
  };

  const recordatorioCxp = async (c: CuentaPagar) => {
    try {
      await contaApi(`/api/conta/cxp/${c.id}/recordatorio`, { method: 'POST' });
      ok(`Recordatorio registrado para la CxP #${c.id}.`);
    } catch (e) { setError(errMsg(e)); }
  };

  const anularCxp = async (c: CuentaPagar) => {
    const motivo = window.prompt(`Motivo de anulación de la CxP #${c.id} (obligatorio):`);
    if (!motivo) return;
    try {
      await contaApi(`/api/conta/cxp/${c.id}/anular`, { method: 'POST', body: { motivo } });
      ok(`CxP #${c.id} anulada.`);
      await cargarCxp();
    } catch (e) { setError(errMsg(e)); }
  };

  // --- Empresas ---
  const crearEmpresa = async () => {
    setError('');
    if (!nuevaEmpresa.nombre.trim()) { setError('El nombre de la empresa es obligatorio.'); return; }
    try {
      await contaApi('/api/conta/empresas', { method: 'POST', body: nuevaEmpresa });
      ok(`Empresa «${nuevaEmpresa.nombre}» creada.`);
      setNuevaEmpresa({ nombre: '', nit: '', contacto: '', telefono: '', email: '', direccion: '' });
      await cargarEmpresas();
    } catch (e) { setError(errMsg(e)); }
  };

  const guardarEmpresa = async () => {
    if (!editEmpresa) return;
    try {
      await contaApi(`/api/conta/empresas/${editEmpresa.id}`, { method: 'PUT', body: editEmpresa });
      ok('Empresa actualizada.');
      setEditEmpresa(null);
      await cargarEmpresas();
    } catch (e) { setError(errMsg(e)); }
  };

  const bajaEmpresa = async (e: Empresa) => {
    if (!window.confirm(`¿Dar de baja la empresa «${e.nombre}»?`)) return;
    try {
      await contaApi(`/api/conta/empresas/${e.id}`, { method: 'DELETE' });
      ok('Empresa dada de baja.');
      await cargarEmpresas();
    } catch (err) { setError(errMsg(err)); }
  };

  // --- Convenios ---
  const crearConvenio = async () => {
    setError('');
    if (!nuevoConvenio.empresa_id) { setError('Selecciona la empresa del convenio.'); return; }
    try {
      await contaApi('/api/conta/convenios', {
        method: 'POST',
        body: {
          empresa_id: Number(nuevoConvenio.empresa_id),
          tarifa_especial: nuevoConvenio.tarifa_especial ? Number(nuevoConvenio.tarifa_especial) : null,
          cupo_mensual: nuevoConvenio.cupo_mensual ? Number(nuevoConvenio.cupo_mensual) : null,
          vigencia_desde: nuevoConvenio.vigencia_desde || null,
          vigencia_hasta: nuevoConvenio.vigencia_hasta || null,
        },
      });
      ok('Convenio creado.');
      setNuevoConvenio({ empresa_id: '', tarifa_especial: '', cupo_mensual: '', vigencia_desde: '', vigencia_hasta: '' });
      await cargarConvenios();
    } catch (e) { setError(errMsg(e)); }
  };

  const bajaConvenio = async (c: Convenio) => {
    if (!window.confirm(`¿Dar de baja el convenio de «${c.empresa || c.empresa_id}»?`)) return;
    try {
      await contaApi(`/api/conta/convenios/${c.id}`, { method: 'DELETE' });
      ok('Convenio dado de baja.');
      await cargarConvenios();
    } catch (e) { setError(errMsg(e)); }
  };

  return (
    <>
      {error && <p className="card" style={{ color: '#ef4444', padding: 12, marginBottom: 12 }}>{error}</p>}

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {([['cxc', 'Cuentas por cobrar'], ['cxp', 'Cuentas por pagar'],
          ['empresas', 'Empresas'], ['convenios', 'Convenios']] as const).map(([k, etiqueta]) => (
          <button key={k} className={`btn ${seccion === k ? 'btn-primary' : ''}`}
            onClick={() => setSeccion(k)}>{etiqueta}</button>
        ))}
      </div>

      {/* ===================== CxC ===================== */}
      {seccion === 'cxc' && (
        <>
          <section className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" type="date" style={{ maxWidth: 160 }} value={fCxc.desde}
                onChange={(e) => setFCxc({ ...fCxc, desde: e.target.value })} />
              <input className="input" type="date" style={{ maxWidth: 160 }} value={fCxc.hasta}
                onChange={(e) => setFCxc({ ...fCxc, hasta: e.target.value })} />
              <select className="input" style={{ maxWidth: 160 }} value={fCxc.estado}
                onChange={(e) => setFCxc({ ...fCxc, estado: e.target.value })}>
                <option value="">Todos los estados</option>
                <option value="pendiente">Pendientes</option>
                <option value="pagada">Cobradas</option>
                <option value="anulada">Anuladas</option>
              </select>
              <input className="input" placeholder="Cliente / NIT" style={{ flex: '1 1 200px' }} value={fCxc.q}
                onChange={(e) => setFCxc({ ...fCxc, q: e.target.value })} />
              <button className="btn btn-primary" onClick={() => void cargarCxc()}>Buscar</button>
              <button className="btn" onClick={() => void cargarAgingCxc()}>Aging 30/60/90</button>
              <button className="btn" onClick={() => void cargarRecordatoriosCxc()}>Recordatorios</button>
            </div>

            {agingCxc && (
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', marginTop: 12 }}>
                {BUCKETS.map((b) => (
                  <div key={b} className="card" style={{ padding: 10 }}>
                    <div style={{ fontWeight: 700 }}>{money(agingCxc.buckets[b] || 0)}</div>
                    <div style={{ color: '#8aa4c7', fontSize: '0.74rem' }}>{b}</div>
                  </div>
                ))}
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(agingCxc.total)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.74rem' }}>
                    Total · {agingCxc.cuentas} cuenta(s) · {agingCxc.clientes ?? 0} cliente(s)
                  </div>
                </div>
              </div>
            )}

            {recCxc && (
              <div style={{ marginTop: 12 }}>
                <h4 style={{ marginBottom: 6 }}>Recordatorios sugeridos ({recCxc.length})</h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.84rem' }}>
                  {recCxc.map((r) => (
                    <li key={r.id}>
                      #{r.id} · {r.cliente_nombre || 'Cliente'} · saldo <b>{money(r.saldo)}</b> ·{' '}
                      vencido hace {r.dias_vencido} día(s)
                    </li>
                  ))}
                  {!recCxc.length && <li style={{ color: '#5f7095' }}>Sin cuentas vencidas.</li>}
                </ul>
              </div>
            )}
          </section>

          <section className="card">
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr><th>#</th><th>Cliente</th><th>NIT</th><th>Venta</th><th>Monto</th><th>Cobrado</th>
                    <th>Saldo</th><th>Vence</th><th>Estado</th><th>Alta</th><th></th></tr>
                </thead>
                <tbody>
                  {cxc.map((c) => (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td>{c.cliente_nombre || '—'}</td>
                      <td style={{ fontSize: '0.8rem' }}>{c.cliente_nit || '—'}</td>
                      <td>{c.venta_id || '—'}</td>
                      <td>{money(c.monto)}</td>
                      <td>{money(c.monto_pagado)}</td>
                      <td><b>{money(c.saldo)}</b></td>
                      <td style={{ fontSize: '0.78rem' }}>{c.vencimiento ? fecha(c.vencimiento) : '—'}</td>
                      <td>
                        <span className="pill" style={{
                          background: `${COLOR_ESTADO[c.estado] || '#8aa4c7'}22`,
                          color: COLOR_ESTADO[c.estado] || '#8aa4c7',
                        }}>{c.estado}</span>
                      </td>
                      <td style={{ fontSize: '0.76rem' }}>{fechaHora(c.creado_en)}</td>
                      <td>
                        {puedeGestionar && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {c.estado !== 'anulada' && c.saldo > 0 && (
                              <button className="btn btn-sm btn-success" onClick={() => setCobrar({
                                cuenta: c, monto: '', metodo_pago_id: '', cuenta_destino_id: '', observacion: '',
                              })}>Cobrar</button>
                            )}
                            {c.estado !== 'anulada' && c.saldo > 0 && (
                              <button className="btn btn-sm" onClick={() => void recordatorioCxc(c)}>Recordar</button>
                            )}
                            {c.estado !== 'anulada' && c.monto_pagado <= 0 && (
                              <button className="btn btn-sm btn-danger" onClick={() => void anularCxc(c)}>Anular</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!cxc.length && <tr><td colSpan={11} style={{ color: '#5f7095' }}>Sin cuentas por cobrar.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ===================== CxP ===================== */}
      {seccion === 'cxp' && (
        <>
          <section className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" type="date" style={{ maxWidth: 160 }} value={fCxp.desde}
                onChange={(e) => setFCxp({ ...fCxp, desde: e.target.value })} />
              <input className="input" type="date" style={{ maxWidth: 160 }} value={fCxp.hasta}
                onChange={(e) => setFCxp({ ...fCxp, hasta: e.target.value })} />
              <select className="input" style={{ maxWidth: 160 }} value={fCxp.estado}
                onChange={(e) => setFCxp({ ...fCxp, estado: e.target.value })}>
                <option value="">Todos los estados</option>
                <option value="pendiente">Pendientes</option>
                <option value="pagada">Pagadas</option>
                <option value="anulada">Anuladas</option>
              </select>
              <button className="btn btn-primary" onClick={() => void cargarCxp()}>Buscar</button>
              <button className="btn" onClick={() => void cargarAgingCxp()}>Aging 30/60/90</button>
              <button className="btn" onClick={() => void cargarRecordatoriosCxp()}>Recordatorios</button>
            </div>

            {agingCxp && (
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', marginTop: 12 }}>
                {BUCKETS.map((b) => (
                  <div key={b} className="card" style={{ padding: 10 }}>
                    <div style={{ fontWeight: 700 }}>{money(agingCxp.buckets[b] || 0)}</div>
                    <div style={{ color: '#8aa4c7', fontSize: '0.74rem' }}>{b}</div>
                  </div>
                ))}
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(agingCxp.total)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.74rem' }}>
                    Total · {agingCxp.cuentas} cuenta(s) · {agingCxp.proveedores ?? 0} proveedor(es)
                  </div>
                </div>
              </div>
            )}

            {recCxp && (
              <div style={{ marginTop: 12 }}>
                <h4 style={{ marginBottom: 6 }}>Recordatorios sugeridos ({recCxp.length})</h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.84rem' }}>
                  {recCxp.map((r) => (
                    <li key={r.id}>
                      #{r.id} · {r.proveedor || 'Proveedor'} · saldo <b>{money(r.saldo)}</b> ·{' '}
                      vencido hace {r.dias_vencido} día(s)
                    </li>
                  ))}
                  {!recCxp.length && <li style={{ color: '#5f7095' }}>Sin cuentas vencidas.</li>}
                </ul>
              </div>
            )}
          </section>

          <section className="card">
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr><th>#</th><th>Proveedor</th><th>Compra</th><th>Monto</th><th>Pagado</th><th>Saldo</th>
                    <th>Vence</th><th>Estado</th><th>Alta</th><th></th></tr>
                </thead>
                <tbody>
                  {cxp.map((c) => (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td>{c.proveedor || '—'}</td>
                      <td>{c.compra_id || '—'}</td>
                      <td>{money(c.monto)}</td>
                      <td>{money(c.monto_pagado)}</td>
                      <td><b>{money(c.saldo)}</b></td>
                      <td style={{ fontSize: '0.78rem' }}>{c.vencimiento ? fecha(c.vencimiento) : '—'}</td>
                      <td>
                        <span className="pill" style={{
                          background: `${COLOR_ESTADO[c.estado] || '#8aa4c7'}22`,
                          color: COLOR_ESTADO[c.estado] || '#8aa4c7',
                        }}>{c.estado}</span>
                      </td>
                      <td style={{ fontSize: '0.76rem' }}>{fechaHora(c.creado_en)}</td>
                      <td>
                        {puedeGestionar && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {c.estado !== 'anulada' && c.saldo > 0 && (
                              <button className="btn btn-sm btn-warn" onClick={() => setPagar({
                                cuenta: c, monto: '', metodo_pago_id: '', cuenta_destino_id: '', observacion: '',
                              })}>Pagar</button>
                            )}
                            {c.estado !== 'anulada' && c.saldo > 0 && (
                              <button className="btn btn-sm" onClick={() => void recordatorioCxp(c)}>Recordar</button>
                            )}
                            {c.estado !== 'anulada' && c.monto_pagado <= 0 && (
                              <button className="btn btn-sm btn-danger" onClick={() => void anularCxp(c)}>Anular</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!cxp.length && <tr><td colSpan={10} style={{ color: '#5f7095' }}>Sin cuentas por pagar.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ===================== Empresas ===================== */}
      {seccion === 'empresas' && (
        <>
          {puedeGestionar && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Nueva empresa</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input className="input" placeholder="Nombre *" style={{ flex: '1 1 200px' }}
                  value={nuevaEmpresa.nombre} onChange={(e) => setNuevaEmpresa({ ...nuevaEmpresa, nombre: e.target.value })} />
                <input className="input" placeholder="NIT" style={{ flex: '0 0 140px' }}
                  value={nuevaEmpresa.nit} onChange={(e) => setNuevaEmpresa({ ...nuevaEmpresa, nit: e.target.value })} />
                <input className="input" placeholder="Contacto" style={{ flex: '0 0 160px' }}
                  value={nuevaEmpresa.contacto} onChange={(e) => setNuevaEmpresa({ ...nuevaEmpresa, contacto: e.target.value })} />
                <input className="input" placeholder="Teléfono" style={{ flex: '0 0 140px' }}
                  value={nuevaEmpresa.telefono} onChange={(e) => setNuevaEmpresa({ ...nuevaEmpresa, telefono: e.target.value })} />
                <input className="input" placeholder="Email" style={{ flex: '1 1 180px' }}
                  value={nuevaEmpresa.email} onChange={(e) => setNuevaEmpresa({ ...nuevaEmpresa, email: e.target.value })} />
                <input className="input" placeholder="Dirección" style={{ flex: '1 1 180px' }}
                  value={nuevaEmpresa.direccion} onChange={(e) => setNuevaEmpresa({ ...nuevaEmpresa, direccion: e.target.value })} />
                <button className="btn btn-primary" onClick={() => void crearEmpresa()}>Crear</button>
              </div>
            </section>
          )}
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Empresas ({empresas.length})</h3>
            <table className="tbl">
              <thead>
                <tr><th>Nombre</th><th>NIT</th><th>Contacto</th><th>Teléfono</th><th>Email</th>
                  <th>Dirección</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.id} style={e.activo ? undefined : { opacity: 0.55 }}>
                    <td>{e.nombre}</td>
                    <td>{e.nit || '—'}</td>
                    <td>{e.contacto || '—'}</td>
                    <td>{e.telefono || '—'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{e.email || '—'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{e.direccion || '—'}</td>
                    <td>{e.activo ? 'Sí' : 'No'}</td>
                    <td>
                      {puedeGestionar && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn btn-sm" onClick={() => setEditEmpresa({ ...e })}>Editar</button>
                          {e.activo && (
                            <button className="btn btn-sm btn-danger" onClick={() => void bajaEmpresa(e)}>Baja</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!empresas.length && <tr><td colSpan={8} style={{ color: '#5f7095' }}>Sin empresas.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* ===================== Convenios ===================== */}
      {seccion === 'convenios' && (
        <>
          {puedeGestionar && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Nuevo convenio</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select className="input" style={{ flex: '1 1 200px' }} value={nuevoConvenio.empresa_id}
                  onChange={(e) => setNuevoConvenio({ ...nuevoConvenio, empresa_id: e.target.value })}>
                  <option value="">Empresa *</option>
                  {empresas.filter((e) => e.activo).map((e) => (
                    <option key={e.id} value={e.id}>{e.nombre}</option>
                  ))}
                </select>
                <input className="input" type="number" step="0.01" placeholder="Tarifa especial" style={{ flex: '0 0 160px' }}
                  value={nuevoConvenio.tarifa_especial}
                  onChange={(e) => setNuevoConvenio({ ...nuevoConvenio, tarifa_especial: e.target.value })} />
                <input className="input" type="number" placeholder="Cupo mensual" style={{ flex: '0 0 150px' }}
                  value={nuevoConvenio.cupo_mensual}
                  onChange={(e) => setNuevoConvenio({ ...nuevoConvenio, cupo_mensual: e.target.value })} />
                <input className="input" type="date" title="Vigencia desde" style={{ maxWidth: 160 }}
                  value={nuevoConvenio.vigencia_desde}
                  onChange={(e) => setNuevoConvenio({ ...nuevoConvenio, vigencia_desde: e.target.value })} />
                <input className="input" type="date" title="Vigencia hasta" style={{ maxWidth: 160 }}
                  value={nuevoConvenio.vigencia_hasta}
                  onChange={(e) => setNuevoConvenio({ ...nuevoConvenio, vigencia_hasta: e.target.value })} />
                <button className="btn btn-primary" onClick={() => void crearConvenio()}>Crear</button>
              </div>
            </section>
          )}
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Convenios ({convenios.length})</h3>
            <table className="tbl">
              <thead>
                <tr><th>Empresa</th><th>NIT</th><th>Tarifa especial</th><th>Cupo mensual</th>
                  <th>Vigencia</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {convenios.map((c) => (
                  <tr key={c.id} style={c.activo ? undefined : { opacity: 0.55 }}>
                    <td>{c.empresa || `Empresa #${c.empresa_id}`}</td>
                    <td>{c.empresa_nit || '—'}</td>
                    <td>{c.tarifa_especial == null ? '—' : money(c.tarifa_especial)}</td>
                    <td>{c.cupo_mensual == null ? '—' : c.cupo_mensual}</td>
                    <td style={{ fontSize: '0.78rem' }}>
                      {c.vigencia_desde ? fecha(c.vigencia_desde) : '—'} → {c.vigencia_hasta ? fecha(c.vigencia_hasta) : '—'}
                    </td>
                    <td>{c.activo ? 'Sí' : 'No'}</td>
                    <td>
                      {puedeGestionar && c.activo && (
                        <button className="btn btn-sm btn-danger" onClick={() => void bajaConvenio(c)}>Baja</button>
                      )}
                    </td>
                  </tr>
                ))}
                {!convenios.length && <tr><td colSpan={7} style={{ color: '#5f7095' }}>Sin convenios.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* Modales de cobro / pago */}
      {cobrar && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 480 }}>
            <h3 style={{ marginTop: 0 }}>Cobrar CxC #{cobrar.cuenta.id}</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              Saldo pendiente: <b>{money(cobrar.cuenta.saldo)}</b>. Deja el monto vacío para cobrar
              el saldo completo (también admite cobros parciales).
            </p>
            <input className="input" type="number" step="0.01" placeholder="Monto (opcional)"
              value={cobrar.monto} onChange={(e) => setCobrar({ ...cobrar, monto: e.target.value })} />
            <select className="input" style={{ marginTop: 8 }} value={cobrar.metodo_pago_id}
              onChange={(e) => setCobrar({ ...cobrar, metodo_pago_id: e.target.value })}>
              <option value="">Método de pago</option>
              {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.tipo})</option>)}
            </select>
            <select className="input" style={{ marginTop: 8 }} value={cobrar.cuenta_destino_id}
              onChange={(e) => setCobrar({ ...cobrar, cuenta_destino_id: e.target.value })}>
              <option value="">Cuenta destino (opcional)</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input className="input" placeholder="Observación" style={{ marginTop: 8 }} value={cobrar.observacion}
              onChange={(e) => setCobrar({ ...cobrar, observacion: e.target.value })} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => void confirmarCobro()}>Cobrar</button>
              <button className="btn" onClick={() => setCobrar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {pagar && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 480 }}>
            <h3 style={{ marginTop: 0 }}>Pagar CxP #{pagar.cuenta.id}</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              Saldo pendiente: <b>{money(pagar.cuenta.saldo)}</b>. Deja el monto vacío para pagar el
              saldo completo.
            </p>
            <input className="input" type="number" step="0.01" placeholder="Monto (opcional)"
              value={pagar.monto} onChange={(e) => setPagar({ ...pagar, monto: e.target.value })} />
            <select className="input" style={{ marginTop: 8 }} value={pagar.metodo_pago_id}
              onChange={(e) => setPagar({ ...pagar, metodo_pago_id: e.target.value })}>
              <option value="">Método de pago</option>
              {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.tipo})</option>)}
            </select>
            <select className="input" style={{ marginTop: 8 }} value={pagar.cuenta_destino_id}
              onChange={(e) => setPagar({ ...pagar, cuenta_destino_id: e.target.value })}>
              <option value="">Cuenta destino (opcional)</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input className="input" placeholder="Observación" style={{ marginTop: 8 }} value={pagar.observacion}
              onChange={(e) => setPagar({ ...pagar, observacion: e.target.value })} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => void confirmarPago()}>Pagar</button>
              <button className="btn" onClick={() => setPagar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal edición de empresa */}
      {editEmpresa && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 520 }}>
            <h3 style={{ marginTop: 0 }}>Editar empresa</h3>
            <input className="input" placeholder="Nombre" value={editEmpresa.nombre}
              onChange={(e) => setEditEmpresa({ ...editEmpresa, nombre: e.target.value })} />
            <input className="input" placeholder="NIT" style={{ marginTop: 8 }} value={editEmpresa.nit || ''}
              onChange={(e) => setEditEmpresa({ ...editEmpresa, nit: e.target.value })} />
            <input className="input" placeholder="Contacto" style={{ marginTop: 8 }} value={editEmpresa.contacto || ''}
              onChange={(e) => setEditEmpresa({ ...editEmpresa, contacto: e.target.value })} />
            <input className="input" placeholder="Teléfono" style={{ marginTop: 8 }} value={editEmpresa.telefono || ''}
              onChange={(e) => setEditEmpresa({ ...editEmpresa, telefono: e.target.value })} />
            <input className="input" placeholder="Email" style={{ marginTop: 8 }} value={editEmpresa.email || ''}
              onChange={(e) => setEditEmpresa({ ...editEmpresa, email: e.target.value })} />
            <input className="input" placeholder="Dirección" style={{ marginTop: 8 }} value={editEmpresa.direccion || ''}
              onChange={(e) => setEditEmpresa({ ...editEmpresa, direccion: e.target.value })} />
            <label style={{ color: '#8aa4c7', fontSize: '0.82rem', display: 'flex', gap: 6, marginTop: 10 }}>
              <input type="checkbox" checked={editEmpresa.activo}
                onChange={(e) => setEditEmpresa({ ...editEmpresa, activo: e.target.checked })} />
              Activa
            </label>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => void guardarEmpresa()}>Guardar</button>
              <button className="btn" onClick={() => setEditEmpresa(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
