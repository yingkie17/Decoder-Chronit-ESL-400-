// =============================================================================
// CHRONIT WEB CLIENT — Resolver de imágenes para componentes de cliente
// -----------------------------------------------------------------------------
// Las fotos se guardan en disco con la ruta canónica `/uploads/<archivo>`, que
// sirve el contenedor nginx `images` (por defecto http://localhost:5001).
// Esta versión es SEGURA para componentes de cliente (no importa `fs`) y:
//   - normaliza rutas heredadas ('/api/uploads/x.jpg' -> '/uploads/x.jpg'),
//   - resuelve la URL completa según conectividad (offline -> LOCAL, online -> PUBLIC),
//   - expone un hook `useImageUrl` sin parpadeo cuando no hay dominio público.
// =============================================================================
'use client';

import { useEffect, useState } from 'react';

const LOCAL_IMAGE_URL = process.env.NEXT_PUBLIC_LOCAL_IMAGE_URL || 'http://localhost:5001';
const PUBLIC_IMAGE_URL = process.env.NEXT_PUBLIC_PUBLIC_IMAGE_URL || '';

/** Imagen por defecto (local, funciona sin conexión). */
export const DEFAULT_AVATAR = '/default-avatar.svg';

let _internetCache: boolean | null = null;

/** Detecta conectividad a internet (se cachea por sesión). */
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

/** Normaliza una ruta relativa a la convención canónica `/uploads/<archivo>`. */
export function normalizeImagePath(relativePath: string): string {
  let rel = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  // Rutas heredadas servidas por Next.js -> ruta canónica global.
  rel = rel.replace(/^\/api\/uploads\//, '/uploads/');
  return rel;
}

/** ¿La ruta ya es absoluta (http/https/data/blob)? */
export function isAbsoluteImage(url?: string | null): boolean {
  if (!url) return false;
  return /^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('blob:');
}

/** Resolución síncrona (modo local, sin dominio público configurado). */
export function resolveImageUrlSync(relativePath?: string | null): string {
  if (!relativePath) return '';
  if (isAbsoluteImage(relativePath)) return relativePath;
  const base = PUBLIC_IMAGE_URL || LOCAL_IMAGE_URL;
  return `${base}${normalizeImagePath(relativePath)}`;
}

/** Resuelve la URL completa de una imagen según conectividad (offline/online). */
export async function getImageUrl(relativePath?: string | null): Promise<string> {
  if (!relativePath) return '';
  if (isAbsoluteImage(relativePath)) return relativePath;
  const rel = normalizeImagePath(relativePath);
  if (!PUBLIC_IMAGE_URL) return `${LOCAL_IMAGE_URL}${rel}`;
  const hasInternet = await checkInternet();
  const baseUrl = hasInternet ? PUBLIC_IMAGE_URL : LOCAL_IMAGE_URL;
  return `${baseUrl}${rel}`;
}

/** Hook reactivo: devuelve la URL lista para usar en `<img src>`. */
export function useImageUrl(relativePath?: string | null): string {
  const [url, setUrl] = useState<string>(() => resolveImageUrlSync(relativePath));
  useEffect(() => {
    let active = true;
    if (!relativePath) {
      setUrl('');
      return;
    }
    if (isAbsoluteImage(relativePath) || !PUBLIC_IMAGE_URL) {
      setUrl(resolveImageUrlSync(relativePath));
      return;
    }
    getImageUrl(relativePath).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [relativePath]);
  return url;
}
