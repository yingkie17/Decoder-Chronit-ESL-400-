// =============================================================================
// CHRONIT ECOSYSTEM — Gestión de usuarios (/admin/usuarios)
// -----------------------------------------------------------------------------
// CRUD de usuarios + roles + baja lógica + reseteo de contraseña + auditoría.
//
//   GET    /api/conta/usuarios                      listar (rol / activo / q)
//   GET    /api/conta/usuarios/roles                catálogo de roles
//   GET    /api/conta/usuarios/beneficiarios-propina cajeros/karts
//   POST   /api/conta/usuarios                      crear
//   PUT    /api/conta/usuarios/:id                  editar
//   PUT    /api/conta/usuarios/:id/rol              cambiar rol
//   POST   /api/conta/usuarios/:id/reset-password   resetear contraseña
//   POST   /api/conta/usuarios/:id/desactivar       baja lógica
//   POST   /api/conta/usuarios/:id/activar          reactivar
//   GET    /api/conta/usuarios/:id/auditoria        bitácora del usuario
//
// REGLA: solo admin/desarrollador pueden asignar roles supervisor o superiores.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { contaApi } from '@/lib/api';
import { useAuthGuard } from '@/lib/useAuthGuard';
import GuardLoading from '@/components/GuardLoading';

interface Usuario {
  id: number;
  nombre: string;
  apellido: string | null;
  carnet: string;
  email: string | null;
  telefono: string | null;
  nacionalidad: string | null;
  foto: string | null;
  rol: string;
  bloqueado: boolean;
  activo: boolean;
  nit_personal: string | null;
  creado_en: string;
  actualizado_en: string | null;
}

interface RolRow { nombre: string; permisos: unknown }

interface AuditoriaRow {
  id: number;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  datos_antes: unknown;
  datos_despues: unknown;
  ip: string | null;
  creado_en: string;
  usuario_nombre: string | null;
}

/** Fila de GET /api/conta/pins (PIN de supervisor). */
interface PinRow {
  id: number;
  usuario_id: number;
  activo: boolean;
  creado_en: string;
  nombre: string | null;
  apellido: string | null;
  carnet: string;
  rol: string;
  nombre_completo: string;
}

// Roles que pueden tener PIN de supervisor (espejo de esSupervisorPlus del backend).
const ROLES_CON_PIN = ['supervisor', 'admin', 'desarrollador'];

// Roles que SOLO admin/desarrollador pueden asignar (espejo del backend).
const ROLES_ELEVADOS = ['supervisor', 'contador', 'socio', 'dueno', 'admin', 'desarrollador'];

const ROLES_FALLBACK = [
  'piloto', 'cajero', 'coordinador', 'supervisor', 'contador', 'socio',
  'admin', 'desarrollador', 'dueno',
];

const ETIQUETA_ROL: Record<string, string> = {
  piloto: 'Piloto', cajero: 'Cajero', coordinador: 'Coordinador',
  supervisor: 'Supervisor', contador: 'Contador', socio: 'Socio',
  admin: 'Admin', desarrollador: 'Desarrollador', dueno: 'Dueño', kart: 'Kart',
};

const FORM_VACIO = {
  nombre: '', apellido: '', carnet: '', email: '', telefono: '',
  nacionalidad: '', foto: '', rol: 'piloto', password: '',
  nit_personal: '', activo: true,
};

const fechaHora = (v: string | null) => (v
  ? new Date(v).toLocaleString('es-BO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  : '—');

/** Formatea el diff de auditoría sin volcar todo el JSON en pantalla. */
function resumenDiff(v: unknown) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const claves = ['rol', 'bloqueado', 'nombre', 'apellido', 'carnet', 'nit_personal', 'valor', 'estado'];
    const partes = claves.filter((k) => k in o).map((k) => `${k}: ${JSON.stringify(o[k])}`);
    return partes.length ? partes.join(' · ') : JSON.stringify(v).slice(0, 120);
  }
  return String(v);
}

export default function UsuariosPage() {
  const { ready, user } = useAuthGuard(['admin']);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [roles, setRoles] = useState<string[]>(ROLES_FALLBACK);
  const [beneficiarios, setBeneficiarios] = useState<Usuario[]>([]);
  const [filtros, setFiltros] = useState({ q: '', rol: '', activo: '' });
  const [form, setForm] = useState({ ...FORM_VACIO });
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [resetUsuario, setResetUsuario] = useState<Usuario | null>(null);
  const [resetPass, setResetPass] = useState('');
  const [auditoria, setAuditoria] = useState<{ usuario: Usuario; rows: AuditoriaRow[] } | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  // PIN de supervisor: listado, alta/rotación y bitácora de cambios.
  const [pins, setPins] = useState<PinRow[]>([]);
  const [pinUsuario, setPinUsuario] = useState<Usuario | null>(null);
  const [pinValor, setPinValor] = useState('');
  const [auditoriaPin, setAuditoriaPin] = useState<AuditoriaRow[] | null>(null);

  const esGestor = user?.rol === 'admin' || user?.rol === 'desarrollador';

  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (filtros.q) qs.set('q', filtros.q);
      if (filtros.rol) qs.set('rol', filtros.rol);
      if (filtros.activo) qs.set('activo', filtros.activo);
      const data = await contaApi<Usuario[]>(`/api/conta/usuarios?${qs.toString()}`);
      setUsuarios(data);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filtros]);

  useEffect(() => { if (ready) void cargar(); }, [ready, cargar]);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const r = await contaApi<RolRow[]>('/api/conta/usuarios/roles');
        if (Array.isArray(r) && r.length) setRoles(r.map((x) => x.nombre));
      } catch { /* se mantiene el catálogo local */ }
      try {
        setBeneficiarios(await contaApi<Usuario[]>('/api/conta/usuarios/beneficiarios-propina'));
      } catch { /* opcional */ }
    })();
  }, [ready]);

  const crear = async () => {
    setMsg(''); setError('');
    if (!form.nombre || !form.carnet || !form.password) {
      setError('Nombre, carnet y contraseña son obligatorios.');
      return;
    }
    try {
      await contaApi('/api/conta/usuarios', { method: 'POST', body: form });
      setMsg(`Usuario ${form.nombre} ${form.apellido} creado.`);
      setForm({ ...FORM_VACIO });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const guardarEdicion = async () => {
    if (!editando) return;
    setMsg(''); setError('');
    try {
      await contaApi(`/api/conta/usuarios/${editando.id}`, {
        method: 'PUT',
        body: {
          nombre: editando.nombre, apellido: editando.apellido, carnet: editando.carnet,
          email: editando.email, telefono: editando.telefono, nacionalidad: editando.nacionalidad,
          foto: editando.foto, nit_personal: editando.nit_personal, activo: editando.activo,
        },
      });
      setMsg(`Usuario ${editando.nombre} actualizado.`);
      setEditando(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cambiarRol = async (u: Usuario, rol: string) => {
    setMsg(''); setError('');
    try {
      await contaApi(`/api/conta/usuarios/${u.id}/rol`, { method: 'PUT', body: { rol } });
      setMsg(`Rol de ${u.nombre} ${u.apellido}: ${ETIQUETA_ROL[rol] || rol}`);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const alternarActivo = async (u: Usuario) => {
    setMsg(''); setError('');
    try {
      await contaApi(`/api/conta/usuarios/${u.id}/${u.activo ? 'desactivar' : 'activar'}`, { method: 'POST' });
      setMsg(`${u.nombre} ${u.apellido} ${u.activo ? 'desactivado (baja lógica)' : 'reactivado'}.`);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const resetear = async () => {
    if (!resetUsuario) return;
    setMsg(''); setError('');
    if (resetPass.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    try {
      await contaApi(`/api/conta/usuarios/${resetUsuario.id}/reset-password`, {
        method: 'POST', body: { password: resetPass },
      });
      setMsg(`Contraseña restablecida para ${resetUsuario.nombre} ${resetUsuario.apellido}.`);
      setResetUsuario(null);
      setResetPass('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const verAuditoria = async (u: Usuario) => {
    setMsg(''); setError('');
    try {
      const rows = await contaApi<AuditoriaRow[]>(`/api/conta/usuarios/${u.id}/auditoria`);
      setAuditoria({ usuario: u, rows });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // -------------------------------------------------------------------------
  // PIN de supervisor (GET/PUT/DELETE /api/conta/pins)
  // -------------------------------------------------------------------------
  const cargarPins = useCallback(async () => {
    try {
      setPins(await contaApi<PinRow[]>('/api/conta/pins'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { if (ready) void cargarPins(); }, [ready, cargarPins]);

  /** PIN activo de un usuario (o null si no tiene). */
  const pinDe = (usuarioId: number) => pins.find((p) => p.usuario_id === usuarioId && p.activo) || null;

  const guardarPin = async () => {
    if (!pinUsuario) return;
    setMsg(''); setError('');
    if (!/^\d{4,6}$/.test(pinValor.trim())) {
      setError('El PIN debe tener entre 4 y 6 dígitos.');
      return;
    }
    try {
      await contaApi(`/api/conta/pins/${pinUsuario.id}`, {
        method: 'PUT',
        body: { pin: pinValor.trim() },
      });
      setMsg(`PIN ${pinDe(pinUsuario.id) ? 'rotado' : 'creado'} para ${pinUsuario.nombre} ${pinUsuario.apellido || ''}.`);
      setPinUsuario(null);
      setPinValor('');
      await cargarPins();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const desactivarPin = async (u: Usuario) => {
    setMsg(''); setError('');
    if (!window.confirm(`¿Desactivar el PIN de ${u.nombre} ${u.apellido || ''}?`)) return;
    try {
      await contaApi(`/api/conta/pins/${u.id}`, { method: 'DELETE' });
      setMsg(`PIN desactivado para ${u.nombre} ${u.apellido || ''}.`);
      await cargarPins();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const verAuditoriaPin = async () => {
    setMsg(''); setError('');
    try {
      setAuditoriaPin(await contaApi<AuditoriaRow[]>('/api/conta/auditoria?entidad=supervisor_pin'));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Roles ofrecidos en los selectores: los elevados solo para gestores. */
  const rolesAsignables = roles.filter((r) => esGestor || !ROLES_ELEVADOS.includes(r));

  if (!ready) return <GuardLoading />;

  return (
    <>
      <Navbar />
      <main style={{ padding: 20, maxWidth: 1150, margin: '0 auto' }}>
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Gestión de usuarios</h2>
          <p style={{ color: '#8aa4c7', fontSize: '0.85rem', margin: 0 }}>
            Alta, edición, cambio de rol, baja lógica, reseteo de contraseña y bitácora de auditoría.
            Solo <b>admin / desarrollador</b> pueden asignar roles de <b>supervisor</b> o superiores.
            Los usuarios con rol <b>cajero</b> o <b>kart</b> pueden ser beneficiarios de propinas.
          </p>
        </div>

        {msg && <p className="card" style={{ color: '#22c55e', padding: 12 }}>{msg}</p>}
        {error && <p className="card" style={{ color: '#ef4444', padding: 12 }}>{error}</p>}

        {/* ---------------- Alta ---------------- */}
        <section className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Nuevo usuario</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Nombre *" style={{ flex: '1 1 130px' }}
              value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            <input className="input" placeholder="Apellido" style={{ flex: '1 1 130px' }}
              value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} />
            <input className="input" placeholder="Carnet *" style={{ flex: '1 1 110px' }}
              value={form.carnet} onChange={(e) => setForm({ ...form, carnet: e.target.value })} />
            <input className="input" placeholder="Email" style={{ flex: '1 1 160px' }}
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="input" placeholder="Teléfono" style={{ flex: '1 1 120px' }}
              value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
            <input className="input" placeholder="Nacionalidad" style={{ flex: '0 1 130px' }}
              value={form.nacionalidad} onChange={(e) => setForm({ ...form, nacionalidad: e.target.value })} />
            <input className="input" placeholder="NIT personal (opcional)" style={{ flex: '1 1 160px' }}
              value={form.nit_personal} onChange={(e) => setForm({ ...form, nit_personal: e.target.value })} />
            <input className="input" placeholder="URL de foto (opcional)" style={{ flex: '1 1 180px' }}
              value={form.foto} onChange={(e) => setForm({ ...form, foto: e.target.value })} />
            <input className="input" placeholder="Contraseña *" type="password" style={{ flex: '1 1 140px' }}
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <select className="input" style={{ flex: '0 0 150px' }} value={form.rol}
              onChange={(e) => setForm({ ...form, rol: e.target.value })}>
              {rolesAsignables.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r] || r}</option>)}
            </select>
            <select className="input" style={{ flex: '0 0 120px' }} value={form.activo ? 'true' : 'false'}
              onChange={(e) => setForm({ ...form, activo: e.target.value === 'true' })}>
              <option value="true">Activo</option>
              <option value="false">Inactivo</option>
            </select>
            <button className="btn btn-primary" onClick={crear}>Crear usuario</button>
          </div>
        </section>

        {/* ---------------- Filtros ---------------- */}
        <section className="card" style={{ marginBottom: 20 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" placeholder="Buscar por nombre, carnet, email, teléfono o NIT"
              style={{ flex: '2 1 260px' }} value={filtros.q}
              onChange={(e) => setFiltros({ ...filtros, q: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') void cargar(); }} />
            <select className="input" style={{ flex: '0 0 160px' }} value={filtros.rol}
              onChange={(e) => setFiltros({ ...filtros, rol: e.target.value })}>
              <option value="">Todos los roles</option>
              {roles.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r] || r}</option>)}
            </select>
            <select className="input" style={{ flex: '0 0 140px' }} value={filtros.activo}
              onChange={(e) => setFiltros({ ...filtros, activo: e.target.value })}>
              <option value="">Activos e inactivos</option>
              <option value="true">Solo activos</option>
              <option value="false">Solo inactivos</option>
            </select>
            <button className="btn btn-primary" onClick={() => void cargar()}>Buscar</button>
            <button className="btn" onClick={() => setFiltros({ q: '', rol: '', activo: '' })}>Limpiar</button>
          </div>
        </section>

        {/* ---------------- Listado ---------------- */}
        <section className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Usuarios ({usuarios.length})</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>Usuario</th><th>Carnet</th><th>Contacto</th><th>Rol</th>
                <th>Estado</th><th>Propinas</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const elevadoBloqueado = !esGestor && ROLES_ELEVADOS.includes(u.rol);
                const esBeneficiario = ['cajero', 'kart'].includes(u.rol);
                return (
                  <tr key={u.id}>
                    <td>
                      <b>{u.nombre} {u.apellido || ''}</b>
                      {u.nacionalidad && <div style={{ color: '#5f7095', fontSize: '0.72rem' }}>{u.nacionalidad}</div>}
                      {u.nit_personal && <div style={{ color: '#5f7095', fontSize: '0.72rem' }}>NIT: {u.nit_personal}</div>}
                    </td>
                    <td>{u.carnet}</td>
                    <td style={{ fontSize: '0.78rem' }}>
                      {u.email || '—'}<div style={{ color: '#8aa4c7' }}>{u.telefono || ''}</div>
                    </td>
                    <td>
                      {elevadoBloqueado ? (
                        <span className="pill" style={{ background: '#f59e0b22', color: '#f59e0b' }}>
                          {ETIQUETA_ROL[u.rol] || u.rol}
                        </span>
                      ) : (
                        <select className="input" style={{ minWidth: 140 }} value={u.rol}
                          onChange={(e) => void cambiarRol(u, e.target.value)}>
                          {!rolesAsignables.includes(u.rol) && (
                            <option value={u.rol}>{ETIQUETA_ROL[u.rol] || u.rol}</option>
                          )}
                          {rolesAsignables.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r] || r}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      {u.activo
                        ? <span className="pill" style={{ background: '#22c55e22', color: '#22c55e' }}>Activo</span>
                        : <span className="pill" style={{ background: '#ef444422', color: '#ef4444' }}>Inactivo</span>}
                    </td>
                    <td style={{ fontSize: '0.78rem' }}>
                      {esBeneficiario ? 'Beneficiario' : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm" onClick={() => setEditando({ ...u })}>Editar</button>
                        <button className="btn btn-sm" onClick={() => { setResetUsuario(u); setResetPass(''); }}>
                          Contraseña
                        </button>
                        <button className="btn btn-sm" onClick={() => void alternarActivo(u)}>
                          {u.activo ? 'Desactivar' : 'Reactivar'}
                        </button>
                        {ROLES_CON_PIN.includes(u.rol) && (
                          <button className="btn btn-sm" onClick={() => { setPinUsuario(u); setPinValor(''); }}>
                            {pinDe(u.id) ? 'Rotar PIN' : 'Crear PIN'}
                          </button>
                        )}
                        <button className="btn btn-sm" onClick={() => void verAuditoria(u)}>Auditoría</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!usuarios.length && (
                <tr><td colSpan={7} style={{ color: '#5f7095' }}>Sin usuarios que coincidan con el filtro.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ---------------- Beneficiarios de propina ---------------- */}
        {!!beneficiarios.length && (
          <section className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>Beneficiarios de propinas ({beneficiarios.length})</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
              Usuarios con rol cajero o kart. La distribución se calcula según
              <b> propina_distribucion</b> en Configuración.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {beneficiarios.map((b) => (
                <span key={b.id} className="pill" style={{ background: '#3b82f622', color: '#3b82f6' }}>
                  {b.nombre} {b.apellido || ''} · {b.carnet}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ---------------- PIN de supervisor ---------------- */}
        <section className="card" style={{ marginBottom: 20 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3 style={{ margin: 0 }}>PIN de supervisor</h3>
              <p style={{ color: '#8aa4c7', fontSize: '0.8rem', margin: '4px 0 0' }}>
                Autorización rápida en el POS (4-6 dígitos) para descuentos, egresos, anulaciones y
                cambios de configuración. Se guarda hasheado: nunca se muestra en pantalla.
              </p>
            </div>
            <button className="btn" onClick={() => void verAuditoriaPin()}>Ver log de auditoría</button>
          </div>

          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>Supervisor</th><th>Rol</th><th>PIN</th><th>Alta</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {usuarios.filter((u) => ROLES_CON_PIN.includes(u.rol)).map((u) => {
                const pin = pinDe(u.id);
                return (
                  <tr key={u.id}>
                    <td>
                      <b>{u.nombre} {u.apellido || ''}</b>
                      <div style={{ color: '#5f7095', fontSize: '0.72rem' }}>{u.carnet}</div>
                    </td>
                    <td>{ETIQUETA_ROL[u.rol] || u.rol}</td>
                    <td>
                      {pin
                        ? <span className="pill" style={{ background: '#22c55e22', color: '#22c55e' }}>Activo</span>
                        : <span className="pill" style={{ background: '#8aa4c722', color: '#8aa4c7' }}>Sin PIN</span>}
                    </td>
                    <td style={{ fontSize: '0.76rem' }}>{pin ? fechaHora(pin.creado_en) : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm" onClick={() => { setPinUsuario(u); setPinValor(''); }}>
                          {pin ? 'Rotar' : 'Crear'}
                        </button>
                        {pin && (
                          <button className="btn btn-sm btn-danger" onClick={() => void desactivarPin(u)}>Desactivar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!usuarios.some((u) => ROLES_CON_PIN.includes(u.rol)) && (
                <tr><td colSpan={5} style={{ color: '#5f7095' }}>No hay usuarios con rol supervisor o superior.</td></tr>
              )}
            </tbody>
          </table>

          {auditoriaPin && (
            <>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                <h4 style={{ margin: 0 }}>Log de auditoría del PIN ({auditoriaPin.length})</h4>
                <button className="btn btn-sm" onClick={() => setAuditoriaPin(null)}>Ocultar</button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ marginTop: 6 }}>
                  <thead>
                    <tr><th>Fecha</th><th>Acción</th><th>Usuario afectado</th><th>Por</th><th>Detalle</th></tr>
                  </thead>
                  <tbody>
                    {auditoriaPin.map((a) => (
                      <tr key={a.id}>
                        <td style={{ fontSize: '0.76rem', whiteSpace: 'nowrap' }}>{fechaHora(a.creado_en)}</td>
                        <td><span className="pill" style={{ background: '#3b82f622', color: '#3b82f6' }}>{a.accion}</span></td>
                        <td style={{ fontSize: '0.76rem' }}>{a.entidad_id || '—'}</td>
                        <td style={{ fontSize: '0.76rem' }}>{a.usuario_nombre || '—'}</td>
                        <td style={{ fontSize: '0.74rem', maxWidth: 260 }}>{resumenDiff(a.datos_despues)}</td>
                      </tr>
                    ))}
                    {!auditoriaPin.length && (
                      <tr><td colSpan={5} style={{ color: '#5f7095' }}>Sin cambios de PIN registrados.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <p style={{ fontSize: '0.8rem', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/admin/configuracion" className="btn">Configuración</Link>
          <Link href="/contabilidad" className="btn">Contabilidad</Link>
          <Link href="/admin" className="btn">Admin</Link>
        </p>

        {/* ---------------- Modal edición ---------------- */}
        {editando && (
          <div className="modal-overlay">
            <div className="card modal" style={{ maxWidth: 560 }}>
              <h3 style={{ marginTop: 0 }}>Editar usuario #{editando.id}</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input className="input" placeholder="Nombre" style={{ flex: '1 1 160px' }}
                  value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} />
                <input className="input" placeholder="Apellido" style={{ flex: '1 1 160px' }}
                  value={editando.apellido || ''} onChange={(e) => setEditando({ ...editando, apellido: e.target.value })} />
                <input className="input" placeholder="Carnet" style={{ flex: '1 1 130px' }}
                  value={editando.carnet} onChange={(e) => setEditando({ ...editando, carnet: e.target.value })} />
                <input className="input" placeholder="Email" style={{ flex: '1 1 200px' }}
                  value={editando.email || ''} onChange={(e) => setEditando({ ...editando, email: e.target.value })} />
                <input className="input" placeholder="Teléfono" style={{ flex: '1 1 140px' }}
                  value={editando.telefono || ''} onChange={(e) => setEditando({ ...editando, telefono: e.target.value })} />
                <input className="input" placeholder="Nacionalidad" style={{ flex: '1 1 140px' }}
                  value={editando.nacionalidad || ''} onChange={(e) => setEditando({ ...editando, nacionalidad: e.target.value })} />
                <input className="input" placeholder="NIT personal" style={{ flex: '1 1 160px' }}
                  value={editando.nit_personal || ''} onChange={(e) => setEditando({ ...editando, nit_personal: e.target.value })} />
                <input className="input" placeholder="URL de foto" style={{ flex: '1 1 220px' }}
                  value={editando.foto || ''} onChange={(e) => setEditando({ ...editando, foto: e.target.value })} />
                <select className="input" style={{ flex: '0 0 140px' }} value={editando.activo ? 'true' : 'false'}
                  onChange={(e) => setEditando({ ...editando, activo: e.target.value === 'true' })}>
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </select>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                <button className="btn btn-primary" onClick={guardarEdicion}>Guardar</button>
                <button className="btn" onClick={() => setEditando(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {/* ---------------- Modal reset de contraseña ---------------- */}
        {resetUsuario && (
          <div className="modal-overlay">
            <div className="card modal" style={{ maxWidth: 420 }}>
              <h3 style={{ marginTop: 0 }}>Resetear contraseña</h3>
              <p style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>
                {resetUsuario.nombre} {resetUsuario.apellido || ''} · carnet {resetUsuario.carnet}
              </p>
              <input className="input" type="password" placeholder="Nueva contraseña (mín. 6)"
                value={resetPass} onChange={(e) => setResetPass(e.target.value)} />
              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                <button className="btn btn-primary" onClick={resetear}>Guardar</button>
                <button className="btn" onClick={() => setResetUsuario(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {/* ---------------- Modal auditoría ---------------- */}
        {auditoria && (
          <div className="modal-overlay">
            <div className="card modal" style={{ maxWidth: 860, maxHeight: '82vh', overflow: 'auto' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ marginTop: 0 }}>
                  Auditoría — {auditoria.usuario.nombre} {auditoria.usuario.apellido || ''}
                </h3>
                <button className="btn btn-sm" onClick={() => setAuditoria(null)}>Cerrar</button>
              </div>
              <table className="tbl" style={{ marginTop: 10 }}>
                <thead>
                  <tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>Antes</th><th>Después</th><th>Por</th></tr>
                </thead>
                <tbody>
                  {auditoria.rows.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontSize: '0.76rem', whiteSpace: 'nowrap' }}>{fechaHora(a.creado_en)}</td>
                      <td><span className="pill" style={{ background: '#3b82f622', color: '#3b82f6' }}>{a.accion}</span></td>
                      <td style={{ fontSize: '0.76rem' }}>{a.entidad}{a.entidad_id ? ` #${a.entidad_id}` : ''}</td>
                      <td style={{ fontSize: '0.74rem', maxWidth: 220 }}>{resumenDiff(a.datos_antes)}</td>
                      <td style={{ fontSize: '0.74rem', maxWidth: 220 }}>{resumenDiff(a.datos_despues)}</td>
                      <td style={{ fontSize: '0.76rem' }}>{a.usuario_nombre || '—'}</td>
                    </tr>
                  ))}
                  {!auditoria.rows.length && (
                    <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin registros de auditoría.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------------- Modal PIN de supervisor ---------------- */}
        {pinUsuario && (
          <div className="modal-overlay">
            <div className="card modal" style={{ maxWidth: 420 }}>
              <h3 style={{ marginTop: 0 }}>
                {pinDe(pinUsuario.id) ? 'Rotar' : 'Crear'} PIN de supervisor
              </h3>
              <p style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>
                {pinUsuario.nombre} {pinUsuario.apellido || ''} · carnet {pinUsuario.carnet} ·{' '}
                {ETIQUETA_ROL[pinUsuario.rol] || pinUsuario.rol}
              </p>
              <label className="label">PIN (4 a 6 dígitos)</label>
              <input className="input" type="password" inputMode="numeric" autoComplete="new-password"
                maxLength={6} placeholder="••••" value={pinValor}
                onChange={(e) => setPinValor(e.target.value.replace(/\D/g, ''))} />
              <p style={{ color: '#5f7095', fontSize: '0.75rem' }}>
                Se guarda hasheado (bcrypt) y el cambio queda en la auditoría. Al rotarlo, el PIN
                anterior deja de funcionar.
              </p>
              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                <button className="btn btn-primary" onClick={() => void guardarPin()}>Guardar PIN</button>
                <button className="btn" onClick={() => { setPinUsuario(null); setPinValor(''); }}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
