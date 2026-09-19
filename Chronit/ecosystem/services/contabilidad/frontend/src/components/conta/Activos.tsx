// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Activos fijos y depreciación
// -----------------------------------------------------------------------------
//   GET  /api/conta/activos                 listar (estado, q)
//   GET  /api/conta/activos/depreciaciones   historial (activo, período)
//   GET  /api/conta/activos/valor-libro      reporte de valor en libros
//   POST /api/conta/activos/depreciar        depreciación mensual (idempotente)
//   GET  /api/conta/activos/:id              detalle + depreciaciones + cuota
//   POST /api/conta/activos                  crear
//   PUT  /api/conta/activos/:id              editar
//   POST /api/conta/activos/:id/baja         dar de baja / vender
//
// DEPRECIACIÓN: línea recta mensual = (costo − valor_residual) / vida_util_meses.
// Cada período se snapshot en conta_depreciaciones (idempotente por período).
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { fecha, hoyISO, money } from './comun';

interface Activo {
  id: number; nombre: string; tipo: string | null; marca: string | null; modelo: string | null;
  numero_serie: string | null; fecha_adquisicion: string; costo: number; vida_util_meses: number;
  valor_residual: number; depreciacion_acumulada: number; valor_libro: number;
  estado: string; foto_url: string | null;
}

interface Depreciacion {
  id: number; activo_id: number; activo?: string | null; periodo: string;
  monto: number; acumulada: number; asiento_id: number | null;
}

interface ValorLibro {
  filas: Activo[];
  resumen: { activos: number; costo_total: number; depreciacion_acumulada: number; valor_libro: number };
}

interface DetalleActivo { activo: Activo; depreciaciones: Depreciacion[]; cuota_mensual: number }

const COLOR_ESTADO: Record<string, string> = {
  activo: '#22c55e', baja: '#ef4444', vendido: '#f59e0b',
};

const FORM_VACIO = {
  nombre: '', tipo: '', marca: '', modelo: '', numero_serie: '',
  fecha_adquisicion: hoyISO(), costo: '', vida_util_meses: '60', valor_residual: '', foto_url: '',
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Activos({ ok, soloLectura, puedeGestion }: {
  ok: (m: string) => void; soloLectura: boolean; puedeGestion: boolean;
}) {
  const puedeGestionar = !soloLectura && puedeGestion;

  const [seccion, setSeccion] = useState<'activos' | 'depreciaciones' | 'valor-libro'>('activos');
  const [error, setError] = useState('');
  const [periodo, setPeriodo] = useState(hoyISO().slice(0, 7));

  const [filtros, setFiltros] = useState({ estado: '', q: '' });
  const [activos, setActivos] = useState<Activo[]>([]);
  const [nuevo, setNuevo] = useState({ ...FORM_VACIO });
  const [edit, setEdit] = useState<Activo | null>(null);
  const [detalle, setDetalle] = useState<DetalleActivo | null>(null);

  const [fDep, setFDep] = useState({ activo_id: '', periodo: '', desde: '', hasta: '' });
  const [deps, setDeps] = useState<Depreciacion[]>([]);

  const [valor, setValor] = useState<ValorLibro | null>(null);
  const [fValor, setFValor] = useState({ estado: '' });

  const cargarActivos = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setActivos(await contaApi<Activo[]>(`/api/conta/activos?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [filtros]);

  const cargarDepreciaciones = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(fDep).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setDeps(await contaApi<Depreciacion[]>(`/api/conta/activos/depreciaciones?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [fDep]);

  useEffect(() => { void cargarActivos(); }, [cargarActivos]);
  useEffect(() => { void cargarDepreciaciones(); }, [cargarDepreciaciones]);

  const cargarValorLibro = async () => {
    try {
      const qs = new URLSearchParams();
      if (fValor.estado) qs.set('estado', fValor.estado);
      setValor(await contaApi<ValorLibro>(`/api/conta/activos/valor-libro?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  };

  const crear = async () => {
    setError('');
    if (!nuevo.nombre.trim()) { setError('El nombre del activo es obligatorio.'); return; }
    if (!(Number(nuevo.costo) > 0)) { setError('El costo debe ser mayor a 0.'); return; }
    try {
      await contaApi('/api/conta/activos', {
        method: 'POST',
        body: {
          nombre: nuevo.nombre.trim(),
          tipo: nuevo.tipo || null,
          marca: nuevo.marca || null,
          modelo: nuevo.modelo || null,
          numero_serie: nuevo.numero_serie || null,
          fecha_adquisicion: nuevo.fecha_adquisicion || hoyISO(),
          costo: Number(nuevo.costo),
          vida_util_meses: Number(nuevo.vida_util_meses) || 60,
          valor_residual: Number(nuevo.valor_residual) || 0,
          foto_url: nuevo.foto_url || null,
        },
      });
      ok(`Activo «${nuevo.nombre}» registrado.`);
      setNuevo({ ...FORM_VACIO });
      await cargarActivos();
    } catch (e) { setError(errMsg(e)); }
  };

  const guardarEdit = async () => {
    if (!edit) return;
    try {
      await contaApi(`/api/conta/activos/${edit.id}`, {
        method: 'PUT',
        body: {
          nombre: edit.nombre, tipo: edit.tipo, marca: edit.marca, modelo: edit.modelo,
          numero_serie: edit.numero_serie, fecha_adquisicion: edit.fecha_adquisicion,
          costo: edit.costo, vida_util_meses: edit.vida_util_meses,
          valor_residual: edit.valor_residual, foto_url: edit.foto_url,
        },
      });
      ok('Activo actualizado (se recalculó el valor en libros).');
      setEdit(null);
      await cargarActivos();
    } catch (e) { setError(errMsg(e)); }
  };

  const depreciar = async () => {
    if (!window.confirm(`¿Ejecutar la depreciación del período ${periodo}? Es idempotente por activo.`)) return;
    try {
      const r = await contaApi<{
        periodo: string; procesados: unknown[]; omitidos: unknown[];
      }>('/api/conta/activos/depreciar', { method: 'POST', body: { periodo } });
      ok(`Depreciación ${r.periodo}: ${r.procesados.length} procesado(s), ${r.omitidos.length} omitido(s).`);
      await cargarDepreciaciones();
      if (seccion === 'valor-libro') await cargarValorLibro();
    } catch (e) { setError(errMsg(e)); }
  };

  const verDetalle = async (id: number) => {
    try { setDetalle(await contaApi<DetalleActivo>(`/api/conta/activos/${id}`)); }
    catch (e) { setError(errMsg(e)); }
  };

  const darBaja = async (a: Activo) => {
    const estado = window.confirm('¿Marcar el activo como VENDIDO? Cancelar = dar de BAJA.')
      ? 'vendido' : 'baja';
    const motivo = window.prompt(`Motivo de ${estado === 'vendido' ? 'venta' : 'baja'} (obligatorio):`);
    if (!motivo) return;
    try {
      await contaApi(`/api/conta/activos/${a.id}/baja`, { method: 'POST', body: { estado, motivo } });
      ok(`Activo #${a.id} marcado como ${estado}.`);
      await cargarActivos();
    } catch (e) { setError(errMsg(e)); }
  };

  return (
    <>
      {error && <p className="card" style={{ color: '#ef4444', padding: 12, marginBottom: 12 }}>{error}</p>}

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {([['activos', 'Activos'], ['depreciaciones', 'Depreciaciones'],
          ['valor-libro', 'Valor en libros']] as const).map(([k, etiqueta]) => (
          <button key={k} className={`btn ${seccion === k ? 'btn-primary' : ''}`}
            onClick={() => setSeccion(k)}>{etiqueta}</button>
        ))}
        <span style={{ flex: 1 }} />
        {puedeGestionar && (
          <>
            <input className="input" type="month" style={{ maxWidth: 150 }} value={periodo}
              onChange={(e) => setPeriodo(e.target.value)} />
            <button className="btn btn-primary" onClick={() => void depreciar()}>Ejecutar depreciación</button>
          </>
        )}
      </div>

      {/* ===================== Activos ===================== */}
      {seccion === 'activos' && (
        <>
          {puedeGestionar && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Nuevo activo fijo</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input className="input" placeholder="Nombre *" style={{ flex: '1 1 200px' }}
                  value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
                <input className="input" placeholder="Tipo" style={{ flex: '0 0 140px' }}
                  value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })} />
                <input className="input" placeholder="Marca" style={{ flex: '0 0 130px' }}
                  value={nuevo.marca} onChange={(e) => setNuevo({ ...nuevo, marca: e.target.value })} />
                <input className="input" placeholder="Modelo" style={{ flex: '0 0 130px' }}
                  value={nuevo.modelo} onChange={(e) => setNuevo({ ...nuevo, modelo: e.target.value })} />
                <input className="input" placeholder="N° de serie" style={{ flex: '0 0 150px' }}
                  value={nuevo.numero_serie} onChange={(e) => setNuevo({ ...nuevo, numero_serie: e.target.value })} />
                <input className="input" type="date" title="Fecha de adquisición" style={{ maxWidth: 160 }}
                  value={nuevo.fecha_adquisicion}
                  onChange={(e) => setNuevo({ ...nuevo, fecha_adquisicion: e.target.value })} />
                <input className="input" type="number" step="0.01" placeholder="Costo *" style={{ flex: '0 0 140px' }}
                  value={nuevo.costo} onChange={(e) => setNuevo({ ...nuevo, costo: e.target.value })} />
                <input className="input" type="number" placeholder="Vida útil (meses)" style={{ flex: '0 0 160px' }}
                  value={nuevo.vida_util_meses}
                  onChange={(e) => setNuevo({ ...nuevo, vida_util_meses: e.target.value })} />
                <input className="input" type="number" step="0.01" placeholder="Valor residual" style={{ flex: '0 0 160px' }}
                  value={nuevo.valor_residual}
                  onChange={(e) => setNuevo({ ...nuevo, valor_residual: e.target.value })} />
                <input className="input" placeholder="URL foto" style={{ flex: '1 1 160px' }}
                  value={nuevo.foto_url} onChange={(e) => setNuevo({ ...nuevo, foto_url: e.target.value })} />
                <button className="btn btn-primary" onClick={() => void crear()}>Registrar</button>
              </div>
            </section>
          )}

          <section className="card">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ maxWidth: 160 }} value={filtros.estado}
                onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
                <option value="">Todos los estados</option>
                <option value="activo">Activos</option>
                <option value="baja">Dados de baja</option>
                <option value="vendido">Vendidos</option>
              </select>
              <input className="input" placeholder="Buscar por nombre" style={{ flex: '1 1 220px' }}
                value={filtros.q} onChange={(e) => setFiltros({ ...filtros, q: e.target.value })} />
              <button className="btn btn-primary" onClick={() => void cargarActivos()}>Buscar</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>#</th><th>Nombre</th><th>Tipo</th><th>Marca/Modelo</th><th>Adquisición</th>
                    <th>Costo</th><th>Dep. acumulada</th><th>Valor en libros</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {activos.map((a) => (
                    <tr key={a.id}>
                      <td>{a.id}</td>
                      <td>{a.nombre}</td>
                      <td>{a.tipo || '—'}</td>
                      <td style={{ fontSize: '0.8rem' }}>
                        {[a.marca, a.modelo].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>{fecha(a.fecha_adquisicion)}</td>
                      <td>{money(a.costo)}</td>
                      <td>{money(a.depreciacion_acumulada)}</td>
                      <td><b>{money(a.valor_libro)}</b></td>
                      <td>
                        <span className="pill" style={{
                          background: `${COLOR_ESTADO[a.estado] || '#8aa4c7'}22`,
                          color: COLOR_ESTADO[a.estado] || '#8aa4c7',
                        }}>{a.estado}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn btn-sm" onClick={() => void verDetalle(a.id)}>Ver</button>
                          {puedeGestionar && (
                            <button className="btn btn-sm" onClick={() => setEdit({ ...a })}>Editar</button>
                          )}
                          {puedeGestionar && a.estado === 'activo' && (
                            <button className="btn btn-sm btn-danger" onClick={() => void darBaja(a)}>Baja</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!activos.length && <tr><td colSpan={10} style={{ color: '#5f7095' }}>Sin activos.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ===================== Depreciaciones ===================== */}
      {seccion === 'depreciaciones' && (
        <section className="card">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="input" style={{ flex: '1 1 200px' }} value={fDep.activo_id}
              onChange={(e) => setFDep({ ...fDep, activo_id: e.target.value })}>
              <option value="">Todos los activos</option>
              {activos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            <input className="input" type="month" style={{ maxWidth: 150 }} value={fDep.periodo}
              onChange={(e) => setFDep({ ...fDep, periodo: e.target.value })} />
            <input className="input" type="month" title="Período desde" style={{ maxWidth: 150 }} value={fDep.desde}
              onChange={(e) => setFDep({ ...fDep, desde: e.target.value })} />
            <input className="input" type="month" title="Período hasta" style={{ maxWidth: 150 }} value={fDep.hasta}
              onChange={(e) => setFDep({ ...fDep, hasta: e.target.value })} />
            <button className="btn btn-primary" onClick={() => void cargarDepreciaciones()}>Buscar</button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ marginTop: 14 }}>
              <thead>
                <tr><th>#</th><th>Activo</th><th>Período</th><th>Cuota del mes</th>
                  <th>Acumulada</th><th>Asiento</th></tr>
              </thead>
              <tbody>
                {deps.map((d) => (
                  <tr key={d.id}>
                    <td>{d.id}</td>
                    <td>{d.activo || `Activo #${d.activo_id}`}</td>
                    <td>{d.periodo}</td>
                    <td>{money(d.monto)}</td>
                    <td><b>{money(d.acumulada)}</b></td>
                    <td>{d.asiento_id || '—'}</td>
                  </tr>
                ))}
                {!deps.length && (
                  <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin depreciaciones en el filtro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ===================== Valor en libros ===================== */}
      {seccion === 'valor-libro' && (
        <section className="card">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="input" style={{ maxWidth: 180 }} value={fValor.estado}
              onChange={(e) => setFValor({ estado: e.target.value })}>
              <option value="">Todos los estados</option>
              <option value="activo">Activos</option>
              <option value="baja">Dados de baja</option>
              <option value="vendido">Vendidos</option>
            </select>
            <button className="btn btn-primary" onClick={() => void cargarValorLibro()}>Generar reporte</button>
          </div>

          {valor && (
            <>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', marginTop: 14 }}>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{valor.resumen.activos}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Activos</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(valor.resumen.costo_total)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Costo total</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(valor.resumen.depreciacion_acumulada)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Depreciación acumulada</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{money(valor.resumen.valor_libro)}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Valor en libros</div>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ marginTop: 14 }}>
                  <thead>
                    <tr><th>#</th><th>Nombre</th><th>Tipo</th><th>Adquisición</th><th>Costo</th>
                      <th>Vida útil</th><th>Dep. acumulada</th><th>Valor en libros</th><th>Estado</th></tr>
                  </thead>
                  <tbody>
                    {valor.filas.map((f) => (
                      <tr key={f.id}>
                        <td>{f.id}</td>
                        <td>{f.nombre}</td>
                        <td>{f.tipo || '—'}</td>
                        <td style={{ fontSize: '0.78rem' }}>{fecha(f.fecha_adquisicion)}</td>
                        <td>{money(f.costo)}</td>
                        <td>{f.vida_util_meses} meses</td>
                        <td>{money(f.depreciacion_acumulada)}</td>
                        <td><b>{money(f.valor_libro)}</b></td>
                        <td>{f.estado}</td>
                      </tr>
                    ))}
                    {!valor.filas.length && (
                      <tr><td colSpan={9} style={{ color: '#5f7095' }}>Sin activos para el filtro.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!valor && (
            <p style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>
              Pulsa «Generar reporte» para ver el valor en libros de los activos.
            </p>
          )}
        </section>
      )}

      {/* Modal edición */}
      {edit && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 520 }}>
            <h3 style={{ marginTop: 0 }}>Editar activo #{edit.id}</h3>
            <input className="input" placeholder="Nombre" value={edit.nombre}
              onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} />
            <input className="input" placeholder="Tipo" style={{ marginTop: 8 }} value={edit.tipo || ''}
              onChange={(e) => setEdit({ ...edit, tipo: e.target.value })} />
            <input className="input" placeholder="Marca" style={{ marginTop: 8 }} value={edit.marca || ''}
              onChange={(e) => setEdit({ ...edit, marca: e.target.value })} />
            <input className="input" placeholder="Modelo" style={{ marginTop: 8 }} value={edit.modelo || ''}
              onChange={(e) => setEdit({ ...edit, modelo: e.target.value })} />
            <input className="input" placeholder="N° de serie" style={{ marginTop: 8 }} value={edit.numero_serie || ''}
              onChange={(e) => setEdit({ ...edit, numero_serie: e.target.value })} />
            <input className="input" type="date" style={{ marginTop: 8 }} value={edit.fecha_adquisicion.slice(0, 10)}
              onChange={(e) => setEdit({ ...edit, fecha_adquisicion: e.target.value })} />
            <input className="input" type="number" step="0.01" placeholder="Costo" style={{ marginTop: 8 }}
              value={edit.costo} onChange={(e) => setEdit({ ...edit, costo: Number(e.target.value) })} />
            <input className="input" type="number" placeholder="Vida útil (meses)" style={{ marginTop: 8 }}
              value={edit.vida_util_meses}
              onChange={(e) => setEdit({ ...edit, vida_util_meses: Number(e.target.value) })} />
            <input className="input" type="number" step="0.01" placeholder="Valor residual" style={{ marginTop: 8 }}
              value={edit.valor_residual}
              onChange={(e) => setEdit({ ...edit, valor_residual: Number(e.target.value) })} />
            <input className="input" placeholder="URL foto" style={{ marginTop: 8 }} value={edit.foto_url || ''}
              onChange={(e) => setEdit({ ...edit, foto_url: e.target.value })} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => void guardarEdit()}>Guardar</button>
              <button className="btn" onClick={() => setEdit(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal detalle */}
      {detalle && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 720, maxHeight: '84vh', overflow: 'auto' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ marginTop: 0 }}>{detalle.activo.nombre}</h3>
              <button className="btn btn-sm" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              {detalle.activo.tipo || 'Sin tipo'} · {detalle.activo.marca || '—'} {detalle.activo.modelo || ''} ·
              serie {detalle.activo.numero_serie || '—'} · estado {detalle.activo.estado}
            </p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontWeight: 700 }}>{money(detalle.activo.costo)}</div>
                <div style={{ color: '#8aa4c7', fontSize: '0.74rem' }}>Costo</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontWeight: 700 }}>{money(detalle.cuota_mensual)}</div>
                <div style={{ color: '#8aa4c7', fontSize: '0.74rem' }}>Cuota mensual (teórica)</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontWeight: 700 }}>{money(detalle.activo.depreciacion_acumulada)}</div>
                <div style={{ color: '#8aa4c7', fontSize: '0.74rem' }}>Depreciación acumulada</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontWeight: 700 }}>{money(detalle.activo.valor_libro)}</div>
                <div style={{ color: '#8aa4c7', fontSize: '0.74rem' }}>Valor en libros</div>
              </div>
            </div>
            <h4>Historial de depreciaciones</h4>
            <table className="tbl">
              <thead><tr><th>Período</th><th>Cuota</th><th>Acumulada</th><th>Asiento</th></tr></thead>
              <tbody>
                {detalle.depreciaciones.map((d) => (
                  <tr key={d.id}>
                    <td>{d.periodo}</td>
                    <td>{money(d.monto)}</td>
                    <td>{money(d.acumulada)}</td>
                    <td>{d.asiento_id || '—'}</td>
                  </tr>
                ))}
                {!detalle.depreciaciones.length && (
                  <tr><td colSpan={4} style={{ color: '#5f7095' }}>Sin depreciaciones registradas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
