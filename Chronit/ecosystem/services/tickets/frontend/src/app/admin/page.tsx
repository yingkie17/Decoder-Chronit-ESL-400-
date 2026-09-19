'use client';

import { useEffect, useState } from 'react';
import { api, API_URL } from '@/lib/api';
import { useImageUrl } from '@/lib/image';
import { flagOf, ESTADO_TICKET } from '@/lib/constants';
import UserList, { type UsuarioRow } from '@/components/UserList';
import KartsTranspondersManager from '@/components/KartsTranspondersManager';
import GuardLoading from '@/components/GuardLoading';
import { useAuthGuard } from '@/lib/useAuthGuard';
import Link from 'next/link';

interface Cola {
  id: number; ticket_id: number; ticket_numero: number; estado: string; vestidor: number | null;
  nombre: string; apellido: string; carnet: string; nacionalidad: string | null;
}
interface PantallaItem { id: number; tipo: string; url: string; duracion_seg: number; activo: boolean; orden: number; }
interface Piloto { id: number; nombre: string; apellido: string; carnet: string; foto: string | null; nacionalidad: string | null; rol?: string; }
interface Resumen {
  usuarios_total: number;
  tickets_por_estado: { estado: string; total: number }[];
  eventos_por_estado: { estado: string; total: number }[];
  carreras_total: number;
  hoy: { creados_hoy: number; pagados_hoy: number };
}
interface HistorialRow {
  fecha: string;
  posicion: number | null;
  tiempo_total: string | null;
  mejor_vuelta: string | null;
  circuito: string | null;
}
interface PersonalRow {
  id: number; nombre: string; apellido: string; carnet: string;
  email: string | null; telefono: string | null; rol: string;
  turno: string | null; vestidor: number | null; bloqueado: boolean;
}
interface ReportePersonal {
  total: number;
  por_rol: Record<string, number>;
  por_turno: Record<string, number>;
  por_vestidor: Record<string, number>;
}

// Foto del piloto con resolución offline/online (si no hay, guion).
function PilotoFoto({ foto }: { foto: string | null }) {
  const url = useImageUrl(foto);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="foto" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />;
  }
  return <span style={{ color: '#5f7095' }}>—</span>;
}

export default function AdminPage() {
  const { ready } = useAuthGuard(['admin']);
  const [colas, setColas] = useState<Cola[]>([]);
  const [items, setItems] = useState<PantallaItem[]>([]);
  const [pilotos, setPilotos] = useState<Piloto[]>([]);
  const [qr, setQr] = useState<{ qr: string; piloto: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [personal, setPersonal] = useState<PersonalRow[]>([]);
  const [repPersonal, setRepPersonal] = useState<ReportePersonal | null>(null);
  const [pForm, setPForm] = useState({
    nombre: '', apellido: '', carnet: '', email: '', telefono: '', password: '',
    rol: 'cajero', turno: 'Mañana', vestidor: '',
  });

  const load = async () => {
    try {
      const c = await api<Cola[]>('/api/colas');
      setColas(c);
    } catch { /* offline */ }
    try {
      const it = await api<PantallaItem[]>('/api/config/pantalla');
      setItems(it);
    } catch { /* offline */ }
    try {
      const p = await api<Piloto[]>('/api/pilotos');
      setPilotos(p);
    } catch { /* offline */ }
    try {
      const r = await api<Resumen>('/api/reportes/resumen');
      setResumen(r);
    } catch { /* offline */ }
    try {
      const pe = await api<{ personal: PersonalRow[]; reporte: ReportePersonal }>('/api/personal');
      setPersonal(pe.personal);
      setRepPersonal(pe.reporte);
    } catch { /* sin permiso u offline */ }
  };
  useEffect(() => { load(); }, []);

  // Crear un premio/logro para un piloto
  const crearPremio = async (id: number, tipo: string, descripcion: string) => {
    setMsg('');
    try {
      await api(`/api/pilotos/${id}/palmares`, { method: 'POST', body: { tipo, descripcion } });
      setMsg(`Premio creado para el piloto #${id}`);
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  // Cambiar el rol de un usuario (promover a admin/taquilla/vestidor)
  const cambiarRol = async (id: number, rol: string) => {
    setMsg('');
    try {
      const r = await api<{ nombre: string; apellido: string }>('/api/auth/rol', {
        method: 'PUT', body: { usuario_id: id, rol },
      });
      setMsg(`Rol actualizado para ${r.nombre} ${r.apellido}`);
      await load();
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  // Subir foto de un piloto
  const subirFoto = async (e: React.ChangeEvent<HTMLInputElement>, id: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('usuario_id', String(id));
    setMsg('');
    try {
      const res = await fetch(`${API_URL}/api/uploads/photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('chronit_token')}` },
        body: fd,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setMsg('Foto actualizada');
      await load();
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  // Ver QR carné
  const verQR = async (id: number, nombre: string) => {
    setMsg('');
    try {
      const data = await api<{ qr: string }>(`/api/uploads/pilotos/${id}/qr`);
      setQr({ qr: data.qr, piloto: nombre });
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  // Historial de carreras de un piloto (modal)
  const [historial, setHistorial] = useState<{ piloto: string; rows: HistorialRow[] } | null>(null);
  const verHistorial = async (id: number, nombre: string) => {
    setMsg('');
    try {
      const rows = await api<HistorialRow[]>(`/api/pilotos/${id}/historial`);
      setHistorial({ piloto: nombre, rows });
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  // Bloquear / desbloquear cuenta
  const bloquear = async (id: number, bloqueado: boolean) => {
    setMsg('');
    try {
      const r = await api<{ nombre: string; apellido: string }>('/api/auth/bloqueo', { method: 'PUT', body: { usuario_id: id, bloqueado } });
      setMsg(`${bloqueado ? 'Cuenta bloqueada' : 'Cuenta desbloqueada'} para ${r.nombre} ${r.apellido}`);
      await load();
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  // Eliminar usuario (y registros asociados)
  const eliminarUsuario = async (id: number, nombre: string) => {
    if (!confirm(`¿Eliminar definitivamente a ${nombre} y todos sus registros? Esta acción no se puede deshacer.`)) return;
    setMsg('');
    try {
      await api(`/api/auth/${id}`, { method: 'DELETE' });
      setMsg(`${nombre} eliminado`);
      await load();
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  const accion = async (path: string, body: unknown, label: string, method: 'POST' | 'PUT' | 'DELETE' = 'POST') => {
    setMsg('');
    try {
      await api(path, { method, body });
      setMsg(`${label}`);
      await load();
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  // --- Módulo de personal (cajeros y coordinadores por turno/vestidor) ---
  const crearPersonal = async () => {
    setMsg('');
    if (!pForm.nombre || !pForm.carnet || !pForm.password) {
      setMsg('Nombre, carnet y contraseña son obligatorios');
      return;
    }
    try {
      await api('/api/personal', {
        method: 'POST',
        body: {
          nombre: pForm.nombre, apellido: pForm.apellido, carnet: pForm.carnet,
          email: pForm.email || null, telefono: pForm.telefono || null,
          password: pForm.password, rol: pForm.rol, turno: pForm.turno,
          vestidor: pForm.vestidor ? Number(pForm.vestidor) : null,
        },
      });
      setMsg(`Personal agregado: ${pForm.nombre}`);
      setPForm({ nombre: '', apellido: '', carnet: '', email: '', telefono: '', password: '', rol: 'cajero', turno: 'Mañana', vestidor: '' });
      await load();
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  const actualizarPersonal = async (id: number, patch: Partial<PersonalRow>) => {
    setMsg('');
    try {
      await api(`/api/personal/${id}`, { method: 'PUT', body: patch });
      await load();
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  const eliminarPersonal = async (id: number, nombre: string) => {
    if (!confirm(`¿Eliminar a ${nombre} del personal? Esta acción no se puede deshacer.`)) return;
    setMsg('');
    try {
      await api(`/api/personal/${id}`, { method: 'DELETE' });
      setMsg(`${nombre} eliminado`);
      await load();
    } catch (err) {
      setMsg(`${(err as Error).message}`);
    }
  };

  if (!ready) return <GuardLoading />;

  return (
    <main style={{ padding: 20, maxWidth: 1000, margin: '0 auto' }}>
      <div className="navbar" style={{ position: 'static', marginBottom: 20 }}>
        <Link href="/" style={{ fontWeight: 700 }}>CHRONIT</Link>
        <span style={{ color: '#8aa4c7' }}>Administración</span>
      </div>
      {msg && <p style={{ marginBottom: 14 }}>{msg}</p>}

      {/* Dashboard / Reportes */}
      <section className="card" style={{ marginBottom: 20 }}>
        <h2>Dashboard y Reportes</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', marginTop: 12 }}>
          <div className="card" style={{ textAlign: 'center', padding: 14 }}>
            <div style={{ fontSize: '1.8rem' }}>{resumen?.usuarios_total ?? '—'}</div>
            <div style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>Usuarios</div>
          </div>
          <div className="card" style={{ textAlign: 'center', padding: 14 }}>
            <div style={{ fontSize: '1.8rem' }}>{resumen?.hoy.creados_hoy ?? '—'}</div>
            <div style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>Tickets hoy</div>
          </div>
          <div className="card" style={{ textAlign: 'center', padding: 14 }}>
            <div style={{ fontSize: '1.8rem' }}>{resumen?.hoy.pagados_hoy ?? '—'}</div>
            <div style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>Pagados hoy</div>
          </div>
          <div className="card" style={{ textAlign: 'center', padding: 14 }}>
            <div style={{ fontSize: '1.8rem' }}>{resumen?.carreras_total ?? '—'}</div>
            <div style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>Carreras</div>
          </div>
        </div>
        <div className="row" style={{ gap: 20, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <h3 className="label">Tickets por estado</h3>
            <table className="tbl" style={{ marginTop: 8 }}>
              <tbody>
                {(resumen?.tickets_por_estado ?? []).map((t) => {
                  const te = ESTADO_TICKET[t.estado] || { label: t.estado, color: '#8aa4c7' };
                  return (
                    <tr key={t.estado}>
                      <td><span className="pill" style={{ background: `${te.color}22`, color: te.color }}>{te.label}</span></td>
                      <td style={{ textAlign: 'right' }}><b>{t.total}</b></td>
                    </tr>
                  );
                })}
                {!resumen?.tickets_por_estado?.length && <tr><td colSpan={2} style={{ color: '#5f7095' }}>Sin tickets.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <h3 className="label">Eventos por estado</h3>
            <table className="tbl" style={{ marginTop: 8 }}>
              <tbody>
                {(resumen?.eventos_por_estado ?? []).map((t) => (
                  <tr key={t.estado}>
                    <td className="pill" style={{ background: '#3b82f622', color: '#3b82f6', border: 'none' }}>{t.estado}</td>
                    <td style={{ textAlign: 'right' }}><b>{t.total}</b></td>
                  </tr>
                ))}
                {!resumen?.eventos_por_estado?.length && <tr><td colSpan={2} style={{ color: '#5f7095' }}>Sin eventos.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Módulo de personal: cajeros y coordinadores por turno/vestidor */}
      <section className="card" style={{ marginBottom: 20 }}>
        <h2>Personal — Cajeros y Coordinadores</h2>
        <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginBottom: 12 }}>
          Agrega trabajadores (cajero o coordinador de vestidor) y asígnales turno y vestidor.
        </p>

        {/* Reporte de personal */}
        {repPersonal && (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', marginBottom: 14 }}>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: '1.6rem' }}>{repPersonal.total}</div>
              <div style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>Total personal</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ color: '#8aa4c7', fontSize: '0.8rem', marginBottom: 4 }}>Por rol</div>
              {Object.entries(repPersonal.por_rol).map(([k, v]) => (
                <div key={k} style={{ fontSize: '0.85rem' }}>
                  <span style={{ textTransform: 'capitalize' }}>{k}</span>: <b>{v}</b>
                </div>
              ))}
              {!Object.keys(repPersonal.por_rol).length && <span style={{ color: '#5f7095', fontSize: '0.85rem' }}>—</span>}
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ color: '#8aa4c7', fontSize: '0.8rem', marginBottom: 4 }}>Por turno</div>
              {Object.entries(repPersonal.por_turno).map(([k, v]) => (
                <div key={k} style={{ fontSize: '0.85rem' }}>{k}: <b>{v}</b></div>
              ))}
              {!Object.keys(repPersonal.por_turno).length && <span style={{ color: '#5f7095', fontSize: '0.85rem' }}>—</span>}
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ color: '#8aa4c7', fontSize: '0.8rem', marginBottom: 4 }}>Por vestidor</div>
              {Object.entries(repPersonal.por_vestidor).map(([k, v]) => (
                <div key={k} style={{ fontSize: '0.85rem' }}>{k}: <b>{v}</b></div>
              ))}
              {!Object.keys(repPersonal.por_vestidor).length && <span style={{ color: '#5f7095', fontSize: '0.85rem' }}>—</span>}
            </div>
          </div>
        )}

        {/* Formulario de creación */}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <input className="input" placeholder="Nombre *" style={{ flex: '1 1 120px' }}
            value={pForm.nombre} onChange={(e) => setPForm({ ...pForm, nombre: e.target.value })} />
          <input className="input" placeholder="Apellido" style={{ flex: '1 1 120px' }}
            value={pForm.apellido} onChange={(e) => setPForm({ ...pForm, apellido: e.target.value })} />
          <input className="input" placeholder="Carnet *" style={{ flex: '1 1 110px' }}
            value={pForm.carnet} onChange={(e) => setPForm({ ...pForm, carnet: e.target.value })} />
          <input className="input" placeholder="Email" style={{ flex: '1 1 150px' }}
            value={pForm.email} onChange={(e) => setPForm({ ...pForm, email: e.target.value })} />
          <input className="input" placeholder="Teléfono" style={{ flex: '1 1 110px' }}
            value={pForm.telefono} onChange={(e) => setPForm({ ...pForm, telefono: e.target.value })} />
          <input className="input" placeholder="Contraseña *" type="password" style={{ flex: '1 1 130px' }}
            value={pForm.password} onChange={(e) => setPForm({ ...pForm, password: e.target.value })} />
          <select className="input" style={{ flex: '0 0 140px' }} value={pForm.rol}
            onChange={(e) => setPForm({ ...pForm, rol: e.target.value, vestidor: e.target.value === 'coordinador' ? pForm.vestidor : '' })}>
            <option value="cajero">Cajero</option>
            <option value="coordinador">Coordinador</option>
          </select>
          <select className="input" style={{ flex: '0 0 120px' }} value={pForm.turno}
            onChange={(e) => setPForm({ ...pForm, turno: e.target.value })}>
            <option value="Mañana">Mañana</option>
            <option value="Tarde">Tarde</option>
            <option value="Noche">Noche</option>
          </select>
          {pForm.rol === 'coordinador' && (
            <select className="input" style={{ flex: '0 0 120px' }} value={pForm.vestidor}
              onChange={(e) => setPForm({ ...pForm, vestidor: e.target.value })}>
              <option value="">Vestidor…</option>
              <option value="1">Vestidor 1</option>
              <option value="2">Vestidor 2</option>
            </select>
          )}
          <button className="btn btn-primary" onClick={crearPersonal}>Agregar personal</button>
        </div>

        {/* Tabla de personal */}
        <table className="tbl">
          <thead>
            <tr><th>Trabajador</th><th>Carnet</th><th>Rol</th><th>Turno</th><th>Vestidor</th><th>Estado</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {personal.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre} {p.apellido}<br /><span style={{ color: '#5f7095', fontSize: '0.75rem' }}>{p.email || p.telefono || '—'}</span></td>
                <td>{p.carnet}</td>
                <td>
                  <select className="input" style={{ minWidth: 120 }} value={p.rol}
                    onChange={(e) => actualizarPersonal(p.id, { rol: e.target.value as PersonalRow['rol'] })}>
                    <option value="cajero">Cajero</option>
                    <option value="coordinador">Coordinador</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>
                  <select className="input" style={{ minWidth: 100 }} value={p.turno || ''}
                    onChange={(e) => actualizarPersonal(p.id, { turno: e.target.value })}>
                    <option value="">—</option>
                    <option value="Mañana">Mañana</option>
                    <option value="Tarde">Tarde</option>
                    <option value="Noche">Noche</option>
                  </select>
                </td>
                <td>
                  {p.rol === 'coordinador' ? (
                    <select className="input" style={{ minWidth: 90 }} value={p.vestidor ?? ''}
                      onChange={(e) => actualizarPersonal(p.id, { vestidor: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">—</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                  ) : '—'}
                </td>
                <td>{p.bloqueado ? 'Bloqueado' : 'Activo'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-sm" onClick={() => actualizarPersonal(p.id, { bloqueado: !p.bloqueado })}>
                      {p.bloqueado ? 'Desbloquear' : 'Bloquear'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => eliminarPersonal(p.id, `${p.nombre} ${p.apellido}`)}>Eliminar</button>
                  </div>
                </td>
              </tr>
            ))}
            {!personal.length && <tr><td colSpan={7} style={{ color: '#5f7095' }}>Sin personal registrado. Agrega cajeros o coordinadores.</td></tr>}
          </tbody>
        </table>
      </section>

      {/* Colas: llamada a vestidores */}
      <section className="card" style={{ marginBottom: 20 }}>
        <h2>Tickets y Colas</h2>
        <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginBottom: 12 }}>
          Marca tickets y llámalos a un vestidor (1 o 2).
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn btn-warn" onClick={() => {
            const ids = colas.filter((c) => c.estado === 'espera').map((c) => c.ticket_id).slice(0, 5);
            if (ids.length) accion('/api/colas/llamar', { ticket_ids: ids, vestidor: 1 }, 'Llamados a Vestidor 1');
          }}>Llamar 5 a Vestidor 1</button>
          <button className="btn btn-warn" onClick={() => {
            const ids = colas.filter((c) => c.estado === 'espera').map((c) => c.ticket_id).slice(0, 5);
            if (ids.length) accion('/api/colas/llamar', { ticket_ids: ids, vestidor: 2 }, 'Llamados a Vestidor 2');
          }}>Llamar 5 a Vestidor 2</button>
        </div>
        <table className="tbl">
          <thead>
            <tr><th>#</th><th>Piloto</th><th>Nac.</th><th>Estado</th><th>Vestidor</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {colas.map((c) => (
              <tr key={c.id}>
                <td>{c.ticket_numero}</td>
                <td>{c.nombre} {c.apellido}</td>
                <td>{flagOf(c.nacionalidad)}</td>
                <td>{c.estado}</td>
                <td>{c.vestidor ? `${c.vestidor}` : '—'}</td>
                <td>
                  {['espera', 'llamado'].includes(c.estado) && (
                    <>
                      <button className="btn btn-sm" onClick={() =>
                        accion(`/api/colas/${c.ticket_id}/ready`, { ready: true }, 'Marcado Ready')}>Ready</button>
                      {c.vestidor !== 1 && <button className="btn btn-sm" onClick={() =>
                        accion(`/api/colas/${c.ticket_id}/vestidor`, { vestidor: 1 }, 'Vestidor 1')}>V1</button>}
                      {c.vestidor !== 2 && <button className="btn btn-sm" onClick={() =>
                        accion(`/api/colas/${c.ticket_id}/vestidor`, { vestidor: 2 }, 'Vestidor 2')}>V2</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!colas.length && <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin colas.</td></tr>}
          </tbody>
        </table>
      </section>

      {/* Configuración de pantalla */}
      <section className="card">
        <h2>Configuración de pantalla</h2>
        <div className="row" style={{ marginTop: 12 }}>
          <input className="input" id="configUrl" style={{ flex: 2 }} placeholder="URL de imagen o video" />
          <select className="input" id="configTipo" style={{ flex: 0.4 }}>
            <option value="imagen">Imagen</option>
            <option value="video">Video</option>
          </select>
          <input className="input" id="configDur" type="number" defaultValue={5} style={{ flex: 0.3 }} title="Duración (s)" />
          <button className="btn btn-primary" onClick={() => {
            const url = (document.getElementById('configUrl') as HTMLInputElement).value;
            const tipo = (document.getElementById('configTipo') as HTMLSelectElement).value;
            const dur = Number((document.getElementById('configDur') as HTMLInputElement).value) || 5;
            if (url) accion('/api/config/pantalla', { tipo, url, duracion_seg: dur, activo: true, orden: items.length + 1 }, 'Item añadido');
          }}>Añadir</button>
        </div>
        <table className="tbl" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>#</th><th>Tipo</th><th>URL</th><th>Dur.</th><th>Activo</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.orden}</td>
                <td>{it.tipo}</td>
                <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.url}</td>
                <td>{it.duracion_seg}s</td>
                <td>{it.activo ? 'Activo' : 'Inactivo'}</td>
                <td>
                  <button className="btn btn-sm btn-danger" onClick={() =>
                    accion(`/api/config/pantalla/${it.id}`, { activo: !it.activo }, it.activo ? 'Desactivado' : 'Activado', 'PUT')}>{it.activo ? 'Off' : 'On'}</button>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin ítems. Añade imágenes/videos para el carrusel.</td></tr>}
          </tbody>
        </table>
      </section>

      {/* Pilotos: premios, foto y QR/carné */}
      <section className="card" style={{ marginTop: 20 }}>
        <h2>Pilotos — Premios, foto y QR</h2>
        <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginBottom: 12 }}>
          Crea premios (palmarés), sube la foto y consulta el QR/carné de cada piloto.
        </p>
        <table className="tbl">
          <thead>
            <tr><th>Piloto</th><th>Nac.</th><th>Foto</th><th>Premio (palmarés)</th><th>QR</th><th>Rol</th></tr>
          </thead>
          <tbody>
            {pilotos.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre} {p.apellido} <span style={{ color: '#5f7095' }}>({p.carnet})</span></td>
                <td>{flagOf(p.nacionalidad)}</td>
                <td>
                  <PilotoFoto foto={p.foto} />
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    id={`foto-${p.id}`} onChange={(e) => subirFoto(e, p.id)} />
                  <button className="btn btn-sm" onClick={() => document.getElementById(`foto-${p.id}`)?.click()}>
                    Subir
                  </button>
                </td>
                <td>
                  <select className="input" defaultValue="trofeo" id={`prem-tipo-${p.id}`} style={{ minWidth: 120 }}>
                    <option value="trofeo">Trofeo</option>
                    <option value="medalla">Medalla</option>
                    <option value="titulo">Título</option>
                    <option value="record">Récord</option>
                  </select>
                  <input className="input" placeholder="Descripción" id={`prem-desc-${p.id}`}
                    style={{ marginTop: 4 }} />
                  <button className="btn btn-sm btn-success" style={{ marginTop: 4 }}
                    onClick={() => crearPremio(p.id,
                      (document.getElementById(`prem-tipo-${p.id}`) as HTMLSelectElement).value,
                      (document.getElementById(`prem-desc-${p.id}`) as HTMLInputElement).value)}>
                    Crear premio
                  </button>
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => verQR(p.id, `${p.nombre} ${p.apellido}`)}>
                    QR
                  </button>
                </td>
                <td>
                  <select className="input" value={p.rol || 'piloto'} style={{ minWidth: 110 }}
                    onChange={(e) => cambiarRol(p.id, e.target.value)}>
                    <option value="piloto">Piloto</option>
                    <option value="cajero">Cajero</option>
                    <option value="coordinador">Coordinador</option>
                    <option value="admin">Admin</option>
                    <option value="desarrollador">Desarrollador</option>
                  </select>
                </td>
              </tr>
            ))}
            {!pilotos.length && <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin pilotos registrados.</td></tr>}
          </tbody>
        </table>
        {qr && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3>Carné — {qr.piloto}</h3>
              <img src={qr.qr} alt="QR" style={{ width: 260, height: 260, margin: '12px 0' }} />
              <button className="btn" onClick={() => setQr(null)}>Cerrar</button>
            </div>
          </div>
        )}
      </section>

      {/* Karts y transponders (sincronizados con control de carrera) */}
      <KartsTranspondersManager />

      {/* Lista unificada de usuarios (requisito VITAL — visible para el staff) */}
      <UserList
        title="Lista completa de usuarios"
        subtitle="Gestión de roles, bloqueos y reportes por usuario."
        actions={(u: UsuarioRow, refresh) => (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              className="input" style={{ minWidth: 110 }} value={u.rol}
              onChange={async (e) => { await cambiarRol(u.id, e.target.value); refresh(); }}
            >
              <option value="piloto">Piloto</option>
              <option value="cajero">Cajero</option>
              <option value="coordinador">Coordinador</option>
              <option value="admin">Admin</option>
              <option value="desarrollador">Desarrollador</option>
            </select>
            <button className="btn btn-sm" onClick={() => verHistorial(u.id, `${u.nombre} ${u.apellido}`)}>Historial</button>
            <button className="btn btn-sm" onClick={async () => { await bloquear(u.id, !u.bloqueado); refresh(); }}>
              {u.bloqueado ? 'Desbloquear' : 'Bloquear'}
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => eliminarUsuario(u.id, `${u.nombre} ${u.apellido}`)}>Eliminar</button>
          </div>
        )}
      />

      {/* Modal de historial */}
      {historial && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ maxWidth: 560, maxHeight: '80vh', overflow: 'auto' }}>
            <h3>Historial — {historial.piloto}</h3>
            <table className="tbl" style={{ marginTop: 10 }}>
              <thead><tr><th>Fecha</th><th>Pos.</th><th>Mejor vuelta</th><th>Circuito</th></tr></thead>
              <tbody>
                {historial.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.fecha ? new Date(r.fecha).toLocaleString('es') : '—'}</td>
                    <td>{r.posicion ?? '—'}</td>
                    <td>{r.mejor_vuelta || '—'}</td>
                    <td>{r.circuito || '—'}</td>
                  </tr>
                ))}
                {!historial.rows.length && <tr><td colSpan={4} style={{ color: '#5f7095' }}>Sin carreras registradas.</td></tr>}
              </tbody>
            </table>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => setHistorial(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </main>
  );
}
