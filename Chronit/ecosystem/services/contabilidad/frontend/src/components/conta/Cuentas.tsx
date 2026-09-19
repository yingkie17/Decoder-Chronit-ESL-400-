// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Cuentas destino
// -----------------------------------------------------------------------------
//   GET  /api/conta/cuentas?activas=false           cuentas + responsable vigente
//   POST /api/conta/cuentas                         crear (contador+)
//   PUT  /api/conta/cuentas/:id                     editar (contador+)
//   GET  /api/conta/cuentas/:id/historial           historial de responsables
//   POST /api/conta/cuentas/:id/rotar               rotar responsable (supervisor+)
//
// ROTACIÓN: cierra la asignación vigente (hasta = now()) y abre una nueva. Las
// ventas pasadas conservan su cuenta_responsable_id_snapshot, así que rotar el
// responsable NO altera los reportes ya emitidos.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { fechaHora, money, type Cuenta } from './comun';

interface UsuarioMini { id: number; nombre: string; apellido: string | null; carnet: string; rol: string }
interface Historial {
  id: number; usuario_id: number; responsable_nombre: string | null; responsable_carnet: string | null;
  desde: string; hasta: string | null; motivo: string | null; asignado_por_nombre: string | null;
}

const NUEVA = { nombre: '', tipo: 'qr', titular: '', banco: '', numero: '', es_efectivo_caja: false };

export default function Cuentas({ puedeGestion, esSupervisor, ok, ko }: {
  puedeGestion: boolean; esSupervisor: boolean; ok: (m: string) => void; ko: (e: unknown) => void;
}) {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioMini[]>([]);
  const [nueva, setNueva] = useState({ ...NUEVA });
  const [historial, setHistorial] = useState<{ cuenta: Cuenta; rows: Historial[] } | null>(null);
  const [rotar, setRotar] = useState<{ cuenta: Cuenta; usuario_id: string; motivo: string } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCuentas(await contaApi<Cuenta[]>('/api/conta/cuentas?activas=false'));
    } catch (e) { ko(e); }
  }, [ko]);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    if (!puedeGestion) return;
    (async () => {
      try { setUsuarios(await contaApi<UsuarioMini[]>('/api/conta/usuarios')); } catch { /* opcional */ }
    })();
  }, [puedeGestion]);

  const crear = async () => {
    if (!nueva.nombre) { ko(new Error('El nombre es obligatorio.')); return; }
    try {
      await contaApi('/api/conta/cuentas', { method: 'POST', body: { ...nueva, activo: true } });
      ok(`Cuenta «${nueva.nombre}» creada.`);
      setNueva({ ...NUEVA });
      await cargar();
    } catch (e) { ko(e); }
  };

  const actualizar = async (id: number, patch: Partial<Cuenta>) => {
    try {
      await contaApi(`/api/conta/cuentas/${id}`, { method: 'PUT', body: patch });
      await cargar();
    } catch (e) { ko(e); }
  };

  const verHistorial = async (c: Cuenta) => {
    try {
      setHistorial({ cuenta: c, rows: await contaApi<Historial[]>(`/api/conta/cuentas/${c.id}/historial`) });
    } catch (e) { ko(e); }
  };

  const confirmarRotar = async () => {
    if (!rotar) return;
    if (!rotar.usuario_id) { ko(new Error('Selecciona el nuevo responsable.')); return; }
    try {
      await contaApi(`/api/conta/cuentas/${rotar.cuenta.id}/rotar`, {
        method: 'POST',
        body: { usuario_id: Number(rotar.usuario_id), motivo: rotar.motivo || null },
      });
      ok(`Responsable de «${rotar.cuenta.nombre}» rotado (auditado). Las ventas anteriores conservan el responsable previo.`);
      setRotar(null);
      await cargar();
    } catch (e) { ko(e); }
  };

  return (
    <>
      {puedeGestion && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Nueva cuenta destino</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Nombre *" style={{ flex: '1 1 170px' }}
              value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} />
            <select className="input" style={{ flex: '0 0 150px' }} value={nueva.tipo}
              onChange={(e) => setNueva({ ...nueva, tipo: e.target.value })}>
              <option value="qr">qr</option>
              <option value="efectivo">efectivo</option>
              <option value="transferencia">transferencia</option>
              <option value="tarjeta">tarjeta</option>
            </select>
            <input className="input" placeholder="Titular" style={{ flex: '1 1 150px' }}
              value={nueva.titular} onChange={(e) => setNueva({ ...nueva, titular: e.target.value })} />
            <input className="input" placeholder="Banco" style={{ flex: '1 1 140px' }}
              value={nueva.banco} onChange={(e) => setNueva({ ...nueva, banco: e.target.value })} />
            <input className="input" placeholder="N° de cuenta" style={{ flex: '1 1 150px' }}
              value={nueva.numero} onChange={(e) => setNueva({ ...nueva, numero: e.target.value })} />
            <label style={{ color: '#8aa4c7', fontSize: '0.82rem', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={nueva.es_efectivo_caja}
                onChange={(e) => setNueva({ ...nueva, es_efectivo_caja: e.target.checked })} />
              Es caja física
            </label>
            <button className="btn btn-primary" onClick={crear}>Crear cuenta</button>
          </div>
        </section>
      )}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Cuentas destino ({cuentas.length})</h3>
        <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
          Al cobrar con QR o transferencia es <b>obligatorio</b> indicar la cuenta destino; el
          responsable vigente se snapshotea en cada pago.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Cuenta</th><th>Tipo</th><th>Titular / banco / n°</th><th>Caja física</th>
                <th>Responsable vigente</th><th>Desde</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cuentas.map((c) => (
                <tr key={c.id} style={c.activo ? undefined : { opacity: 0.55 }}>
                  <td>{c.nombre}</td>
                  <td>{c.tipo}</td>
                  <td style={{ fontSize: '0.78rem' }}>
                    {c.titular || '—'}
                    <div style={{ color: '#8aa4c7' }}>{[c.banco, c.numero].filter(Boolean).join(' · ') || ''}</div>
                  </td>
                  <td>{c.es_efectivo_caja ? 'Sí' : '—'}</td>
                  <td style={{ fontSize: '0.8rem' }}>
                    {c.responsable_nombre || '—'}
                    {c.responsable_carnet ? <div style={{ color: '#5f7095' }}>{c.responsable_carnet}</div> : null}
                  </td>
                  <td style={{ fontSize: '0.76rem' }}>{fechaHora((c as Cuenta & { responsable_desde?: string }).responsable_desde || null)}</td>
                  <td>
                    {c.activo
                      ? <span className="pill" style={{ background: '#22c55e22', color: '#22c55e' }}>Activa</span>
                      : <span className="pill" style={{ background: '#ef444422', color: '#ef4444' }}>Inactiva</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => void verHistorial(c)}>Historial</button>
                      {esSupervisor && (
                        <button className="btn btn-sm btn-warn"
                          onClick={() => setRotar({ cuenta: c, usuario_id: '', motivo: '' })}>
                          Rotar responsable
                        </button>
                      )}
                      {puedeGestion && (
                        <button className="btn btn-sm" onClick={() => void actualizar(c.id, { activo: !c.activo })}>
                          {c.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!cuentas.length && <tr><td colSpan={8} style={{ color: '#5f7095' }}>Sin cuentas destino.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {historial && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 780, maxHeight: '84vh', overflow: 'auto' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ marginTop: 0 }}>Historial — {historial.cuenta.nombre}</h3>
              <button className="btn btn-sm" onClick={() => setHistorial(null)}>Cerrar</button>
            </div>
            <table className="tbl">
              <thead><tr><th>Responsable</th><th>Carnet</th><th>Desde</th><th>Hasta</th><th>Motivo</th><th>Asignó</th></tr></thead>
              <tbody>
                {historial.rows.map((h) => (
                  <tr key={h.id}>
                    <td>{h.responsable_nombre || `Usuario #${h.usuario_id}`}</td>
                    <td>{h.responsable_carnet || '—'}</td>
                    <td style={{ fontSize: '0.76rem' }}>{fechaHora(h.desde)}</td>
                    <td style={{ fontSize: '0.76rem' }}>
                      {h.hasta
                        ? fechaHora(h.hasta)
                        : <span className="pill" style={{ background: '#22c55e22', color: '#22c55e' }}>vigente</span>}
                    </td>
                    <td>{h.motivo || '—'}</td>
                    <td style={{ fontSize: '0.76rem' }}>{h.asignado_por_nombre || '—'}</td>
                  </tr>
                ))}
                {!historial.rows.length && (
                  <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin asignaciones registradas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rotar && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 460 }}>
            <h3 style={{ marginTop: 0 }}>Rotar responsable — {rotar.cuenta.nombre}</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              Se cerrará la asignación vigente y se abrirá una nueva. Los pagos anteriores conservan
              el responsable que tenían al momento de la venta.
            </p>
            <select className="input" value={rotar.usuario_id}
              onChange={(e) => setRotar({ ...rotar, usuario_id: e.target.value })}>
              <option value="">Nuevo responsable *</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} {u.apellido || ''} · {u.carnet} ({u.rol})
                </option>
              ))}
            </select>
            <input className="input" placeholder="Motivo de la rotación" style={{ marginTop: 8 }}
              value={rotar.motivo} onChange={(e) => setRotar({ ...rotar, motivo: e.target.value })} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={confirmarRotar}>Rotar</button>
              <button className="btn" onClick={() => setRotar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// =============================================================================
// IMPUESTOS (mismo archivo: pestaña corta y relacionada con cuentas/QR)
// -----------------------------------------------------------------------------
//   GET  /api/conta/impuestos
//   POST /api/conta/impuestos      (contador+)
//   PUT  /api/conta/impuestos/:id  (contador+)
//
// El NIT del cliente NO alimenta impuestos todavía: es informativo hasta que se
// habilite explícitamente el módulo fiscal.
// =============================================================================
export function Impuestos({ puedeGestion, ok, ko }: {
  puedeGestion: boolean; ok: (m: string) => void; ko: (e: unknown) => void;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: '', porcentaje: '', tipo: 'iva', aplica_a: 'productos,combos,servicios' });

  const cargar = useCallback(async () => {
    try { setRows(await contaApi<Record<string, unknown>[]>('/api/conta/impuestos')); } catch (e) { ko(e); }
  }, [ko]);

  useEffect(() => { void cargar(); }, [cargar]);

  const crear = async () => {
    if (!nuevo.nombre) { ko(new Error('El nombre es obligatorio.')); return; }
    try {
      await contaApi('/api/conta/impuestos', {
        method: 'POST',
        body: {
          nombre: nuevo.nombre,
          porcentaje: Number(nuevo.porcentaje) || 0,
          tipo: nuevo.tipo,
          aplica_a: nuevo.aplica_a.split(',').map((s) => s.trim()).filter(Boolean),
        },
      });
      ok(`Impuesto «${nuevo.nombre}» creado.`);
      setNuevo({ nombre: '', porcentaje: '', tipo: 'iva', aplica_a: 'productos,combos,servicios' });
      await cargar();
    } catch (e) { ko(e); }
  };

  const actualizar = async (id: number, patch: Record<string, unknown>) => {
    try {
      await contaApi(`/api/conta/impuestos/${id}`, { method: 'PUT', body: patch });
      await cargar();
    } catch (e) { ko(e); }
  };

  return (
    <>
      {puedeGestion && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Nuevo impuesto</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Nombre *" style={{ flex: '1 1 160px' }}
              value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            <input className="input" type="number" step="0.01" placeholder="Porcentaje" style={{ flex: '0 0 130px' }}
              value={nuevo.porcentaje} onChange={(e) => setNuevo({ ...nuevo, porcentaje: e.target.value })} />
            <select className="input" style={{ flex: '0 0 140px' }} value={nuevo.tipo}
              onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })}>
              <option value="iva">iva</option><option value="exento">exento</option><option value="otro">otro</option>
            </select>
            <input className="input" placeholder="Aplica a (separado por comas)" style={{ flex: '1 1 220px' }}
              value={nuevo.aplica_a} onChange={(e) => setNuevo({ ...nuevo, aplica_a: e.target.value })} />
            <button className="btn btn-primary" onClick={crear}>Crear</button>
          </div>
        </section>
      )}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Impuestos</h3>
        <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
          El <b>NIT del cliente</b> se captura desde el día 1 y se imprime en la factura, pero se
          guarda <b>desacoplado de los impuestos</b>: no se calcula ni se reporta ningún impuesto en
          función del NIT hasta habilitar el módulo fiscal.
        </p>
        <table className="tbl">
          <thead><tr><th>Nombre</th><th>%</th><th>Tipo</th><th>Aplica a</th><th>Activo</th><th></th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={String(i.id)}>
                <td>{String(i.nombre)}</td>
                <td>{money(i.porcentaje)}%</td>
                <td>{String(i.tipo)}</td>
                <td>{Array.isArray(i.aplica_a) ? (i.aplica_a as string[]).join(', ') : '—'}</td>
                <td>{i.activo ? 'Sí' : 'No'}</td>
                <td>
                  {puedeGestion && (
                    <button className="btn btn-sm" onClick={() => void actualizar(Number(i.id), { activo: !i.activo })}>
                      {i.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin impuestos.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
