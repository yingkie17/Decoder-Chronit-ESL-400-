// =============================================================================
// CHRONIT WEB CLIENT — Página de login
// =============================================================================
import Navbar from '@/components/Navbar';
import LoginForm from '@/components/LoginForm';
import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect('/cuenta');

  return (
    <main style={{ minHeight: '100vh' }}>
      <Navbar />
      <div style={{ maxWidth: 420, margin: '60px auto', padding: 24 }}>
        <h1 style={{ marginBottom: 16 }}>🔑 Iniciar sesión</h1>
        <LoginForm />
      </div>
    </main>
  );
}
