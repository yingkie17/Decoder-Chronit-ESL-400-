// =============================================================================
// CHRONIT WEB CLIENT — Mi cuenta (Server Component)
// -----------------------------------------------------------------------------
// Perfil del piloto: foto de portada + foto de perfil + datos + botón de editar
// (lápiz). Debajo, sus tickets, sus tiempos (historial) y sus premios.
// =============================================================================
import { redirect } from 'next/navigation';
import Navbar from '@/components/Navbar';
import ProfileHero from '@/components/ProfileHero';
import { currentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { ESTADO_COLA, ESTADO_EVENTO, ESTADO_TICKET } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function CuentaPage() {
  const session = await currentUser();
  if (!session) redirect('/login');

  const { rows } = await query('SELECT * FROM usuarios WHERE id = $1', [session.id]);
  const user = rows[0];
  if (!user) redirect('/login');

  const ticket = await query(
    `SELECT t.id, t.numero, t.estado AS ticket_estado, t.creado_en, t.pagado_en, t.asignado_en,
            e.id AS evento_id, e.nombre AS evento_nombre, e.fecha AS evento_fecha,
            e.hora AS evento_hora, e.estado AS evento_estado, e.tipo_carrera,
            c.estado AS cola_estado, c.vestidor, c.llamada_en, c.ready_en
     FROM tickets t
     LEFT JOIN eventos e ON e.id = t.evento_id
     LEFT JOIN colas c ON c.ticket_id = t.id
     WHERE t.usuario_id = $1
     ORDER BY t.id DESC LIMIT 5`,
    [session.id]
  );

  const resultados = await query(
    `SELECT id, fecha, posicion, tiempo_total, mejor_vuelta, circuito, vuelta_rapida
     FROM resultados_carrera WHERE usuario_id = $1
     ORDER BY fecha DESC LIMIT 20`,
    [session.id]
  );

  const premios = await query(
    `SELECT id, tipo, descripcion, fecha FROM logros
     WHERE usuario_id = $1 ORDER BY fecha DESC LIMIT 20`,
    [session.id]
  );

  const myTickets = ticket.rows;
  const lastTicket = myTickets[0];

  return (
    <main style={{ minHeight: '100vh' }}>
      <Navbar />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
        {/* Cabecera de perfil con portada, avatar y lápiz */}
        <ProfileHero
          user={{
            id: user.id,
            nombre: user.nombre,
            apellido: user.apellido,
            email: user.email,
            telefono: user.telefono,
            carnet: user.carnet,
            nacionalidad: user.nacionalidad,
            edad: user.edad,
            genero: user.genero,
            foto: user.foto,
            portada: user.portada,
          }}
        />

        {/* Mi carrera */}
        <section className="card" style={{ marginTop: 24 }}>
          <h2 style={{ marginBottom: 14 }}>🎟️ Mi carrera</h2>
          {myTickets.length === 0 && <p className="muted">No tienes tickets asignados todavía.</p>}
          {myTickets.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Ticket</th>
                  <th>Evento</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>Vestidor</th>
                </tr>
              </thead>
              <tbody>
                {myTickets.map((t) => {
                  const te = ESTADO_TICKET[t.ticket_estado] || { label: t.ticket_estado, color: '#8aa4c7' };
                  const ce = ESTADO_COLA[t.cola_estado] || { label: '—', color: '#8aa4c7' };
                  return (
                    <tr key={t.id}>
                      <td>{t.numero}</td>
                      <td>
                        <span className="pill" style={{ background: `${te.color}22`, color: te.color }}>{te.label}</span>
                      </td>
                      <td>{t.evento_nombre || '—'}</td>
                      <td>
                        {t.evento_fecha ? new Date(t.evento_fecha).toLocaleDateString('es') : '—'}
                        {t.evento_hora ? ` · ${t.evento_hora}` : ''}
                      </td>
                      <td>
                        {t.evento_estado ? (
                          <span
                            className="pill"
                            style={{
                              background: `${(ESTADO_EVENTO[t.evento_estado] || { color: '#8aa4c7' }).color}22`,
                              color: (ESTADO_EVENTO[t.evento_estado] || { color: '#8aa4c7' }).color,
                            }}
                          >
                            {ESTADO_EVENTO[t.evento_estado]?.label || t.evento_estado}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <span className="pill" style={{ background: `${ce.color}22`, color: ce.color }}>
                          {t.cola_estado === 'llamado' ? '📢 ' : ''}{ce.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {lastTicket && lastTicket.cola_estado === 'llamado' && (
            <p style={{ color: 'var(--blue)', fontWeight: 700, marginTop: 12 }}>
              📢 ¡Han llamado a vestidores! Preséntate en {lastTicket.vestidor || 'el vestidor'}.
            </p>
          )}
        </section>

        {/* Tiempos + Premios */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', marginTop: 20 }}>
          <section className="card">
            <h2 style={{ marginBottom: 14 }}>⏱️ Mis tiempos</h2>
            {resultados.rows.length === 0 && <p className="muted">Aún no tienes tiempos registrados.</p>}
            {resultados.rows.length > 0 && (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Circuito</th>
                    <th>Pos</th>
                    <th>Total</th>
                    <th>Mejor vuelta</th>
                  </tr>
                </thead>
                <tbody>
                  {resultados.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.fecha ? new Date(r.fecha).toLocaleDateString('es') : '—'}</td>
                      <td>{r.circuito || '—'}</td>
                      <td>{r.posicion != null ? `P${r.posicion}` : '—'}</td>
                      <td>{r.tiempo_total || '—'}</td>
                      <td>
                        {r.mejor_vuelta || '—'}
                        {r.vuelta_rapida ? ' ⚡' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <h2 style={{ marginBottom: 14 }}>🏆 Mis premios</h2>
            {premios.rows.length === 0 && <p className="muted">Aún no tienes premios registrados.</p>}
            {premios.rows.map((p) => (
              <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{p.tipo || 'Premio'}</strong>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {p.fecha ? new Date(p.fecha).toLocaleDateString('es') : ''}
                  </span>
                </div>
                {p.descripcion && <p className="muted" style={{ fontSize: '0.85rem' }}>{p.descripcion}</p>}
              </div>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
