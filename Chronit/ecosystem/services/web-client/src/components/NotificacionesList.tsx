// =============================================================================
// CHRONIT WEB CLIENT — Lista de notificaciones (Client Component)
// -----------------------------------------------------------------------------
// Hace polling a /api/notificaciones cada 10s para mantenerse al día (llamadas
// a vestidores, estado del ticket y de la cola).
// =============================================================================
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ESTADO_COLA, ESTADO_TICKET } from '@/lib/constants';

interface Notificacion {
  id: number;
  estado: string;
  vestidor: number | null;
  llamada_en: string | null;
  ready_en: string | null;
  ticket_numero: number;
  ticket_estado: string;
  evento_nombre: string | null;
  evento_fecha: string | null;
  evento_hora: string | null;
}

export default function NotificacionesList() {
  const router = useRouter();
  const [items, setItems] = useState<Notificacion[]>([]);
  const [activas, setActivas] = useState(0);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval>>();

  const load = async () => {
    try {
      const r = await fetch('/api/notificaciones', { cache: 'no-store' });
      if (r.status === 401) {
        router.push('/login');
        return;
      }
      if (!r.ok) return;
      const d = await r.json();
      setItems(d.notificaciones || []);
      setActivas(d.activas || 0);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    timer.current = setInterval(load, 10000);
    return () => timer.current && clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1>🔔 Notificaciones</h1>
        {activas > 0 && <span className="badge-dot" style={{ position: 'static', border: 'none' }}>{activas} activas</span>}
      </div>

      {loading && <p className="muted">Cargando…</p>}
      {!loading && items.length === 0 && (
        <div className="card empty fade-in">
          No tienes notificaciones por ahora. Aquí verás cuándo te llamen a vestidores o cambie el estado de tu ticket.
        </div>
      )}

      <div className="grid" style={{ gap: 12 }}>
        {items.map((n) => {
          const ce = ESTADO_COLA[n.estado] || { label: n.estado, color: 'var(--muted)' };
          const te = ESTADO_TICKET[n.ticket_estado] || { label: n.ticket_estado, color: 'var(--muted)' };
          const esActiva = ['llamado', 'vestidor1', 'vestidor2', 'ready', 'en_pista'].includes(n.estado);
          return (
            <div key={n.id} className="card fade-in" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ fontSize: '1.6rem' }}>
                {n.estado === 'llamado' ? '📢' : n.estado === 'ready' ? '✅' : n.estado === 'en_pista' ? '🏁' : '🎟️'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong>Ticket #{n.ticket_numero}</strong>
                  <span className="pill" style={{ background: `${ce.color}22`, color: ce.color }}>
                    {n.estado === 'llamado' ? '📢 ' : ''}{ce.label}
                  </span>
                  <span className="pill" style={{ background: `${te.color}22`, color: te.color }}>
                    {te.label}
                  </span>
                  {esActiva && <span className="pill" style={{ background: 'rgba(22,163,74,0.15)', color: 'var(--green)' }}>● Activa</span>}
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  {n.evento_nombre ? `${n.evento_nombre} · ` : ''}
                  {n.evento_fecha ? new Date(n.evento_fecha).toLocaleDateString('es') : ''}
                  {n.evento_hora ? ` · ${n.evento_hora}` : ''}
                </div>
                {n.estado === 'llamado' && (
                  <p style={{ color: 'var(--blue)', fontWeight: 700, marginTop: 6 }}>
                    📢 ¡Te han llamado a vestidores! Preséntate de inmediato
                    {n.vestidor ? ` en el Vestidor ${n.vestidor}` : ''}.
                  </p>
                )}
                <div className="muted small" style={{ marginTop: 6 }}>
                  Actualización: {fmt(n.ready_en || n.llamada_en)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
