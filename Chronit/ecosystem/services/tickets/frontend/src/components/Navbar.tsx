// =============================================================================
// CHRONIT ECOSYSTEM — SISTEMA DE TICKETS: barra de navegación
// -----------------------------------------------------------------------------
// Identidad uniforme con el panel contable: navegación por texto, sin iconos
// decorativos, agrupada en dos bloques separados por una línea —
//   1) Operación (este sistema: cuenta, pantalla, kiosco, vestidores, caja).
//   2) Módulos externos (panel contable, en su propio puerto :3002).
// El enlace activo se resalta por contraste; la jerarquía la da el texto.
// =============================================================================
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CONTA_FRONTEND_URL, clearSession, getUser } from '@/lib/api';
import { useState } from 'react';

export function Navbar() {
  const [user, setUser] = useState(getUser());
  const pathname = usePathname();

  const logout = () => {
    clearSession();
    setUser(null);
    window.location.href = '/login';
  };

  // Enlaces de módulos según el rol del personal (el backend también los valida).
  const rol = (user as { rol?: string } | null)?.rol;
  const showKiosco = rol === 'cajero' || rol === 'admin' || rol === 'desarrollador';
  const showVestidor = rol === 'coordinador' || rol === 'admin' || rol === 'desarrollador';
  const showAdmin = rol === 'admin' || rol === 'desarrollador';
  // Caja: POS de carreras (pertenece a este sistema; usa la API contable).
  const showCaja = ['cajero', 'supervisor', 'admin', 'desarrollador'].includes(rol || '');
  // Contabilidad y dirección viven en el PANEL CONTABLE INDEPENDIENTE (:3002).
  // Desde aquí sólo se enlaza: no hay rutas contables en este proyecto.
  const showContabilidad = ['contador', 'socio', 'dueno', 'supervisor', 'admin', 'desarrollador'].includes(rol || '');
  const showDireccion = ['dueno', 'socio', 'admin', 'desarrollador'].includes(rol || '');

  const activo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="navbar">
      <Link href="/" className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="CHRONIT" style={{ height: 32, width: 'auto' }} />
        <span className="brand-text">Tickets</span>
      </Link>

      <div className="nav-group">
        <Link href="/dashboard" className={activo('/dashboard') ? 'nav-link activo' : 'nav-link'}>
          Mi cuenta
        </Link>
        <Link href="/display" className={activo('/display') ? 'nav-link activo' : 'nav-link'}>
          Pantalla
        </Link>
        {showKiosco && (
          <Link href="/kiosco" className={activo('/kiosco') ? 'nav-link activo' : 'nav-link'}>
            Kiosco
          </Link>
        )}
        {showVestidor && (
          <Link href="/vestidor" className={activo('/vestidor') ? 'nav-link activo' : 'nav-link'}>
            Vestidores
          </Link>
        )}
        {showCaja && (
          <Link href="/caja" className={activo('/caja') ? 'nav-link activo' : 'nav-link'}>
            Caja
          </Link>
        )}
        {showAdmin && (
          <Link href="/admin" className={activo('/admin') ? 'nav-link activo' : 'nav-link'}>
            Administración
          </Link>
        )}
      </div>

      {(showContabilidad || showDireccion) && (
        <>
          <span className="nav-divisor" aria-hidden="true" />
          <div className="nav-group">
            {showContabilidad && (
              <a href={`${CONTA_FRONTEND_URL}/contabilidad`} className="nav-link">
                Contabilidad
              </a>
            )}
            {showDireccion && (
              <a href={`${CONTA_FRONTEND_URL}/dashboard-ejecutivo`} className="nav-link">
                Dirección
              </a>
            )}
          </div>
        </>
      )}

      <div className="nav-right">
        {user ? (
          <>
            <span className="nav-user">
              {user.nombre} {user.apellido}
              <span className="nav-rol">{user.rol}</span>
            </span>
            <button className="btn" onClick={logout}>Salir</button>
          </>
        ) : (
          <>
            <Link href="/login" className="btn btn-primary">Ingresar</Link>
            <Link href="/register" className="btn">Registrarme</Link>
          </>
        )}
      </div>
    </nav>
  );
}
