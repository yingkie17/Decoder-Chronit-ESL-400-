// =============================================================================
// CHRONIT WEB CLIENT — Historial del piloto (Server Component)
// -----------------------------------------------------------------------------
// Historial pre-cargado al iniciar sesión: carreras (posiciones, tiempos y mejor
// vuelta) y premios. Se actualiza automáticamente cuando finaliza una carrera
// (la sincronización vuelca los resultados en `resultados_carrera`).
// =============================================================================
import { redirect } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { currentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { flagOf } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function HistorialPage() {
  const session = await currentUser();
  if (!session) redirect('/login');

  const { rows: urows } = await query('SELECT * FROM usuarios WHERE id = $1', [session.id]);
  const user = urows[0];
  if (!user) redirect('/login');

  const historial = await query(
    `SELECT r.id, r.fecha, r.posicion, r.tiempo_total, r.mejor_vuelta, r.circuito, r.vuelta_rapida,
            e.nombre AS evento_nombre, e.tipo_carrera, e.tipo_pista
     FROM resultados_carrera r
     LEFT JOIN eventos e ON e.id = r.evento_id
     WHERE r.usuario_id = $1
     ORDER BY r.fecha DESC NULLS LAST
     LIMIT 50`,
    [session.id]
  );

  const premios = await query(
    `SELECT id, tipo, descripcion, fecha, imagen FROM logros
     WHERE usuario_id = $1 ORDER BY fecha DESC LIMIT 50`,
    [session.id]
  );

  const totalCarreras = (historial.rows as { id: number }[]).length;
  const podios = (historial.rows as { posicion: number | null }[]).filter((r) => r.posicion && r.posicion <= 3).length;
  const mejores = (historial.rows as { mejor_vuelta: string | null }[]).filter((r) => r.mejor_vuelta).length;

  return (
    <main style={{ minHeight: '100vh' }}>
      <Navbar />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
        <h1 style={{ marginBottom: 6 }}>
          🕘 Historial de {user.nombre} {flagOf(user.nacionalidad)}
        </h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          Tus carreras y resultados. Se actualiza automáticamente al finalizar cada carrera.
        </p>

        {/* Resumen */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 20 }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--blue)' }}>{totalCarreras}</div>
            <div className="muted small">Carreras</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--gold)' }}>{podios}</div>
            <div className="muted small">Podios (≤3º)</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--green)' }}>{mejores}</div>
            <div className="muted small">Mejores vueltas</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{premios.rows.length}</div>
            <div className="muted small">Premios</div>
          </div>
        </div>

        {/* Historial de carreras */}
        <section className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginBottom: 14 }}>🏁 Carreras</h2>
          {historial.rows.length === 0 && (
            <p className="muted">Aún no tienes carreras finalizadas. Cuando termines una aparecerá aquí.</p>
          )}
          {historial.rows.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Evento</th>
                  <th>Pos</th>
                  <th>Total</th>
                  <th>Mejor vuelta</th>
                  <th>Circuito</th>
                </tr>
              </thead>
              <tbody>
                {historial.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.fecha ? new Date(r.fecha).toLocaleDateString('es') : '—'}</td>
                    <td>{r.evento_nombre || '—'}</td>
                    <td>
                      {r.posicion != null ? (
                        <span
                          className="pill"
                          style={{
                            background: r.posicion <= 3 ? 'rgba(245,182,10,0.15)' : 'var(--surface2)',
                            color: r.posicion <= 3 ? 'var(--gold)' : 'var(--muted)',
                          }}
                        >
                          P{r.posicion} {r.posicion === 1 ? '🥇' : r.posicion === 2 ? '🥈' : r.posicion === 3 ? '🥉' : ''}
                        </span>
                      ) : '—'}
                    </td>
                    <td>{r.tiempo_total || '—'}</td>
                    <td>
                      {r.mejor_vuelta || '—'}
                      {r.vuelta_rapida ? ' ⚡' : ''}
                    </td>
                    <td>{r.circuito || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Premios */}
        <section className="card">
          <h2 style={{ marginBottom: 14 }}>🏆 Premios y logros</h2>
          {premios.rows.length === 0 && <p className="muted">Aún no tienes premios registrados.</p>}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            {premios.rows.map((p) => (
              <div key={p.id} className="card" style={{ padding: 16, margin: 0 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {p.imagen ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imagen} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: '2rem' }}>🏅</span>
                  )}
                  <div>
                    <div style={{ fontWeight: 700 }}>{p.tipo || 'Premio'}</div>
                    <div className="muted small">
                      {p.fecha ? new Date(p.fecha).toLocaleDateString('es') : '—'}
                    </div>
                  </div>
                </div>
                {p.descripcion && <p className="muted small" style={{ marginTop: 8 }}>{p.descripcion}</p>}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
