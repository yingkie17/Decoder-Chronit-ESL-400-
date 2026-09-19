// =============================================================================
// CHRONIT ECOSYSTEM — Dashboard Ejecutivo (/dashboard-ejecutivo)
// -----------------------------------------------------------------------------
// Panel de métricas vivas para los roles dueño y socio (solo lectura). El
// backend valida el rol y responde 403 al resto: en ese caso se muestra un
// aviso claro de acceso restringido.
//
//   GET /api/conta/dashboard-ejecutivo
//     -> ventas de hoy vs ayer vs el mismo día del mes pasado (con variación %),
//        efectivo esperado en cajas abiertas, QR por cuenta destino con la
//        diferencia contra el banco, top de productos del día, pilotos que
//        corrieron hoy y alertas activas.
//
// La pantalla se refresca sola cada 30 s (setInterval con limpieza) y muestra
// la hora de la última actualización.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import GuardLoading from '@/components/GuardLoading';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { contaApi, TICKETS_FRONTEND_URL } from '@/lib/api';
import { fecha, fechaHora, hora, money, TZ } from '@/components/conta/comun';

const INTERVALO_MS = 30000;

// ---------------------------------------------------------------------------
// Tipos de la respuesta de GET /api/conta/dashboard-ejecutivo
// ---------------------------------------------------------------------------
interface ResumenVenta {
  fecha: string;
  n_ventas: number;
  tickets: number;
  total: number;
  efectivo: number;
  qr: number;
  descuento: number;
  iva: number;
  propina: number;
  ticket_promedio: number;
}

interface CajaAbierta {
  sesion_id: number;
  cajero: string | null;
  monto_inicial: number;
  ventas_efectivo: number;
  egresos: number;
  propinas: number;
  retiros: number;
  efectivo_esperado: number;
}

interface QrCuenta {
  cuenta_id: number;
  cuenta: string;
  tipo: string;
  banco: string | null;
  monto_sistema: number;
  monto_banco: number | null;
  diferencia: number;
  conciliado: boolean;
}

interface TopProducto {
  producto: string;
  cantidad: number;
  ingresos: number;
}

interface PilotoEvento {
  evento: string;
  hora: string | null;
  modo: string | null;
  pilotos: number;
  tickets: number;
}

interface AlertaItem {
  id: number;
  tipo: string;
  severidad: string;
  mensaje: string;
  creado_en: string;
}

interface DashboardEjecutivo {
  generado_en: string;
  fecha: string;
  sucursal_id: number | null;
  ventas: {
    hoy: ResumenVenta;
    ayer: ResumenVenta;
    mes_pasado_mismo_dia: ResumenVenta;
    variacion_vs_ayer: number | null;
    variacion_vs_mes_pasado: number | null;
  };
  efectivo: {
    cajas_abiertas: number;
    efectivo_esperado_total: number;
    detalle: CajaAbierta[];
  };
  qr: {
    cuentas: QrCuenta[];
    total_sistema: number;
    total_banco: number;
    con_diferencia: number;
  };
  top_productos: TopProducto[];
  pilotos_hoy: {
    pilotos: number;
    eventos: number;
    tickets: number;
    por_evento: PilotoEvento[];
  };
  alertas: {
    sin_leer: number;
    criticas: number;
    umbrales: { diferencia_caja: number; caja_abierta_horas: number };
    items: AlertaItem[];
  };
}

// ---------------------------------------------------------------------------
// Utilidades de presentación
// ---------------------------------------------------------------------------
const COLOR_SEVERIDAD: Record<string, string> = {
  critica: '#ef4444',
  alta: '#f59e0b',
  media: '#3b82f6',
  baja: '#8aa4c7',
};

/** Variación porcentual con signo y color (verde sube, rojo baja). */
function Variacion({ valor }: { valor: number | null }) {
  if (valor === null || valor === undefined) return <span style={{ color: '#5f7095' }}>—</span>;
  const color = valor > 0 ? '#22c55e' : valor < 0 ? '#ef4444' : '#8aa4c7';
  return (
    <span style={{ color, fontWeight: 700 }}>
      {valor > 0 ? '+' : ''}{valor.toFixed(2)}%
    </span>
  );
}

/** Tarjeta de métrica (mismo patrón que el Resumen de contabilidad). */
function Tarjeta({ etiqueta, valor, detalle, color }: {
  etiqueta: string; valor: string; detalle?: string; color?: string;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, color: color || undefined }}>{valor}</div>
      <div style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>{etiqueta}</div>
      {detalle && <div style={{ color: '#5f7095', fontSize: '0.72rem', marginTop: 2 }}>{detalle}</div>}
    </div>
  );
}

export default function DashboardEjecutivoPage() {
  // Sin lista de roles: la autorización real la impone el backend (403) y así
  // se puede mostrar el aviso de acceso restringido en lugar de redirigir.
  const { ready } = useAuthGuard();
  const [data, setData] = useState<DashboardEjecutivo | null>(null);
  const [error, setError] = useState('');
  const [restringido, setRestringido] = useState(false);
  const [actualizado, setActualizado] = useState('');

  const cargar = useCallback(async () => {
    try {
      const d = await contaApi<DashboardEjecutivo>('/api/conta/dashboard-ejecutivo');
      setData(d);
      setRestringido(false);
      setError('');
      setActualizado(new Date().toISOString());
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) {
        setRestringido(true);
        setData(null);
        setError('');
      } else {
        setError(err.message);
      }
    }
  }, []);

  // Carga inicial + auto-refresh cada 30 s (se limpia al desmontar).
  useEffect(() => {
    if (!ready) return;
    void cargar();
    const id = setInterval(() => { void cargar(); }, INTERVALO_MS);
    return () => clearInterval(id);
  }, [ready, cargar]);

  if (!ready) return <GuardLoading />;

  const v = data?.ventas;
  const ventaHoy = v?.hoy;
  const qr = data?.qr;
  const alertas = data?.alertas;

  const tarjetas: { etiqueta: string; valor: string; detalle?: string; color?: string }[] = [
    {
      etiqueta: 'Ventas de hoy',
      valor: `Bs ${money(ventaHoy?.total)}`,
      detalle: `${ventaHoy?.n_ventas ?? 0} ventas · ${ventaHoy?.tickets ?? 0} tickets`,
    },
    {
      etiqueta: 'Var. vs ayer',
      valor: v?.variacion_vs_ayer == null ? '—'
        : `${(v.variacion_vs_ayer > 0 ? '+' : '')}${v.variacion_vs_ayer.toFixed(2)}%`,
      detalle: `Ayer Bs ${money(v?.ayer.total)}`,
      color: v?.variacion_vs_ayer == null ? undefined : (v.variacion_vs_ayer >= 0 ? '#22c55e' : '#ef4444'),
    },
    {
      etiqueta: 'Var. vs mismo día mes pasado',
      valor: v?.variacion_vs_mes_pasado == null ? '—'
        : `${(v.variacion_vs_mes_pasado > 0 ? '+' : '')}${v.variacion_vs_mes_pasado.toFixed(2)}%`,
      detalle: `${v ? fecha(v.mes_pasado_mismo_dia.fecha) : '—'} · Bs ${money(v?.mes_pasado_mismo_dia.total)}`,
      color: v?.variacion_vs_mes_pasado == null ? undefined : (v.variacion_vs_mes_pasado >= 0 ? '#22c55e' : '#ef4444'),
    },
    {
      etiqueta: 'Ticket promedio (hoy)',
      valor: `Bs ${money(ventaHoy?.ticket_promedio)}`,
      detalle: `IVA Bs ${money(ventaHoy?.iva)} · Propinas Bs ${money(ventaHoy?.propina)}`,
    },
    {
      etiqueta: 'Efectivo esperado en caja',
      valor: `Bs ${money(data?.efectivo.efectivo_esperado_total)}`,
      detalle: `${data?.efectivo.cajas_abiertas ?? 0} cajas abiertas`,
    },
    {
      etiqueta: 'QR del día (sistema)',
      valor: `Bs ${money(qr?.total_sistema)}`,
      detalle: `Banco Bs ${money(qr?.total_banco)} · ${qr?.con_diferencia ?? 0} con diferencia`,
    },
    {
      etiqueta: 'Alertas activas',
      valor: String(alertas?.sin_leer ?? 0),
      detalle: `${alertas?.criticas ?? 0} críticas`,
      color: (alertas?.criticas ?? 0) > 0 ? '#ef4444' : undefined,
    },
    {
      etiqueta: 'Pilotos que corrieron hoy',
      valor: String(data?.pilotos_hoy.pilotos ?? 0),
      detalle: `${data?.pilotos_hoy.eventos ?? 0} eventos · ${data?.pilotos_hoy.tickets ?? 0} tickets`,
    },
  ];

  const filasComparativa: [string, string, string, string][] = [
    ['Total vendido', money(ventaHoy?.total), money(v?.ayer.total), money(v?.mes_pasado_mismo_dia.total)],
    ['N° de ventas', String(ventaHoy?.n_ventas ?? 0), String(v?.ayer.n_ventas ?? 0), String(v?.mes_pasado_mismo_dia.n_ventas ?? 0)],
    ['Tickets', String(ventaHoy?.tickets ?? 0), String(v?.ayer.tickets ?? 0), String(v?.mes_pasado_mismo_dia.tickets ?? 0)],
    ['Ticket promedio', money(ventaHoy?.ticket_promedio), money(v?.ayer.ticket_promedio), money(v?.mes_pasado_mismo_dia.ticket_promedio)],
    ['Efectivo', money(ventaHoy?.efectivo), money(v?.ayer.efectivo), money(v?.mes_pasado_mismo_dia.efectivo)],
    ['QR / transferencia', money(ventaHoy?.qr), money(v?.ayer.qr), money(v?.mes_pasado_mismo_dia.qr)],
    ['Descuentos', money(ventaHoy?.descuento), money(v?.ayer.descuento), money(v?.mes_pasado_mismo_dia.descuento)],
    ['IVA', money(ventaHoy?.iva), money(v?.ayer.iva), money(v?.mes_pasado_mismo_dia.iva)],
  ];

  return (
    <>
      <Navbar />
      <main style={{ padding: 20, maxWidth: 1280, margin: '0 auto' }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2 style={{ margin: 0 }}>Dashboard ejecutivo</h2>
              <p style={{ color: '#8aa4c7', fontSize: '0.85rem', margin: '4px 0 0' }}>
                Métricas vivas del día para dirección · sucursal #{data?.sucursal_id ?? '—'} · zona horaria {TZ}
              </p>
            </div>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>
                Última actualización: {actualizado ? `${fechaHora(actualizado)} (${hora(actualizado)})` : '—'}
              </span>
              <button className="btn btn-primary" onClick={() => void cargar()}>Actualizar ahora</button>
            </div>
          </div>
          <p style={{ color: '#5f7095', fontSize: '0.75rem', margin: '8px 0 0' }}>
            Se actualiza automáticamente cada {INTERVALO_MS / 1000} segundos. Todos los importes en BOB.
          </p>
        </div>

        {restringido && (
          <section className="card" style={{ borderColor: '#f59e0b', marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, color: '#f59e0b' }}>Acceso restringido a dueño/socio</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.85rem', marginBottom: 0 }}>
              Este panel es de solo lectura ejecutiva y está reservado a los roles <b>dueño</b> y
              <b> socio</b>. Tu rol no tiene permiso para consultarlo. Si necesitas estas cifras,
              solicítalas a dirección.
            </p>
          </section>
        )}

        {error && <p className="card" style={{ color: '#ef4444', padding: 12 }}>{error}</p>}

        {!restringido && data && (
          <>
            {/* ---------------- Tarjetas de métricas ---------------- */}
            <section className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', marginBottom: 16 }}>
              {tarjetas.map((t) => (
                <Tarjeta key={t.etiqueta} etiqueta={t.etiqueta} valor={t.valor} detalle={t.detalle} color={t.color} />
              ))}
            </section>

            {/* ---------------- Comparativa de ventas ---------------- */}
            <section className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Ventas: hoy vs ayer vs mismo día del mes pasado</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Hoy ({fecha(ventaHoy?.fecha)})</th>
                      <th>Ayer ({fecha(v?.ayer.fecha)})</th>
                      <th>Mes pasado ({fecha(v?.mes_pasado_mismo_dia.fecha)})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasComparativa.map(([concepto, hoy, ayer, mesPasado]) => (
                      <tr key={concepto}>
                        <td>{concepto}</td>
                        <td><b>{hoy}</b></td>
                        <td>{ayer}</td>
                        <td>{mesPasado}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>Variación vs ayer</td>
                      <td colSpan={3}><Variacion valor={v?.variacion_vs_ayer ?? null} /></td>
                    </tr>
                    <tr>
                      <td>Variación vs mismo día del mes pasado</td>
                      <td colSpan={3}><Variacion valor={v?.variacion_vs_mes_pasado ?? null} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              {/* ---------------- Efectivo en cajas abiertas ---------------- */}
              <section className="card" style={{ flex: '1 1 420px' }}>
                <h3 style={{ marginTop: 0 }}>Efectivo esperado en caja</h3>
                <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
                  Total en {data.efectivo.cajas_abiertas} cajas abiertas:{' '}
                  <b>Bs {money(data.efectivo.efectivo_esperado_total)}</b>
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Cajero</th><th>M. inicial</th><th>Ventas efectivo</th>
                        <th>Egresos</th><th>Retiros</th><th>Esperado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.efectivo.detalle.map((c) => (
                        <tr key={c.sesion_id}>
                          <td>{c.cajero || `Sesión #${c.sesion_id}`}</td>
                          <td>{money(c.monto_inicial)}</td>
                          <td>{money(c.ventas_efectivo)}</td>
                          <td>{money(c.egresos)}</td>
                          <td>{money(c.retiros)}</td>
                          <td><b>{money(c.efectivo_esperado)}</b></td>
                        </tr>
                      ))}
                      {!data.efectivo.detalle.length && (
                        <tr><td colSpan={6} style={{ color: '#5f7095' }}>No hay cajas abiertas.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ---------------- QR por cuenta destino ---------------- */}
              <section className="card" style={{ flex: '1 1 420px' }}>
                <h3 style={{ marginTop: 0 }}>QR por cuenta destino</h3>
                <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
                  Sistema <b>Bs {money(qr?.total_sistema)}</b> · Banco <b>Bs {money(qr?.total_banco)}</b> ·{' '}
                  <b>{qr?.con_diferencia ?? 0}</b> cuentas con diferencia.
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead>
                      <tr><th>Cuenta</th><th>Tipo</th><th>Sistema</th><th>Banco</th><th>Diferencia</th><th>Estado</th></tr>
                    </thead>
                    <tbody>
                      {(qr?.cuentas || []).map((c) => (
                        <tr key={c.cuenta_id}>
                          <td>
                            {c.cuenta}
                            {c.banco && <div style={{ color: '#5f7095', fontSize: '0.72rem' }}>{c.banco}</div>}
                          </td>
                          <td>{c.tipo}</td>
                          <td>{money(c.monto_sistema)}</td>
                          <td>{c.monto_banco == null ? '—' : money(c.monto_banco)}</td>
                          <td style={{ color: Math.abs(c.diferencia) > 0.009 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
                            {money(c.diferencia)}
                          </td>
                          <td>
                            {c.conciliado
                              ? <span className="pill" style={{ background: '#22c55e22', color: '#22c55e' }}>Conciliado</span>
                              : <span className="pill" style={{ background: '#f59e0b22', color: '#f59e0b' }}>Pendiente</span>}
                          </td>
                        </tr>
                      ))}
                      {!qr?.cuentas?.length && (
                        <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin cuentas destino activas.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              {/* ---------------- Top productos ---------------- */}
              <section className="card" style={{ flex: '1 1 320px' }}>
                <h3 style={{ marginTop: 0 }}>Top productos del día</h3>
                <table className="tbl">
                  <thead><tr><th>Producto</th><th>Cant.</th><th>Ingresos</th></tr></thead>
                  <tbody>
                    {data.top_productos.map((p) => (
                      <tr key={p.producto}>
                        <td>{p.producto}</td><td>{p.cantidad}</td><td>{money(p.ingresos)}</td>
                      </tr>
                    ))}
                    {!data.top_productos.length && (
                      <tr><td colSpan={3} style={{ color: '#5f7095' }}>Sin ventas registradas hoy.</td></tr>
                    )}
                  </tbody>
                </table>
              </section>

              {/* ---------------- Pilotos ---------------- */}
              <section className="card" style={{ flex: '1 1 320px' }}>
                <h3 style={{ marginTop: 0 }}>Pilotos que corrieron hoy</h3>
                <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
                  <b>{data.pilotos_hoy.pilotos}</b> pilotos · <b>{data.pilotos_hoy.eventos}</b> eventos ·{' '}
                  <b>{data.pilotos_hoy.tickets}</b> tickets
                </p>
                <table className="tbl">
                  <thead><tr><th>Evento</th><th>Hora</th><th>Modo</th><th>Pilotos</th><th>Tickets</th></tr></thead>
                  <tbody>
                    {data.pilotos_hoy.por_evento.map((e) => (
                      <tr key={`${e.evento}-${e.hora}`}>
                        <td>{e.evento}</td>
                        <td>{e.hora || '—'}</td>
                        <td>{e.modo || '—'}</td>
                        <td>{e.pilotos}</td>
                        <td>{e.tickets}</td>
                      </tr>
                    ))}
                    {!data.pilotos_hoy.por_evento.length && (
                      <tr><td colSpan={5} style={{ color: '#5f7095' }}>No hay eventos programados para hoy.</td></tr>
                    )}
                  </tbody>
                </table>
              </section>

              {/* ---------------- Alertas ---------------- */}
              <section className="card" style={{ flex: '1 1 320px' }}>
                <h3 style={{ marginTop: 0 }}>Alertas activas</h3>
                <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
                  Sin leer: <b>{data.alertas.sin_leer}</b> · Críticas: <b>{data.alertas.criticas}</b> ·
                  Umbral diferencia de caja: <b>Bs {money(data.alertas.umbrales.diferencia_caja)}</b> ·
                  Caja abierta &gt; <b>{data.alertas.umbrales.caja_abierta_horas} h</b>
                </p>
                <table className="tbl">
                  <thead><tr><th>Severidad</th><th>Tipo</th><th>Mensaje</th><th>Fecha</th></tr></thead>
                  <tbody>
                    {data.alertas.items.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <span className="pill" style={{
                            background: `${COLOR_SEVERIDAD[a.severidad] || '#8aa4c7'}22`,
                            color: COLOR_SEVERIDAD[a.severidad] || '#8aa4c7',
                          }}>
                            {a.severidad}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.76rem' }}>{a.tipo}</td>
                        <td style={{ fontSize: '0.8rem' }}>{a.mensaje}</td>
                        <td style={{ fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{fechaHora(a.creado_en)}</td>
                      </tr>
                    ))}
                    {!data.alertas.items.length && (
                      <tr><td colSpan={4} style={{ color: '#5f7095' }}>Sin alertas activas.</td></tr>
                    )}
                  </tbody>
                </table>
              </section>
            </div>
          </>
        )}

        <p style={{ marginTop: 16, fontSize: '0.8rem', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/contabilidad" className="btn">Ir a Contabilidad</Link>
          <a href={`${TICKETS_FRONTEND_URL}/dashboard`} className="btn">Sistema de tickets</a>
        </p>
      </main>
    </>
  );
}
