// =============================================================================
// CHRONIT TICKETS FRONTEND — Helper de imágenes (modo offline/online)
// -----------------------------------------------------------------------------
//   getImageUrl(relativePath)  : resuelve la URL completa de una imagen según
//                                haya o no conexión a internet:
//                                  - Online  -> NEXT_PUBLIC_PUBLIC_IMAGE_URL + ruta
//                                  - Offline -> NEXT_PUBLIC_LOCAL_IMAGE_URL + ruta
// La detección de internet se hace contra google.com y se cachea por sesión.
// =============================================================================

import { useEffect, useState } from 'react';

const LOCAL_IMAGE_URL = process.env.NEXT_PUBLIC_LOCAL_IMAGE_URL || 'http://localhost:5001';
const PUBLIC_IMAGE_URL = process.env.NEXT_PUBLIC_PUBLIC_IMAGE_URL || '';

let _internetCache: boolean | null = null;

/** Detecta conectividad a internet (DNS/HTTP a google.com), cacheado por sesión. */
export async function checkInternet(): Promise<boolean> {
  if (_internetCache !== null) return _internetCache;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    await fetch('https://www.google.com/generate_204', {
      mode: 'no-cors',
      signal: controller.signal,
    }).catch(() => {
      throw new Error('no-internet');
    });
    clearTimeout(timer);
    _internetCache = true;
  } catch {
    _internetCache = false;
  }
  return _internetCache;
}

/** Resuelve la URL completa de una imagen (relativa) según conectividad. */
export async function getImageUrl(relativePath?: string | null): Promise<string> {
  if (!relativePath) return '';
  // Ya es una URL completa (http/https o data URL): devolver tal cual.
  if (/^(https?:)?\/\//.test(relativePath) || relativePath.startsWith('data:')) {
    return relativePath;
  }
  const rel = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const hasInternet = await checkInternet();
  const baseUrl = hasInternet && PUBLIC_IMAGE_URL ? PUBLIC_IMAGE_URL : LOCAL_IMAGE_URL;
  return `${baseUrl}${rel}`;
}

// React hook: resuelve la URL de una imagen de forma reactiva (offline/online).
// Devuelve '' mientras resuelve o si no hay ruta.
export function useImageUrl(relativePath?: string | null): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    if (!relativePath) { setUrl(''); return; }
    getImageUrl(relativePath).then((u) => { if (active) setUrl(u); });
    return () => { active = false; };
  }, [relativePath]);
  return url;
}
