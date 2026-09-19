// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Administración (Alertas/SIAT/Backup)
// -----------------------------------------------------------------------------
//   ALERTAS   GET /api/conta/alertas, /alertas/resumen, /alertas/config,
//             PUT /alertas/config, POST /alertas/evaluar, /alertas/leer-todas,
//             POST /alertas/:id/leer
//   SIAT      GET/POST /api/conta/siat/dosificaciones, PUT/DELETE /:id,
//             POST /:id/reservar, GET /siat/libro-ventas.csv y libro-compras.csv
//   BACKUP    GET /api/conta/backup/estado, POST /backup/ejecutar,
//             POST /backup/verificar, GET/PUT /backup/config
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi, contaDescargar } from '@/lib/api';
import { fecha, fechaHora, hoyISO } from './comun';

interface Alerta {
  id: number; tipo: string; severidad: string; mensaje: string;
  entidad: string | null; entidad_id: string | null;
  leida: boolean; notificada: boolean; notificada_en: string | null; creado_en: string;
}

interface AlertaResumen {
  total: number; sin_leer: number; criticas: number;
  por_tipo: { tipo: string; severidad: string; n: number }[];
  tipos_disponibles: string[];
}

interface AlertaConfig {
  canales: string[];
  telegram_token: string | null; telegram_chat_id: string | null;
  email_webhook: string | null; email?: string | null;
  diferencia_caja_umbral: number; caja_abierta_horas: number; qr_sin_confirmar_horas: number;
  propinas_pendientes_dias: number; stock_bajo_unidades: number; anticipo_aviso_dias: number;
}

interface Dosificacion {
  id: number; tipo_factura: string; rango_desde: number; rango_hasta: number;
  numero_actual: number; restantes: number; cuf_base: string | null; cuis: string | null;
  cun: string | null; vigencia_desde: string | null; vigencia_hasta: string | null; activo: boolean;
}

interface Respaldo {
  archivo: string; fecha: string; fecha_local: string; bytes: number; cifrado: boolean;
  sha256: string; existe: boolean; subido_externo?: boolean; error_externo?: string;
}

interface BackupEstado {
  directorio: string; cifrado_disponible: boolean;
  config: { retencion_anios: number; hora: string; destino: string | null; gpg: boolean };
  ultimo_ok: Respaldo | null; ultimo_ok_hoy: boolean; total: number; respaldos: Respaldo[];
  verificacion_mensual: { ok: boolean; archivo: string; tablas_detectadas: number; verificado_en: string } | null;
}

const SEVERIDAD: Record<string, string> = { critica: '#ef4444', alta: '#f59e0b', media: '#3b82f6', baja: '#8aa4c7' };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const bytes = (n: number) => {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
};

export default function AdminConta({ ok, soloLectura, esSupervisor, esAdmin }: {
  ok: (m: string) => void; soloLectura: boolean; esSupervisor: boolean; esAdmin: boolean;
}) {
  const [seccion, setSeccion] = useState<'alertas' | 'siat' | 'backup'>('alertas');
  const [error, setError] = useState('');

  // Alertas
  const [fAlt, setFAlt] = useState({ leida: '', tipo: '', severidad: '', desde: '' });
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [resumen, setResumen] = useState<AlertaResumen | null>(null);
  const [config, setConfig] = useState<AlertaConfig | null>(null);
  const [canalesTexto, setCanalesTexto] = useState('');

  // SIAT
  const [fSiat, setFSiat] = useState({ tipo_factura: '', activo: '' });
  const [dosif, setDosif] = useState<Dosificacion[]>([]);
  const [nuevaDosif, setNuevaDosif] = useState({
    tipo_factura: 'factura', rango_desde: '', rango_hasta: '', cuf_base: '', cuis: '', cun: '',
    vigencia_desde: '', vigencia_hasta: '',
  });
  const [libro, setLibro] = useState({ desde: `${hoyISO().slice(0, 4)}-01-01`, hasta: hoyISO() });

  // Backup
  const [estado, setEstado] = useState<BackupEstado | null>(null);
  const [cfgBackup, setCfgBackup] = useState({
    retencion_anios: '', hora: '', destino: '', gpg: true,
  });

  const cargarAlertas = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(fAlt).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setAlertas(await contaApi<Alerta[]>(`/api/conta/alertas?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [fAlt]);

  const cargarResumen = async () => {
    try { setResumen(await contaApi<AlertaResumen>('/api/conta/alertas/resumen')); }
    catch (e) { setError(errMsg(e)); }
  };

  const cargarConfigAlertas = async () => {
    try {
      const c = await contaApi<AlertaConfig>('/api/conta/alertas/config');
      setConfig(c);
      setCanalesTexto((c.canales || []).join(', '));
    } catch (e) { setError(errMsg(e)); }
  };

  const cargarDosificaciones = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(fSiat).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setDosif(await contaApi<Dosificacion[]>(`/api/conta/siat/dosificaciones?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [fSiat]);

  const cargarBackup = async () => {
    try {
      const e = await contaApi<BackupEstado>('/api/conta/backup/estado');
      setEstado(e);
      setCfgBackup({
        retencion_anios: String(e.config.retencion_anios ?? ''),
        hora: e.config.hora || '',
        destino: e.config.destino || '',
        gpg: e.config.gpg,
      });
    } catch (e) { setError(errMsg(e)); }
  };

  useEffect(() => { void cargarAlertas(); }, [cargarAlertas]);
  useEffect(() => { void cargarResumen(); }, []);
  useEffect(() => { void cargarConfigAlertas(); }, []);
  useEffect(() => { void cargarDosificaciones(); }, [cargarDosificaciones]);
  // El estado del respaldo solo lo pueden consultar admin/desarrollador.
  useEffect(() => { if (esAdmin) void cargarBackup(); }, [esAdmin]);

  // --- Alertas ---
  const leerAlerta = async (a: Alerta) => {
    try {
      await contaApi(`/api/conta/alertas/${a.id}/leer`, { method: 'POST' });
      await cargarAlertas();
      await cargarResumen();
    } catch (e) { setError(errMsg(e)); }
  };

  const leerTodas = async () => {
    try {
      const r = await contaApi<{ marcadas: number }>('/api/conta/alertas/leer-todas', { method: 'POST' });
      ok(`${r.marcadas} alerta(s) marcadas como leídas.`);
      await cargarAlertas();
      await cargarResumen();
    } catch (e) { setError(errMsg(e)); }
  };

  const evaluar = async () => {
    try {
      const r = await contaApi<{ total: number }>('/api/conta/alertas/evaluar', { method: 'POST' });
      ok(`Detección ejecutada: ${r.total} alerta(s) nueva(s).`);
      await cargarAlertas();
      await cargarResumen();
    } catch (e) { setError(errMsg(e)); }
  };

  const guardarConfigAlertas = async () => {
    if (!config) return;
    setError('');
    try {
      const canales = canalesTexto.split(',').map((c) => c.trim()).filter(Boolean);
      await contaApi('/api/conta/alertas/config', {
        method: 'PUT',
        body: {
          canales,
          telegram_token: config.telegram_token || null,
          telegram_chat_id: config.telegram_chat_id || null,
          email_webhook: config.email_webhook || null,
          diferencia_caja_umbral: Number(config.diferencia_caja_umbral) || 0,
          caja_abierta_horas: Number(config.caja_abierta_horas) || 0,
          qr_sin_confirmar_horas: Number(config.qr_sin_confirmar_horas) || 0,
          propinas_pendientes_dias: Number(config.propinas_pendientes_dias) || 0,
          stock_bajo_unidades: Number(config.stock_bajo_unidades) || 0,
          anticipo_aviso_dias: Number(config.anticipo_aviso_dias) || 0,
        },
      });
      ok('Configuración de alertas guardada.');
      await cargarConfigAlertas();
    } catch (e) { setError(errMsg(e)); }
  };

  // --- SIAT ---
  const crearDosificacion = async () => {
    setError('');
    if (!(Number(nuevaDosif.rango_desde) > 0) || !(Number(nuevaDosif.rango_hasta) > Number(nuevaDosif.rango_desde))) {
      setError('El rango autorizado debe tener "desde" mayor a 0 y "hasta" mayor que "desde".');
      return;
    }
    try {
      await contaApi('/api/conta/siat/dosificaciones', {
        method: 'POST',
        body: {
          tipo_factura: nuevaDosif.tipo_factura || 'factura',
          rango_desde: Number(nuevaDosif.rango_desde),
          rango_hasta: Number(nuevaDosif.rango_hasta),
          cuf_base: nuevaDosif.cuf_base || null,
          cuis: nuevaDosif.cuis || null,
          cun: nuevaDosif.cun || null,
          vigencia_desde: nuevaDosif.vigencia_desde || null,
          vigencia_hasta: nuevaDosif.vigencia_hasta || null,
        },
      });
      ok('Dosificación registrada.');
      setNuevaDosif({
        tipo_factura: 'factura', rango_desde: '', rango_hasta: '', cuf_base: '', cuis: '', cun: '',
        vigencia_desde: '', vigencia_hasta: '',
      });
      await cargarDosificaciones();
    } catch (e) { setError(errMsg(e)); }
  };

  const desactivarDosificacion = async (d: Dosificacion) => {
    if (!window.confirm(`¿Desactivar la dosificación #${d.id}?`)) return;
    try {
      await contaApi(`/api/conta/siat/dosificaciones/${d.id}`, { method: 'DELETE' });
      ok(`Dosificación #${d.id} desactivada.`);
      await cargarDosificaciones();
    } catch (e) { setError(errMsg(e)); }
  };

  const reservarNumero = async (d: Dosificacion) => {
    try {
      const r = await contaApi<{ numero_factura: string; cuf: string | null; restantes: number }>(
        `/api/conta/siat/dosificaciones/${d.id}/reservar`, { method: 'POST' });
      ok(`Número reservado: ${r.numero_factura} (restantes ${r.restantes}). CUF: ${r.cuf || '—'}`);
      await cargarDosificaciones();
    } catch (e) { setError(errMsg(e)); }
  };

  const descargarLibro = async (tipo: 'ventas' | 'compras') => {
    try {
      await contaDescargar(
        `/api/conta/siat/libro-${tipo}.csv?desde=${libro.desde}&hasta=${libro.hasta}`,
        `libro-${tipo}_${libro.desde}_${libro.hasta}.csv`,
      );
    } catch (e) { setError(errMsg(e)); }
  };

  // --- Backup ---
  const ejecutarBackup = async () => {
    if (!window.confirm('¿Ejecutar un respaldo fiscal manual ahora?')) return;
    try {
      const r = await contaApi<{ respaldo: Respaldo }>('/api/conta/backup/ejecutar', { method: 'POST' });
      ok(`Respaldo generado: ${r.respaldo.archivo} (${bytes(r.respaldo.bytes)}).`);
      await cargarBackup();
    } catch (e) { setError(errMsg(e)); }
  };

  const verificarBackup = async () => {
    try {
      const r = await contaApi<{ archivo: string; tablas_detectadas: number }>(
        '/api/conta/backup/verificar', { method: 'POST' });
      ok(`Restauración verificada: ${r.archivo} (${r.tablas_detectadas} tabla(s)).`);
      await cargarBackup();
    } catch (e) { setError(errMsg(e)); }
  };

  const guardarConfigBackup = async () => {
    setError('');
    try {
      await contaApi('/api/conta/backup/config', {
        method: 'PUT',
        body: {
          retencion_anios: Number(cfgBackup.retencion_anios) || 8,
          hora: cfgBackup.hora || '02:00',
          destino: cfgBackup.destino || null,
          gpg: cfgBackup.gpg,
        },
      });
      ok('Configuración de respaldo guardada.');
      await cargarBackup();
    } catch (e) { setError(errMsg(e)); }
  };

  return (
    <>
      {error && <p className="card" style={{ color: '#ef4444', padding: 12, marginBottom: 12 }}>{error}</p>}

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {([['alertas', 'Alertas'], ['siat', 'SIAT / Dosificaciones'],
          ['backup', 'Backup fiscal']] as const).map(([k, etiqueta]) => (
          <button key={k} className={`btn ${seccion === k ? 'btn-primary' : ''}`}
            onClick={() => setSeccion(k)}>{etiqueta}</button>
        ))}
      </div>

      {/* ===================== Alertas ===================== */}
      {seccion === 'alertas' && (
        <>
          {resumen && (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', marginBottom: 14 }}>
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontWeight: 700 }}>{resumen.sin_leer}</div>
                <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Sin leer</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontWeight: 700, color: '#ef4444' }}>{resumen.criticas}</div>
                <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Críticas sin leer</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontWeight: 700 }}>{resumen.total}</div>
                <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Total histórico</div>
              </div>
              {resumen.por_tipo.slice(0, 3).map((p) => (
                <div key={`${p.tipo}-${p.severidad}`} className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{p.n}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>{p.tipo} ({p.severidad})</div>
                </div>
              ))}
            </div>
          )}

          <section className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ maxWidth: 150 }} value={fAlt.leida}
                onChange={(e) => setFAlt({ ...fAlt, leida: e.target.value })}>
                <option value="">Todas</option>
                <option value="false">Sin leer</option>
                <option value="true">Leídas</option>
              </select>
              <select className="input" style={{ flex: '1 1 200px' }} value={fAlt.tipo}
                onChange={(e) => setFAlt({ ...fAlt, tipo: e.target.value })}>
                <option value="">Todos los tipos</option>
                {(resumen?.tipos_disponibles || []).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="input" style={{ maxWidth: 150 }} value={fAlt.severidad}
                onChange={(e) => setFAlt({ ...fAlt, severidad: e.target.value })}>
                <option value="">Toda severidad</option>
                <option value="critica">Crítica</option>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
              <input className="input" type="date" style={{ maxWidth: 160 }} value={fAlt.desde}
                onChange={(e) => setFAlt({ ...fAlt, desde: e.target.value })} />
              <button className="btn btn-primary" onClick={() => void cargarAlertas()}>Buscar</button>
              <button className="btn" onClick={() => void leerTodas()}>Marcar todas leídas</button>
              {esSupervisor && !soloLectura && (
                <button className="btn btn-warn" onClick={() => void evaluar()}>Evaluar ahora</button>
              )}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>#</th><th>Severidad</th><th>Tipo</th><th>Mensaje</th><th>Entidad</th>
                    <th>Fecha</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {alertas.map((a) => (
                    <tr key={a.id} style={a.leida ? { opacity: 0.6 } : undefined}>
                      <td>{a.id}</td>
                      <td>
                        <span className="pill" style={{
                          background: `${SEVERIDAD[a.severidad] || '#8aa4c7'}22`,
                          color: SEVERIDAD[a.severidad] || '#8aa4c7',
                        }}>{a.severidad}</span>
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>{a.tipo}</td>
                      <td style={{ fontSize: '0.82rem' }}>{a.mensaje}</td>
                      <td style={{ fontSize: '0.76rem' }}>
                        {a.entidad_id ? `${a.entidad || '—'}#${a.entidad_id}` : (a.entidad || '—')}
                      </td>
                      <td style={{ fontSize: '0.76rem' }}>{fechaHora(a.creado_en)}</td>
                      <td>{a.leida ? 'leída' : 'sin leer'}</td>
                      <td>
                        {!a.leida && (
                          <button className="btn btn-sm" onClick={() => void leerAlerta(a)}>Leer</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!alertas.length && <tr><td colSpan={8} style={{ color: '#5f7095' }}>Sin alertas.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {config && (
            <section className="card">
              <h3 style={{ marginTop: 0 }}>Configuración de alertas</h3>
              <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
                Canales disponibles: <b>in_app</b>, <b>telegram</b>, <b>email</b>. La edición está
                reservada a supervisor o superior.
              </p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input className="input" placeholder="Canales (separados por coma)" style={{ flex: '1 1 260px' }}
                  value={canalesTexto} disabled={!esSupervisor || soloLectura}
                  onChange={(e) => setCanalesTexto(e.target.value)} />
                <input className="input" placeholder="Token de Telegram" style={{ flex: '1 1 220px' }}
                  value={config.telegram_token || ''} disabled={!esSupervisor || soloLectura}
                  onChange={(e) => setConfig({ ...config, telegram_token: e.target.value })} />
                <input className="input" placeholder="Chat ID de Telegram" style={{ flex: '0 0 200px' }}
                  value={config.telegram_chat_id || ''} disabled={!esSupervisor || soloLectura}
                  onChange={(e) => setConfig({ ...config, telegram_chat_id: e.target.value })} />
                <input className="input" placeholder="Webhook de email" style={{ flex: '1 1 220px' }}
                  value={config.email_webhook || ''} disabled={!esSupervisor || soloLectura}
                  onChange={(e) => setConfig({ ...config, email_webhook: e.target.value })} />
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <input className="input" type="number" step="0.01" placeholder="Umbral diferencia de caja"
                  style={{ flex: '0 0 220px' }} value={config.diferencia_caja_umbral}
                  disabled={!esSupervisor || soloLectura}
                  onChange={(e) => setConfig({ ...config, diferencia_caja_umbral: Number(e.target.value) })} />
                <input className="input" type="number" placeholder="Caja abierta (horas)" style={{ flex: '0 0 200px' }}
                  value={config.caja_abierta_horas} disabled={!esSupervisor || soloLectura}
                  onChange={(e) => setConfig({ ...config, caja_abierta_horas: Number(e.target.value) })} />
                <input className="input" type="number" placeholder="QR sin confirmar (horas)" style={{ flex: '0 0 210px' }}
                  value={config.qr_sin_confirmar_horas} disabled={!esSupervisor || soloLectura}
                  onChange={(e) => setConfig({ ...config, qr_sin_confirmar_horas: Number(e.target.value) })} />
                <input className="input" type="number" placeholder="Propinas pendientes (días)" style={{ flex: '0 0 220px' }}
                  value={config.propinas_pendientes_dias} disabled={!esSupervisor || soloLectura}
                  onChange={(e) => setConfig({ ...config, propinas_pendientes_dias: Number(e.target.value) })} />
                <input className="input" type="number" placeholder="Stock bajo (unidades)" style={{ flex: '0 0 200px' }}
                  value={config.stock_bajo_unidades} disabled={!esSupervisor || soloLectura}
                  onChange={(e) => setConfig({ ...config, stock_bajo_unidades: Number(e.target.value) })} />
                <input className="input" type="number" placeholder="Aviso anticipo (días)" style={{ flex: '0 0 200px' }}
                  value={config.anticipo_aviso_dias} disabled={!esSupervisor || soloLectura}
                  onChange={(e) => setConfig({ ...config, anticipo_aviso_dias: Number(e.target.value) })} />
                {esSupervisor && !soloLectura && (
                  <button className="btn btn-primary" onClick={() => void guardarConfigAlertas()}>
                    Guardar configuración
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* ===================== SIAT ===================== */}
      {seccion === 'siat' && (
        <>
          <section className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Libros del SIN (CSV)</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
              Exporta el Libro de Ventas y de Compras en el formato del SIN para descarga manual
              (no hay integración SOAP; la dosificación es estructural).
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" type="date" style={{ maxWidth: 160 }} value={libro.desde}
                onChange={(e) => setLibro({ ...libro, desde: e.target.value })} />
              <input className="input" type="date" style={{ maxWidth: 160 }} value={libro.hasta}
                onChange={(e) => setLibro({ ...libro, hasta: e.target.value })} />
              <button className="btn" onClick={() => void descargarLibro('ventas')}>Libro de Ventas (CSV)</button>
              <button className="btn" onClick={() => void descargarLibro('compras')}>Libro de Compras (CSV)</button>
            </div>
          </section>

          {!soloLectura && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Nueva dosificación</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select className="input" style={{ flex: '0 0 160px' }} value={nuevaDosif.tipo_factura}
                  onChange={(e) => setNuevaDosif({ ...nuevaDosif, tipo_factura: e.target.value })}>
                  <option value="factura">Factura</option>
                  <option value="nota_credito">Nota de crédito</option>
                  <option value="nota_debito">Nota de débito</option>
                </select>
                <input className="input" type="number" placeholder="Rango desde *" style={{ flex: '0 0 150px' }}
                  value={nuevaDosif.rango_desde} onChange={(e) => setNuevaDosif({ ...nuevaDosif, rango_desde: e.target.value })} />
                <input className="input" type="number" placeholder="Rango hasta *" style={{ flex: '0 0 150px' }}
                  value={nuevaDosif.rango_hasta} onChange={(e) => setNuevaDosif({ ...nuevaDosif, rango_hasta: e.target.value })} />
                <input className="input" placeholder="CUF base" style={{ flex: '1 1 200px' }}
                  value={nuevaDosif.cuf_base} onChange={(e) => setNuevaDosif({ ...nuevaDosif, cuf_base: e.target.value })} />
                <input className="input" placeholder="CUIS" style={{ flex: '0 0 140px' }}
                  value={nuevaDosif.cuis} onChange={(e) => setNuevaDosif({ ...nuevaDosif, cuis: e.target.value })} />
                <input className="input" placeholder="CUN" style={{ flex: '0 0 140px' }}
                  value={nuevaDosif.cun} onChange={(e) => setNuevaDosif({ ...nuevaDosif, cun: e.target.value })} />
                <input className="input" type="date" title="Vigencia desde" style={{ maxWidth: 160 }}
                  value={nuevaDosif.vigencia_desde}
                  onChange={(e) => setNuevaDosif({ ...nuevaDosif, vigencia_desde: e.target.value })} />
                <input className="input" type="date" title="Vigencia hasta" style={{ maxWidth: 160 }}
                  value={nuevaDosif.vigencia_hasta}
                  onChange={(e) => setNuevaDosif({ ...nuevaDosif, vigencia_hasta: e.target.value })} />
                <button className="btn btn-primary" onClick={() => void crearDosificacion()}>Registrar</button>
              </div>
            </section>
          )}

          <section className="card">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ maxWidth: 170 }} value={fSiat.tipo_factura}
                onChange={(e) => setFSiat({ ...fSiat, tipo_factura: e.target.value })}>
                <option value="">Todos los tipos</option>
                <option value="factura">Factura</option>
                <option value="nota_credito">Nota de crédito</option>
                <option value="nota_debito">Nota de débito</option>
              </select>
              <select className="input" style={{ maxWidth: 150 }} value={fSiat.activo}
                onChange={(e) => setFSiat({ ...fSiat, activo: e.target.value })}>
                <option value="">Todos</option>
                <option value="true">Activas</option>
                <option value="false">Inactivas</option>
              </select>
              <button className="btn btn-primary" onClick={() => void cargarDosificaciones()}>Buscar</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>#</th><th>Tipo</th><th>Rango</th><th>N° actual</th><th>Restantes</th>
                    <th>CUF base</th><th>CUIS/CUN</th><th>Vigencia</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {dosif.map((d) => (
                    <tr key={d.id} style={d.activo ? undefined : { opacity: 0.55 }}>
                      <td>{d.id}</td>
                      <td>{d.tipo_factura}</td>
                      <td style={{ fontSize: '0.8rem' }}>{d.rango_desde} → {d.rango_hasta}</td>
                      <td>{d.numero_actual}</td>
                      <td>{d.restantes}</td>
                      <td style={{ fontSize: '0.72rem', maxWidth: 160, wordBreak: 'break-all' }}>{d.cuf_base || '—'}</td>
                      <td style={{ fontSize: '0.74rem' }}>{d.cuis || '—'} / {d.cun || '—'}</td>
                      <td style={{ fontSize: '0.74rem' }}>
                        {d.vigencia_desde ? fecha(d.vigencia_desde) : '—'} →{' '}
                        {d.vigencia_hasta ? fecha(d.vigencia_hasta) : '—'}
                      </td>
                      <td>{d.activo ? 'Sí' : 'No'}</td>
                      <td>
                        {!soloLectura && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {d.activo && d.restantes > 0 && (
                              <button className="btn btn-sm btn-success" onClick={() => void reservarNumero(d)}>
                                Reservar
                              </button>
                            )}
                            {d.activo && (
                              <button className="btn btn-sm btn-danger" onClick={() => void desactivarDosificacion(d)}>Desactivar</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!dosif.length && <tr><td colSpan={10} style={{ color: '#5f7095' }}>Sin dosificaciones.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ===================== Backup ===================== */}
      {seccion === 'backup' && (
        <>
          {!esAdmin && (
            <p className="card" style={{ color: '#f59e0b', padding: 12, marginBottom: 12 }}>
              La ejecución y configuración del respaldo fiscal está reservada a <b>admin</b> o{' '}
              <b>desarrollador</b>. Puedes consultar el estado.
            </p>
          )}

          {estado && (
            <>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', marginBottom: 14 }}>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700, color: estado.ultimo_ok_hoy ? '#22c55e' : '#f59e0b' }}>
                    {estado.ultimo_ok_hoy ? 'Respaldo de hoy' : 'Sin respaldo hoy'}
                  </div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>
                    Último: {estado.ultimo_ok ? fechaHora(estado.ultimo_ok.fecha) : '—'}
                  </div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{estado.total}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Respaldos conservados</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{estado.config.retencion_anios} años</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Retención (normativa)</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>{estado.cifrado_disponible ? 'Sí' : 'No'}</div>
                  <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>Cifrado GPG disponible</div>
                </div>
              </div>

              <section className="card" style={{ marginBottom: 16 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>Directorio: {estado.directorio}</span>
                  <span style={{ flex: 1 }} />
                  {esAdmin && !soloLectura && (
                    <>
                      <button className="btn btn-primary" onClick={() => void ejecutarBackup()}>Ejecutar respaldo</button>
                      <button className="btn" onClick={() => void verificarBackup()}>Verificar restauración</button>
                    </>
                  )}
                </div>
                {estado.verificacion_mensual && (
                  <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginBottom: 0, marginTop: 8 }}>
                    Última verificación: {fechaHora(estado.verificacion_mensual.verificado_en)} ·{' '}
                    {estado.verificacion_mensual.ok ? 'OK' : 'Falló'} ·{' '}
                    {estado.verificacion_mensual.tablas_detectadas} tabla(s)
                  </p>
                )}
              </section>

              <section className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ marginTop: 0 }}>Respaldos</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead>
                      <tr><th>Archivo</th><th>Fecha</th><th>Tamaño</th><th>Cifrado</th>
                        <th>Externo</th><th>Existe</th><th>SHA256</th></tr>
                    </thead>
                    <tbody>
                      {estado.respaldos.map((r) => (
                        <tr key={r.archivo}>
                          <td style={{ fontSize: '0.78rem' }}>{r.archivo}</td>
                          <td style={{ fontSize: '0.76rem' }}>{fechaHora(r.fecha)}</td>
                          <td>{bytes(r.bytes)}</td>
                          <td>{r.cifrado ? 'Sí' : '—'}</td>
                          <td>{r.subido_externo ? 'Sí' : (r.error_externo ? 'Error' : '—')}</td>
                          <td>{r.existe ? 'Sí' : 'No'}</td>
                          <td style={{ fontSize: '0.68rem', maxWidth: 150, wordBreak: 'break-all' }}>{r.sha256}</td>
                        </tr>
                      ))}
                      {!estado.respaldos.length && (
                        <tr><td colSpan={7} style={{ color: '#5f7095' }}>Todavía no hay respaldos.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card">
                <h3 style={{ marginTop: 0 }}>Configuración de respaldo</h3>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input className="input" type="number" placeholder="Retención (años)" style={{ flex: '0 0 170px' }}
                    value={cfgBackup.retencion_anios} disabled={!esAdmin || soloLectura}
                    onChange={(e) => setCfgBackup({ ...cfgBackup, retencion_anios: e.target.value })} />
                  <input className="input" placeholder="Hora (HH:MM)" style={{ flex: '0 0 150px' }}
                    value={cfgBackup.hora} disabled={!esAdmin || soloLectura}
                    onChange={(e) => setCfgBackup({ ...cfgBackup, hora: e.target.value })} />
                  <input className="input" placeholder="Destino externo (rclone)" style={{ flex: '1 1 220px' }}
                    value={cfgBackup.destino} disabled={!esAdmin || soloLectura}
                    onChange={(e) => setCfgBackup({ ...cfgBackup, destino: e.target.value })} />
                  <label style={{ color: '#8aa4c7', fontSize: '0.82rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={cfgBackup.gpg} disabled={!esAdmin || soloLectura}
                      onChange={(e) => setCfgBackup({ ...cfgBackup, gpg: e.target.checked })} />
                    Cifrar con GPG
                  </label>
                  {esAdmin && !soloLectura && (
                    <button className="btn btn-primary" onClick={() => void guardarConfigBackup()}>
                      Guardar configuración
                    </button>
                  )}
                </div>
                <p style={{ color: '#8aa4c7', fontSize: '0.78rem', marginBottom: 0 }}>
                  Retención por defecto: 8 años (normativa boliviana). El respaldo diario corre a la
                  hora configurada y la verificación de restauración el día 1 de cada mes.
                </p>
              </section>
            </>
          )}
          {!estado && <p style={{ color: '#5f7095' }}>Cargando estado del respaldo…</p>}
        </>
      )}
    </>
  );
}
