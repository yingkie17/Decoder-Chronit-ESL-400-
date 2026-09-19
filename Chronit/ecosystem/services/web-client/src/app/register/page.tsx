// =============================================================================
// CHRONIT WEB CLIENT — Página de registro (crear cuenta de piloto)
// -----------------------------------------------------------------------------
// Muestra el formulario de registro con foto de perfil. Al crear la cuenta, el
// API inicia la sesión (Valkey) y redirige al feed.
// =============================================================================
import Navbar from '@/components/Navbar';
import RegisterForm from '@/components/RegisterForm';
import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const user = await currentUser();
  if (user) redirect('/feed');

  return (
    <main
      style={{
        minHeight: '100vh',
        position: 'relative',
        backgroundImage:
          "linear-gradient(rgba(11,13,18,0.70), rgba(11,13,18,0.82)), url('/images/backgroundjpeg4.jpeg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <Navbar />
      <div style={{ maxWidth: 720, margin: '48px auto', padding: 24, position: 'relative', zIndex: 1 }}>
        <div className="card" style={{ padding: 30 }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <h1 style={{ marginBottom: 6 }}>Crea tu cuenta de piloto</h1>
            <p className="muted">
              Regístrate una vez y accede a tu historial de carreras, tus tiempos, tus premios y las
              notificaciones cuando te llamen a vestidores.
            </p>
          </div>
          <RegisterForm />
          <div className="sep" />
          <p className="muted small" style={{ textAlign: 'center' }}>
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" style={{ color: 'var(--blue)', fontWeight: 600 }}>
              Inicia sesión
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
