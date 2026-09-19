'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { flagOf, eventoColor, eventoLabel } from '@/lib/constants';
import UserList, { type UsuarioRow } from '@/components/UserList';
import KartsTranspondersManager from '@/components/KartsTranspondersManager';
import GuardLoading from '@/components/GuardLoading';
import { useAuthGuard } from '@/lib/useAuthGuard';
import Link from 'next/link';

interface Evento { id: number; nombre: string; fecha: string | null; hora: string | null; estado: string; total_drivers?: number; tipo_carrera?: string | null; modo?: string | null; }
interface Cola {
  id: number; ticket_id: number; ticket_numero: number; estado: string; vestidor: number | null;
  nombre: string; apellido: string; carnet: string; nacionalidad: string | null;
  kart_id?: number | null; transponder_id?: number | null;
}
interface Kart { id: number; numero: number; transponder: string | null; estado: string; }
interface Piloto { id: number; nombre: string; apellido: string; carnet: string; nacionalidad: string | null; }
interface CarreraActiva { activa: boolean; status: string | null; circuit_name: string | null; }

export default function VestidorPage() {
  const { ready } = useAuthGuard(['coordinador', 'admin']);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [eventoId, setEventoId] = useState('');
  const [colas, setColas] = useState<Cola[]>([]);
  const [karts, setKarts] = useState<Kart[]>([]);
  const [kartSel, setKartSel] = useState<Record<number, string>>({});
  const [vestidor, setVestidor] = useState(1);
  const [grupo, setGrupo] = useState(5);
  const [msg, setMsg] = useState('');
  const [carrera, setCarrera] = useState<CarreraActiva>({ activa: false, status: null, circuit_name: null });
  const [confirmPreparada, setConfirmPreparada] = useState(false);
  // Modal de reemplazo
  const [reempTicket, setReempTicket] = useState<Cola | null>(null);
  const [reempQ, setReempQ] = useState('');
  const [reempRes, setReempRes] = useState<Piloto[]>([]);

  const loadEventos = async () => { const evs = await api<Evento[]>('/api/eventos'); setEventos(evs); };
  const loadCarrera = async () => { try { const c = await api<CarreraActiva>('/api/eventos/carrera-activa'); setCarrera(c); } catch { setCarrera({ activa: false, status: null, circuit_name: null }); } };
  const loadKarts = async () => { try { setKarts(await api<Kart[]>('/api/karts')); } catch { setKarts([]); } };

  useEffect(() => { loadEventos().catch(() => {}); loadCarrera().catch(() => {}); loadKarts().catch(() => {}); }, []);

  useEffect(() => {
    if (!eventoId) { setColas([]); return; }
    api<Cola[]>(`/api/colas?evento_id=${eventoId}`).then(setColas).catch(() => setColas([]));
  }, [eventoId]);

  const refetch = async () => {
    if (eventoId) setColas(await api<Cola[]>(`/api/colas?evento_id=${eventoId}`));
    await loadCarrera();
    // REQ 4: recargar eventos para reflejar el estado que mueve el vestidor
    // (pendiente -> llamando -> preparada -> activo -> finalizado).
    await loadEventos();
  };

  const accion = async (path: string, body: unknown, label: string) => {
    setMsg('');
    try {
      await api(path, { method: 'POST', body });
      setMsg(`${label}`);
      await refetch();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const llamarSiguiente = () => {
    if (!eventoId) return setMsg('Selecciona un evento primero.');
    accion('/api/colas/siguiente', { evento_id: Number(eventoId), vestidor, grupo: Number(grupo) }, `Llamados a Vestidor ${vestidor}`);
  };

  const toggleReady = async (c: Cola) => {
    setMsg('');
    try {
      if (c.estado === 'ready') {
        await api(`/api/colas/${c.ticket_id}/ready`, { method: 'POST', body: { ready: false } });
      } else {
        const kartId = kartSel[c.ticket_id] ? Number(kartSel[c.ticket_id]) : null;
        await api(`/api/colas/${c.ticket_id}/ready`, { method: 'POST', body: { ready: true, kart_id: kartId } });
      }
      const kk = { ...kartSel }; delete kk[c.ticket_id];
      setKartSel(kk);
      await refetch();
      await loadKarts();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  // El transponder va montado en el kart: al asignar el kart queda vinculado
  // automáticamente (un solo campo, sin vincular dos veces).

  // Coordinador: marcar el evento como INCOMPLETO (faltan pilotos) -> notifica a la cajera.
  const marcarIncompleto = async () => {
    if (!eventoId) return setMsg('Selecciona un evento primero.');
    if (!confirm('¿Marcar el evento como INCOMPLETO y notificar a la cajera para que complete la lista de pilotos?')) return;
    setMsg('');
    try {
      await api(`/api/eventos/${eventoId}/incompleto`, { method: 'POST' });
      setMsg('Evento marcado como INCOMPLETO. Se notificó a la cajera.');
      await loadEventos();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const eliminar = async (c: Cola) => {
    if (!confirm(`¿Eliminar el ticket #${c.ticket_numero} de la lista de carrera?`)) return;
    setMsg('');
    try {
      await api(`/api/colas/${c.ticket_id}`, { method: 'DELETE' });
      setMsg(`Ticket #${c.ticket_numero} eliminado`);
      await refetch();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const buscarReemplazo = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await api<Piloto[]>(`/api/auth/search?q=${encodeURIComponent(reempQ)}`);
    setReempRes(data);
  };

  const confirmarReemplazo = async (p: Piloto) => {
    if (!reempTicket) return;
    setMsg('');
    try {
      await api(`/api/colas/${reempTicket.ticket_id}/reemplazar`, { method: 'POST', body: { usuario_id: p.id } });
      setMsg(`Competidor #${reempTicket.ticket_numero} reemplazado por ${p.nombre} ${p.apellido}`);
      setReempTicket(null); setReempQ(''); setReempRes([]);
      await refetch();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const todosListos = colas.length > 0 && colas.every((c) => c.estado === 'ready');
  const eventoActual = eventos.find((e) => String(e.id) === eventoId);

  const confirmarPreparada = async () => {
    if (!eventoId) return;
    setMsg('');
    try {
      const r = await api<{ estado: string }>(`/api/eventos/${eventoId}/preparada`, { method: 'POST' });
      setMsg(`Evento en estado: ${r.estado}`);
      setConfirmPreparada(false);
      await loadEventos();
    } catch (err) { setMsg(`${(err as Error).message}`); setConfirmPreparada(false); }
  };

  if (!ready) return <GuardLoading />;

  return (
    <main style={{ padding: 20, maxWidth: 1000, margin: '0 auto' }}>
      <div className="navbar" style={{ position: 'static', marginBottom: 20 }}>
        <Link href="/" style={{ fontWeight: 700 }}>CHRONIT</Link>
        <span style={{ color: '#8aa4c7' }}>Vestidores</span>
        <Link href="/kiosco" className="btn" style={{ marginLeft: 'auto' }}>Kiosco</Link>
      </div>
      {msg && <p style={{ marginBottom: 14 }}>{msg}</p>}

      {/* Estado de la carrera y selector de evento */}
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className={`badge`} style={{
            borderColor: carrera.activa ? '#d97706' : '#16a34a',
            color: carrera.activa ? '#d97706' : '#16a34a',
            fontWeight: 600,
          }}>
            {carrera.activa ? `Carrera en curso${carrera.circuit_name ? ` — ${carrera.circuit_name}` : ''}` : 'Sin carrera activa'}
          </div>
          <select className="input" style={{ flex: 1 }} value={eventoId} onChange={(e) => setEventoId(e.target.value)}>
            <option value="">— Selecciona un evento —</option>
            {eventos.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.nombre} · {ev.fecha || 's/fecha'} · {ev.total_drivers ?? 0} · {ev.estado}</option>
            ))}
          </select>
        </div>
      </section>

      {/* Llamar siguiente grupo */}
      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Llamar siguiente grupo</h2>
        <div className="row" style={{ alignItems: 'end', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <div>
            <label className="label">Vestidor</label>
            <select className="input" value={vestidor} onChange={(e) => setVestidor(Number(e.target.value))}>
              <option value={1}>Vestidor 1</option>
              <option value={2}>Vestidor 2</option>
            </select>
          </div>
          <div>
            <label className="label">Tamaño del grupo</label>
            <input className="input" type="number" min={1} max={20} value={grupo} onChange={(e) => setGrupo(Number(e.target.value))} />
          </div>
          <button className="btn btn-warn" onClick={llamarSiguiente} disabled={!eventoId}>Llamar siguiente grupo</button>
        </div>
      </section>

      {/* Lista de la carrera */}
      <section className="card">
        <h2>Lista de carrera {eventoActual ? `— ${eventoActual.nombre}` : ''}</h2>
        {!eventoId && <p style={{ color: '#5f7095' }}>Selecciona un evento para ver su lista.</p>}
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>#</th><th>Piloto</th><th>Nac.</th><th>Vestidor</th><th>Kart / Transponder</th><th>Listo</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {colas.map((c) => (
              <tr key={c.id}>
                <td>{c.ticket_numero}</td>
                <td>{c.nombre} {c.apellido} <span style={{ color: '#5f7095' }}>({c.carnet})</span></td>
                <td>{flagOf(c.nacionalidad)}</td>
                <td>{c.vestidor ? `${c.vestidor}` : '—'}</td>
                <td>
                  {(() => {
                    const kk = karts.find((k) => k.id === c.kart_id);
                    if (kk) {
                      return (
                        <span style={{ color: '#16a34a', fontWeight: 700 }}>
                          #{kk.numero}{kk.transponder ? ` · ${kk.transponder}` : ''}
                        </span>
                      );
                    }
                    return (
                      <select className="input" style={{ minWidth: 120, maxWidth: 160 }} value={kartSel[c.ticket_id] || ''} onChange={(e) => setKartSel({ ...kartSel, [c.ticket_id]: e.target.value })}>
                        <option value="">Kart…</option>
                        {karts.filter((k) => k.estado !== 'asignado').map((k) => (
                          <option key={k.id} value={k.id}>#{k.numero}{k.transponder ? ` · ${k.transponder}` : ''}</option>
                        ))}
                      </select>
                    );
                  })()}
                </td>
                <td>
                  {c.estado === 'ready' ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ color: '#16a34a', fontWeight: 700 }}>Listo</span>
                      <button className="btn btn-sm" onClick={() => toggleReady(c)}>Desmarcar</button>
                    </div>
                  ) : (
                    <button className="btn btn-sm btn-success" onClick={() => toggleReady(c)}>Listo</button>
                  )}
                </td>
                <td>
                  <button className="btn btn-sm btn-danger" onClick={() => eliminar(c)}>Eliminar</button>
                  <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => { setReempTicket(c); setReempQ(''); setReempRes([]); }}>Reemplazar</button>
                </td>
              </tr>
            ))}
            {!colas.length && <tr><td colSpan={7} style={{ color: '#5f7095' }}>Sin tickets en este evento.</td></tr>}
          </tbody>
        </table>

        {/* Marcar evento como preparada / faltan pilotos */}
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-success" disabled={!eventoId || !todosListos || carrera.activa} onClick={() => setConfirmPreparada(true)}>
            Poner evento en «preparada»
          </button>
          <button className="btn btn-warn" disabled={!eventoId} onClick={marcarIncompleto}>
            Faltan pilotos
          </button>
          {!todosListos && eventoId && <span style={{ color: '#d97706', fontSize: '0.8rem' }}>Marca todos los competidores como listos para poder preparar.</span>}
          {carrera.activa && <span style={{ color: '#d97706', fontSize: '0.8rem' }}>Hay una carrera en curso; no se puede preparar aún.</span>}
        </div>

        {eventoActual && (
          <p style={{ marginTop: 12, fontSize: '0.85rem', color: eventoColor(eventoActual.estado) }}>
            Estado del evento: <b>{eventoLabel(eventoActual.estado)}</b>
            {eventoActual.estado === 'incompleto' && ' — La cajera deberá asignar pilotos para volver a PENDIENTE.'}
          </p>
        )}
      </section>

      {/* Karts y transponders (sincronizados con control de carrera) */}
      <KartsTranspondersManager />

      {/* Lista unificada de usuarios (requisito VITAL — visible para el staff) */}
      <UserList
        title="Lista completa de usuarios"
        subtitle="Todos los pilotos con su ticket, kart, evento y transponder."
        actions={(u: UsuarioRow, refresh) => (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {u.ticket_id && (
              <>
                <button
                  className="btn btn-sm btn-success"
                  onClick={async () => {
                    setMsg('');
                    try {
                      await api(`/api/colas/${u.ticket_id}/ready`, { method: 'POST', body: { ready: true } });
                      refresh();
                    } catch (err) { setMsg(`${(err as Error).message}`); }
                  }}
                >
                  Listo
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (!confirm(`¿Marcar a ${u.nombre} ${u.apellido} como AUSENTE? Sigue en el evento y puede volver a llamarse.`)) return;
                    await api(`/api/colas/${u.ticket_id}/ausente`, { method: 'POST' });
                    refresh();
                  }}
                >
                  Ausente
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (!confirm(`¿Marcar a ${u.nombre} ${u.apellido} como REZAGADO? Nunca se presentó: se elimina del evento y su ticket vuelve a la lista de pendientes.`)) return;
                    await api(`/api/colas/${u.ticket_id}/rezagado`, { method: 'POST' });
                    refresh();
                  }}
                >
                  Rezagado
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setReempTicket({
                    id: u.ticket_id!, ticket_id: u.ticket_id!, ticket_numero: u.ticket_numero!,
                    nombre: u.nombre, apellido: u.apellido, carnet: u.carnet,
                    nacionalidad: u.nacionalidad, estado: u.ticket_estado || '', vestidor: null,
                  })}
                >
                  Reemplazar
                </button>
              </>
            )}
          </div>
        )}
      />

      {/* Modal de confirmación "preparada" (doble rol) */}
      {confirmPreparada && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ maxWidth: 460, textAlign: 'center' }}>
            <h3>Confirmar estado «preparada»</h3>
            <p style={{ color: '#8aa4c7', margin: '12px 0' }}>
              Estás a punto de poner el evento <b>{eventoActual?.nombre}</b> en estado
              <b> «preparada»</b>. A partir de ahí el control de carrera podrá iniciarlo.
              Recuerda que la misma persona puede tener doble rol, por eso pedimos confirmación.
            </p>
            <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
              <button className="btn btn-success" onClick={confirmarPreparada}>Sí, preparar evento</button>
              <button className="btn" onClick={() => setConfirmPreparada(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de reemplazo de competidor */}
      {reempTicket && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ maxWidth: 520 }}>
            <h3>Reemplazar competidor #{reempTicket.ticket_numero}</h3>
            <p style={{ color: '#8aa4c7', margin: '8px 0' }}>
              Sustituye a <b>{reempTicket.nombre} {reempTicket.apellido}</b> por otro piloto. Mantiene el mismo número y posición.
            </p>
            <form className="row" onSubmit={buscarReemplazo}>
              <input className="input" style={{ flex: 1 }} placeholder="Buscar piloto (carnet/nombre)" value={reempQ} onChange={(e) => setReempQ(e.target.value)} />
              <button className="btn btn-primary" type="submit">Buscar</button>
            </form>
            <div style={{ marginTop: 12 }}>
              {reempRes.map((p) => (
                <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 8, borderBottom: '1px solid #1e232e' }}>
                  <span>{flagOf(p.nacionalidad)}</span>
                  <span style={{ flex: 1 }}>{p.nombre} {p.apellido} · <b>{p.carnet}</b></span>
                  <button className="btn btn-sm btn-success" onClick={() => confirmarReemplazo(p)}>Usar</button>
                </div>
              ))}
              {!reempRes.length && <p style={{ color: '#5f7095', fontSize: '0.8rem' }}>Sin resultados.</p>}
            </div>
            <button className="btn" style={{ marginTop: 14 }} onClick={() => setReempTicket(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </main>
  );
}
