// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Asientos y contabilidad general
// -----------------------------------------------------------------------------
//   GET  /api/conta/contabilidad/cuentas              plan de cuentas
//   GET  /api/conta/contabilidad/asientos             libro diario (filtros)
//   GET  /api/conta/contabilidad/asientos/:id         asiento + líneas
//   POST /api/conta/contabilidad/asientos             asiento manual
//   POST /api/conta/contabilidad/asientos/:id/anular
//   GET  /api/conta/contabilidad/libro-diario         diario con líneas
//   GET  /api/conta/contabilidad/libro-mayor          mayor por cuenta
//   GET  /api/conta/contabilidad/balance-general      balance a una fecha
//   GET  /api/conta/contabilidad/estado-resultados    resultado del período
//
// Todo asiento cuadra (debe = haber); los reportes leen los asientos registrados
// y nunca recalculan la operación original.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { fecha, haceISO, hoyISO, money } from './comun';

interface CuentaContable {
  id: number; codigo: string; nombre: string; tipo: string; activo: boolean;
}

interface Asiento {
  id: number; fecha: string; tipo: string; descripcion: string;
  referencia_tipo: string | null; referencia_id: number | null;
  total_debe: number; total_haber: number; estado: string;
  creado_por_nombre?: string | null; n_lineas?: number;
}

interface LineaAsiento {
  id: number; asiento_id?: number; cuenta_contable: string; cuenta_nombre?: string | null;
  debe: number; haber: number; descripcion: string | null;
}

interface DetalleAsiento { asiento: Asiento; lineas: LineaAsiento[] }

interface LibroDiario {
  desde: string; hasta: string;
  asientos: (Asiento & { lineas: LineaAsiento[] })[];
  resumen: { asientos: number; total_debe: number; total_haber: number };
}

interface MovMayor extends LineaAsiento {
  codigo?: string; nombre?: string; tipo?: string; fecha?: string; asiento_id?: number;
  asiento_descripcion?: string;
}

interface CuentaMayor {
  codigo: string; nombre: string; tipo: string; deudora: boolean;
  movimientos: MovMayor[]; total_debe: number; total_haber: number; saldo: number;
}

interface LibroMayor { desde: string; hasta: string; cuentas: CuentaMayor[] }

interface SaldoCuenta {
  codigo: string; nombre: string; tipo: string; debe: number; haber: number;
  saldo: number; deudora: boolean;
}

interface Balance {
  fecha: string; activo: SaldoCuenta[]; pasivo: SaldoCuenta[]; patrimonio: SaldoCuenta[];
  resumen: {
    total_activo: number; total_pasivo: number; total_patrimonio: number;
    resultado_ejercicio: number; total_pasivo_patrimonio: number; cuadra: boolean;
  };
}

interface Resultados {
  desde: string; hasta: string; ingresos: SaldoCuenta[]; costos: SaldoCuenta[]; gastos: SaldoCuenta[];
  resumen: {
    total_ingresos: number; total_costos: number; utilidad_bruta: number;
    total_gastos: number; resultado_neto: number; margen: number;
  };
}

interface LineaForm { cuenta: string; debe: string; haber: string; descripcion: string }

const LINEA_VACIA: LineaForm = { cuenta: '', debe: '', haber: '', descripcion: '' };

const COLOR_ESTADO: Record<string, string> = { registrado: '#22c55e', anulado: '#ef4444' };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tabla de saldos por cuenta (balance / resultados). */
function TablaSaldos({ titulo, filas, total }: { titulo: string; filas: SaldoCuenta[]; total: number }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h4 style={{ marginBottom: 6 }}>{titulo}</h4>
      <table className="tbl">
        <thead><tr><th>Código</th><th>Cuenta</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.codigo}>
              <td>{f.codigo}</td>
              <td>{f.nombre}</td>
              <td>{money(f.debe)}</td>
              <td>{money(f.haber)}</td>
              <td><b>{money(f.saldo)}</b></td>
            </tr>
          ))}
          {!filas.length && <tr><td colSpan={5} style={{ color: '#5f7095' }}>Sin movimientos.</td></tr>}
          <tr>
            <td colSpan={4} style={{ textAlign: 'right' }}><b>Total</b></td>
            <td><b>{money(total)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Asientos({ ok, soloLectura, puedeGestion }: {
  ok: (m: string) => void; soloLectura: boolean; puedeGestion: boolean;
}) {
  const puedeGestionar = !soloLectura && puedeGestion;

  const [seccion, setSeccion] = useState<
    'asientos' | 'plan' | 'libro-diario' | 'libro-mayor' | 'balance' | 'resultados'
  >('asientos');
  const [error, setError] = useState('');

  const [cuentas, setCuentas] = useState<CuentaContable[]>([]);

  // Asientos
  const [fAs, setFAs] = useState({
    desde: haceISO(30), hasta: hoyISO(), referencia_tipo: '', estado: '', tipo: '',
  });
  const [asientos, setAsientos] = useState<Asiento[]>([]);
  const [detalle, setDetalle] = useState<DetalleAsiento | null>(null);
  const [nuevo, setNuevo] = useState({ fecha: hoyISO(), descripcion: '', tipo: 'manual' });
  const [lineas, setLineas] = useState<LineaForm[]>([{ ...LINEA_VACIA }]);

  // Libro diario
  const [fd, setFd] = useState({ desde: haceISO(30), hasta: hoyISO() });
  const [diario, setDiario] = useState<LibroDiario | null>(null);

  // Libro mayor
  const [fm, setFm] = useState({ desde: haceISO(30), hasta: hoyISO(), cuenta: '' });
  const [mayor, setMayor] = useState<LibroMayor | null>(null);

  // Balance
  const [fBalance, setFBalance] = useState(hoyISO());
  const [balance, setBalance] = useState<Balance | null>(null);

  // Estado de resultados
  const [fr, setFr] = useState({ desde: `${hoyISO().slice(0, 4)}-01-01`, hasta: hoyISO() });
  const [resultados, setResultados] = useState<Resultados | null>(null);

  const cargarAsientos = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(fAs).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setAsientos(await contaApi<Asiento[]>(`/api/conta/contabilidad/asientos?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [fAs]);

  useEffect(() => { void cargarAsientos(); }, [cargarAsientos]);

  useEffect(() => {
    (async () => {
      try { setCuentas(await contaApi<CuentaContable[]>('/api/conta/contabilidad/cuentas?activo=true')); }
      catch { /* plan de cuentas opcional */ }
    })();
  }, []);

  const verDetalle = async (id: number) => {
    try { setDetalle(await contaApi<DetalleAsiento>(`/api/conta/contabilidad/asientos/${id}`)); }
    catch (e) { setError(errMsg(e)); }
  };

  const crearAsiento = async () => {
    setError('');
    if (!nuevo.descripcion.trim()) { setError('La descripción es obligatoria.'); return; }
    const cuerpo = lineas
      .filter((l) => l.cuenta && (Number(l.debe) > 0 || Number(l.haber) > 0))
      .map((l) => ({
        cuenta: l.cuenta,
        debe: Number(l.debe) || 0,
        haber: Number(l.haber) || 0,
        descripcion: l.descripcion || null,
      }));
    if (!cuerpo.length) { setError('El asiento debe tener al menos una línea con importe.'); return; }
    const debe = cuerpo.reduce((a, l) => a + l.debe, 0);
    const haber = cuerpo.reduce((a, l) => a + l.haber, 0);
    if (Math.abs(debe - haber) > 0.02) {
      setError(`El asiento no cuadra: debe ${money(debe)} ≠ haber ${money(haber)}.`);
      return;
    }
    try {
      await contaApi('/api/conta/contabilidad/asientos', {
        method: 'POST',
        body: { fecha: nuevo.fecha, descripcion: nuevo.descripcion.trim(), tipo: 'manual', lineas: cuerpo },
      });
      ok('Asiento manual registrado.');
      setNuevo({ fecha: hoyISO(), descripcion: '', tipo: 'manual' });
      setLineas([{ ...LINEA_VACIA }]);
      await cargarAsientos();
    } catch (e) { setError(errMsg(e)); }
  };

  const anularAsiento = async (a: Asiento) => {
    const motivo = window.prompt(`Motivo de anulación del asiento #${a.id} (obligatorio):`);
    if (!motivo) return;
    try {
      await contaApi(`/api/conta/contabilidad/asientos/${a.id}/anular`, { method: 'POST', body: { motivo } });
      ok(`Asiento #${a.id} anulado.`);
      await cargarAsientos();
    } catch (e) { setError(errMsg(e)); }
  };

  const cargarDiario = async () => {
    try {
      const qs = new URLSearchParams(fd);
      setDiario(await contaApi<LibroDiario>(`/api/conta/contabilidad/libro-diario?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  };

  const cargarMayor = async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(fm).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setMayor(await contaApi<LibroMayor>(`/api/conta/contabilidad/libro-mayor?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  };

  const cargarBalance = async () => {
    try {
      setBalance(await contaApi<Balance>(`/api/conta/contabilidad/balance-general?fecha=${fBalance}`));
    } catch (e) { setError(errMsg(e)); }
  };

  const cargarResultados = async () => {
    try {
      const qs = new URLSearchParams(fr);
      setResultados(await contaApi<Resultados>(`/api/conta/contabilidad/estado-resultados?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  };

  const sumDebe = lineas.reduce((a, l) => a + (Number(l.debe) || 0), 0);
  const sumHaber = lineas.reduce((a, l) => a + (Number(l.haber) || 0), 0);

  return (
    <>
      {error && <p className="card" style={{ color: '#ef4444', padding: 12, marginBottom: 12 }}>{error}</p>}

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {([['asientos', 'Asientos'], ['plan', 'Plan de cuentas'],
          ['libro-diario', 'Libro Diario'], ['libro-mayor', 'Libro Mayor'],
          ['balance', 'Balance General'], ['resultados', 'Estado de Resultados']] as const)
          .map(([k, etiqueta]) => (
            <button key={k} className={`btn ${seccion === k ? 'btn-primary' : ''}`}
              onClick={() => setSeccion(k)}>{etiqueta}</button>
          ))}
      </div>

      {/* ===================== Asientos ===================== */}
      {seccion === 'asientos' && (
        <>
          {puedeGestionar && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Asiento manual</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input className="input" type="date" style={{ maxWidth: 160 }} value={nuevo.fecha}
                  onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} />
                <input className="input" placeholder="Descripción *" style={{ flex: '1 1 320px' }}
                  value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
              </div>
              <table className="tbl" style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>Cuenta</th><th>Debe</th><th>Haber</th><th>Descripción</th><th></th></tr>
                </thead>
                <tbody>
                  {lineas.map((l, idx) => (
                    <tr key={idx}>
                      <td>
                        <select className="input" value={l.cuenta}
                          onChange={(e) => setLineas(lineas.map((x, i) =>
                            i === idx ? { ...x, cuenta: e.target.value } : x))}>
                          <option value="">Selecciona cuenta</option>
                          {cuentas.map((c) => (
                            <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input className="input" type="number" step="0.01" style={{ maxWidth: 120 }} value={l.debe}
                          onChange={(e) => setLineas(lineas.map((x, i) =>
                            i === idx ? { ...x, debe: e.target.value } : x))} />
                      </td>
                      <td>
                        <input className="input" type="number" step="0.01" style={{ maxWidth: 120 }} value={l.haber}
                          onChange={(e) => setLineas(lineas.map((x, i) =>
                            i === idx ? { ...x, haber: e.target.value } : x))} />
                      </td>
                      <td>
                        <input className="input" placeholder="Detalle" value={l.descripcion}
                          onChange={(e) => setLineas(lineas.map((x, i) =>
                            i === idx ? { ...x, descripcion: e.target.value } : x))} />
                      </td>
                      <td>
                        <button className="btn btn-sm btn-danger"
                          onClick={() => setLineas(lineas.filter((_, i) => i !== idx))}>Quitar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
                <button className="btn btn-sm" onClick={() => setLineas([...lineas, { ...LINEA_VACIA }])}>
                  Añadir línea
                </button>
                <span style={{ fontSize: '0.84rem', color: Math.abs(sumDebe - sumHaber) <= 0.02 ? '#22c55e' : '#ef4444' }}>
                  Debe <b>{money(sumDebe)}</b> · Haber <b>{money(sumHaber)}</b>{' '}
                  {Math.abs(sumDebe - sumHaber) <= 0.02 ? '(cuadra)' : '(descuadrado)'}
                </span>
                <button className="btn btn-primary" onClick={() => void crearAsiento()}>Registrar asiento</button>
              </div>
            </section>
          )}

          <section className="card">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" type="date" style={{ maxWidth: 160 }} value={fAs.desde}
                onChange={(e) => setFAs({ ...fAs, desde: e.target.value })} />
              <input className="input" type="date" style={{ maxWidth: 160 }} value={fAs.hasta}
                onChange={(e) => setFAs({ ...fAs, hasta: e.target.value })} />
              <select className="input" style={{ maxWidth: 170 }} value={fAs.referencia_tipo}
                onChange={(e) => setFAs({ ...fAs, referencia_tipo: e.target.value })}>
                <option value="">Toda referencia</option>
                <option value="venta">Venta</option>
                <option value="compra">Compra</option>
                <option value="cxc">CxC</option>
                <option value="cxp">CxP</option>
                <option value="nomina">Nómina</option>
                <option value="depreciacion">Depreciación</option>
                <option value="nota_credito">Nota de crédito</option>
                <option value="manual">Manual</option>
              </select>
              <select className="input" style={{ maxWidth: 150 }} value={fAs.estado}
                onChange={(e) => setFAs({ ...fAs, estado: e.target.value })}>
                <option value="">Todos los estados</option>
                <option value="registrado">Registrados</option>
                <option value="anulado">Anulados</option>
              </select>
              <select className="input" style={{ maxWidth: 150 }} value={fAs.tipo}
                onChange={(e) => setFAs({ ...fAs, tipo: e.target.value })}>
                <option value="">Todos los tipos</option>
                <option value="automatico">Automáticos</option>
                <option value="manual">Manuales</option>
              </select>
              <button className="btn btn-primary" onClick={() => void cargarAsientos()}>Buscar</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>#</th><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Referencia</th>
                    <th>Líneas</th><th>Debe</th><th>Haber</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {asientos.map((a) => (
                    <tr key={a.id}>
                      <td>{a.id}</td>
                      <td style={{ fontSize: '0.8rem' }}>{fecha(a.fecha)}</td>
                      <td style={{ fontSize: '0.84rem' }}>{a.descripcion}</td>
                      <td>{a.tipo}</td>
                      <td style={{ fontSize: '0.78rem' }}>
                        {a.referencia_id ? `${a.referencia_tipo || '—'}#${a.referencia_id}` : (a.referencia_tipo || '—')}
                      </td>
                      <td>{a.n_lineas ?? '—'}</td>
                      <td>{money(a.total_debe)}</td>
                      <td>{money(a.total_haber)}</td>
                      <td>
                        <span className="pill" style={{
                          background: `${COLOR_ESTADO[a.estado] || '#8aa4c7'}22`,
                          color: COLOR_ESTADO[a.estado] || '#8aa4c7',
                        }}>{a.estado}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn btn-sm" onClick={() => void verDetalle(a.id)}>Ver</button>
                          {puedeGestionar && a.estado === 'registrado' && (
                            <button className="btn btn-sm btn-danger" onClick={() => void anularAsiento(a)}>Anular</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!asientos.length && <tr><td colSpan={10} style={{ color: '#5f7095' }}>Sin asientos.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ===================== Plan de cuentas ===================== */}
      {seccion === 'plan' && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Plan de cuentas ({cuentas.length})</h3>
          <table className="tbl">
            <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Estado</th></tr></thead>
            <tbody>
              {cuentas.map((c) => (
                <tr key={c.id}>
                  <td>{c.codigo}</td>
                  <td>{c.nombre}</td>
                  <td>{c.tipo}</td>
                  <td>{c.activo ? 'Sí' : 'No'}</td>
                </tr>
              ))}
              {!cuentas.length && <tr><td colSpan={4} style={{ color: '#5f7095' }}>Sin cuentas contables.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {/* ===================== Libro Diario ===================== */}
      {seccion === 'libro-diario' && (
        <section className="card">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" type="date" style={{ maxWidth: 160 }} value={fd.desde}
              onChange={(e) => setFd({ ...fd, desde: e.target.value })} />
            <input className="input" type="date" style={{ maxWidth: 160 }} value={fd.hasta}
              onChange={(e) => setFd({ ...fd, hasta: e.target.value })} />
            <button className="btn btn-primary" onClick={() => void cargarDiario()}>Generar</button>
          </div>

          {diario && (
            <>
              <p style={{ color: '#8aa4c7', fontSize: '0.82rem', marginTop: 12 }}>
                {fecha(diario.desde)} → {fecha(diario.hasta)} · {diario.resumen.asientos} asiento(s) ·
                debe <b>{money(diario.resumen.total_debe)}</b> · haber <b>{money(diario.resumen.total_haber)}</b>
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>Asiento</th><th>Fecha</th><th>Cuenta</th><th>Descripción</th><th>Debe</th><th>Haber</th></tr></thead>
                  <tbody>
                    {diario.asientos.map((a) => a.lineas.map((l, i) => (
                      <tr key={`${a.id}-${l.id}-${i}`}>
                        <td>{i === 0 ? `#${a.id}` : ''}</td>
                        <td style={{ fontSize: '0.78rem' }}>{i === 0 ? fecha(a.fecha) : ''}</td>
                        <td style={{ fontSize: '0.8rem' }}>{l.cuenta_contable} · {l.cuenta_nombre || ''}</td>
                        <td style={{ fontSize: '0.8rem' }}>{l.descripcion || a.descripcion}</td>
                        <td>{l.debe ? money(l.debe) : ''}</td>
                        <td>{l.haber ? money(l.haber) : ''}</td>
                      </tr>
                    )))}
                    {!diario.asientos.length && (
                      <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin asientos registrados en el período.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!diario && (
            <p style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>Pulsa «Generar» para ver el libro diario.</p>
          )}
        </section>
      )}

      {/* ===================== Libro Mayor ===================== */}
      {seccion === 'libro-mayor' && (
        <section className="card">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" type="date" style={{ maxWidth: 160 }} value={fm.desde}
              onChange={(e) => setFm({ ...fm, desde: e.target.value })} />
            <input className="input" type="date" style={{ maxWidth: 160 }} value={fm.hasta}
              onChange={(e) => setFm({ ...fm, hasta: e.target.value })} />
            <select className="input" style={{ flex: '1 1 220px' }} value={fm.cuenta}
              onChange={(e) => setFm({ ...fm, cuenta: e.target.value })}>
              <option value="">Todas las cuentas</option>
              {cuentas.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
            </select>
            <button className="btn btn-primary" onClick={() => void cargarMayor()}>Generar</button>
          </div>

          {mayor && (
            <div style={{ marginTop: 14 }}>
              {mayor.cuentas.map((c) => (
                <div key={c.codigo} className="card" style={{ marginBottom: 14 }}>
                  <h4 style={{ marginTop: 0 }}>
                    {c.codigo} · {c.nombre}{' '}
                    <span style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>
                      ({c.tipo}{c.deudora ? ', deudora' : ', acreedora'}) · saldo <b>{money(c.saldo)}</b>
                    </span>
                  </h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="tbl">
                      <thead><tr><th>Fecha</th><th>Asiento</th><th>Descripción</th><th>Debe</th><th>Haber</th></tr></thead>
                      <tbody>
                        {c.movimientos.map((m, i) => (
                          <tr key={i}>
                            <td style={{ fontSize: '0.78rem' }}>{m.fecha ? fecha(m.fecha) : '—'}</td>
                            <td>#{m.asiento_id ?? '—'}</td>
                            <td style={{ fontSize: '0.8rem' }}>{m.descripcion || m.asiento_descripcion || '—'}</td>
                            <td>{m.debe ? money(m.debe) : ''}</td>
                            <td>{m.haber ? money(m.haber) : ''}</td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={3} style={{ textAlign: 'right' }}><b>Totales</b></td>
                          <td><b>{money(c.total_debe)}</b></td>
                          <td><b>{money(c.total_haber)}</b></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              {!mayor.cuentas.length && (
                <p style={{ color: '#5f7095' }}>Sin movimientos para el filtro seleccionado.</p>
              )}
            </div>
          )}
          {!mayor && (
            <p style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>Pulsa «Generar» para ver el libro mayor.</p>
          )}
        </section>
      )}

      {/* ===================== Balance General ===================== */}
      {seccion === 'balance' && (
        <section className="card">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" type="date" style={{ maxWidth: 170 }} value={fBalance}
              onChange={(e) => setFBalance(e.target.value)} />
            <button className="btn btn-primary" onClick={() => void cargarBalance()}>Generar balance</button>
          </div>

          {balance && (
            <>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', marginTop: 14 }}>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(balance.resumen.total_activo)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Total activo</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(balance.resumen.total_pasivo)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Total pasivo</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(balance.resumen.total_patrimonio)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Patrimonio (incluye resultado)</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700, color: balance.resumen.cuadra ? '#22c55e' : '#ef4444' }}>
                    {balance.resumen.cuadra ? 'Cuadra' : 'No cuadra'}
                  </div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>
                    Pasivo + Patrimonio: {money(balance.resumen.total_pasivo_patrimonio)}
                  </div>
                </div>
              </div>
              <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>Al {fecha(balance.fecha)}</p>
              <TablaSaldos titulo="ACTIVO" filas={balance.activo} total={balance.resumen.total_activo} />
              <TablaSaldos titulo="PASIVO" filas={balance.pasivo} total={balance.resumen.total_pasivo} />
              <TablaSaldos titulo="PATRIMONIO" filas={balance.patrimonio} total={balance.resumen.total_patrimonio} />
            </>
          )}
          {!balance && (
            <p style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>Pulsa «Generar balance» para ver el informe.</p>
          )}
        </section>
      )}

      {/* ===================== Estado de Resultados ===================== */}
      {seccion === 'resultados' && (
        <section className="card">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" type="date" style={{ maxWidth: 160 }} value={fr.desde}
              onChange={(e) => setFr({ ...fr, desde: e.target.value })} />
            <input className="input" type="date" style={{ maxWidth: 160 }} value={fr.hasta}
              onChange={(e) => setFr({ ...fr, hasta: e.target.value })} />
            <button className="btn btn-primary" onClick={() => void cargarResultados()}>Generar</button>
          </div>

          {resultados && (
            <>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', marginTop: 14 }}>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(resultados.resumen.total_ingresos)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Ingresos</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(resultados.resumen.total_costos)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Costos</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(resultados.resumen.utilidad_bruta)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Utilidad bruta</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(resultados.resumen.total_gastos)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Gastos</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{
                    fontWeight: 700,
                    color: resultados.resumen.resultado_neto >= 0 ? '#22c55e' : '#ef4444',
                  }}>{money(resultados.resumen.resultado_neto)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>
                    Resultado neto · margen {resultados.resumen.margen}%
                  </div>
                </div>
              </div>
              <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
                {fecha(resultados.desde)} → {fecha(resultados.hasta)}
              </p>
              <TablaSaldos titulo="INGRESOS" filas={resultados.ingresos} total={resultados.resumen.total_ingresos} />
              <TablaSaldos titulo="COSTOS" filas={resultados.costos} total={resultados.resumen.total_costos} />
              <TablaSaldos titulo="GASTOS" filas={resultados.gastos} total={resultados.resumen.total_gastos} />
            </>
          )}
          {!resultados && (
            <p style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>Pulsa «Generar» para ver el estado de resultados.</p>
          )}
        </section>
      )}

      {/* Modal detalle de asiento */}
      {detalle && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 720, maxHeight: '84vh', overflow: 'auto' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ marginTop: 0 }}>Asiento #{detalle.asiento.id}</h3>
              <button className="btn btn-sm" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              {fecha(detalle.asiento.fecha)} · {detalle.asiento.tipo} · {detalle.asiento.estado} ·{' '}
              {detalle.asiento.referencia_id
                ? `${detalle.asiento.referencia_tipo}#${detalle.asiento.referencia_id}`
                : (detalle.asiento.referencia_tipo || 'sin referencia')}
              {detalle.asiento.creado_por_nombre ? ` · por ${detalle.asiento.creado_por_nombre}` : ''}
            </p>
            <p style={{ fontSize: '0.86rem' }}><b>{detalle.asiento.descripcion}</b></p>
            <table className="tbl">
              <thead><tr><th>Cuenta</th><th>Descripción</th><th>Debe</th><th>Haber</th></tr></thead>
              <tbody>
                {detalle.lineas.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontSize: '0.8rem' }}>{l.cuenta_contable} · {l.cuenta_nombre || ''}</td>
                    <td style={{ fontSize: '0.8rem' }}>{l.descripcion || '—'}</td>
                    <td>{l.debe ? money(l.debe) : ''}</td>
                    <td>{l.haber ? money(l.haber) : ''}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} style={{ textAlign: 'right' }}><b>Totales</b></td>
                  <td><b>{money(detalle.asiento.total_debe)}</b></td>
                  <td><b>{money(detalle.asiento.total_haber)}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
