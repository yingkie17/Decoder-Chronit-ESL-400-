// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Nómina y adelantos
// -----------------------------------------------------------------------------
//   ADELANTOS  GET/POST /api/conta/nomina/adelantos, POST /:id/anular
//   NÓMINA     GET /api/conta/nomina, GET /:id, POST /, /:id/aprobar,
//              /:id/pagar, /:id/anular, GET /:id/recibo.pdf
//
// REGLA: total_pagar = sueldo_base + bonos + propinas_incluidas − descuentos
//        − adelantos. El recibo lee el snapshot de la fila.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi, contaDescargar } from '@/lib/api';
import { fecha, fechaHora, hoyISO, money } from './comun';

interface Usuario {
  id: number; nombre: string; apellido: string; carnet: string; rol: string; activo?: boolean;
}

interface Adelanto {
  id: number; usuario_id: number; usuario?: string | null; carnet?: string | null;
  monto: number; motivo: string | null; estado: string; nomina_id?: number | null; creado_en: string;
}

interface Nomina {
  id: number; usuario_id: number; usuario?: string | null; carnet?: string | null;
  periodo_desde: string; periodo_hasta: string; sueldo_base: number; bonos: number;
  propinas_incluidas: number; descuentos: number; adelantos: number; total_pagar: number;
  estado: string; pagado_en?: string | null; creado_en: string;
}

interface DetalleNomina {
  nomina: Nomina;
  adelantos: { id: number; monto: number; motivo: string | null; estado: string; creado_en: string }[];
}

interface MetodoPago { id: number; nombre: string; tipo: string }

const COLOR_ESTADO: Record<string, string> = {
  borrador: '#f59e0b', aprobada: '#3b82f6', pagada: '#22c55e', anulada: '#ef4444',
  pendiente: '#f59e0b', descontado: '#22c55e', anulado: '#ef4444',
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const nombreUsuario = (u: Usuario) =>
  `${u.nombre || ''} ${u.apellido || ''}`.trim() || `Usuario #${u.id}`;

export default function Nomina({ ok, soloLectura, puedeGestion }: {
  ok: (m: string) => void; soloLectura: boolean; puedeGestion: boolean;
}) {
  const puedeGestionar = !soloLectura && puedeGestion;

  const [seccion, setSeccion] = useState<'adelantos' | 'nomina'>('nomina');
  const [error, setError] = useState('');
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [metodos, setMetodos] = useState<MetodoPago[]>([]);

  // Adelantos
  const [fAdel, setFAdel] = useState({ usuario_id: '', estado: '' });
  const [adelantos, setAdelantos] = useState<Adelanto[]>([]);
  const [nuevoAdel, setNuevoAdel] = useState({ usuario_id: '', monto: '', motivo: '' });

  // Nómina
  const [fNom, setFNom] = useState({ usuario_id: '', estado: '', desde: '', hasta: '' });
  const [nominas, setNominas] = useState<Nomina[]>([]);
  const [nueva, setNueva] = useState({
    usuario_id: '', periodo_desde: hoyISO().slice(0, 8) + '01', periodo_hasta: hoyISO(),
    sueldo_base: '', bonos: '', descuentos: '', incluir_propinas: true, incluir_adelantos: true,
  });
  const [pagar, setPagar] = useState<{ nomina: Nomina; metodo_pago_id: string } | null>(null);
  const [detalle, setDetalle] = useState<DetalleNomina | null>(null);

  const cargarAdelantos = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(fAdel).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setAdelantos(await contaApi<Adelanto[]>(`/api/conta/nomina/adelantos?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [fAdel]);

  const cargarNominas = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(fNom).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setNominas(await contaApi<Nomina[]>(`/api/conta/nomina?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [fNom]);

  useEffect(() => { void cargarAdelantos(); }, [cargarAdelantos]);
  useEffect(() => { void cargarNominas(); }, [cargarNominas]);

  useEffect(() => {
    (async () => {
      try {
        const us = await contaApi<Usuario[]>('/api/conta/usuarios?activo=true');
        setUsuarios(us);
      } catch { /* catálogo opcional */ }
      try { setMetodos(await contaApi<MetodoPago[]>('/api/conta/metodos-pago')); } catch { /* opcional */ }
    })();
  }, []);

  // --- Adelantos ---
  const crearAdelanto = async () => {
    setError('');
    if (!nuevoAdel.usuario_id) { setError('Selecciona el usuario del adelanto.'); return; }
    if (!(Number(nuevoAdel.monto) > 0)) { setError('El monto debe ser mayor a 0.'); return; }
    try {
      await contaApi('/api/conta/nomina/adelantos', {
        method: 'POST',
        body: {
          usuario_id: Number(nuevoAdel.usuario_id),
          monto: Number(nuevoAdel.monto),
          motivo: nuevoAdel.motivo || null,
        },
      });
      ok('Adelanto registrado (se descontará en la próxima nómina).');
      setNuevoAdel({ usuario_id: '', monto: '', motivo: '' });
      await cargarAdelantos();
    } catch (e) { setError(errMsg(e)); }
  };

  const anularAdelanto = async (a: Adelanto) => {
    if (!window.confirm(`¿Anular el adelanto #${a.id}?`)) return;
    try {
      await contaApi(`/api/conta/nomina/adelantos/${a.id}/anular`, { method: 'POST' });
      ok(`Adelanto #${a.id} anulado.`);
      await cargarAdelantos();
    } catch (e) { setError(errMsg(e)); }
  };

  // --- Nómina ---
  const generarNomina = async () => {
    setError('');
    if (!nueva.usuario_id) { setError('Selecciona el usuario.'); return; }
    if (!nueva.periodo_desde || !nueva.periodo_hasta) { setError('El período (desde y hasta) es obligatorio.'); return; }
    try {
      await contaApi('/api/conta/nomina', {
        method: 'POST',
        body: {
          usuario_id: Number(nueva.usuario_id),
          periodo_desde: nueva.periodo_desde,
          periodo_hasta: nueva.periodo_hasta,
          sueldo_base: Number(nueva.sueldo_base) || 0,
          bonos: Number(nueva.bonos) || 0,
          descuentos: Number(nueva.descuentos) || 0,
          incluir_propinas: nueva.incluir_propinas,
          incluir_adelantos: nueva.incluir_adelantos,
        },
      });
      ok('Nómina generada en borrador (incluye propinas y adelantos según configuración).');
      setNueva({ ...nueva, sueldo_base: '', bonos: '', descuentos: '' });
      await cargarNominas();
    } catch (e) { setError(errMsg(e)); }
  };

  const aprobar = async (n: Nomina) => {
    try {
      await contaApi(`/api/conta/nomina/${n.id}/aprobar`, { method: 'POST' });
      ok(`Nómina #${n.id} aprobada.`);
      await cargarNominas();
    } catch (e) { setError(errMsg(e)); }
  };

  const confirmarPago = async () => {
    if (!pagar) return;
    try {
      await contaApi(`/api/conta/nomina/${pagar.nomina.id}/pagar`, {
        method: 'POST',
        body: { metodo_pago_id: pagar.metodo_pago_id ? Number(pagar.metodo_pago_id) : null },
      });
      ok(`Nómina #${pagar.nomina.id} pagada (asiento registrado).`);
      setPagar(null);
      await cargarNominas();
    } catch (e) { setError(errMsg(e)); }
  };

  const anularNomina = async (n: Nomina) => {
    const motivo = window.prompt(`Motivo de anulación de la nómina #${n.id} (obligatorio):`);
    if (!motivo) return;
    try {
      await contaApi(`/api/conta/nomina/${n.id}/anular`, { method: 'POST', body: { motivo } });
      ok(`Nómina #${n.id} anulada.`);
      await cargarNominas();
    } catch (e) { setError(errMsg(e)); }
  };

  const verDetalle = async (id: number) => {
    try { setDetalle(await contaApi<DetalleNomina>(`/api/conta/nomina/${id}`)); }
    catch (e) { setError(errMsg(e)); }
  };

  const recibo = async (n: Nomina) => {
    try {
      await contaDescargar(`/api/conta/nomina/${n.id}/recibo.pdf`, `recibo-nomina-${n.id}.pdf`);
    } catch (e) { setError(errMsg(e)); }
  };

  const totalEstimado = (Number(nueva.sueldo_base) || 0) + (Number(nueva.bonos) || 0)
    - (Number(nueva.descuentos) || 0);

  return (
    <>
      {error && <p className="card" style={{ color: '#ef4444', padding: 12, marginBottom: 12 }}>{error}</p>}

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {([['nomina', 'Nómina'], ['adelantos', 'Adelantos']] as const).map(([k, etiqueta]) => (
          <button key={k} className={`btn ${seccion === k ? 'btn-primary' : ''}`}
            onClick={() => setSeccion(k)}>{etiqueta}</button>
        ))}
      </div>

      {/* ===================== Nómina ===================== */}
      {seccion === 'nomina' && (
        <>
          {puedeGestionar && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Generar nómina (borrador)</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select className="input" style={{ flex: '1 1 220px' }} value={nueva.usuario_id}
                  onChange={(e) => setNueva({ ...nueva, usuario_id: e.target.value })}>
                  <option value="">Usuario *</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{nombreUsuario(u)} · {u.rol}</option>
                  ))}
                </select>
                <input className="input" type="date" title="Período desde" style={{ maxWidth: 160 }}
                  value={nueva.periodo_desde} onChange={(e) => setNueva({ ...nueva, periodo_desde: e.target.value })} />
                <input className="input" type="date" title="Período hasta" style={{ maxWidth: 160 }}
                  value={nueva.periodo_hasta} onChange={(e) => setNueva({ ...nueva, periodo_hasta: e.target.value })} />
                <input className="input" type="number" step="0.01" placeholder="Sueldo base" style={{ flex: '0 0 150px' }}
                  value={nueva.sueldo_base} onChange={(e) => setNueva({ ...nueva, sueldo_base: e.target.value })} />
                <input className="input" type="number" step="0.01" placeholder="Bonos" style={{ flex: '0 0 130px' }}
                  value={nueva.bonos} onChange={(e) => setNueva({ ...nueva, bonos: e.target.value })} />
                <input className="input" type="number" step="0.01" placeholder="Descuentos" style={{ flex: '0 0 140px' }}
                  value={nueva.descuentos} onChange={(e) => setNueva({ ...nueva, descuentos: e.target.value })} />
                <label style={{ color: '#8aa4c7', fontSize: '0.82rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={nueva.incluir_propinas}
                    onChange={(e) => setNueva({ ...nueva, incluir_propinas: e.target.checked })} />
                  Incluir propinas
                </label>
                <label style={{ color: '#8aa4c7', fontSize: '0.82rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={nueva.incluir_adelantos}
                    onChange={(e) => setNueva({ ...nueva, incluir_adelantos: e.target.checked })} />
                  Incluir adelantos
                </label>
                <button className="btn btn-primary" onClick={() => void generarNomina()}>Generar borrador</button>
              </div>
              <p style={{ color: '#8aa4c7', fontSize: '0.78rem', marginBottom: 0 }}>
                Base + bonos − descuentos (sin propinas/adelantos): <b>{money(totalEstimado)}</b>.
                El backend suma las propinas pendientes y descuenta los adelantos pendientes del período.
              </p>
            </section>
          )}

          <section className="card">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ flex: '1 1 200px' }} value={fNom.usuario_id}
                onChange={(e) => setFNom({ ...fNom, usuario_id: e.target.value })}>
                <option value="">Todos los usuarios</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{nombreUsuario(u)}</option>)}
              </select>
              <select className="input" style={{ maxWidth: 160 }} value={fNom.estado}
                onChange={(e) => setFNom({ ...fNom, estado: e.target.value })}>
                <option value="">Todos los estados</option>
                <option value="borrador">Borradores</option>
                <option value="aprobada">Aprobadas</option>
                <option value="pagada">Pagadas</option>
                <option value="anulada">Anuladas</option>
              </select>
              <input className="input" type="date" style={{ maxWidth: 160 }} value={fNom.desde}
                onChange={(e) => setFNom({ ...fNom, desde: e.target.value })} />
              <input className="input" type="date" style={{ maxWidth: 160 }} value={fNom.hasta}
                onChange={(e) => setFNom({ ...fNom, hasta: e.target.value })} />
              <button className="btn btn-primary" onClick={() => void cargarNominas()}>Buscar</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>#</th><th>Usuario</th><th>Período</th><th>Sueldo base</th><th>Bonos</th>
                    <th>Propinas</th><th>Descuentos</th><th>Adelantos</th><th>Total a pagar</th>
                    <th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {nominas.map((n) => (
                    <tr key={n.id}>
                      <td>{n.id}</td>
                      <td>{n.usuario || `Usuario #${n.usuario_id}`}</td>
                      <td style={{ fontSize: '0.78rem' }}>{fecha(n.periodo_desde)} → {fecha(n.periodo_hasta)}</td>
                      <td>{money(n.sueldo_base)}</td>
                      <td>{money(n.bonos)}</td>
                      <td>{money(n.propinas_incluidas)}</td>
                      <td>{money(n.descuentos)}</td>
                      <td>{money(n.adelantos)}</td>
                      <td><b>{money(n.total_pagar)}</b></td>
                      <td>
                        <span className="pill" style={{
                          background: `${COLOR_ESTADO[n.estado] || '#8aa4c7'}22`,
                          color: COLOR_ESTADO[n.estado] || '#8aa4c7',
                        }}>{n.estado}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn btn-sm" onClick={() => void verDetalle(n.id)}>Ver</button>
                          <button className="btn btn-sm" onClick={() => void recibo(n)}>Recibo</button>
                          {puedeGestionar && n.estado === 'borrador' && (
                            <button className="btn btn-sm btn-success" onClick={() => void aprobar(n)}>Aprobar</button>
                          )}
                          {puedeGestionar && ['borrador', 'aprobada'].includes(n.estado) && (
                            <button className="btn btn-sm btn-warn"
                              onClick={() => setPagar({ nomina: n, metodo_pago_id: '' })}>Pagar</button>
                          )}
                          {puedeGestionar && n.estado !== 'pagada' && n.estado !== 'anulada' && (
                            <button className="btn btn-sm btn-danger" onClick={() => void anularNomina(n)}>Anular</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!nominas.length && <tr><td colSpan={11} style={{ color: '#5f7095' }}>Sin nóminas.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ===================== Adelantos ===================== */}
      {seccion === 'adelantos' && (
        <>
          {puedeGestionar && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Nuevo adelanto</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select className="input" style={{ flex: '1 1 220px' }} value={nuevoAdel.usuario_id}
                  onChange={(e) => setNuevoAdel({ ...nuevoAdel, usuario_id: e.target.value })}>
                  <option value="">Usuario *</option>
                  {usuarios.map((u) => <option key={u.id} value={u.id}>{nombreUsuario(u)} · {u.rol}</option>)}
                </select>
                <input className="input" type="number" step="0.01" placeholder="Monto *" style={{ flex: '0 0 150px' }}
                  value={nuevoAdel.monto} onChange={(e) => setNuevoAdel({ ...nuevoAdel, monto: e.target.value })} />
                <input className="input" placeholder="Motivo" style={{ flex: '1 1 240px' }}
                  value={nuevoAdel.motivo} onChange={(e) => setNuevoAdel({ ...nuevoAdel, motivo: e.target.value })} />
                <button className="btn btn-primary" onClick={() => void crearAdelanto()}>Registrar</button>
              </div>
            </section>
          )}

          <section className="card">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ flex: '1 1 200px' }} value={fAdel.usuario_id}
                onChange={(e) => setFAdel({ ...fAdel, usuario_id: e.target.value })}>
                <option value="">Todos los usuarios</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{nombreUsuario(u)}</option>)}
              </select>
              <select className="input" style={{ maxWidth: 170 }} value={fAdel.estado}
                onChange={(e) => setFAdel({ ...fAdel, estado: e.target.value })}>
                <option value="">Todos los estados</option>
                <option value="pendiente">Pendientes</option>
                <option value="descontado">Descontados</option>
                <option value="anulado">Anulados</option>
              </select>
              <button className="btn btn-primary" onClick={() => void cargarAdelantos()}>Buscar</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>#</th><th>Usuario</th><th>Carnet</th><th>Monto</th><th>Motivo</th><th>Estado</th>
                    <th>Nómina</th><th>Alta</th><th></th></tr>
                </thead>
                <tbody>
                  {adelantos.map((a) => (
                    <tr key={a.id}>
                      <td>{a.id}</td>
                      <td>{a.usuario || `Usuario #${a.usuario_id}`}</td>
                      <td style={{ fontSize: '0.8rem' }}>{a.carnet || '—'}</td>
                      <td><b>{money(a.monto)}</b></td>
                      <td style={{ fontSize: '0.82rem' }}>{a.motivo || '—'}</td>
                      <td>
                        <span className="pill" style={{
                          background: `${COLOR_ESTADO[a.estado] || '#8aa4c7'}22`,
                          color: COLOR_ESTADO[a.estado] || '#8aa4c7',
                        }}>{a.estado}</span>
                      </td>
                      <td>{a.nomina_id || '—'}</td>
                      <td style={{ fontSize: '0.76rem' }}>{fechaHora(a.creado_en)}</td>
                      <td>
                        {puedeGestionar && a.estado === 'pendiente' && (
                          <button className="btn btn-sm btn-danger" onClick={() => void anularAdelanto(a)}>Anular</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!adelantos.length && <tr><td colSpan={9} style={{ color: '#5f7095' }}>Sin adelantos.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Modal pago de nómina */}
      {pagar && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 460 }}>
            <h3 style={{ marginTop: 0 }}>Pagar nómina #{pagar.nomina.id}</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              Total a pagar: <b>{money(pagar.nomina.total_pagar)}</b>. Al pagar se registra el
              asiento y se marcan las propinas incluidas y los adelantos descontados.
            </p>
            <select className="input" value={pagar.metodo_pago_id}
              onChange={(e) => setPagar({ ...pagar, metodo_pago_id: e.target.value })}>
              <option value="">Método de pago (opcional)</option>
              {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.tipo})</option>)}
            </select>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => void confirmarPago()}>Pagar</button>
              <button className="btn" onClick={() => setPagar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal detalle */}
      {detalle && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 620, maxHeight: '84vh', overflow: 'auto' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ marginTop: 0 }}>Nómina #{detalle.nomina.id}</h3>
              <button className="btn btn-sm" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              {detalle.nomina.usuario || `Usuario #${detalle.nomina.usuario_id}`} ·{' '}
              {fecha(detalle.nomina.periodo_desde)} → {fecha(detalle.nomina.periodo_hasta)} · estado{' '}
              {detalle.nomina.estado}
            </p>
            <table className="tbl">
              <tbody>
                <tr><td>Sueldo base</td><td style={{ textAlign: 'right' }}>{money(detalle.nomina.sueldo_base)}</td></tr>
                <tr><td>Bonos</td><td style={{ textAlign: 'right' }}>{money(detalle.nomina.bonos)}</td></tr>
                <tr><td>Propinas incluidas</td><td style={{ textAlign: 'right' }}>{money(detalle.nomina.propinas_incluidas)}</td></tr>
                <tr><td>Descuentos</td><td style={{ textAlign: 'right' }}>−{money(detalle.nomina.descuentos)}</td></tr>
                <tr><td>Adelantos descontados</td><td style={{ textAlign: 'right' }}>−{money(detalle.nomina.adelantos)}</td></tr>
                <tr><td><b>TOTAL A PAGAR</b></td><td style={{ textAlign: 'right' }}><b>{money(detalle.nomina.total_pagar)}</b></td></tr>
              </tbody>
            </table>
            <h4>Adelantos descontados</h4>
            <table className="tbl">
              <thead><tr><th>#</th><th>Monto</th><th>Motivo</th><th>Estado</th></tr></thead>
              <tbody>
                {detalle.adelantos.map((a) => (
                  <tr key={a.id}>
                    <td>{a.id}</td><td>{money(a.monto)}</td><td>{a.motivo || '—'}</td><td>{a.estado}</td>
                  </tr>
                ))}
                {!detalle.adelantos.length && (
                  <tr><td colSpan={4} style={{ color: '#5f7095' }}>Sin adelantos asociados.</td></tr>
                )}
              </tbody>
            </table>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={() => void recibo(detalle.nomina)}>Descargar recibo PDF</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
