// =============================================================================
// CHRONIT ECOSYSTEM — Hook de estado del servidor (frontend de tickets)
// -----------------------------------------------------------------------------
// Sondea periódicamente el endpoint /health del backend de tickets y avisa si
// el servidor está caído. Permite detectar cuando se corre el sistema sin que el
// backend esté activo (por ejemplo, carreras con el servidor abajo).
// =============================================================================
'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';

/**
 * Devuelve el estado de conexión con el backend:
 * - `null`  -> aún comprobando (primer chequeo).
 * - `true`  -> conectado.
 * - `false` -> servidor no accesible.
 */
export function useServerStatus(intervalMs = 15000, timeoutMs = 4000) {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    const check = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(`${API_URL}/health`, {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        clearTimeout(timer);
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };

    check();
    const id = setInterval(check, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs, timeoutMs]);

  return online;
}
