// =============================================================================
// CHRONIT WEB CLIENT — Página de notificaciones (Server Component)
// -----------------------------------------------------------------------------
// Protegida: requiere sesión. Renderiza la barra de navegación y la lista viva
// de notificaciones (client component con polling).
// =============================================================================
import { redirect } from 'next/navigation';
import Navbar from '@/components/Navbar';
import NotificacionesList from '@/components/NotificacionesList';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function NotificacionesPage() {
  const session = await currentUser();
  if (!session) redirect('/login');

  return (
    <main style={{ minHeight: '100vh' }}>
      <Navbar />
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <NotificacionesList />
      </div>
    </main>
  );
}
