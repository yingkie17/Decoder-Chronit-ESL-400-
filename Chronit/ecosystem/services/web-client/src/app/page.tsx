// =============================================================================
// CHRONIT WEB CLIENT — Landing (página pública)
// -----------------------------------------------------------------------------
// Si ya hay sesión (Valkey) redirige al feed. Si no, muestra una landing que
// "vende la experiencia": carrusel de imágenes a la izquierda y login estilo
// red social a la derecha, junto al menú Eventos / Sobre nosotros.
// =============================================================================
import Link from 'next/link';
import { redirect } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Carousel from '@/components/Carousel';
import LoginForm from '@/components/LoginForm';
import { currentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { ESTADO_EVENTO } from '@/lib/constants';

export const dynamic = 'force-dynamic';

interface Evento {
  id: number;
  nombre: string;
  fecha: string | null;
  hora: string | null;
  estado: string;
  tipo_carrera: string | null;
}

export default async function Landing() {
  const user = await currentUser();
  if (user) redirect('/feed');

  let eventos: Evento[] = [];
  try {
    const { rows } = await query(
      `SELECT id, nombre, fecha, hora, estado, tipo_carrera FROM eventos
       WHERE estado IN ('pendiente', 'asignado', 'preparada')
       ORDER BY fecha ASC NULLS LAST LIMIT 8`
    );
    eventos = rows;
  } catch {
    /* sin eventos */
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        position: 'relative',
        backgroundImage:
          "linear-gradient(rgba(11,13,18,0.62), rgba(11,13,18,0.80)), url('/images/backgroundjpeg.jpeg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <Navbar />
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px', position: 'relative', zIndex: 1 }}>
        {/* Hero: carrusel + login */}
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'center', gap: 28 }}
        >
          <div>
            <Carousel />
            <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
              <span className="pill" style={{ background: 'rgba(245,182,10,0.15)', color: 'var(--accent)' }}>
                ⏱ Tiempos en vivo
              </span>
              <span className="pill" style={{ background: 'rgba(59,130,246,0.15)', color: 'var(--blue)' }}>
                🏆 Premios y podios
              </span>
              <span className="pill" style={{ background: 'rgba(22,163,74,0.15)', color: 'var(--green)' }}>
                🎟 Tickets y vestidores
              </span>
            </div>
          </div>

          <div className="card" style={{ padding: 28 }}>
            <h2 style={{ marginBottom: 6 }}>Bienvenido a CHRONIT</h2>
            <p className="muted" style={{ marginBottom: 18 }}>
              Inicia sesión para ver tu ticket, tus tiempos, tus premios y el evento al que estás asignado.
            </p>
            <LoginForm />
            <div className="sep" />
            <div style={{ textAlign: 'center' }}>
              <Link href="/register" className="btn btn-accent btn-lg" style={{ width: '100%' }}>
                Crear cuenta nueva
              </Link>
            </div>
          </div>
        </div>

        {/* Eventos */}
        <section id="eventos" style={{ marginTop: 56, scrollMarginTop: 90 }}>
          <h2 style={{ marginBottom: 18 }}>🏁 Próximos eventos</h2>
          {eventos.length === 0 ? (
            <p className="muted">No hay eventos programados por ahora. ¡Sigue atento!</p>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
              {eventos.map((e) => {
                const st = ESTADO_EVENTO[e.estado] || { label: e.estado, color: 'var(--muted)' };
                return (
                  <div key={e.id} className="card" style={{ padding: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '1.02rem' }}>{e.nombre}</div>
                        <div className="muted small">
                          {e.fecha ? new Date(e.fecha).toLocaleDateString('es', { day: 'numeric', month: 'short' }) : 's/fecha'}
                          {e.hora ? ` · ${e.hora}` : ''}
                          {e.tipo_carrera ? ` · ${e.tipo_carrera}` : ''}
                        </div>
                      </div>
                      <span className="pill" style={{ background: `${st.color}22`, color: st.color }}>
                        {st.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Sobre nosotros */}
        <section id="nosotros" style={{ marginTop: 56, scrollMarginTop: 90 }}>
          <div className="hero" style={{ textAlign: 'center' }}>
            <h2 style={{ marginBottom: 12 }}>Sobre CHRONIT</h2>
            <p className="muted" style={{ maxWidth: 680, margin: '0 auto' }}>
              Somos un circuito de karting donde cada vuelta cuenta. Registrate una vez y ten acceso a tu
              historial de carreras, tus tiempos, tus premios y las notificaciones cuando te llamen a
              vestidores. Vive la experiencia completa desde cualquier dispositivo.
            </p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
              <Link href="/register" className="btn btn-accent">Comenzar ahora</Link>
              <Link href="/login" className="btn">Ya tengo cuenta</Link>
            </div>
          </div>
        </section>

        <footer style={{ textAlign: 'center', padding: '40px 0 20px', color: 'var(--muted)', fontSize: '0.8rem' }}>
          © {new Date().getFullYear()} CHRONIT — Karting &amp; Timing
        </footer>
      </div>
    </main>
  );
}
