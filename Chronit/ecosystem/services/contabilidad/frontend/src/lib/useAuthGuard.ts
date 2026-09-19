// =============================================================================
// CHRONIT ECOSYSTEM — Guard de acceso (frontend de tickets)
// -----------------------------------------------------------------------------
// Protege las páginas de cada módulo:
//   - Si no hay sesión o el token/JWT es inválido o expiró -> limpia la sesión
//     y redirige a /login de inmediato (sin renderizar contenido protegido).
//   - Si el rol del usuario no está permitido para ese módulo -> /dashboard.
//
// Además de validar en el montaje/cambio de ruta, re-valida contra el backend
// (GET /api/auth/me) cuando la pestaña recupera el foco, cambia de visibilidad
// o cuando otra pestaña modifica la sesión en localStorage. De este modo, la
// navegación entre ventanas/pestañas vuelve a comprobar la sesión.
//
// NOTA: la sesión vive en el servidor (cookie httpOnly + Valkey); la fuente de
// verdad es GET /api/auth/me. El usuario cacheado en localStorage solo se usa
// para pintar la UI.
// =============================================================================
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AUTH_EXPIRED_EVENT,
  TOKEN_KEY,
  USER_KEY,
  clearSession,
  fetchMe,
  setSession,
} from '@/lib/api';

export interface AuthUser {
  id: number;
  uuid_global?: string;
  rol: string;
  nombre?: string;
  apellido?: string;
  carnet?: string;
  email?: string | null;
  foto?: string | null;
}

/**
 * Verifica la sesión del personal. Devuelve `ready=false` mientras comprueba y
 * `ready=true` cuando se puede renderizar la página.
 */
export function useAuthGuard(roles?: string[]) {
  const router = useRouter();
  // Clave estable derivada de los roles para que el efecto no se re-ejecute
  // cuando se pase un array nuevo (literal) en cada render.
  const rolesKey = roles ? roles.join(',') : '*';
  const rolesRef = useRef<string[] | undefined>(roles);
  rolesRef.current = roles;
  // Evita disparar más de un redirect a la vez.
  const redirectingRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  const goLogin = useCallback(() => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    clearSession();
    router.replace('/login');
  }, [router]);

  // Re-valida la sesión contra el backend. Devuelve true si es válida y el rol
  // está permitido para el módulo actual.
  const validate = useCallback(async (): Promise<boolean> => {
    try {
      // La cookie de sesión (httpOnly) viaja automáticamente: si es válida, el
      // backend devuelve el usuario fresco. No dependemos de localStorage.
      const fresh = await fetchMe<AuthUser>();
      const allowed = rolesRef.current;
      if (allowed && allowed.length) {
        const ok = allowed.includes(fresh.rol) || fresh.rol === 'desarrollador';
        if (!ok) {
          // Este panel no tiene un "dashboard" propio: un rol sin competencia
          // financiera vuelve al acceso, donde se le explica la restricción.
          router.replace('/login');
          return false;
        }
      }
      // Refresca el usuario cacheado por si cambió el rol/estado en el backend.
      setSession(null, fresh);
      setUser(fresh);
      return true;
    } catch {
      // Sesión inválida/expirada o usuario inexistente -> fuera.
      goLogin();
      return false;
    }
  }, [goLogin, router]);

  // Validación inicial en cada montaje / cambio de ruta.
  useEffect(() => {
    let active = true;
    redirectingRef.current = false;
    setReady(false);
    validate().then((ok) => {
      if (active && ok) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [validate, rolesKey]);

  // Re-validación al volver a la pestaña, al cambiar de visibilidad o cuando
  // otra ventana/pestaña toca la sesión (storage event).
  useEffect(() => {
    const revalidate = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (redirectingRef.current) return;
      void validate();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === TOKEN_KEY || e.key === USER_KEY) revalidate();
    };
    const onAuthExpired = () => goLogin();

    window.addEventListener('focus', revalidate);
    window.addEventListener('storage', onStorage);
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [validate, goLogin]);

  return { ready, user };
}
