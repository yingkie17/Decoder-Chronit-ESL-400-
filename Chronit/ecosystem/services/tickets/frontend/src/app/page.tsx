'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { getUser } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const u = getUser();
    setUser(u);
    const dest = u ? '/dashboard' : '/login';
    // Redirección tras una breve pausa para mostrar la pantalla de bienvenida
    const t = setTimeout(() => router.push(dest), 1200);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <>
      <Navbar />
      <main style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 520, padding: 24 }}>
          <h1 style={{ fontSize: '2.4rem', marginBottom: 12 }}>CHRONIT</h1>
          <p style={{ color: '#8aa4c7' }}>Bienvenido al ecosistema de eventos, tickets y colas.</p>
          <p style={{ marginTop: 16, fontSize: '0.85rem', color: '#5f7095' }}>
            {user ? `Hola ${user.nombre}, redirigiendo...` : 'Redirigiendo a inicio de sesión...'}
          </p>
        </div>
      </main>
    </>
  );
}
