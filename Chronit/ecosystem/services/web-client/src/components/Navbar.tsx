// =============================================================================
// CHRONIT WEB CLIENT — Navbar (Server Component)
// -----------------------------------------------------------------------------
// Barra superior: marca, navegación (Feed / Eventos / Sobre nosotros) y, según
// la sesión (Valkey), el menú de cuenta (avatar + dropdown) o los botones de
// inicio de sesión / registro.
// =============================================================================
import Link from 'next/link';
import { currentUser } from '@/lib/auth';
import { LOGO_SRC } from '@/lib/assets';
import AuthMenu from './AuthMenu';

export default async function Navbar() {
  const user = await currentUser();

  return (
    <nav className="navbar">
      <Link href={user ? '/feed' : '/'} className="nav-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_SRC} alt="gokart.bo" style={{ height: 40, width: 'auto' }} />
      </Link>

      {user && <Link href="/feed" className="nav-link">📰 Feed</Link>}
      {user && <Link href="/buscar" className="nav-link">🔎 Buscar</Link>}
      <Link href="/#eventos" className="nav-link">Eventos</Link>
      <Link href="/#nosotros" className="nav-link">Sobre nosotros</Link>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
        {user ? (
          <AuthMenu
            user={{
              id: user.id,
              nombre: user.nombre,
              apellido: user.apellido,
              foto: user.foto,
              flag: user.flag,
            }}
          />
        ) : (
          <>
            <Link href="/login" className="btn btn-ghost">🔑 Iniciar sesión</Link>
            <Link href="/register" className="btn btn-accent">Crear cuenta</Link>
          </>
        )}
      </div>
    </nav>
  );
}
