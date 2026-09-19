// =============================================================================
// CHRONIT ECOSYSTEM — CRM INTERNO: resumen (/crm)
// -----------------------------------------------------------------------------
// Foto global del negocio a partir de GET /api/crm/resumen: usuarios, tickets,
// carreras/eventos, parte web y caja. Incluye el diagnóstico del módulo
// biométrico de personal (arquitectura lista / pendiente de hardware).
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import GuardLoading from '@/components/GuardLoading';
import { money } from '@/components/TablaDatos';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { CRM_ROLES, crmApi } from '@/lib/api';

interface Resumen {
  sistemas: {
    usuarios: { usuarios: number; registrados: number };
    tickets: { tickets: number; impresos: number };
    carreras: { carreras: number; eventos: number };
    parte_web: { publicaciones: number };
    caja: { sesiones: number; abiertas: number; ventas: number; total: number };
  };
  biometrico: { arquitectura_lista: boolean; habilitado: boolean };
}

interface EstadoPersonal {
  modulo: string;
  habilitado: boolean;
  arquitectura_lista: boolean;
  tablas: string[];
  resumen: {
    empleados: number;
    empleados_activos: number;
    dispositivos: number;
    dispositivos_activos: number;
    marcaciones: number;
    ultima_marcacion: string | null;
  };
}

// Tarjeta de un sistema integrado: título, enlaces y métricas.
function CardSistema({
  titulo,
  enlaces,
  metricas,
}: {
  titulo: string;
  enlaces: { href: string; etiqueta: string }[];
  metricas: { etiqueta: string; valor: string }[];
}) {
  return (
    <section className="card">
      <header className="page-header" style={{ marginBottom: 12 }}>
        <h2 className="page-title" style={{ fontSize: '1rem' }}>{titulo}</h2>
      </header>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
        {metricas.map((m) => (
          <div key={m.etiqueta} className="card" style={{ padding: 12, background: 'var(--bg-elev-2)' }}>
            <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>{m.valor}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem', marginTop: 2 }}>{m.etiqueta}</div>
          </div>
        ))}
      </div>
      <div className="acciones" style={{ marginTop: 12 }}>
        {enlaces.map((e) => (
          <Link key={e.href} href={e.href} className="btn">{e.etiqueta}</Link>
        ))}
      </div>
    </section>
  );
}

export default function CrmResumenPage() {
  const { ready, user } = useAuthGuard(CRM_ROLES);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [personal, setPersonal] = useState<EstadoPersonal | null>(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try {
      const [r, p] = await Promise.all([
        crmApi<Resumen>('/api/crm/resumen'),
        crmApi<EstadoPersonal>('/api/crm/personal/estado'),
      ]);
      setResumen(r);
      setPersonal(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (ready) void cargar();
  }, [ready, cargar]);

  if (!ready) return <GuardLoading />;

  const s = resumen?.sistemas;

  return (
    <>
      <Navbar />
      <main className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Resumen del CRM</h1>
            <p className="page-sub">
              Información centralizada del negocio (solo lectura)
              {user?.nombre ? ` · ${user.nombre} ${user.apellido || ''}` : ''}
            </p>
          </div>
          <div className="acciones">
            <button className="btn" onClick={cargar}>Actualizar</button>
          </div>
        </header>

        {error && (
          <p className="card" style={{ color: 'var(--danger)', padding: 12, marginBottom: 14 }}>{error}</p>
        )}

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
          <CardSistema
            titulo="Usuarios"
            enlaces={[{ href: '/crm/personas', etiqueta: 'Ver personas' }]}
            metricas={[
              { etiqueta: 'Total de usuarios', valor: String(s?.usuarios.usuarios ?? '—') },
              { etiqueta: 'Registrados', valor: String(s?.usuarios.registrados ?? '—') },
            ]}
          />

          <CardSistema
            titulo="Tickets"
            enlaces={[{ href: '/crm/tickets', etiqueta: 'Ver tickets' }]}
            metricas={[
              { etiqueta: 'Tickets emitidos', valor: String(s?.tickets.tickets ?? '—') },
              { etiqueta: 'Tickets impresos', valor: String(s?.tickets.impresos ?? '—') },
            ]}
          />

          <CardSistema
            titulo="Carreras y eventos"
            enlaces={[{ href: '/crm/carreras', etiqueta: 'Ver carreras' }]}
            metricas={[
              { etiqueta: 'Resultados', valor: String(s?.carreras.carreras ?? '—') },
              { etiqueta: 'Eventos', valor: String(s?.carreras.eventos ?? '—') },
            ]}
          />

          <CardSistema
            titulo="Parte web"
            enlaces={[{ href: '/crm/comunidad', etiqueta: 'Ver comunidad' }]}
            metricas={[
              { etiqueta: 'Publicaciones', valor: String(s?.parte_web.publicaciones ?? '—') },
            ]}
          />

          <CardSistema
            titulo="Caja"
            enlaces={[{ href: '/crm/caja', etiqueta: 'Ver caja' }]}
            metricas={[
              { etiqueta: 'Sesiones', valor: String(s?.caja.sesiones ?? '—') },
              { etiqueta: 'Cajas abiertas', valor: String(s?.caja.abiertas ?? '—') },
              { etiqueta: 'Ventas', valor: String(s?.caja.ventas ?? '—') },
              { etiqueta: 'Total vendido', valor: money(s?.caja.total) },
            ]}
          />
        </div>

        {/* Módulo biométrico: arquitectura lista, a la espera del hardware. */}
        <h3 className="seccion-titulo">Personal y control biométrico</h3>
        <section className="card">
          <div className="page-header" style={{ marginBottom: 12 }}>
            <div>
              <h2 className="page-title" style={{ fontSize: '1rem' }}>Módulo biométrico</h2>
              <p className="page-sub">
                Arquitectura lista · {personal?.habilitado ? 'Con marcaciones registradas' : 'Pendiente de hardware'}
              </p>
            </div>
            <span className="badge" style={{ color: personal?.habilitado ? 'var(--ok)' : 'var(--warn)' }}>
              {personal?.habilitado ? 'Operativo' : 'Pendiente de hardware'}
            </span>
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
            <div className="card" style={{ padding: 12, background: 'var(--bg-elev-2)' }}>
              <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>{personal?.resumen.empleados ?? '—'}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>Empleados</div>
            </div>
            <div className="card" style={{ padding: 12, background: 'var(--bg-elev-2)' }}>
              <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>{personal?.resumen.empleados_activos ?? '—'}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>Empleados activos</div>
            </div>
            <div className="card" style={{ padding: 12, background: 'var(--bg-elev-2)' }}>
              <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>{personal?.resumen.dispositivos ?? '—'}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>Dispositivos</div>
            </div>
            <div className="card" style={{ padding: 12, background: 'var(--bg-elev-2)' }}>
              <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>{personal?.resumen.marcaciones ?? '—'}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>Marcaciones</div>
            </div>
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 12 }}>
            La arquitectura del módulo biométrico está lista (tablas y endpoints consultables).
            El dispositivo se conectará en el futuro registrando las marcaciones de entrada y salida.
          </p>

          <div className="acciones" style={{ marginTop: 12 }}>
            <Link href="/crm/personal" className="btn">Ver empleados y asistencia</Link>
          </div>
        </section>
      </main>
    </>
  );
}
