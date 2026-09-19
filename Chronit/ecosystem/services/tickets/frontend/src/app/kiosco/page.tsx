'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { flagOf, ESTADO_TICKET, EVENTOS_NO_SELECCIONABLES, eventoColor, eventoLabel } from '@/lib/constants';
import { useImageUrl } from '@/lib/image';
import UserList from '@/components/UserList';
import GuardLoading from '@/components/GuardLoading';
import { useAuthGuard } from '@/lib/useAuthGuard';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
interface Evento {
  id: number;
  nombre: string;
  fecha: string | null;
  hora: string | null;
  estado: string;
  tipo_carrera: string | null;
  tipo_pista?: string | null;
  largo_km?: number | null;
  modo?: string | null;
  vueltas?: number | null;
  vueltas_clasificacion?: number | null;
  duracion_min?: number | null;
  pilotos_por_equipo?: number | null;
  max_pilotos?: number | null;
  total_drivers?: number;
}
interface TicketList {
  id: number;
  usuario_id: number;
  numero: number;
  estado: string;
  evento_id: number | null;
  kart_id?: number | null;
  transponder_id?: number | null;
  pagado_en?: string | null;
  nombre: string;
  apellido: string;
  carnet: string;
  email: string | null;
  telefono: string | null;
  foto: string | null;
  nacionalidad: string | null;
  creado_en: string;
}
interface Kart {
  id: number;
  numero: number;
  transponder: string | null;
  transponder_descripcion: string | null;
  estado: string;
  ticket_asignado: number | null;
  piloto_nombre: string | null;
  piloto_apellido: string | null;
}
interface Transponder {
  id: number;
  description: string | null;
  kart_id: string | null;
  kart_status: string | null;
  estado: string;
}

const EMPTY_EVENTO = { nombre: '', fecha: '', hora: '', tipo_carrera: 'position', laps_limit: 10, time_limit_seconds: 900, qualifying_laps: 10, pilots_per_team: 1, max_pilotos: 0 };

// Avatar de piloto con resolución offline/online de la foto (si no hay, bandera).
function MiniAvatar({ foto, nacionalidad, size = 30 }: { foto: string | null; nacionalidad: string | null; size?: number }) {
  const url = useImageUrl(foto);
  if (url) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  return <span>{flagOf(nacionalidad)}</span>;
}

// Texto legible de la configuración del modo de carrera.
function modoTexto(ev: Evento): string {
  const m = ev.tipo_carrera || ev.modo || 'position';
  const d = ev.duracion_min != null ? `${ev.duracion_min} min` : '';
  const v = ev.vueltas != null ? `${ev.vueltas} vueltas` : '';
  const vc = ev.vueltas_clasificacion != null ? `${ev.vueltas_clasificacion} v. clasi` : '';
  const eq = ev.pilotos_por_equipo != null && ev.pilotos_por_equipo > 1 ? `${ev.pilotos_por_equipo} pilotos/equipo` : '';
  const parts = [d, v, vc, eq].filter(Boolean).join(' · ');
  const label =
    m === 'position' ? 'Race Position'
    : m === 'time_attack' || m === 'por_tiempo' ? 'Time Attack'
    : m === 'classification' || m === 'qualifying_laps' || m === 'clasificacion' ? 'Clasificatorio'
    : m === 'endurance' || m === 'resistencia' ? 'Endurance'
    : m === 'personalizado' ? 'Personalizado'
    : 'Time Attack';
  return parts ? `${label} — ${parts}` : label;
}

export default function KioscoPage() {
  const { ready } = useAuthGuard(['cajero', 'admin']);
  const [msg, setMsg] = useState('');

  // Datos maestros
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [tickets, setTickets] = useState<TicketList[]>([]);
  const [karts, setKarts] = useState<Kart[]>([]);
  const [transponders, setTransponders] = useState<Transponder[]>([]);
  const [tpError, setTpError] = useState('');
  const [kartNombre, setKartNombre] = useState('');
  const [kartTp, setKartTp] = useState('');
  // Vinculación transponder↔kart
  const [montarTp, setMontarTp] = useState('');
  const [montarKart, setMontarKart] = useState('');

  // Modals / formulario de evento
  const [formModal, setFormModal] = useState(false);
  const [inEdit, setInEdit] = useState<Evento | null>(null);
  const [evForm, setEvForm] = useState(EMPTY_EVENTO);

  // Modal "Agregar piloto"
  const [addEvent, setAddEvent] = useState<Evento | null>(null);
  const [addSel, setAddSel] = useState<number[]>([]);

  // Modal de acciones del piloto
  const [pilotEv, setPilotEv] = useState<Evento | null>(null);
  const [pilotT, setPilotT] = useState<TicketList | null>(null);
  const [pf, setPf] = useState({ nombre: '', apellido: '', email: '', telefono: '', carnet: '', nacionalidad: '' });
  const [kartSel, setKartSel] = useState<number | ''>('');

  const refreshAll = async () => {
    try { setEventos(await api<Evento[]>('/api/eventos')); } catch { setEventos([]); }
    try { setTickets(await api<TicketList[]>('/api/tickets')); } catch { setTickets([]); }
    try { setKarts(await api<Kart[]>('/api/karts')); } catch { setKarts([]); }
    try {
      setTransponders(await api<Transponder[]>('/api/karts/transponders'));
      setTpError('');
    } catch (err) { setTransponders([]); setTpError((err as Error).message); }
  };
  useEffect(() => { refreshAll(); }, []);

  const crearKart = async () => {
    setMsg('');
    if (!kartNombre) return setMsg('Ingresa el número del kart.');
    try {
      await api('/api/karts', { method: 'POST', body: { numero: Number(kartNombre), transponder: kartTp || null } });
      setMsg(`Kart #${kartNombre} creado`);
      setKartNombre(''); setKartTp('');
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const montarTransponder = async () => {
    setMsg('');
    if (!montarTp || !montarKart) return setMsg('Selecciona un transponder y un kart.');
    try {
      await api(`/api/karts/${montarKart}/vincular-transponder`, { method: 'POST', body: { transponder_id: Number(montarTp) } });
      setMsg(`Transponder #${montarTp} montado en el kart #${montarKart}`);
      setMontarTp(''); setMontarKart('');
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const desmontarTransponder = async (kartNumero: string) => {
    setMsg('');
    try {
      await api(`/api/karts/${kartNumero}/desvincular-transponder`, { method: 'POST', body: {} });
      setMsg(`Transponder desmontado del kart #${kartNumero}`);
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  // --- Derivados por evento ---
  const pilotsOf = (evo: Evento) => tickets.filter((t) => t.evento_id === evo.id);
  const pagadosDe = (evo: Evento) => pilotsOf(evo).filter((t) => t.estado !== 'PENDIENTE').length;
  const kartsEnEvento = (evo: Evento) =>
    karts.filter((k) => { const tk = tickets.find((t) => t.id === k.ticket_asignado); return !!(tk && tk.evento_id === evo.id); }).length;
  const kartDeTicket = (tid: number) => karts.find((k) => k.ticket_asignado === tid);

  // Karts disponibles globalmente (no asignados, candidatos a cambiar).
  const kartsDisponibles = useMemo(() => karts.filter((k) => k.estado !== 'asignado'), [karts]);

  // Eventos ordenados: primero los INCOMPLETO (parpadean), luego por fecha.
  const eventosOrdenados = useMemo(() => {
    const score = (e: Evento) => (e.estado === 'incompleto' ? 0 : 1);
    return [...eventos].sort((a, b) => score(a) - score(b) || (a.fecha || '').localeCompare(b.fecha || ''));
  }, [eventos]);

  // REQ 2: separar en dos secciones. "Finalizados" = estados cerrados
  // (finalizado / cancelado / insuficiente); el resto son "Pendientes".
  const eventosPendientes = useMemo(
    () => eventosOrdenados.filter((e) => !EVENTOS_NO_SELECCIONABLES.includes(e.estado)),
    [eventosOrdenados]
  );
  const eventosFinalizados = useMemo(
    () => eventosOrdenados.filter((e) => EVENTOS_NO_SELECCIONABLES.includes(e.estado)),
    [eventosOrdenados]
  );

  // ---------------------------------------------------------------------------
  // Evento: crear / editar / borrar
  // ---------------------------------------------------------------------------
  const buildEventBody = (f = evForm) => {
    const b: Record<string, unknown> = { name: f.nombre, event_date: f.fecha || null, event_time: f.hora || null, track_type: 'karting' };
    if (f.tipo_carrera === 'position') { b.race_mode = 'position'; b.laps_limit = Number(f.laps_limit) || 10; }
    else if (f.tipo_carrera === 'time_attack') { b.race_mode = 'time_attack'; b.time_limit_seconds = Math.max(0, Math.round(Number(f.time_limit_seconds))) || 900; }
    else if (f.tipo_carrera === 'classification') { b.race_mode = 'classification'; b.qualifying_laps = Number(f.qualifying_laps) || 10; }
    else if (f.tipo_carrera === 'endurance') { b.race_mode = 'endurance'; b.time_limit_seconds = Math.max(0, Math.round(Number(f.time_limit_seconds))) || 3600; b.pilots_per_team = Number(f.pilots_per_team) || 1; }
    else { b.race_mode = 'personalizado'; b.time_limit_seconds = Math.max(0, Math.round(Number(f.time_limit_seconds))) || 600; b.laps_limit = Number(f.laps_limit) || 10; }
    if (f.max_pilotos) b.max_drivers = Number(f.max_pilotos);
    return b;
  };

  const guardarEvento = async () => {
    setMsg('');
    try {
      if (inEdit) {
        await api(`/api/eventos/${inEdit.id}`, { method: 'PUT', body: buildEventBody() });
        setMsg('Evento actualizado');
      } else {
        await api('/api/eventos', { method: 'POST', body: buildEventBody() });
        setMsg('Evento creado (estado: pendiente)');
      }
      setFormModal(false); setInEdit(null); setEvForm(EMPTY_EVENTO);
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const abrirNuevo = () => { setInEdit(null); setEvForm(EMPTY_EVENTO); setFormModal(true); };
  const abrirEditar = (ev: Evento) => {
    setInEdit(ev);
    setEvForm({
      nombre: ev.nombre,
      fecha: ev.fecha || '',
      hora: ev.hora || '',
      tipo_carrera: ev.tipo_carrera || (ev.modo === 'por_vueltas' ? 'position' : ev.modo === 'por_tiempo' ? 'time_attack' : ev.modo === 'clasificacion' ? 'classification' : ev.modo === 'resistencia' ? 'endurance' : 'position'),
      laps_limit: ev.vueltas ?? 10,
      time_limit_seconds: (ev.duracion_min ?? 15) * 60,
      qualifying_laps: ev.vueltas_clasificacion ?? 10,
      pilots_per_team: ev.pilotos_por_equipo ?? 1,
      max_pilotos: ev.max_pilotos ?? 0,
    });
    setFormModal(true);
  };

  const borrarEvento = async (ev: Evento) => {
    if (!confirm(`¿Borrar el evento "${ev.nombre}"? Se eliminarán también sus tickets y pilotos asignados.`)) return;
    setMsg('');
    try {
      await api(`/api/eventos/${ev.id}`, { method: 'DELETE' });
      setMsg('Evento eliminado');
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const marcarEstado = async (ev: Evento, estado: 'insuficiente' | 'cancelado') => {
    if (!confirm(`¿Cambiar el evento "${ev.nombre}" a ${estado.toUpperCase()}?`)) return;
    setMsg('');
    try { await api(`/api/eventos/${ev.id}/${estado}`, { method: 'POST' }); setMsg('Estado actualizado'); await refreshAll(); }
    catch (err) { setMsg(`${(err as Error).message}`); }
  };

  // ---------------------------------------------------------------------------
  // Agregar pilotos a un evento
  // ---------------------------------------------------------------------------
  const disponiblesParaAdd = (_evo: Evento) =>
    tickets.filter((t) =>
      t.evento_id == null &&
      (t.estado === 'PENDIENTE' || t.estado === 'ASIGNADO' || t.estado === 'AUSENTE' || t.estado === 'REZAGADO')
    );

  const guardarSeleccion = async () => {
    if (!addEvent || !addSel.length) return setMsg('Selecciona al menos un piloto.');
    setMsg('');
    try {
      for (const id of addSel) {
        const t = tickets.find((x) => x.id === id);
        if (!t) continue;
        if (t.estado === 'PENDIENTE') await api(`/api/tickets/${t.id}/pagar`, { method: 'POST' });
        await api(`/api/tickets/${t.id}/asignar`, { method: 'POST', body: { evento_id: addEvent.id } });
      }
      setMsg(`${addSel.length} piloto(s) agregado(s) al evento`);
      setAddSel([]); setAddEvent(null);
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  // ---------------------------------------------------------------------------
  // Acciones de piloto en el modal
  // ---------------------------------------------------------------------------
  const abrirPiloto = (ev: Evento, t: TicketList) => {
    setPilotEv(ev); setPilotT(t);
    setKartSel(kartDeTicket(t.id)?.id ?? '');
    setPf({ nombre: t.nombre, apellido: t.apellido, email: t.email || '', telefono: t.telefono || '', carnet: t.carnet, nacionalidad: t.nacionalidad || '' });
  };

  const guardarPiloto = async () => {
    if (!pilotT) return;
    setMsg('');
    try {
      await api(`/api/pilotos/${pilotT.usuario_id}`, {
        method: 'PUT',
        body: { nombre: pf.nombre, apellido: pf.apellido, email: pf.email || null, telefono: pf.telefono || null, carnet: pf.carnet, nacionalidad: pf.nacionalidad || null },
      });
      setMsg('Piloto actualizado');
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const marcarPagado = async () => {
    if (!pilotT) return;
    setMsg('');
    try {
      await api(`/api/tickets/${pilotT.id}/pagar`, { method: 'POST' });
      setMsg('Ticket marcado como pagado (ASIGNADO)');
      await refreshAll(); await loadPilotsModal();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const reactivar = async () => {
    if (!pilotT) return;
    setMsg('');
    try {
      await api(`/api/tickets/${pilotT.id}/reactivar`, { method: 'POST' });
      setMsg('Ticket reactivado a PENDIENTE');
      setPilotT(null);
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const cambiarKart = async () => {
    if (!pilotT) return;
    if (kartSel === '') return setMsg('Selecciona un kart.');
    setMsg('');
    try {
      await api(`/api/karts/${kartSel}/asignar`, { method: 'POST', body: { ticket_id: pilotT.id } });
      setMsg('Kart asignado al piloto');
      await refreshAll(); await loadPilotsModal();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const quitarKart = async () => {
    if (!pilotT) return;
    const k = kartDeTicket(pilotT.id);
    if (!k) return;
    setMsg('');
    try {
      await api(`/api/karts/${k.id}/desasignar`, { method: 'POST' });
      setMsg('Kart liberado');
      await refreshAll(); await loadPilotsModal();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const quitarDelEvento = async () => {
    if (!pilotT || !pilotEv) return;
    if (!confirm(`¿Quitar a ${pilotT.nombre} ${pilotT.apellido} del evento "${pilotEv.nombre}"?`)) return;
    setMsg('');
    try {
      await api(`/api/tickets/${pilotT.id}/quitar`, { method: 'POST' });
      setMsg('Piloto quitado del evento');
      setPilotT(null);
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  const eliminarTicket = async () => {
    if (!pilotT || !confirm(`¿Eliminar el ticket #${pilotT.numero} definitivamente?`)) return;
    setMsg('');
    try {
      await api(`/api/tickets/${pilotT.id}`, { method: 'DELETE' });
      setMsg('Ticket eliminado');
      setPilotT(null);
      await refreshAll();
    } catch (err) { setMsg(`${(err as Error).message}`); }
  };

  // Re-cargar el ticket abierto en el modal tras una acción (para refrescar su estado).
  const loadPilotsModal = async () => {
    if (!pilotT) return;
    try {
      const t = await api<TicketList>(`/api/tickets/${pilotT.id}`);
      setPilotT((prev) => (prev ? { ...prev, ...t } : prev));
    } catch { /* el ticket pudo eliminarse */ }
  };

  const te = (estado: string) => ESTADO_TICKET[estado] || { label: estado, color: '#8aa4c7' };

  // Tarjeta de un evento (se reutiliza en las secciones Pendientes/Finalizados).
  // La tabla de pilotos tiene scroll propio para que la card no crezca.
  const renderEventoCard = (ev: Evento) => {
    const pilots = pilotsOf(ev);
    const incompleto = ev.estado === 'incompleto';
    const seleccionable = !EVENTOS_NO_SELECCIONABLES.includes(ev.estado);
    return (
      <section key={ev.id}
        className={`card ${incompleto ? 'evento-incompleto' : ''}`}
        style={{ borderLeft: `6px solid ${eventoColor(ev.estado)}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Cabecera */}
        <div style={{ display: 'flex', alignItems: 'start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2 }}>{ev.nombre || 'Evento sin nombre'}</div>
            <div style={{ color: '#8aa4c7', fontSize: '0.85rem', marginTop: 4 }}>
              {modoTexto(ev)}
            </div>
            <div style={{ color: '#5f7095', fontSize: '0.82rem', marginTop: 3 }}>
              {ev.fecha || 's/fecha'} {ev.hora ? `· ${ev.hora}` : ''}
              {ev.tipo_pista ? ` · ${ev.tipo_pista}` : ''}
              {ev.largo_km ? ` · ${ev.largo_km} km` : ''}
            </div>
          </div>
          <span className="pill" style={{ background: `${eventoColor(ev.estado)}22`, color: eventoColor(ev.estado), whiteSpace: 'nowrap' }}>
            {eventoLabel(ev.estado)}
          </span>
        </div>

        {/* Conteos */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '14px 0' }}>
          <span className="badge" style={{ borderColor: '#3b82f6', color: '#3b82f6' }}>Pilotos {pilots.length}{ev.max_pilotos ? `/${ev.max_pilotos}` : ''}</span>
          <span className="badge" style={{ borderColor: '#16a34a', color: '#16a34a' }}>Karts {kartsEnEvento(ev)}/{karts.length}</span>
          <span className="badge" style={{ borderColor: '#d97706', color: '#d97706' }}>Pagados {pagadosDe(ev)}/{pilots.length}</span>
        </div>

        {/* Acciones (cajera) */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn btn-sm" onClick={() => abrirEditar(ev)}>Editar</button>
          <button className="btn btn-sm btn-success" disabled={!seleccionable} title={!seleccionable ? 'Evento finalizado/cancelado/insuficiente: no puede recibir pilotos' : ''} onClick={() => { setAddEvent(ev); setAddSel([]); }}>Agregar piloto</button>
          <button className="btn btn-sm btn-danger" onClick={() => borrarEvento(ev)}>Eliminar</button>
          {incompleto && (
            <>
              <button className="btn btn-sm btn-warn" onClick={() => marcarEstado(ev, 'insuficiente')}>Insuficiente</button>
              <button className="btn btn-sm" onClick={() => marcarEstado(ev, 'cancelado')}>Cancelar</button>
            </>
          )}
        </div>

        {/* Tabla de pilotos inscritos (scroll interno) */}
        <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Foto</th><th>Piloto</th><th>Carnet</th><th>Ticket</th><th>Estado</th><th>Kart / Transponder</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {pilots.map((t) => {
                const k = kartDeTicket(t.id);
                const tt = te(t.estado);
                return (
                  <tr key={t.id}>
                    <td><b>#{t.numero}</b></td>
                    <td><MiniAvatar foto={t.foto} nacionalidad={t.nacionalidad} size={30} /></td>
                    <td>{t.nombre} {t.apellido}</td>
                    <td>{t.carnet}</td>
                    <td>#{t.numero}</td>
                    <td><span className="pill" style={{ background: `${tt.color}22`, color: tt.color }}>{tt.label}</span></td>
                    <td>{k ? `#${k.numero}${k.transponder ? ` · ${k.transponder}` : ''}` : '—'}</td>
                    <td><button className="btn btn-sm" onClick={() => abrirPiloto(ev, t)}>Acciones</button></td>
                  </tr>
                );
              })}
              {!pilots.length && <tr><td colSpan={8} style={{ color: '#5f7095' }}>Sin pilotos asignados.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  if (!ready) return <GuardLoading />;

  return (
    <main style={{ padding: 20, maxWidth: 1280, margin: '0 auto' }}>
      <div className="navbar" style={{ position: 'static', marginBottom: 20 }}>
        <Link href="/" style={{ fontWeight: 700 }}>CHRONIT</Link>
        <span style={{ color: '#8aa4c7' }}>Kiosco (Taquilla)</span>
        <Link href="/cliente" className="btn" style={{ marginLeft: 'auto' }}>Kiosco de cliente</Link>
        <Link href="/vestidor" className="btn">Vestidores</Link>
      </div>
      {msg && <p style={{ marginBottom: 14 }}>{msg}</p>}

      {/* Barra superior de acciones */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <button className="btn btn-primary" onClick={abrirNuevo}>Nuevo evento</button>
        <span style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>
          {eventos.length} evento(s) · {tickets.length} ticket(s) · {karts.length} kart(s)
        </span>
      </div>

      {/* CARDS DE EVENTOS — separadas en Pendientes / Finalizados */}
      <h2 style={{ margin: '4px 0 12px' }}>Pendientes ({eventosPendientes.length})</h2>
      {eventosPendientes.length ? (
        <div className="eventos-grid">{eventosPendientes.map(renderEventoCard)}</div>
      ) : (
        <p style={{ color: '#5f7095', padding: '8px 0 18px' }}>No hay eventos pendientes.</p>
      )}

      <h2 style={{ margin: '24px 0 12px' }}>Finalizados ({eventosFinalizados.length})</h2>
      {eventosFinalizados.length ? (
        <div className="eventos-grid">{eventosFinalizados.map(renderEventoCard)}</div>
      ) : (
        <p style={{ color: '#5f7095', padding: '8px 0 18px' }}>No hay eventos finalizados.</p>
      )}

      {!eventos.length && (
        <p style={{ color: '#5f7095', textAlign: 'center', padding: 40 }}>
          No hay eventos. Crea el primero con «Nuevo evento».
        </p>
      )}

      {/* Gestión de karts / transponders (desde el control de carrera) */}
      <section className="card" style={{ marginTop: 22, marginBottom: 20 }}>
        <h2>Karts / Transponders</h2>
        <p style={{ color: '#5f7095', fontSize: '0.85rem', margin: '4px 0 8px' }}>
          Lista sincronizada con control de carrera: los karts y transponders que ves aquí son los que están en el módulo de carrera.
        </p>

        {/* Crear kart */}
        <div className="row" style={{ alignItems: 'end', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <div>
            <label className="label">Nº Kart</label>
            <input className="input" type="number" placeholder="1" value={kartNombre} onChange={(e) => setKartNombre(e.target.value)} />
          </div>
          <div>
            <label className="label">Transponder</label>
            <input className="input" placeholder="TP-101" value={kartTp} onChange={(e) => setKartTp(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={crearKart}>Crear kart</button>
        </div>

        {/* Montar transponder en kart */}
        <div className="row" style={{ alignItems: 'end', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <div>
            <label className="label">Transponder libre</label>
            <select className="input" value={montarTp} onChange={(e) => setMontarTp(e.target.value)}>
              <option value="">— Sin transponder —</option>
              {transponders.filter((t) => t.estado === 'disponible').map((t) => (
                <option key={t.id} value={t.id}>#{t.id}{t.description ? ` · ${t.description}` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Kart destino</label>
            <select className="input" value={montarKart} onChange={(e) => setMontarKart(e.target.value)}>
              <option value="">— Elegir kart —</option>
              {karts.filter((k) => !k.transponder).map((k) => (
                <option key={k.id} value={k.numero}>#{k.numero}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={montarTransponder} disabled={!montarTp || !montarKart}>Montar en kart</button>
        </div>

        {/* Tabla de karts (con tope de altura + scroll) */}
        <div className="kiosco-scroll" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead>
              <tr><th>Kart</th><th>Transponder</th><th>Estado</th><th>Piloto</th></tr>
            </thead>
            <tbody>
              {karts.map((k) => (
                <tr key={k.id}>
                  <td><b>#{k.numero}</b></td>
                  <td>{k.transponder ? `${k.transponder}${k.transponder_descripcion ? ` · ${k.transponder_descripcion}` : ''}` : '—'}</td>
                  <td>
                    <span className="badge" style={{ borderColor: k.estado === 'asignado' ? '#3b82f6' : '#16a34a', color: k.estado === 'asignado' ? '#3b82f6' : '#16a34a' }}>
                      {k.estado === 'asignado' ? 'Asignado' : 'Disponible'}
                    </span>
                  </td>
                  <td>{k.piloto_nombre ? `${k.piloto_nombre} ${k.piloto_apellido || ''}` : '—'}</td>
                </tr>
              ))}
              {!karts.length && <tr><td colSpan={4} style={{ color: '#5f7095' }}>No hay karts registrados. Crea uno arriba.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Tabla de transponders */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 8px' }}>
          <h3 style={{ margin: 0 }}>Transponders</h3>
          <button className="btn btn-sm" onClick={() => refreshAll()}>Actualizar</button>
        </div>
        {tpError && (
          <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: 8 }}>
            No se pudo cargar la lista desde control de carrera: {tpError}
          </p>
        )}
        <div className="kiosco-scroll">
          <table className="tbl">
            <thead>
              <tr><th>ID</th><th>Descripción</th><th>Kart</th><th>Estado</th><th>Acción</th></tr>
            </thead>
            <tbody>
              {transponders.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.id}</b></td>
                  <td>{t.description || '—'}</td>
                  <td>{t.kart_id ? `#${t.kart_id}` : '—'}</td>
                  <td>
                    <span className="badge" style={{
                      borderColor: t.estado === 'en_pista' ? '#d97706' : t.estado === 'mantenimiento' ? '#7c3aed' : t.estado === 'montado' ? '#3b82f6' : '#16a34a',
                      color: t.estado === 'en_pista' ? '#d97706' : t.estado === 'mantenimiento' ? '#7c3aed' : t.estado === 'montado' ? '#3b82f6' : '#16a34a',
                    }}>
                      {t.estado === 'en_pista' ? 'En pista' : t.estado === 'mantenimiento' ? 'Mantenimiento' : t.estado === 'montado' ? 'Montado' : 'Disponible'}
                    </span>
                  </td>
                  <td>{t.kart_id ? (
                    <button className="btn btn-sm" onClick={() => desmontarTransponder(t.kart_id!)}>Desmontar</button>
                  ) : (
                    <span style={{ color: '#5f7095', fontSize: '0.8rem' }}>—</span>
                  )}</td>
                </tr>
              ))}
              {!transponders.length && <tr><td colSpan={5} style={{ color: '#5f7095' }}>No hay transponders registrados en control de carrera.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lista unificada de usuarios */}
      <UserList title="Lista completa de usuarios" subtitle="Pilotos, ticket, kart, evento, transponder y rol." />

      {/* MODAL: crear/editar evento */}
      {formModal && (
        <div className="modal-overlay fade-in" onClick={() => setFormModal(false)}>
          <div className="modal-box card" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 16 }}>{inEdit ? 'Editar evento' : 'Nuevo evento'}</h2>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 100%' }}>
                <label className="label">Nombre</label>
                <input className="input" value={evForm.nombre} onChange={(e) => setEvForm({ ...evForm, nombre: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label className="label">Fecha</label>
                <input className="input" type="date" value={evForm.fecha} onChange={(e) => setEvForm({ ...evForm, fecha: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 110px' }}>
                <label className="label">Hora</label>
                <input className="input" type="time" value={evForm.hora} onChange={(e) => setEvForm({ ...evForm, hora: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 100%' }}>
                <label className="label">Modo</label>
                <select className="input" value={evForm.tipo_carrera} onChange={(e) => setEvForm({ ...evForm, tipo_carrera: e.target.value })}>
                  <option value="position">Race Position (vueltas)</option>
                  <option value="time_attack">Time Attack (tiempo)</option>
                  <option value="classification">Clasificatorio</option>
                  <option value="endurance">Endurance (relevos)</option>
                  <option value="personalizado">Personalizado</option>
                </select>
              </div>
              {(evForm.tipo_carrera === 'position' || evForm.tipo_carrera === 'personalizado') && (
                <div style={{ flex: '1 1 120px' }}>
                  <label className="label">Vueltas</label>
                  <input className="input" type="number" min={1} value={evForm.laps_limit} onChange={(e) => setEvForm({ ...evForm, laps_limit: Number(e.target.value) })} />
                </div>
              )}
              {(evForm.tipo_carrera === 'time_attack' || evForm.tipo_carrera === 'endurance' || evForm.tipo_carrera === 'personalizado') && (
                <div style={{ flex: '1 1 140px' }}>
                  <label className="label">Duración (min)</label>
                  <input className="input" type="number" min={1} value={Math.round(Number(evForm.time_limit_seconds) / 60)}
                    onChange={(e) => setEvForm({ ...evForm, time_limit_seconds: Number(e.target.value) * 60 })} />
                </div>
              )}
              {evForm.tipo_carrera === 'classification' && (
                <div style={{ flex: '1 1 160px' }}>
                  <label className="label">Vueltas de clasificación</label>
                  <input className="input" type="number" min={1} value={evForm.qualifying_laps} onChange={(e) => setEvForm({ ...evForm, qualifying_laps: Number(e.target.value) })} />
                </div>
              )}
              {evForm.tipo_carrera === 'endurance' && (
                <div style={{ flex: '1 1 140px' }}>
                  <label className="label">Pilotos/equipo</label>
                  <input className="input" type="number" min={1} value={evForm.pilots_per_team} onChange={(e) => setEvForm({ ...evForm, pilots_per_team: Number(e.target.value) })} />
                </div>
              )}
              <div style={{ flex: '1 1 130px' }}>
                <label className="label">Máx. pilotos</label>
                <input className="input" type="number" min={0} value={evForm.max_pilotos} onChange={(e) => setEvForm({ ...evForm, max_pilotos: Number(e.target.value) })} />
              </div>
            </div>
            <div className="row" style={{ gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setFormModal(false); setInEdit(null); setEvForm(EMPTY_EVENTO); }}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarEvento}>{inEdit ? 'Guardar' : 'Crear evento'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: agregar piloto */}
      {addEvent && (
        <div className="modal-overlay fade-in" onClick={() => setAddEvent(null)}>
          <div className="modal-box card" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 6 }}>Agregar piloto — {addEvent.nombre}</h2>
            <p style={{ color: '#8aa4c7', fontSize: '0.85rem', marginBottom: 14 }}>
              Tickets PENDIENTES o ASIGNADOS sin evento. Los PENDIENTES se marcarán pagados al agregarse.
            </p>
            <div style={{ maxHeight: 360, overflow: 'auto' }}>
              <table className="tbl">
                <thead><tr><th></th><th>#</th><th>Piloto</th><th>Carnet</th><th>Estado</th></tr></thead>
                <tbody>
                  {disponiblesParaAdd(addEvent).map((t) => (
                    <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setAddSel((s) => s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id])}>
                      <td><input type="checkbox" readOnly checked={addSel.includes(t.id)} /></td>
                      <td><b>#{t.numero}</b></td>
                      <td><MiniAvatar foto={t.foto} nacionalidad={t.nacionalidad} size={24} /> {t.nombre} {t.apellido}</td>
                      <td>{t.carnet}</td>
                      <td><span className="pill" style={{ background: `${te(t.estado).color}22`, color: te(t.estado).color }}>{te(t.estado).label}</span></td>
                    </tr>
                  ))}
                  {!disponiblesParaAdd(addEvent).length && <tr><td colSpan={5} style={{ color: '#5f7095' }}>No hay tickets disponibles.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setAddEvent(null)}>Cancelar</button>
              <button className="btn btn-success" disabled={!addSel.length} onClick={guardarSeleccion}>Agregar seleccionados</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: acciones del piloto */}
      {pilotT && pilotEv && (
        <div className="modal-overlay fade-in" onClick={() => setPilotT(null)}>
          <div className="modal-box card" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <MiniAvatar foto={pilotT.foto} nacionalidad={pilotT.nacionalidad} size={44} />
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>{pilotT.nombre} {pilotT.apellido}</h2>
                <div style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>{pilotT.carnet} · Ticket #{pilotT.numero} · {eventoLabel(pilotEv.estado)}</div>
              </div>
              <button className="btn btn-sm btn-danger" onClick={eliminarTicket}>Ticket</button>
            </div>

            {/* Ticket */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <span className="pill" style={{ background: `${te(pilotT.estado).color}22`, color: te(pilotT.estado).color }}>{te(pilotT.estado).label}</span>
              {pilotT.estado === 'PENDIENTE' && <button className="btn btn-sm btn-warn" onClick={marcarPagado}>Marcar pagado</button>}
              {['AUSENTE', 'REZAGADO'].includes(pilotT.estado) && <button className="btn btn-sm" onClick={reactivar}>Reactivar a PENDIENTE</button>}
              {['ASIGNADO', 'LLAMANDO', 'PREPARADO', 'ACTIVO'].includes(pilotT.estado) && (
                <button className="btn btn-sm btn-danger" onClick={quitarDelEvento}>Quitar del evento</button>
              )}
            </div>

            {/* Editar datos del piloto */}
            <h3 className="label">Editar datos</h3>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ flex: '1 1 150px' }}><label className="label">Nombre</label><input className="input" value={pf.nombre} onChange={(e) => setPf({ ...pf, nombre: e.target.value })} /></div>
              <div style={{ flex: '1 1 150px' }}><label className="label">Apellido</label><input className="input" value={pf.apellido} onChange={(e) => setPf({ ...pf, apellido: e.target.value })} /></div>
              <div style={{ flex: '1 1 100%' }}><label className="label">Email</label><input className="input" value={pf.email} onChange={(e) => setPf({ ...pf, email: e.target.value })} /></div>
              <div style={{ flex: '1 1 150px' }}><label className="label">Teléfono</label><input className="input" value={pf.telefono} onChange={(e) => setPf({ ...pf, telefono: e.target.value })} /></div>
              <div style={{ flex: '1 1 150px' }}><label className="label">Carnet</label><input className="input" value={pf.carnet} onChange={(e) => setPf({ ...pf, carnet: e.target.value })} /></div>
              <div style={{ flex: '1 1 150px' }}><label className="label">Nacionalidad</label><input className="input" value={pf.nacionalidad} onChange={(e) => setPf({ ...pf, nacionalidad: e.target.value })} /></div>
            </div>
            <button className="btn btn-sm btn-primary" onClick={guardarPiloto}>Guardar piloto</button>

            {/* Kart / Transponder (un solo campo: el transponder viene del kart) */}
            <h3 className="label" style={{ marginTop: 16 }}>Kart / Transponder</h3>
            <p style={{ color: '#5f7095', fontSize: '0.8rem', margin: '0 0 8px' }}>
              El kart ya tiene su transponder vinculado; al asignarlo se toma automáticamente.
            </p>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ flex: '1 1 180px' }} value={kartSel} onChange={(e) => setKartSel(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— Sin kart —</option>
                {kartsDisponibles.map((k) => <option key={k.id} value={k.id}>#{k.numero}{k.transponder ? ` · ${k.transponder}` : ''}</option>)}
              </select>
              <button className="btn btn-sm" onClick={cambiarKart}>Asignar kart</button>
              {kartDeTicket(pilotT.id) && <button className="btn btn-sm btn-danger" onClick={quitarKart}>Desasignar</button>}
            </div>

            <div className="row" style={{ gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setPilotT(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
