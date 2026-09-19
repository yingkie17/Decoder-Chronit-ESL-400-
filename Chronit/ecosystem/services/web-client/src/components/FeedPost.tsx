// =============================================================================
// CHRONIT WEB CLIENT — Publicación del feed (Client Component)
// -----------------------------------------------------------------------------
// Renderiza una publicación con autor, tipo, imagen, "me gusta" y comentarios
// (red social). Interactúa con /api/posts/[id]/like y /api/posts/[id]/comments.
// =============================================================================
'use client';

import { useState } from 'react';
import { flagOf } from '@/lib/constants';
import { useImageUrl } from '@/lib/imageClient';
import UserAvatar from './UserAvatar';

interface Comentario {
  id: number;
  contenido: string;
  creado_en: string;
  autor_nombre: string;
  autor_apellido: string;
  autor_foto: string | null;
}
interface Post {
  id: number;
  tipo: string;
  titulo: string | null;
  contenido: string | null;
  imagen: string | null;
  creado_en: string;
  autor_id: number | null;
  autor_nombre: string | null;
  autor_apellido: string | null;
  autor_foto: string | null;
  autor_nacionalidad: string | null;
  likes: number;
  comments: number;
  liked_by_me: boolean;
}
interface Props {
  post: Post;
}

const TIPO_LABEL: Record<string, { label: string; color: string }> = {
  noticia: { label: '📰 Noticia', color: 'var(--blue)' },
  evento: { label: '🏁 Evento', color: 'var(--accent)' },
  foto: { label: '📷 Foto', color: 'var(--green)' },
  resultado: { label: '🏆 Resultado', color: 'var(--gold)' },
};

export default function FeedPost({ post }: Props) {
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likes, setLikes] = useState(post.likes);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comentario[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mediaBroken, setMediaBroken] = useState(false);
  const mediaUrl = useImageUrl(post.imagen);

  const toggleLike = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/posts/${post.id}/like`, { method: 'POST' });
      const d = await r.json();
      if (r.ok) {
        setLiked(d.liked);
        setLikes(d.likes);
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const loadComments = async () => {
    if (comments.length) return setShowComments((s) => !s);
    try {
      const r = await fetch(`/api/posts/${post.id}/comments`, { cache: 'no-store' });
      const d = await r.json();
      setComments(d.comments || []);
      setShowComments(true);
    } catch {
      /* ignore */
    }
  };

  const addComment = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/posts/${post.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contenido: text }),
      });
      const d = await r.json();
      if (r.ok) {
        setComments((c) => [...c, d.comment]);
        setText('');
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const tp = TIPO_LABEL[post.tipo] || { label: post.tipo, color: 'var(--muted)' };
  const autor = post.autor_nombre ? `${post.autor_nombre} ${post.autor_apellido || ''}`.trim() : 'Chronit';
  const fecha = post.creado_en
    ? new Date(post.creado_en).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <article className="post-card fade-in">
      <div className="post-header">
        {post.autor_foto ? (
          <UserAvatar foto={post.autor_foto} alt={autor} className="avatar avatar-sm" />
        ) : (
          <span className="avatar avatar-sm">{flagOf(post.autor_nacionalidad)}</span>
        )}
        <div>
          <div style={{ fontWeight: 700 }}>{autor}</div>
          <div className="muted small">{fecha}</div>
        </div>
        <span className="pill" style={{ marginLeft: 'auto', background: `${tp.color}22`, color: tp.color }}>
          {tp.label}
        </span>
      </div>

      {mediaUrl && !mediaBroken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl} alt="" className="post-media" onError={() => setMediaBroken(true)} />
      )}

      <div className="post-body">
        {post.titulo && <h3 style={{ marginBottom: 6 }}>{post.titulo}</h3>}
        {post.contenido && <p style={{ color: 'var(--text)' }}>{post.contenido}</p>}
      </div>

      <div className="post-actions">
        <button className={`action-btn ${liked ? 'liked' : ''}`} onClick={toggleLike} disabled={busy}>
          {liked ? '👍' : '👍'} {likes}
        </button>
        <button className="action-btn" onClick={loadComments}>
          💬 {post.comments} Comentar
        </button>
      </div>

      {showComments && (
        <div style={{ padding: '0 16px 14px' }}>
          {comments.length === 0 && <p className="muted small">Sé el primero en comentar.</p>}
          {comments.map((c) => (
            <div key={c.id} className="comment-line">
              <span className="avatar avatar-sm" style={{ flexShrink: 0 }}>
                {c.autor_foto ? (
                  <UserAvatar
                    foto={c.autor_foto}
                    alt={c.autor_nombre || ''}
                    style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  flagOf(null)
                )}
              </span>
              <div>
                <span style={{ fontWeight: 600 }}>
                  {(c.autor_nombre ? `${c.autor_nombre} ${c.autor_apellido || ''}` : 'Piloto').trim()}
                </span>{' '}
                <span style={{ color: 'var(--text)' }}>{c.contenido}</span>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              className="input"
              placeholder="Escribe un comentario…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addComment()}
            />
            <button className="btn btn-primary btn-sm" onClick={addComment} disabled={busy}>
              Comentar
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
