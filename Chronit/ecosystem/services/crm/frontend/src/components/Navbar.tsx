// =============================================================================
// CHRONIT ECOSYSTEM — CRM INTERNO: barra de navegación
// -----------------------------------------------------------------------------
// Navegación sobria y explícita: los enlaces se agrupan en dos bloques
// separados por una línea —
//   1) Secciones del CRM (este panel, solo lectura).
//   2) Enlaces cruzados a los demás sistemas (tickets, contabilidad, web).
// La jerarquía la dan el texto, el espaciado y el contraste: sin iconos.
// =============================================================================
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  CONTA_FRONTEND_URL,
  TICKETS_FRONTEND_URL,
  WEB_FRONTEND_URL,
  api,
  clearSession,
  getUser,
} from '@/lib/api';

type NavUser = { nombre?: string; apellido?: string; rol?: string } | null;

// Secciones internas del CRM (todas de solo lectura).
const SECCIONES: [string, string][] = [
  ['/crm', 'Resumen'],
  ['/crm/personas', 'Personas'],
  ['/crm/tickets', 'Tickets'],
  ['/crm/carreras', 'Carreras'],
  ['/crm/caja', 'Caja'],
  ['/crm/comunidad', 'Comunidad'],
  ['/crm/personal', 'Personal'],
  ['/crm/auditoria', 'Auditoría'],
];

export function Navbar() {
  const [user] = useState<NavUser>(getUser());
  const pathname = usePathname();

  const logout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* la sesión local se limpia igual */
    }
    clearSession();
    window.location.href = '/login';
  };

  // El resumen es la raíz del CRM: se marca sólo con coincidencia exacta para
  // no resaltarlo también en el resto de secciones.
  const activo = (href: string) =>
    href === '/crm' ? pathname === '/crm' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="navbar">
      <Link href="/crm" className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="CHRONIT" style={{ height: 32, width: 'auto' }} />
        <span className="brand-text">CRM</span>
      </Link>

      <div className="nav-group">
        {SECCIONES.map(([href, etiqueta]) => (
          <Link key={href} href={href} className={activo(href) ? 'nav-link activo' : 'nav-link'}>
            {etiqueta}
          </Link>
        ))}
      </div>

      <span className="nav-divisor" aria-hidden="true" />

      <div className="nav-group">
        <a href={`${TICKETS_FRONTEND_URL}/dashboard`} className="nav-link">
          Sistema de tickets
        </a>
        <a href={`${CONTA_FRONTEND_URL}/contabilidad`} className="nav-link">
          Panel contable
        </a>
        <a href={WEB_FRONTEND_URL} className="nav-link">
          Web
        </a>
      </div>

      <div className="nav-right">
        {user && (
          <span className="nav-user">
            {user.nombre} {user.apellido}
            <span className="nav-rol">{user.rol}</span>
          </span>
        )}
        <button className="btn" onClick={logout}>Salir</button>
      </div>
    </nav>
  );
}
