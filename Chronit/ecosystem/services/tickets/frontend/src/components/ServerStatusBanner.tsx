// =============================================================================
// CHRONIT ECOSYSTEM — Indicador de estado del servidor (frontend de tickets)
// -----------------------------------------------------------------------------
// Pastilla flotante que muestra SIEMPRE si el backend está conectado. Cuando el
// servidor cae, se pone roja y avisa que los cambios pueden no guardarse.
// =============================================================================
'use client';

import { useServerStatus } from '@/lib/useServerStatus';

export default function ServerStatusBanner() {
  const online = useServerStatus();

  if (online === null) return null; // primer chequeo, no mostrar aún

  const connected = online === true;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 14,
        right: 14,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 13px',
        borderRadius: 999,
        fontSize: '0.78rem',
        fontWeight: 600,
        color: '#fff',
        background: connected ? '#16a34a' : '#dc2626',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: connected ? '0 0 6px #fff' : '0 0 6px #fff',
          animation: connected ? 'none' : 'chronitBlink 1s infinite',
        }}
      />
      {connected ? 'Servidor conectado' : 'Servidor no conectado'}
    </div>
  );
}
