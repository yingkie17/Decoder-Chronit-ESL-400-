'use client';

import { useEffect, useState } from 'react';
import { api, getUser, connectLive } from '@/lib/api';
import { flagOf } from '@/lib/constants';
import { Navbar } from '@/components/Navbar';
import { useAuthGuard } from '@/lib/useAuthGuard';
import GuardLoading from '@/components/GuardLoading';

interface Resultado {
  id: number; fecha: string; posicion: number; tiempo_total: string;
  mejor_vuelta: string; circuito: string; vuelta_rapida: boolean;
}
interface Logro {
  id: number; tipo: string; descripcion: string; evento_id_ref: number | null;
  fecha: string; imagen: string | null;
}

export default function DashboardPage() {
  const { ready } = useAuthGuard();
  const [user, setUser] = useState(getUser());
  const [historial, setHistorial] = useState<Resultado[]>([]);
  const [palmares, setPalmares] = useState<Logro[]>([]);
  const [loading, setLoading] = useState(true);
  const [llamado, setLlamado] = useState<{ vestidor?: number; ticket?: number; nombre?: string } | null>(null);

  useEffect(() => {
    if (!ready) return;
    const u = getUser();
    setUser(u);
    if (!u) return; // el guard ya redirige a /login
    (async () => {
      try {
        const h = await api<Resultado[]>(`/api/pilotos/${u.id}/historial`);
        const p = await api<Logro[]>(`/api/pilotos/${u.id}/palmares`);
        setHistorial(h);
        setPalmares(p);
      } catch {
        /* offline: se muestra vacío */
      } finally {
        setLoading(false);
      }
    })();

    // Notificación en tiempo real cuando el piloto es llamado a vestidor
    let live: Awaited<ReturnType<typeof connectLive>> = null;
    (async () => {
      live = await connectLive();
      if (!live || !u.uuid_global) return;
      live.emit('subscribe', { uuid_global: u.uuid_global });
      live.on('llamado', (payload) => {
        setLlamado(payload as { vestidor?: number; ticket?: number; nombre?: string });
        // Ocultar el aviso tras unos segundos
        setTimeout(() => setLlamado(null), 15000);
      });
    })();

    return () => {
      live?.disconnect();
    };
  }, [ready]);

  if (!ready) return <><Navbar /><GuardLoading /></>;

  return (
    <>
      <Navbar />
      <main style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
        {llamado && (
          <div style={{
            background: '#16a34a', color: '#fff', padding: 16, borderRadius: 12,
            marginBottom: 20, textAlign: 'center', fontSize: '1.1rem',
          }}>
            ¡Has sido llamado! {llamado.nombre ? `${llamado.nombre}, ` : ''}
            dirígete al <b>Vestidor {llamado.vestidor}</b> · Ticket #{llamado.ticket}
          </div>
        )}
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#0f1117',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem' }}>
              {flagOf(user?.nacionalidad)}
            </div>
            <div>
              <h1>{user?.nombre} {user?.apellido}</h1>
              <p style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>
                Carnet: <b>{user?.carnet}</b> · {user?.email} · {user?.telefono}
              </p>
            </div>
          </div>
        </div>

        <h2 style={{ margin: '20px 0 10px' }}>Palmarés (premios y logros)</h2>
        {loading ? (
          <p style={{ color: '#8aa4c7' }}>Cargando...</p>
        ) : palmares.length ? (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }}>
            {palmares.map((l) => (
              <div key={l.id} className="card" style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontWeight: 600, marginTop: 6 }}>{l.descripcion}</div>
                <div style={{ color: '#8aa4c7', fontSize: '0.75rem', marginTop: 4 }}>
                  {l.tipo} {l.fecha ? `· ${new Date(l.fecha).getFullYear()}` : ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#8aa4c7' }}>Aún no tienes premios.</p>
        )}

        <h2 style={{ margin: '28px 0 10px' }}>Historial de carreras</h2>
        {loading ? (
          <p style={{ color: '#8aa4c7' }}>Cargando...</p>
        ) : historial.length ? (
          <table className="tbl card">
            <thead>
              <tr><th>#</th><th>Pos.</th><th>Circuito</th><th>Fecha</th><th>Mejor vuelta</th><th>Total</th></tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id}>
                  <td>{h.posicion}</td>
                  <td>{h.posicion}º</td>
                  <td>{h.circuito || '—'}</td>
                  <td>{h.fecha ? new Date(h.fecha).toLocaleDateString() : '—'}</td>
                  <td>{h.mejor_vuelta || '—'}</td>
                  <td>{h.tiempo_total || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: '#8aa4c7' }}>Aún no tienes carreras registradas.</p>
        )}
      </main>
    </>
  );
}
