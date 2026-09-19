// =============================================================================
// CHRONIT ECOSYSTEM — PANEL CONTABLE: barra de navegación
// -----------------------------------------------------------------------------
// Navegación sobria y explícita: los enlaces se agrupan en dos bloques
// separados por una línea —
//   1) Módulo contable (este panel).
//   2) Enlaces cruzados al sistema de tickets (Caja de carreras, portal).
// El uso de iconos es mínimo y decorativo; la jerarquía la dan el texto y el
// contraste, no los pictogramas.
// =============================================================================
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { TICKETS_FRONTEND_URL, api, clearSession, getUser } from '@/lib/api';

type NavUser = { nombre?: string; apellido?: string; rol?: string } | null;

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

  const rol = user?.rol || '';
  const puedeUsuarios = ['admin', 'desarrollador'].includes(rol);
  const puedeConfig = ['supervisor', 'admin', 'desarrollador'].includes(rol);
  const esDireccion = ['dueno', 'socio', 'contador', 'supervisor', 'admin', 'desarrollador'].includes(rol);

  const activo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="navbar">
      <Link href="/contabilidad" className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="CHRONIT" style={{ height: 32, width: 'auto' }} />
        <span className="brand-text">Contabilidad</span>
      </Link>

      <div className="nav-group">
        <Link href="/contabilidad" className={activo('/contabilidad') ? 'nav-link activo' : 'nav-link'}>
          Panel contable
        </Link>
        {esDireccion && (
          <Link
            href="/dashboard-ejecutivo"
            className={activo('/dashboard-ejecutivo') ? 'nav-link activo' : 'nav-link'}
          >
            Dirección
          </Link>
        )}
        {puedeUsuarios && (
          <Link href="/admin/usuarios" className={activo('/admin/usuarios') ? 'nav-link activo' : 'nav-link'}>
            Usuarios
          </Link>
        )}
        {puedeConfig && (
          <Link
            href="/admin/configuracion"
            className={activo('/admin/configuracion') ? 'nav-link activo' : 'nav-link'}
          >
            Configuración
          </Link>
        )}
      </div>

      <span className="nav-divisor" aria-hidden="true" />

      <div className="nav-group">
        <a href={`${TICKETS_FRONTEND_URL}/caja`} className="nav-link">
          Caja de carreras
        </a>
        <a href={`${TICKETS_FRONTEND_URL}/dashboard`} className="nav-link">
          Sistema de tickets
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
