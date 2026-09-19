// =============================================================================
// CHRONIT WEB CLIENT — Menú de cuenta (Client Component)
// -----------------------------------------------------------------------------
// Muestra el avatar + nombre del piloto y, al hacer clic, un desplegable con:
// Mi cuenta, Historial, Notificaciones (con contador) y Cerrar sesión.
// =============================================================================
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import UserAvatar from './UserAvatar';

interface Props {
  user: {
    id: number;
    nombre?: string;
    apellido?: string;
    foto?: string | null;
    flag?: string;
  };
}

export default function AuthMenu({ user }: Props) {
  const [open, setOpen] = useState(false);
  const [activas, setActivas] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/notificaciones', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setActivas(d.activas || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const nombre = `${user.nombre || ''} ${user.apellido || ''}`.trim();

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="menu-btn" onClick={() => setOpen((o) => !o)}>
        <UserAvatar foto={user.foto} className="avatar avatar-sm" />
        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{nombre.split(' ')[0]}</span>
        <span style={{ color: 'var(--muted)' }}>▾</span>
      </button>

      {open && (
        <div className="dropdown fade-in">
          <Link href="/cuenta" className="dropdown-item" onClick={() => setOpen(false)}>
            <span>👤</span> Mi cuenta
          </Link>
          <Link href="/historial" className="dropdown-item" onClick={() => setOpen(false)}>
            <span>🕘</span> Historial
          </Link>
          <Link href="/buscar" className="dropdown-item" onClick={() => setOpen(false)}>
            <span>🔎</span> Buscar pilotos
          </Link>
          <Link href="/notificaciones" className="dropdown-item" onClick={() => setOpen(false)}>
            <span>🔔</span> Notificaciones
            {activas > 0 && <span className="badge-dot" style={{ position: 'static', border: 'none', marginLeft: 'auto' }}>{activas}</span>}
          </Link>
          <div className="dropdown-divider" />
          <form action="/api/logout" method="post">
            <button type="submit" className="dropdown-item" style={{ color: 'var(--red)' }}>
              <span>🚪</span> Cerrar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
