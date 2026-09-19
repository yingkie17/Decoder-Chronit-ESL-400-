// =============================================================================
// CHRONIT WEB CLIENT — Banner de modo offline / servidor caído (Client)
// -----------------------------------------------------------------------------
// Combina dos señales para avisar al piloto:
//  1) El navegador está sin conexión (navigator.onLine).
//  2) El servidor no responde al healthcheck (/api/health) — p. ej. la base de
//     datos está caída y los datos no se están guardando.
// Se sondea periódicamente para avisar en cuanto cambie el estado.
// =============================================================================
'use client';

import { useEffect, useState } from 'react';

export default function OfflineBanner() {
  const [browserOffline, setBrowserOffline] = useState(false);
  const [serverDown, setServerDown] = useState<boolean | null>(null);

  // 1) Conectividad del navegador
  useEffect(() => {
    const update = () => setBrowserOffline(typeof navigator === 'undefined' ? false : !navigator.onLine);
    update();
    window.addEventListener('offline', update);
    window.addEventListener('online', update);
    return () => {
      window.removeEventListener('offline', update);
      window.removeEventListener('online', update);
    };
  }, []);

  // 2) Healthcheck periódico del servidor
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (alive) setServerDown(!res.ok);
      } catch {
        if (alive) setServerDown(true);
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // No mostrar nada hasta que el servidor haya respondido al menos una vez.
  if (serverDown === null) return null;

  const offline = browserOffline || serverDown;
  if (!offline) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: serverDown ? '#dc2626' : '#d97706',
        color: '#fff',
        padding: '10px 16px',
        textAlign: 'center',
        zIndex: 9999,
        fontWeight: 600,
        fontSize: '0.9rem',
      }}
    >
      {serverDown
        ? '⚠ El sistema no está conectado en este momento. Los cambios pueden no guardarse. Reconectando…'
        : '📡 Sistema en modo local. Los datos se sincronizarán al restablecerse la conexión.'}
    </div>
  );
}
