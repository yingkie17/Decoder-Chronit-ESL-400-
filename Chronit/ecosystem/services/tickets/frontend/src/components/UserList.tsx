'use client';

// =============================================================================
// CHRONIT ECOSYSTEM — Lista unificada de usuarios (visible para todo el staff)
// -----------------------------------------------------------------------------
// PROMPT FINAL: "Es VITAL que todos los roles tengan la lista completa de
// usuarios con todos sus datos (foto, ticket, kart, evento, transponder, rol)."
//
// Esta lista consume GET /api/usuarios, que devuelve por cada usuario su
// ticket actual (número + estado), evento, kart, transponder y rol. Incluye
// filtros de búsqueda, estado de ticket, evento, kart y rol.
//
// Props:
//   - actions(u, refresh): renderiza las acciones específicas del rol en la
//     última columna (asignar kart, editar, cambiar rol, marcar listo, etc.).
//   - title / subtitle: encabezado opcional.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { flagOf, ESTADO_TICKET } from '@/lib/constants';
import { useImageUrl } from '@/lib/image';

export interface UsuarioRow {
  id: number;
  uuid_global: string;
  nombre: string;
  apellido: string;
  email: string | null;
  telefono: string | null;
  carnet: string;
  foto: string | null;
  nacionalidad: string | null;
  rol: string;
  es_invitado: boolean;
  bloqueado: boolean;
  ticket_id: number | null;
  ticket_numero: number | null;
  ticket_estado: string | null;
  evento_id: number | null;
  evento_nombre: string | null;
  evento_modo: string | null;
  kart_id: number | null;
  kart_numero: number | null;
  kart_transponder: string | null;
}

interface EventoOpt {
  id: number;
  nombre: string;
}

interface Props {
  actions?: (u: UsuarioRow, refresh: () => void) => React.ReactNode;
  title?: string;
  subtitle?: string;
  onLoad?: (rows: UsuarioRow[]) => void;
}

const ALL_ESTADOS = ['PENDIENTE', 'ASIGNADO', 'LLAMANDO', 'PREPARADO', 'ACTIVO', 'FINALIZADO', 'AUSENTE', 'REZAGADO', 'USADO', 'REVOCADO'];
const ROLES = ['piloto', 'cajero', 'coordinador', 'admin', 'desarrollador'];

function EstadoBadge({ estado }: { estado: string | null }) {
  if (!estado) return <span style={{ color: '#5f7095' }}>Sin ticket</span>;
  const meta = ESTADO_TICKET[estado] || { label: estado, color: '#5f7095' };
  return (
    <span className="badge" style={{ borderColor: meta.color, color: meta.color, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
      {meta.label}
    </span>
  );
}

function Avatar({ u }: { u: UsuarioRow }) {
  const foto = useImageUrl(u.foto);
  if (foto) {
    return <img src={foto} alt={u.nombre} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', background: '#1e232e' }} />;
  }
  const ini = `${u.nombre?.[0] || ''}${u.apellido?.[0] || ''}`.toUpperCase();
  return <span style={{ width: 40, height: 40, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#1e232e', fontWeight: 700 }}>{ini}</span>;
}

export default function UserList({ actions, title, subtitle, onLoad }: Props) {
  const [rows, setRows] = useState<UsuarioRow[]>([]);
  const [eventos, setEventos] = useState<EventoOpt[]>([]);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const [eventoId, setEventoId] = useState('');
  const [rol, setRol] = useState('');
  const [kart, setKart] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (estado) p.set('estado', estado);
      if (eventoId) p.set('evento_id', eventoId);
      if (rol) p.set('rol', rol);
      if (kart) p.set('kart', kart);
      const data = await api<UsuarioRow[]>(`/api/usuarios?${p.toString()}`);
      setRows(data);
      onLoad?.(data);
    } catch (e) {
      setMsg(`${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [q, estado, eventoId, rol, kart, onLoad]);

  useEffect(() => {
    api<EventoOpt[]>('/api/eventos').then(setEventos).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  const totalConTicket = useMemo(() => rows.filter((r) => r.ticket_numero != null).length, [rows]);

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2>{title || 'Lista de usuarios'}</h2>
          {(subtitle || totalConTicket) && (
            <p style={{ color: '#8aa4c7', margin: '4px 0 0', fontSize: '0.85rem' }}>
              {subtitle || `${rows.length} usuarios · ${totalConTicket} con ticket`}
            </p>
          )}
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {msg && <p style={{ margin: '10px 0', color: '#dc2626' }}>{msg}</p>}

      {/* Barra de filtros */}
      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ flex: 2, minWidth: 180 }}>
          <label className="label">Buscar</label>
          <input className="input" placeholder="Nombre, carnet, email o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label">Estado ticket</label>
          <select className="input" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            {ALL_ESTADOS.map((s) => <option key={s} value={s}>{ESTADO_TICKET[s]?.label || s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Evento</label>
          <select className="input" value={eventoId} onChange={(e) => setEventoId(e.target.value)}>
            <option value="">Todos</option>
            {eventos.map((ev) => <option key={ev.id} value={ev.id}>{ev.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Kart</label>
          <input className="input" style={{ width: 90 }} placeholder="#kart" value={kart} onChange={(e) => setKart(e.target.value)} />
        </div>
        <div>
          <label className="label">Rol</label>
          <select className="input" value={rol} onChange={(e) => setRol(e.target.value)}>
            <option value="">Todos</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* Tabla (con tope de altura + scroll para no desbordar la página) */}
      <div className="kiosco-scroll" style={{ marginTop: 12 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Foto</th>
              <th>Piloto</th>
              <th>Carnet</th>
              <th>Email / Tel.</th>
              <th>Ticket</th>
              <th>Estado</th>
              <th>Kart</th>
              <th>Evento</th>
              <th>Transponder</th>
              <th>Rol</th>
              {actions && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} style={u.bloqueado ? { opacity: 0.55 } : undefined}>
                <td><Avatar u={u} /></td>
                <td>
                  <b>{u.nombre} {u.apellido}</b>
                  {u.es_invitado && <span className="badge" style={{ marginLeft: 6, borderColor: '#d97706', color: '#d97706' }}>invitado</span>}
                  {u.bloqueado && <span className="badge" style={{ marginLeft: 6, borderColor: '#dc2626', color: '#dc2626' }}>bloqueado</span>}
                </td>
                <td>{u.carnet}</td>
                <td>
                  {u.email || '—'}<br />
                  <span style={{ color: '#5f7095', fontSize: '0.78rem' }}>{u.telefono || ''}</span>
                </td>
                <td>{u.ticket_numero != null ? `#${u.ticket_numero}` : 'Sin ticket'}</td>
                <td><EstadoBadge estado={u.ticket_estado} /></td>
                <td>{u.kart_numero != null ? `#${u.kart_numero}` : 'Sin kart'}</td>
                <td>{u.evento_nombre || 'Sin evento'}</td>
                <td>{u.kart_transponder || '—'}</td>
                <td><span className="badge" style={{ borderColor: '#3b82f6', color: '#3b82f6' }}>{u.rol}</span></td>
                {actions && <td>{actions(u, load)}</td>}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={actions ? 11 : 10} style={{ color: '#5f7095' }}>{loading ? 'Cargando…' : 'No hay usuarios que coincidan con los filtros.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
