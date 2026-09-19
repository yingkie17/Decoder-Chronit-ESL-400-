// =============================================================================
// CHRONIT — Kiosco de Cliente (self-service) — Client Component
// -----------------------------------------------------------------------------
// Pantalla táctil minimalista para el lugar físico. Flujo:
//   1) «Generar ticket» -> pantalla que pide el usuario
//   2) Buscador por email / carnet / nombre / celular -> resultados
//   3) Si existe: elegir y «Generar ticket»
//   4) Si no existe: modal «Registrar piloto» (foto + datos) -> luego generar
// =============================================================================
'use client';

import { useState } from 'react';
import { api, API_URL, getToken } from '@/lib/api';
import { useImageUrl } from '@/lib/image';
import { flagOf, NATIONALITIES } from '@/lib/constants';
import ImagePicker from './ImagePicker';

interface Piloto {
  id: number;
  nombre: string;
  apellido: string;
  email: string | null;
  telefono: string | null;
  carnet: string;
  foto: string | null;
  nacionalidad: string | null;
  edad: number | null;
  genero: string | null;
}
interface Ticket { id: number; numero: number; estado: string; usuario_id: number; }

const EMPTY = { nombre: '', apellido: '', email: '', telefono: '', carnet: '', nacionalidad: '', edad: '', genero: '', password: '' };

interface TicketFull {
  id: number;
  numero: number;
  estado: string;
  usuario_id: number;
  carnet?: string;
  nombre?: string;
  apellido?: string;
  evento_nombre?: string | null;
  fecha?: string | null;
  hora?: string | null;
  modo?: string | null;
  tipo_carrera?: string | null;
}

// Avatar de piloto con resolución offline/online de la foto (si no hay, bandera).
function PilotoAvatar({ foto, nacionalidad, size = 46 }: { foto: string | null; nacionalidad: string | null; size?: number }) {
  const url = useImageUrl(foto);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  }
  return <span style={{ fontSize: size / 28 + 'rem' }}>{flagOf(nacionalidad) || ''}</span>;
}

export default function ClienteKiosk() {
  const [view, setView] = useState<'inicio' | 'buscar' | 'ticket'>('inicio');
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Piloto[]>([]);
  const [sel, setSel] = useState<Piloto | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [ticketInfo, setTicketInfo] = useState<TicketFull | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [esInvitado, setEsInvitado] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Modal de registro
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [foto, setFoto] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [regMsg, setRegMsg] = useState('');

  const up = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const buscar = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(''); setSel(null); setTicket(null); setTicketInfo(null); setQr(null); setEsInvitado(false);
    setBusy(true);
    try {
      if (!q.trim()) { setRes([]); return; }
      const data = await api<Piloto[]>('/api/auth/search-publico?q=' + encodeURIComponent(q.trim()));
      setRes(data);
    } catch (err) { setMsg((err as Error).message); }
    finally { setBusy(false); }
  };

  // Crear piloto (público). Luego preguntar «¿generar ticket?».
  const registrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setRegMsg('');
    try {
      const data = await api<{ token: string; user: Piloto }>('/api/auth/register', {
        method: 'POST',
        body: {
          nombre: form.nombre,
          apellido: form.apellido,
          email: form.email || null,
          telefono: form.telefono || null,
          carnet: form.carnet,
          nacionalidad: form.nacionalidad || null,
          edad: form.edad ? Number(form.edad) : null,
          genero: form.genero || null,
          foto: null,
          password: form.password,
        },
      });
      // Subir la foto si se eligió (multipart) con el token del operador del kiosco
      if (foto) {
        try {
          const token = getToken();
          const fd = new FormData();
          fd.append('usuario_id', String(data.user.id));
          const blob = await (await fetch(foto)).blob();
          fd.append('photo', blob, 'piloto.jpg');
          const headers: Record<string, string> = {};
          if (token) headers.Authorization = `Bearer ${token}`;
          await fetch(`${API_URL}/api/uploads/photo`, { method: 'POST', headers, body: fd, credentials: 'include' });
        } catch { /* foto opcional */ }
      }
      setSel({ ...data.user, foto: data.user.foto || null });
      setModal(false);
      setForm(EMPTY); setFoto(null); setPreview(null);
      setMsg('Cuenta creada. Ahora genera el ticket para el nuevo piloto.');
    } catch (err) {
      setRegMsg((err as Error).message);
    } finally { setBusy(false); }
  };

  // Cargar el QR público de un ticket (sin token) para mostrarlo/imprimirlo.
  const cargarQr = async (ticketId: number) => {
    try {
      const data = await api<{ qr: string; ticket: TicketFull }>(`/api/tickets/${ticketId}/qr-publico`);
      setQr(data.qr);
      setTicketInfo(data.ticket);
    } catch { /* QR opcional */ }
  };

  // Generar ticket para un piloto ya registrado (o invitado). Usa el endpoint
  // público self-service (no exige sesión de taquilla/admin).
  const generar = async () => {
    if (!sel) return;
    setMsg(''); setBusy(true);
    try {
      const data = await api<Ticket>('/api/tickets/publico', { method: 'POST', body: { usuario_id: sel.id } });
      setTicket(data);
      setEsInvitado(false);
      await cargarQr(data.id);
      setView('ticket');
    } catch (err) {
      setMsg((err as Error).message);
    } finally { setBusy(false); }
  };

  // «Competir como invitado»: genera cuenta de invitado + ticket sin registrarse.
  const asInvitado = async () => {
    setMsg(''); setTicket(null); setQr(null); setBusy(true);
    try {
      const data = await api<{ user: Piloto; ticket: Ticket }>('/api/auth/invitado-publico', { method: 'POST', body: {} });
      setSel({ id: data.user.id, nombre: data.user.nombre, apellido: data.user.apellido, email: data.user.email, telefono: data.user.telefono, carnet: data.user.carnet, foto: null, nacionalidad: null, edad: null, genero: null });
      setTicket(data.ticket);
      setEsInvitado(true);
      await cargarQr(data.ticket.id);
      setView('ticket');
    } catch (err) {
      setMsg((err as Error).message);
    } finally { setBusy(false); }
  };

  // Imprimir el ticket (solo texto + QR, sin foto) usando la vista de impresión.
  const imprimir = () => window.print();

  const reiniciar = () => {
    setView('inicio'); setQ(''); setRes([]); setSel(null); setTicket(null); setTicketInfo(null); setQr(null); setEsInvitado(false); setMsg('');
  };

  const selNombre = sel ? `${sel.nombre} ${sel.apellido}`.trim() : '';

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'linear-gradient(160deg,#0b0d12,#151a26)' }}>
      {/* Barra superior */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 28px', borderBottom: '1px solid #232a38' }}>
        <span style={{ fontWeight: 800, fontSize: '1.25rem', letterSpacing: '0.03em' }}>CHRONIT</span>
        <span style={{ marginLeft: 'auto', color: '#8aa4c7', fontSize: '0.82rem' }}>Kiosco de piloto</span>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {/* PANTALLA 1 — Inicio */}
        {view === 'inicio' && (
          <div className="fade-in" style={{ textAlign: 'center', maxWidth: 560 }}>
            <h1 style={{ fontSize: '2.3rem', marginBottom: 10 }}>¡Bienvenido!</h1>
            <p style={{ color: '#8aa4c7', fontSize: '1.05rem', marginBottom: 30 }}>
              Presiona para generar tu ticket y correr con nosotros.
            </p>
            <button className="kiosk-btn kiosk-btn-primary" onClick={() => setView('buscar')} style={{ fontSize: '1.5rem', padding: '26px 60px' }}>
              Generar ticket
            </button>
          </div>
        )}

        {/* PANTALLA 2 — Buscar / registrar usuario */}
        {view === 'buscar' && (
          <div style={{ width: '100%', maxWidth: 980 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
              <button className="kiosk-btn" onClick={reiniciar}>Volver</button>
              <div>
                <h1 style={{ fontSize: '1.6rem' }}>¿Quién va a correr?</h1>
                <p style={{ color: '#8aa4c7', fontSize: '0.92rem' }}>Busca por correo, carnet, nombre o celular.</p>
              </div>
            </div>

            {msg && <p style={{ color: '#e2b93a', marginBottom: 14 }}>{msg}</p>}

            <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
              {/* Card: buscar */}
              <div className="card" style={{ padding: 24 }}>
                <h2 style={{ marginBottom: 16 }}>Buscar piloto</h2>
                <form onSubmit={buscar} style={{ display: 'flex', gap: 10 }}>
                  <input
                    className="input"
                    style={{ flex: 1, padding: '14px 16px', fontSize: '1.05rem' }}
                    placeholder="Email, carnet, nombre o celular"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  <button className="kiosk-btn kiosk-btn-primary" disabled={busy}>Buscar</button>
                </form>

                <div style={{ marginTop: 16, maxHeight: 360, overflow: 'auto' }}>
                  {res.length === 0 && !busy && (
                    <p style={{ color: '#5f7095', textAlign: 'center', padding: '20px 0' }}>
                      Escribe para buscar. Si no aparece, registra al piloto.
                    </p>
                  )}
                  {res.map((p) => {
                    const activo = sel?.id === p.id;
                    return (
                      <div key={p.id} onClick={() => { setSel(p); setTicket(null); setMsg(''); }}
                        style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 10px', borderRadius: 12, cursor: 'pointer', border: activo ? '1px solid #3b82f6' : '1px solid transparent', background: activo ? 'rgba(59,130,246,0.12)' : 'transparent' }}>
                        {p.foto ? (
                          <PilotoAvatar foto={p.foto} nacionalidad={p.nacionalidad} size={46} />
                        ) : (
                          <span style={{ fontSize: '1.6rem' }}>{flagOf(p.nacionalidad)}</span>
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700 }}>{p.nombre} {p.apellido}</div>
                          <div style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
                            {p.carnet}
                          </div>
                        </div>
                        <span className="pill" style={{ background: activo ? 'rgba(59,130,246,0.2)' : 'rgba(22,163,74,0.15)', color: activo ? '#3b82f6' : '#16a34a' }}>
                          {activo ? 'Elegido' : 'Elegir'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card: registrar nuevo piloto (abre modal) — o correr como invitado */}
              <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', borderStyle: 'dashed' }}>
                <h2 style={{ marginBottom: 8 }}>¿Primera vez?</h2>
                <p style={{ color: '#8aa4c7', marginBottom: 18 }}>
                  Registra al piloto con sus datos y su foto, y listo.
                </p>
                <button className="kiosk-btn kiosk-btn-accent" onClick={() => { setModal(true); setRegMsg(''); }} style={{ fontSize: '1.05rem', padding: '16px 32px' }}>
                  Registrar piloto
                </button>
                <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 10px', color: '#5f7095', fontSize: '0.8rem' }}>
                  <span style={{ flex: 1, height: 1, background: '#232a38' }} />
                  o
                  <span style={{ flex: 1, height: 1, background: '#232a38' }} />
                </div>
                <p style={{ color: '#8aa4c7', marginBottom: 14 }}>
                  ¿No quieres crear una cuenta? Corre como invitado.
                </p>
                <button className="kiosk-btn" onClick={asInvitado} disabled={busy} style={{ fontSize: '1.05rem', padding: '16px 32px' }}>
                  {busy ? 'Creando…' : 'Competir como invitado'}
                </button>
              </div>
            </div>

            {/* Ticket seleccionado */}
            {sel && (
              <div className="card fade-in" style={{ marginTop: 18, padding: 24, display: 'flex', alignItems: 'center', gap: 20, borderColor: '#3b82f6' }}>
                {sel.foto ? (
                  <PilotoAvatar foto={sel.foto} nacionalidad={sel.nacionalidad} size={64} />
                ) : (
                  <span style={{ fontSize: '2.2rem' }}>{flagOf(sel.nacionalidad)}</span>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: '1.2rem' }}>{selNombre}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.88rem' }}>
                    Carnet {sel.carnet}{sel.edad ? ` · ${sel.edad} años` : ''}{sel.genero ? ` · ${sel.genero}` : ''}
                  </div>
                </div>
                {ticket ? (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#16a34a' }}>#{ticket.numero}</div>
                    <div className="pill" style={{ background: 'rgba(22,163,74,0.15)', color: '#16a34a' }}>Ticket generado</div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'right' }}>
                    <button className="kiosk-btn kiosk-btn-success" onClick={generar} disabled={busy} style={{ fontSize: '1.1rem', padding: '16px 34px' }}>
                      {busy ? 'Generando…' : 'Generar ticket'}
                    </button>
                    <p style={{ color: '#5f7095', fontSize: '0.78rem', marginTop: 8 }}>Genera el ticket para este piloto.</p>
                  </div>
                )}
              </div>
            )}

            {/* Nueva sesión después de un ticket */}
            {ticket && (
              <div className="card fade-in" style={{ marginTop: 18, padding: 24, textAlign: 'center' }}>
                <h2 style={{ marginBottom: 6 }}>¡Ticket listo, {selNombre.split(' ')[0]}!</h2>
                <p style={{ color: '#8aa4c7', marginBottom: 18 }}>
                  Tu ticket <b style={{ color: '#e2b93a' }}>#{ticket.numero}</b> fue generado. Pasa a la taquilla para pagarlo
                  y ser asignado a tu evento.
                </p>
                <button className="kiosk-btn" onClick={reiniciar}>Atender al siguiente</button>
              </div>
            )}
          </div>
        )}

        {/* PANTALLA 3 — Ticket generado (QR + imprimir) */}
        {view === 'ticket' && ticket && (
          <div style={{ width: '100%', maxWidth: 560 }}>
            <div className="ticket-print">
              <div className="fade-in" style={{ background: '#0e1117', border: '1px solid #2a6e4f', borderRadius: 18, padding: '28px 26px', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '1.5rem', letterSpacing: '0.04em' }}>CHRONIT</div>
                <div style={{ color: '#8aa4c7', fontSize: '0.82rem', marginBottom: 12 }}>TICKET DE CARRERA</div>

                <div style={{ fontSize: '2.4rem', fontWeight: 800, color: '#e2b93a', marginBottom: 4 }}>
                  TICKET #{String(ticket.numero).padStart(3, '0')}
                </div>
                <div className="pill" style={{ background: 'rgba(22,163,74,0.15)', color: '#16a34a', margin: '0 auto 18px' }}>
                  {esInvitado ? 'Invitado' : 'Piloto'} · {ticket.estado}
                </div>

                <div style={{ display: 'grid', gap: 8, textAlign: 'left', fontSize: '0.92rem', marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#8aa4c7' }}>Piloto</span>
                    <span style={{ fontWeight: 700 }}>{ticketInfo?.nombre || sel?.nombre} {ticketInfo?.apellido || sel?.apellido}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#8aa4c7' }}>Carnet</span>
                    <span style={{ fontWeight: 700 }}>{ticketInfo?.carnet || sel?.carnet}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#8aa4c7' }}>Evento</span>
                    <span style={{ fontWeight: 700 }}>{ticketInfo?.evento_nombre || 'Por asignar'}</span>
                  </div>
                  {ticketInfo?.modo && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#8aa4c7' }}>Modo</span>
                      <span style={{ fontWeight: 700 }}>{ticketInfo.modo}</span>
                    </div>
                  )}
                  {(ticketInfo?.fecha || ticketInfo?.hora) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#8aa4c7' }}>Fecha</span>
                      <span style={{ fontWeight: 700 }}>{ticketInfo?.fecha || ''} {ticketInfo?.hora || ''}</span>
                    </div>
                  )}
                </div>

                {/* Código QR del ticket */}
                <div style={{ background: '#fff', borderRadius: 12, padding: 12, display: 'inline-block' }}>
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr} alt="QR" style={{ width: 190, height: 190, display: 'block' }} />
                  ) : (
                    <span style={{ display: 'grid', placeItems: 'center', width: 190, height: 190, color: '#5f7095', fontSize: '0.85rem' }}>Cargando…</span>
                  )}
                </div>

                <p style={{ color: '#8aa4c7', fontSize: '0.85rem', marginTop: 14 }}>
                  {esInvitado
                    ? 'Presenta este QR en la taquilla para pagar tu ticket.'
                    : 'Pasa a la taquilla para pagar y ser asignado a tu evento.'}
                </p>
              </div>
            </div>

            <div className="no-print" style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 18 }}>
              <button className="kiosk-btn kiosk-btn-primary" onClick={imprimir} style={{ fontSize: '1.05rem', padding: '16px 36px' }}>
                Imprimir ticket
              </button>
              <button className="kiosk-btn" onClick={reiniciar}>
                Atender al siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL — Registrar piloto */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal fade-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <h2 style={{ flex: 1 }}>Registrar piloto</h2>
              <button className="kiosk-btn kiosk-btn-sm" onClick={() => setModal(false)}>Cerrar</button>
            </div>

            <form className="grid" style={{ gridTemplateColumns: '1fr', gap: 4 }} onSubmit={registrar}>
              {/* Foto */}
              <div style={{ marginBottom: 8 }}>
                <ImagePicker
                  value={preview}
                  onChange={(d) => { setFoto(d); setPreview(d); }}
                  aspect={1}
                  shape="circle"
                  outputSize={512}
                  label="Galería"
                  disabled={busy}
                />
              </div>

              <div className="row">
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Nombre *</label>
                  <input className="input" value={form.nombre} onChange={up('nombre')} required />
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Apellido</label>
                  <input className="input" value={form.apellido} onChange={up('apellido')} />
                </div>
              </div>

              <div className="row">
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Email *</label>
                  <input className="input" type="email" value={form.email} onChange={up('email')} required />
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Celular</label>
                  <input className="input" value={form.telefono} onChange={up('telefono')} />
                </div>
              </div>

              <div className="row">
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Carnet *</label>
                  <input className="input" value={form.carnet} onChange={up('carnet')} required />
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Edad</label>
                  <input className="input" type="number" min={1} max={120} value={form.edad} onChange={up('edad')} />
                </div>
              </div>

              <div className="row">
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Nacionalidad</label>
                  <select className="input" value={form.nacionalidad} onChange={up('nacionalidad')}>
                    <option value="">—</option>
                    {NATIONALITIES.map((n) => (
                      <option key={n.code} value={n.code}>{n.flag} {n.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Género</label>
                  <select className="input" value={form.genero} onChange={up('genero')}>
                    <option value="">—</option>
                    <option value="masculino">Masculino</option>
                    <option value="femenino">Femenino</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Contraseña *</label>
                <input className="input" type="password" value={form.password} onChange={up('password')} required placeholder="Para acceder desde la web (mín. 6)" />
              </div>

              {regMsg && <p style={{ color: '#f87171', fontSize: '0.85rem' }}>{regMsg}</p>}

              <div className="row" style={{ marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setModal(false)}>Cancelar</button>
                <button className="kiosk-btn kiosk-btn-accent" type="submit" disabled={busy} style={{ marginLeft: 'auto' }}>
                  {busy ? 'Guardando…' : 'Guardar piloto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
