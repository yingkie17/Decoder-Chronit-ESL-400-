// =============================================================================
// CHRONIT ECOSYSTEM — Configuración (/admin/configuracion)
// -----------------------------------------------------------------------------
// Página dedicada (supervisor+) que reutiliza el editor de configuración del
// módulo de contabilidad. Cada cambio queda auditado con datos_antes y
// datos_despues; las ventas ya emitidas conservan el valor que aplicaron.
//
// Secciones:
//   1. Parámetros generales (Configuracion) — umbrales, IVA, propina, combo, NIT.
//   2. Alertas        — canales/umbrales (alertas_config) y alertas recientes.
//   3. Backup fiscal  — último respaldo, respaldo manual, verificación y config.
//   4. Dosificaciones SIAT — CRUD por sucursal/tipo + Libros de Ventas y Compras.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import Configuracion from '@/components/conta/Configuracion';
import GuardLoading from '@/components/GuardLoading';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { contaApi, contaDescargar } from '@/lib/api';
import { fechaHora, hoyISO, money } from '@/components/conta/comun';

// =============================================================================
// 2) ALERTAS
// =============================================================================
interface AlertasConfig {
  canales?: string[];
  telegram_token?: string | null;
  telegram_chat_id?: string | null;
  email?: string | null;
  email_webhook?: string | null;
  diferencia_caja_umbral?: number;
  caja_abierta_horas?: number;
  qr_sin_confirmar_horas?: number;
  propinas_pendientes_dias?: number;
  stock_bajo_unidades?: number;
  anticipo_aviso_dias?: number;
}

interface AlertaRow {
  id: number;
  tipo: string;
  severidad: string;
  mensaje: string;
  leida: boolean;
  creado_en: string;
}

interface AlertasResumen {
  total: number;
  sin_leer: number;
  criticas: number;
}

interface AlertasForm {
  canales: string[];
  telegram_token: string;
  telegram_chat_id: string;
  email: string;
  email_webhook: string;
  diferencia_caja_umbral: string;
  caja_abierta_horas: string;
  qr_sin_confirmar_horas: string;
  propinas_pendientes_dias: string;
  stock_bajo_unidades: string;
  anticipo_aviso_dias: string;
}

type CampoUmbral =
  | 'diferencia_caja_umbral' | 'caja_abierta_horas' | 'qr_sin_confirmar_horas'
  | 'propinas_pendientes_dias' | 'stock_bajo_unidades' | 'anticipo_aviso_dias';

const CANALES_ALERTA: [string, string][] = [
  ['in_app', 'En la app'],
  ['telegram', 'Telegram'],
  ['email', 'Email'],
];

const UMBRALES_ALERTA: [CampoUmbral, string, string][] = [
  ['diferencia_caja_umbral', 'Umbral de diferencia de caja (BOB)',
    'Diferencia entre el efectivo esperado y el contado que dispara la alerta.'],
  ['caja_abierta_horas', 'Horas de caja abierta',
    'Alerta si una sesión de caja permanece abierta más de estas horas.'],
  ['qr_sin_confirmar_horas', 'Horas de QR sin confirmar',
    'Pagos por QR que siguen pendientes de confirmación.'],
  ['propinas_pendientes_dias', 'Días de propinas pendientes',
    'Propinas acumuladas sin pagar a los beneficiarios.'],
  ['stock_bajo_unidades', 'Stock bajo (unidades)',
    'Productos cuyo stock cae por debajo de este valor.'],
  ['anticipo_aviso_dias', 'Aviso de anticipo vencido (días)',
    'Días de antelación con que se avisa de un anticipo por vencer.'],
];

const COLOR_SEVERIDAD: Record<string, string> = {
  critica: '#ef4444', alta: '#f59e0b', media: '#3b82f6', baja: '#8aa4c7',
};

const FORM_ALERTAS_VACIO: AlertasForm = {
  canales: ['in_app'],
  telegram_token: '', telegram_chat_id: '', email: '', email_webhook: '',
  diferencia_caja_umbral: '20', caja_abierta_horas: '14', qr_sin_confirmar_horas: '2',
  propinas_pendientes_dias: '7', stock_bajo_unidades: '5', anticipo_aviso_dias: '3',
};

const aTexto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function AlertasAdmin() {
  const [form, setForm] = useState<AlertasForm>(FORM_ALERTAS_VACIO);
  const [resumen, setResumen] = useState<AlertasResumen | null>(null);
  const [alerts, setAlerts] = useState<AlertaRow[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const cfg = await contaApi<AlertasConfig>('/api/conta/alertas/config');
      setForm({
        canales: Array.isArray(cfg.canales) && cfg.canales.length ? cfg.canales : ['in_app'],
        telegram_token: aTexto(cfg.telegram_token),
        telegram_chat_id: aTexto(cfg.telegram_chat_id),
        email: aTexto(cfg.email),
        email_webhook: aTexto(cfg.email_webhook),
        diferencia_caja_umbral: aTexto(cfg.diferencia_caja_umbral),
        caja_abierta_horas: aTexto(cfg.caja_abierta_horas),
        qr_sin_confirmar_horas: aTexto(cfg.qr_sin_confirmar_horas),
        propinas_pendientes_dias: aTexto(cfg.propinas_pendientes_dias),
        stock_bajo_unidades: aTexto(cfg.stock_bajo_unidades),
        anticipo_aviso_dias: aTexto(cfg.anticipo_aviso_dias),
      });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const cargarAlertas = useCallback(async () => {
    try {
      setResumen(await contaApi<AlertasResumen>('/api/conta/alertas/resumen'));
      setAlerts(await contaApi<AlertaRow[]>('/api/conta/alertas?leida=false'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void cargar(); void cargarAlertas(); }, [cargar, cargarAlertas]);

  const numero = (s: string) => {
    const n = Number(String(s).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  const guardar = async () => {
    setMsg(''); setError('');
    setGuardando(true);
    try {
      await contaApi('/api/conta/alertas/config', {
        method: 'PUT',
        body: {
          canales: form.canales,
          telegram_token: form.telegram_token.trim() || null,
          telegram_chat_id: form.telegram_chat_id.trim() || null,
          email: form.email.trim() || null,
          email_webhook: form.email_webhook.trim() || null,
          diferencia_caja_umbral: numero(form.diferencia_caja_umbral),
          caja_abierta_horas: numero(form.caja_abierta_horas),
          qr_sin_confirmar_horas: numero(form.qr_sin_confirmar_horas),
          propinas_pendientes_dias: numero(form.propinas_pendientes_dias),
          stock_bajo_unidades: numero(form.stock_bajo_unidades),
          anticipo_aviso_dias: numero(form.anticipo_aviso_dias),
        },
      });
      setMsg('Configuración de alertas guardada y auditada.');
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const evaluar = async () => {
    setMsg(''); setError('');
    try {
      const r = await contaApi<{ total: number }>('/api/conta/alertas/evaluar', { method: 'POST' });
      setMsg(`Evaluación ejecutada: ${r.total} alertas nuevas.`);
      await cargarAlertas();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const leerTodas = async () => {
    setMsg(''); setError('');
    try {
      const r = await contaApi<{ marcadas: number }>('/api/conta/alertas/leer-todas', { method: 'POST' });
      setMsg(`${r.marcadas} alertas marcadas como leídas.`);
      await cargarAlertas();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const alternarCanal = (canal: string) => {
    setForm((f) => ({
      ...f,
      canales: f.canales.includes(canal)
        ? f.canales.filter((c) => c !== canal)
        : [...f.canales, canal],
    }));
  };

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>Alertas</h3>
          <p style={{ color: '#8aa4c7', fontSize: '0.8rem', margin: '4px 0 0' }}>
            Canales de notificación y umbrales (<b>alertas_config</b>). Sin leer:{' '}
            <b>{resumen?.sin_leer ?? 0}</b> · Críticas: <b>{resumen?.criticas ?? 0}</b>.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => void evaluar()}>Evaluar ahora</button>
          <button className="btn" onClick={() => void leerTodas()}>Marcar leídas</button>
          <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar alertas'}
          </button>
        </div>
      </div>

      {msg && <p className="card" style={{ color: '#22c55e', padding: 12 }}>{msg}</p>}
      {error && <p className="card" style={{ color: '#ef4444', padding: 12 }}>{error}</p>}

      <div className="row" style={{ gap: 20, flexWrap: 'wrap', marginTop: 10 }}>
        <div style={{ flex: '1 1 300px' }}>
          <label className="label">Canales de notificación</label>
          <div className="row" style={{ gap: 14 }}>
            {CANALES_ALERTA.map(([clave, etiqueta]) => (
              <label key={clave} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                <input type="checkbox" checked={form.canales.includes(clave)}
                  onChange={() => alternarCanal(clave)} />
                {etiqueta}
              </label>
            ))}
          </div>

          <label className="label">Token del bot de Telegram</label>
          <input className="input" placeholder="123456:ABC…" value={form.telegram_token}
            onChange={(e) => setForm({ ...form, telegram_token: e.target.value })} />

          <label className="label">Chat ID de Telegram</label>
          <input className="input" placeholder="-1001234567890" value={form.telegram_chat_id}
            onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })} />

          <label className="label">Email de destino</label>
          <input className="input" type="email" placeholder="alertas@dominio.com" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />

          <label className="label">Webhook de email (relay HTTP)</label>
          <input className="input" placeholder="https://…" value={form.email_webhook}
            onChange={(e) => setForm({ ...form, email_webhook: e.target.value })} />
        </div>

        <div style={{ flex: '1 1 320px' }}>
          {UMBRALES_ALERTA.map(([clave, etiqueta, ayuda]) => (
            <div key={clave} style={{ marginBottom: 8 }}>
              <label className="label" style={{ margin: '6px 0 4px' }}>{etiqueta}</label>
              <input className="input" type="number" step="0.01" value={form[clave]}
                onChange={(e) => setForm({ ...form, [clave]: e.target.value })} />
              <div style={{ color: '#5f7095', fontSize: '0.72rem', marginTop: 2 }}>{ayuda}</div>
            </div>
          ))}
        </div>
      </div>

      <h4 style={{ marginBottom: 6 }}>Alertas recientes sin leer ({alerts.length})</h4>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr><th>Fecha</th><th>Severidad</th><th>Tipo</th><th>Mensaje</th></tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id}>
                <td style={{ fontSize: '0.76rem', whiteSpace: 'nowrap' }}>{fechaHora(a.creado_en)}</td>
                <td>
                  <span className="pill" style={{
                    background: `${COLOR_SEVERIDAD[a.severidad] || '#8aa4c7'}22`,
                    color: COLOR_SEVERIDAD[a.severidad] || '#8aa4c7',
                  }}>
                    {a.severidad}
                  </span>
                </td>
                <td style={{ fontSize: '0.78rem' }}>{a.tipo}</td>
                <td style={{ fontSize: '0.8rem' }}>{a.mensaje}</td>
              </tr>
            ))}
            {!alerts.length && (
              <tr><td colSpan={4} style={{ color: '#5f7095' }}>Sin alertas activas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// =============================================================================
// 3) BACKUP FISCAL
// =============================================================================
interface BackupRegistro {
  archivo: string;
  fecha: string;
  fecha_local: string;
  bytes: number;
  cifrado: boolean;
  sha256: string;
  destino_externo: string | null;
  subido_externo: boolean;
  manual?: boolean;
  existe?: boolean;
  error_externo?: string;
}

interface BackupEstado {
  directorio: string;
  cifrado_disponible: boolean;
  config: { retencion_anios: number; hora: string; destino: string | null; gpg: boolean };
  ultimo_ok: BackupRegistro | null;
  ultimo_ok_hoy: boolean;
  total: number;
  respaldos: BackupRegistro[];
  verificacion_mensual: { ok: boolean; archivo: string; tablas_detectadas: number; verificado_en: string } | null;
}

const peso = (n: number) => (n >= 1048576
  ? `${(n / 1048576).toFixed(2)} MB`
  : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

function BackupFiscal({ puedeGestionar }: { puedeGestionar: boolean }) {
  const [estado, setEstado] = useState<BackupEstado | null>(null);
  const [cfg, setCfg] = useState({ retencion_anios: '8', hora: '02:00', destino: '', gpg: true });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const e = await contaApi<BackupEstado>('/api/conta/backup/estado');
      setEstado(e);
      setCfg({
        retencion_anios: String(e.config.retencion_anios ?? ''),
        hora: String(e.config.hora ?? ''),
        destino: e.config.destino || '',
        gpg: e.config.gpg !== false,
      });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { if (puedeGestionar) void cargar(); }, [puedeGestionar, cargar]);

  const ejecutar = async () => {
    setMsg(''); setError(''); setOcupado(true);
    try {
      const r = await contaApi<{ respaldo: BackupRegistro }>('/api/conta/backup/ejecutar', { method: 'POST' });
      setMsg(`Respaldo creado: ${r.respaldo.archivo} (${peso(r.respaldo.bytes)})`);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const verificar = async () => {
    setMsg(''); setError(''); setOcupado(true);
    try {
      const r = await contaApi<{ archivo: string; tablas_detectadas: number }>(
        '/api/conta/backup/verificar', { method: 'POST' });
      setMsg(`Respaldo verificado: ${r.archivo} · ${r.tablas_detectadas} tablas detectadas.`);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const guardar = async () => {
    setMsg(''); setError(''); setOcupado(true);
    try {
      await contaApi('/api/conta/backup/config', {
        method: 'PUT',
        body: {
          retencion_anios: Number(cfg.retencion_anios) || 0,
          hora: cfg.hora,
          destino: cfg.destino.trim() || null,
          gpg: cfg.gpg,
        },
      });
      setMsg('Configuración de respaldo guardada y auditada.');
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  if (!puedeGestionar) {
    return (
      <section className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginTop: 0 }}>Backup fiscal</h3>
        <p style={{ color: '#8aa4c7', fontSize: '0.85rem', margin: 0 }}>
          La gestión del respaldo fiscal (ejecutar, verificar y configurar) está reservada a
          <b> admin / desarrollador</b>.
        </p>
      </section>
    );
  }

  const ultimo = estado?.ultimo_ok;

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>Backup fiscal</h3>
          <p style={{ color: '#8aa4c7', fontSize: '0.8rem', margin: '4px 0 0' }}>
            Directorio: <b>{estado?.directorio || '—'}</b> · cifrado:{' '}
            <b>{estado?.cifrado_disponible ? 'disponible' : 'no configurado'}</b> · respaldos: <b>{estado?.total ?? 0}</b>
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => void verificar()} disabled={ocupado}>Verificar respaldo</button>
          <button className="btn btn-primary" onClick={() => void ejecutar()} disabled={ocupado}>
            {ocupado ? 'Procesando…' : 'Ejecutar respaldo ahora'}
          </button>
        </div>
      </div>

      {msg && <p className="card" style={{ color: '#22c55e', padding: 12 }}>{msg}</p>}
      {error && <p className="card" style={{ color: '#ef4444', padding: 12 }}>{error}</p>}

      <div className="row" style={{ gap: 20, flexWrap: 'wrap', marginTop: 10 }}>
        <div style={{ flex: '1 1 320px' }}>
          <h4 style={{ marginTop: 0 }}>Último respaldo correcto</h4>
          {ultimo ? (
            <table className="tbl">
              <tbody>
                <tr><th>Archivo</th><td style={{ fontFamily: 'monospace', fontSize: '0.76rem' }}>{ultimo.archivo}</td></tr>
                <tr><th>Fecha</th><td>{fechaHora(ultimo.fecha)} ({ultimo.fecha_local})</td></tr>
                <tr><th>Tamaño</th><td>{peso(ultimo.bytes)}</td></tr>
                <tr><th>Cifrado</th><td>{ultimo.cifrado ? 'Sí (GPG AES256)' : 'No'}</td></tr>
                <tr><th>Destino externo</th><td>{ultimo.destino_externo || '—'}{ultimo.subido_externo ? ' (copiado)' : ''}</td></tr>
                <tr><th>SHA-256</th><td style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all' }}>{ultimo.sha256}</td></tr>
              </tbody>
            </table>
          ) : (
            <p style={{ color: '#5f7095', fontSize: '0.85rem' }}>Todavía no hay respaldos registrados.</p>
          )}
          <p style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>
            Respaldo de hoy: <b>{estado?.ultimo_ok_hoy ? 'sí' : 'no'}</b> · Última verificación:{' '}
            {estado?.verificacion_mensual
              ? `${fechaHora(estado.verificacion_mensual.verificado_en)} (${estado.verificacion_mensual.ok ? 'OK' : 'FALLÓ'})`
              : '—'}
          </p>
        </div>

        <div style={{ flex: '1 1 320px' }}>
          <h4 style={{ marginTop: 0 }}>Configuración del respaldo</h4>
          <label className="label">Retención (años)</label>
          <input className="input" type="number" min={1} value={cfg.retencion_anios}
            onChange={(e) => setCfg({ ...cfg, retencion_anios: e.target.value })} />

          <label className="label">Hora del respaldo diario</label>
          <input className="input" type="time" value={cfg.hora}
            onChange={(e) => setCfg({ ...cfg, hora: e.target.value })} />

          <label className="label">Remoto rclone de destino</label>
          <input className="input" placeholder="b2:chronit-backups" value={cfg.destino}
            onChange={(e) => setCfg({ ...cfg, destino: e.target.value })} />

          <label className="label">Cifrado GPG</label>
          <select className="input" value={cfg.gpg ? 'true' : 'false'}
            onChange={(e) => setCfg({ ...cfg, gpg: e.target.value === 'true' })}>
            <option value="true">Activado (AES256)</option>
            <option value="false">Desactivado</option>
          </select>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => void guardar()} disabled={ocupado}>Guardar respaldo</button>
          </div>
        </div>
      </div>

      <h4 style={{ marginBottom: 6 }}>Historial de respaldos ({estado?.respaldos.length ?? 0})</h4>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr><th>Fecha</th><th>Archivo</th><th>Tamaño</th><th>Cifrado</th><th>Externo</th><th>Disponible</th></tr>
          </thead>
          <tbody>
            {(estado?.respaldos || []).slice(0, 20).map((r) => (
              <tr key={r.archivo}>
                <td style={{ fontSize: '0.76rem', whiteSpace: 'nowrap' }}>{fechaHora(r.fecha)}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{r.archivo}</td>
                <td>{peso(r.bytes)}</td>
                <td>{r.cifrado ? 'Sí' : 'No'}</td>
                <td>{r.subido_externo ? 'Sí' : (r.error_externo ? 'Error' : '—')}</td>
                <td>{r.existe === false ? 'eliminado' : ''}</td>
              </tr>
            ))}
            {!estado?.respaldos.length && (
              <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin respaldos en el manifiesto.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// =============================================================================
// 4) DOSIFICACIONES SIAT
// =============================================================================
interface Dosificacion {
  id: number;
  sucursal_id: number | null;
  tipo_factura: string;
  rango_desde: number;
  rango_hasta: number;
  numero_actual: number;
  restantes: number;
  cuf_base: string | null;
  cuis: string | null;
  cun: string | null;
  vigencia_desde: string | null;
  vigencia_hasta: string | null;
  activo: boolean;
}

const FORM_DOSIF_VACIO = {
  tipo_factura: 'factura', rango_desde: '', rango_hasta: '',
  cuf_base: '', cuis: '', cun: '', vigencia_desde: '', vigencia_hasta: '',
};

const soloFecha = (v: string | null) => (v ? String(v).slice(0, 10) : '');

function DosificacionesSiat({ puedeGestionar }: { puedeGestionar: boolean }) {
  const [dosifs, setDosifs] = useState<Dosificacion[]>([]);
  const [form, setForm] = useState({ ...FORM_DOSIF_VACIO });
  const [editando, setEditando] = useState<Dosificacion | null>(null);
  const [rango, setRango] = useState({ desde: `${hoyISO().slice(0, 4)}-01-01`, hasta: hoyISO() });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      setDosifs(await contaApi<Dosificacion[]>('/api/conta/siat/dosificaciones'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const crear = async () => {
    setMsg(''); setError('');
    if (!form.rango_desde || !form.rango_hasta) {
      setError('Indica el rango autorizado (desde y hasta).');
      return;
    }
    try {
      await contaApi('/api/conta/siat/dosificaciones', {
        method: 'POST',
        body: {
          tipo_factura: form.tipo_factura,
          rango_desde: Number(form.rango_desde),
          rango_hasta: Number(form.rango_hasta),
          cuf_base: form.cuf_base.trim() || null,
          cuis: form.cuis.trim() || null,
          cun: form.cun.trim() || null,
          vigencia_desde: form.vigencia_desde || null,
          vigencia_hasta: form.vigencia_hasta || null,
        },
      });
      setMsg('Dosificación creada (auditada).');
      setForm({ ...FORM_DOSIF_VACIO });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const guardarEdicion = async () => {
    if (!editando) return;
    setMsg(''); setError('');
    try {
      await contaApi(`/api/conta/siat/dosificaciones/${editando.id}`, {
        method: 'PUT',
        body: {
          tipo_factura: editando.tipo_factura,
          cuf_base: editando.cuf_base || null,
          cuis: editando.cuis || null,
          cun: editando.cun || null,
          vigencia_desde: editando.vigencia_desde || null,
          vigencia_hasta: editando.vigencia_hasta || null,
          activo: editando.activo,
        },
      });
      setMsg('Dosificación actualizada (auditada).');
      setEditando(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const desactivar = async (d: Dosificacion) => {
    setMsg(''); setError('');
    if (!window.confirm(`¿Desactivar la dosificación #${d.id} (${d.tipo_factura})?`)) return;
    try {
      await contaApi(`/api/conta/siat/dosificaciones/${d.id}`, { method: 'DELETE' });
      setMsg(`Dosificación #${d.id} desactivada.`);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const descargarLibro = async (tipo: 'ventas' | 'compras') => {
    setMsg(''); setError('');
    try {
      await contaDescargar(
        `/api/conta/siat/libro-${tipo}.csv?desde=${rango.desde}&hasta=${rango.hasta}`,
        `libro-${tipo}_${rango.desde}_${rango.hasta}.csv`,
      );
      setMsg(`Libro de ${tipo} descargado (${rango.desde} → ${rango.hasta}).`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Dosificaciones SIAT</h3>
      <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
        Rangos autorizados por sucursal y tipo de documento (CUF/CUIS/CUN). La integración SOAP con
        el SIN está desactivada: los libros se descargan en CSV con el formato del SIN para envío manual.
      </p>

      {msg && <p className="card" style={{ color: '#22c55e', padding: 12 }}>{msg}</p>}
      {error && <p className="card" style={{ color: '#ef4444', padding: 12 }}>{error}</p>}

      {/* -------- Libros CSV -------- */}
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <label className="label">Libros desde</label>
          <input className="input" type="date" value={rango.desde}
            onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
        </div>
        <div>
          <label className="label">Libros hasta</label>
          <input className="input" type="date" value={rango.hasta}
            onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
        </div>
        <button className="btn" onClick={() => void descargarLibro('ventas')}>Libro Ventas CSV</button>
        <button className="btn" onClick={() => void descargarLibro('compras')}>Libro Compras CSV</button>
      </div>

      {/* -------- Alta -------- */}
      {puedeGestionar && (
        <>
          <h4 style={{ marginBottom: 6 }}>Nueva dosificación</h4>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '0 0 140px' }}>
              <label className="label">Tipo</label>
              <select className="input" value={form.tipo_factura}
                onChange={(e) => setForm({ ...form, tipo_factura: e.target.value })}>
                <option value="factura">Factura</option>
                <option value="recibo">Recibo</option>
                <option value="nota_venta">Nota de venta</option>
              </select>
            </div>
            <div style={{ flex: '0 0 120px' }}>
              <label className="label">Rango desde</label>
              <input className="input" type="number" value={form.rango_desde}
                onChange={(e) => setForm({ ...form, rango_desde: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 120px' }}>
              <label className="label">Rango hasta</label>
              <input className="input" type="number" value={form.rango_hasta}
                onChange={(e) => setForm({ ...form, rango_hasta: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label className="label">CUF base</label>
              <input className="input" value={form.cuf_base}
                onChange={(e) => setForm({ ...form, cuf_base: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 130px' }}>
              <label className="label">CUIS</label>
              <input className="input" value={form.cuis}
                onChange={(e) => setForm({ ...form, cuis: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 130px' }}>
              <label className="label">CUN</label>
              <input className="input" value={form.cun}
                onChange={(e) => setForm({ ...form, cun: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 150px' }}>
              <label className="label">Vigencia desde</label>
              <input className="input" type="date" value={form.vigencia_desde}
                onChange={(e) => setForm({ ...form, vigencia_desde: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 150px' }}>
              <label className="label">Vigencia hasta</label>
              <input className="input" type="date" value={form.vigencia_hasta}
                onChange={(e) => setForm({ ...form, vigencia_hasta: e.target.value })} />
            </div>
            <button className="btn btn-primary" onClick={() => void crear()}>Crear</button>
          </div>
        </>
      )}

      {/* -------- Listado -------- */}
      <h4 style={{ marginBottom: 6 }}>Dosificaciones ({dosifs.length})</h4>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th><th>Sucursal</th><th>Tipo</th><th>Rango</th><th>N° actual</th>
              <th>Restantes</th><th>Vigencia</th><th>Estado</th>
              {puedeGestionar && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {dosifs.map((d) => (
              <tr key={d.id}>
                <td>{d.id}</td>
                <td>{d.sucursal_id ?? 'Todas'}</td>
                <td>{d.tipo_factura}</td>
                <td>{d.rango_desde} – {d.rango_hasta}</td>
                <td>{d.numero_actual}</td>
                <td>{d.restantes}</td>
                <td style={{ fontSize: '0.76rem' }}>
                  {soloFecha(d.vigencia_desde) || '—'} → {soloFecha(d.vigencia_hasta) || '—'}
                </td>
                <td>
                  {d.activo
                    ? <span className="pill" style={{ background: '#22c55e22', color: '#22c55e' }}>Activa</span>
                    : <span className="pill" style={{ background: '#ef444422', color: '#ef4444' }}>Inactiva</span>}
                </td>
                {puedeGestionar && (
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => setEditando({
                        ...d,
                        vigencia_desde: soloFecha(d.vigencia_desde),
                        vigencia_hasta: soloFecha(d.vigencia_hasta),
                      })}>Editar</button>
                      {d.activo && (
                        <button className="btn btn-sm btn-danger" onClick={() => void desactivar(d)}>Desactivar</button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!dosifs.length && (
              <tr><td colSpan={puedeGestionar ? 9 : 8} style={{ color: '#5f7095' }}>
                No hay dosificaciones registradas.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 620 }}>
            <h3 style={{ marginTop: 0 }}>Editar dosificación #{editando.id}</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
              Creada para la sucursal {editando.sucursal_id ?? 'todas'} · rango {editando.rango_desde}–{editando.rango_hasta}.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '0 0 150px' }}>
                <label className="label">Tipo</label>
                <select className="input" value={editando.tipo_factura}
                  onChange={(e) => setEditando({ ...editando, tipo_factura: e.target.value })}>
                  <option value="factura">Factura</option>
                  <option value="recibo">Recibo</option>
                  <option value="nota_venta">Nota de venta</option>
                </select>
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label className="label">CUF base</label>
                <input className="input" value={editando.cuf_base || ''}
                  onChange={(e) => setEditando({ ...editando, cuf_base: e.target.value })} />
              </div>
              <div style={{ flex: '0 0 150px' }}>
                <label className="label">CUIS</label>
                <input className="input" value={editando.cuis || ''}
                  onChange={(e) => setEditando({ ...editando, cuis: e.target.value })} />
              </div>
              <div style={{ flex: '0 0 150px' }}>
                <label className="label">CUN</label>
                <input className="input" value={editando.cun || ''}
                  onChange={(e) => setEditando({ ...editando, cun: e.target.value })} />
              </div>
              <div style={{ flex: '0 0 160px' }}>
                <label className="label">Vigencia desde</label>
                <input className="input" type="date" value={soloFecha(editando.vigencia_desde)}
                  onChange={(e) => setEditando({ ...editando, vigencia_desde: e.target.value })} />
              </div>
              <div style={{ flex: '0 0 160px' }}>
                <label className="label">Vigencia hasta</label>
                <input className="input" type="date" value={soloFecha(editando.vigencia_hasta)}
                  onChange={(e) => setEditando({ ...editando, vigencia_hasta: e.target.value })} />
              </div>
              <div style={{ flex: '0 0 140px' }}>
                <label className="label">Estado</label>
                <select className="input" value={editando.activo ? 'true' : 'false'}
                  onChange={(e) => setEditando({ ...editando, activo: e.target.value === 'true' })}>
                  <option value="true">Activa</option>
                  <option value="false">Inactiva</option>
                </select>
              </div>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => void guardarEdicion()}>Guardar</button>
              <button className="btn" onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// =============================================================================
// 5) TASAS DE IMPUESTO (conta_tasas_impuesto) — cumplimiento fiscal Bolivia
// -----------------------------------------------------------------------------
// Historial normativo de alícuotas (IVA 13, IT 3, IUE 25, ITF 0.15, SIETE-RG 5).
// La tasa OPERATIVA se edita en "Parámetros" (claves *_pct_default) y cada venta
// snapshotea la que aplicó: cambiar aquí NO altera ventas pasadas. Solo
// supervisor+; cada cambio queda en conta_auditoria.
// =============================================================================
interface TasaRow {
  id: number; codigo: string; nombre: string; pct: number;
  vigencia_desde: string | null; vigencia_hasta: string | null;
  activo: boolean; creado_en: string;
}

function TasasFiscales() {
  const [rows, setRows] = useState<TasaRow[]>([]);
  const [edicion, setEdicion] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState('');

  const cargar = useCallback(async () => {
    try {
      const data = await contaApi<TasaRow[]>('/api/conta/tasas');
      setRows(data);
      const e: Record<string, string> = {};
      for (const r of data) e[r.codigo] = String(r.pct);
      setEdicion(e);
      setError('');
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const guardar = async (r: TasaRow) => {
    setMsg(''); setError(''); setGuardando(r.codigo);
    try {
      await contaApi('/api/conta/tasas', {
        method: 'POST',
        body: {
          codigo: r.codigo, nombre: r.nombre,
          pct: Number(String(edicion[r.codigo] ?? r.pct).replace(',', '.')),
          vigencia_desde: r.vigencia_desde, vigencia_hasta: r.vigencia_hasta,
          activo: r.activo,
        },
      });
      setMsg(`Tasa ${r.codigo} guardada y auditada.`);
      await cargar();
    } catch (e) { setError((e as Error).message); }
    finally { setGuardando(''); }
  };

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Tasas de impuesto (Bolivia)</h3>
      <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
        Historial de alícuotas. La tasa aplicada se guarda en cada venta (snapshot):
        editar aquí <b>no</b> recalcula los registros históricos.
      </p>
      {msg && <p style={{ color: '#22c55e' }}>{msg}</p>}
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ marginTop: 8 }}>
          <thead>
            <tr><th>Código</th><th>Nombre</th><th>%</th><th>Vigencia</th><th>Estado</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.codigo}</b></td>
                <td>{r.nombre}</td>
                <td style={{ width: 110 }}>
                  <input className="input" type="number" step="0.01"
                    value={edicion[r.codigo] ?? ''}
                    onChange={(e) => setEdicion({ ...edicion, [r.codigo]: e.target.value })} />
                </td>
                <td style={{ fontSize: '0.78rem', color: '#8aa4c7' }}>
                  {soloFecha(r.vigencia_desde) || '—'} → {soloFecha(r.vigencia_hasta) || '—'}
                </td>
                <td>
                  <select className="input" value={r.activo ? 'true' : 'false'}
                    onChange={(e) => setRows((prev) => prev.map((x) => x.id === r.id
                      ? { ...x, activo: e.target.value === 'true' } : x))}>
                    <option value="true">Activa</option>
                    <option value="false">Inactiva</option>
                  </select>
                </td>
                <td>
                  <button className="btn btn-sm btn-primary" disabled={guardando === r.codigo}
                    onClick={() => void guardar(r)}>
                    {guardando === r.codigo ? '…' : ''}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin tasas registradas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// =============================================================================
// 6) ESTADO SIETE-RG — acumulado anual vs límite (por defecto Bs 400.000)
// =============================================================================
interface SieteRgEstado {
  anio: number; regimen: string; pct_unificado: number; limite_anual: number;
  acumulado_anual: number; unificado_registrado: number; n_ventas: number;
  porcentaje_consumido: number; disponible: number;
  alerta: 'limite_superado' | 'cerca_del_limite' | null;
}

function EstadoSieteRg() {
  const [data, setData] = useState<SieteRgEstado | null>(null);
  const [error, setError] = useState('');
  const anio = new Date().getFullYear();

  useEffect(() => {
    contaApi<SieteRgEstado>(`/api/conta/siete-rg/estado?anio=${anio}`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [anio]);

  const color = data?.alerta === 'limite_superado' ? '#ef4444'
    : data?.alerta === 'cerca_del_limite' ? '#f59e0b' : '#22c55e';

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Régimen SIETE-RG — acumulado {anio}</h3>
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {!data && !error && <p style={{ color: '#8aa4c7' }}>Cargando…</p>}
      {data && (
        <>
          <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>Régimen configurado</div>
              <b>{data.regimen}</b>
            </div>
            <div>
              <div style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>Ventas acumuladas</div>
              <b>{money(data.acumulado_anual)} BOB</b>
            </div>
            <div>
              <div style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>Límite anual</div>
              <b>{money(data.limite_anual)} BOB</b>
            </div>
            <div>
              <div style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>Disponible</div>
              <b>{money(data.disponible)} BOB</b>
            </div>
            <div>
              <div style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>Unificado registrado ({data.pct_unificado}%)</div>
              <b>{money(data.unificado_registrado)} BOB</b>
            </div>
          </div>
          <div style={{ marginTop: 10, height: 10, background: '#1b2536', borderRadius: 6 }}>
            <div style={{
              width: `${Math.min(100, data.porcentaje_consumido)}%`,
              height: '100%', background: color, borderRadius: 6,
            }} />
          </div>
          <p style={{ color, marginTop: 6, fontSize: '0.82rem' }}>
            {data.porcentaje_consumido}% del límite consumido ({data.n_ventas} ventas).
            {data.alerta === 'limite_superado' && ' Límite superado: revisar permanencia en SIETE-RG.'}
            {data.alerta === 'cerca_del_limite' && ' Cerca del límite del régimen.'}
          </p>
        </>
      )}
    </section>
  );
}

// =============================================================================
// Página
// =============================================================================
export default function ConfiguracionPage() {
  const { ready, user } = useAuthGuard(['supervisor', 'admin']);

  if (!ready) return <GuardLoading />;

  const rol = user?.rol || '';
  const esGestor = rol === 'admin' || rol === 'desarrollador';
  const puedeGestionarSiat = ['contador', 'supervisor', 'admin', 'desarrollador'].includes(rol);

  return (
    <>
      <Navbar />
      <main style={{ padding: 20, maxWidth: 1000, margin: '0 auto' }}>
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Configuración del sistema</h2>
          <p style={{ color: '#8aa4c7', fontSize: '0.85rem', margin: 0 }}>
            Umbrales de egreso y descuento, modo de IVA por defecto, modo y distribución de propinas,
            modo de facturación de combos y exigencia de NIT. Además, la sección de{' '}
            <b>facturación (Bolivia)</b>: toggle facturado/no facturado, IVA 13%, IT 3%, IUE 25%,
            ITF 0.15%, régimen SIETE-RG, tasas históricas y dosificaciones SIN. Solo{' '}
            <b>supervisor</b> o superior (y el rol autorizado de cada clave). Además: alertas,
            backup fiscal y dosificaciones SIAT.
          </p>
        </div>

        <Configuracion rol={rol} />

        <TasasFiscales />

        <EstadoSieteRg />

        <AlertasAdmin />

        <BackupFiscal puedeGestionar={esGestor} />

        <DosificacionesSiat puedeGestionar={puedeGestionarSiat} />

        <p style={{ marginTop: 16, fontSize: '0.8rem', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/contabilidad" className="btn">Ir a Contabilidad</Link>
          <Link href="/admin/usuarios" className="btn">Usuarios</Link>
          <Link href="/dashboard-ejecutivo" className="btn">Dashboard ejecutivo</Link>
        </p>
      </main>
    </>
  );
}
