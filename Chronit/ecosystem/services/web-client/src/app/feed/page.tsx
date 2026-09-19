// =============================================================================
// CHRONIT WEB CLIENT — Feed de noticias (página del piloto)
// -----------------------------------------------------------------------------
// Red social del karting: publicaciones (eventos, fotos, resultados), con likes
// y comentarios. A la izquierda un mini-perfil + accesos, a la derecha eventos y
// resultados de carreras. Requiere sesión iniciada.
// =============================================================================
import { redirect } from 'next/navigation';
import Navbar from '@/components/Navbar';
import FeedPost from '@/components/FeedPost';
import FeedComposer from '@/components/FeedComposer';
import UserAvatar from '@/components/UserAvatar';
import { currentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { ESTADO_EVENTO, flagOf } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['admin', 'cajero', 'coordinador', 'desarrollador'];

export default async function FeedPage() {
  const session = await currentUser();
  if (!session) redirect('/login');

  const { rows: urows } = await query('SELECT * FROM usuarios WHERE id = $1', [session.id]);
  const user = urows[0];

  const posts = await query(
    `SELECT p.id, p.tipo, p.titulo, p.contenido, p.imagen, p.creado_en,
            u.id AS autor_id, u.nombre AS autor_nombre, u.apellido AS autor_apellido,
            u.foto AS autor_foto, u.nacionalidad AS autor_nacionalidad,
            (SELECT count(*) FROM post_likes pl WHERE pl.post_id = p.id) AS likes,
            (SELECT count(*) FROM post_comments pc WHERE pc.post_id = p.id) AS comments,
            EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.usuario_id = $1) AS liked_by_me
     FROM posts p
     LEFT JOIN usuarios u ON u.id = p.autor_id
     ORDER BY p.creado_en DESC NULLS LAST
     LIMIT 30`,
    [session.id]
  );

  const eventos = await query(
    `SELECT id, nombre, fecha, hora, estado, tipo_carrera FROM eventos
     WHERE estado IN ('pendiente', 'asignado', 'preparada')
     ORDER BY fecha ASC NULLS LAST LIMIT 6`
  );

  const resultados = await query(
    `SELECT r.id, r.fecha, r.posicion, r.tiempo_total, r.mejor_vuelta, r.vuelta_rapida,
            u.nombre, u.apellido, u.nacionalidad
     FROM resultados_carrera r
     JOIN usuarios u ON u.id = r.usuario_id
     ORDER BY r.fecha DESC NULLS LAST
     LIMIT 8`
  );

  const isStaff = STAFF_ROLES.includes(session.rol);

  return (
    <main style={{ minHeight: '100vh' }}>
      <Navbar />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
        <div className="feed-layout">
          {/* Columna izquierda: mini perfil + accesos */}
          <aside>
            <div className="sidebar-card fade-in">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {user.foto ? (
                  <UserAvatar foto={user.foto} alt={`${user.nombre} ${user.apellido}`} className="avatar" />
                ) : (
                  <span className="avatar">{flagOf(user.nacionalidad)}</span>
                )}
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {user.nombre} {user.apellido}
                  </div>
                  <div className="muted small">🏎 Piloto</div>
                </div>
              </div>
              <div className="sep" />
              <a href="/cuenta" className="side-list-item" style={{ display: 'flex' }}>
                <span>👤</span> Mi cuenta
              </a>
              <a href="/historial" className="side-list-item" style={{ display: 'flex' }}>
                <span>🕘</span> Historial
              </a>
              <a href="/notificaciones" className="side-list-item" style={{ display: 'flex' }}>
                <span>🔔</span> Notificaciones
              </a>
            </div>
          </aside>

          {/* Columna central: compositor + publicaciones */}
          <section style={{ display: 'grid', gap: 18 }}>
            {isStaff && <FeedComposer />}
            {posts.rows.length === 0 && (
              <div className="card empty fade-in">
                Aún no hay publicaciones. {isStaff ? '¡Sé el primero en compartir una novedad!' : 'Vuelve pronto.'}
              </div>
            )}
            {posts.rows.map((p) => (
              <FeedPost key={p.id} post={p} />
            ))}
          </section>

          {/* Columna derecha: eventos + resultados */}
          <aside>
            <div className="sidebar-card fade-in" style={{ marginBottom: 18 }}>
              <h3 style={{ marginBottom: 12 }}>🏁 Próximos eventos</h3>
              {eventos.rows.length === 0 && <p className="muted small">Sin eventos programados.</p>}
              {eventos.rows.map((e) => {
                const st = ESTADO_EVENTO[e.estado] || { label: e.estado, color: 'var(--muted)' };
                return (
                  <div key={e.id} className="side-list-item">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{e.nombre}</div>
                      <div className="muted small">
                        {e.fecha ? new Date(e.fecha).toLocaleDateString('es', { day: 'numeric', month: 'short' }) : 's/fecha'}
                        {e.hora ? ` · ${e.hora}` : ''}
                      </div>
                    </div>
                    <span className="pill" style={{ marginLeft: 'auto', background: `${st.color}22`, color: st.color }}>
                      {st.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="sidebar-card fade-in">
              <h3 style={{ marginBottom: 12 }}>🏆 Resultados recientes</h3>
              {resultados.rows.length === 0 && <p className="muted small">Aún no hay resultados.</p>}
              {resultados.rows.map((r) => (
                <div key={r.id} className="side-list-item">
                  <span className="avatar avatar-sm">{flagOf(r.nacionalidad)}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                      {r.nombre} {r.apellido}
                    </div>
                    <div className="muted small">
                      {r.posicion != null ? `P${r.posicion} · ` : ''}
                      {r.mejor_vuelta || 's/vuelta'}
                      {r.vuelta_rapida ? ' ⚡' : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
