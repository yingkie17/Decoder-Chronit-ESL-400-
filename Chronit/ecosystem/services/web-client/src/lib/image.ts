// =============================================================================
// CHRONIT WEB CLIENT — Helper de imágenes (modo offline/online)
// -----------------------------------------------------------------------------
//   saveImage(base64, prefix)  : guarda una imagen en disco y devuelve la ruta
//                                relativa (/uploads/<name>) que se persiste en BD.
//   getImageUrl(relativePath)  : resuelve la URL completa de una imagen según
//                                haya o no conexión a internet:
//                                  - Online  -> PUBIC_IMAGE_URL + ruta (dominio)
//                                  - Offline -> LOCAL_IMAGE_URL + ruta (nginx :5001)
// La detección de internet se hace contra google.com y se cachea por sesión.
// =============================================================================
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

// URL base configurable. Next.js solo expone al navegador las variables NEXT_PUBLIC_*.
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
  // Normalizar: garantizar que empiece con '/'
  const rel = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const hasInternet = await checkInternet();
  const baseUrl = hasInternet && PUBLIC_IMAGE_URL ? PUBLIC_IMAGE_URL : LOCAL_IMAGE_URL;
  return `${baseUrl}${rel}`;
}

/** Guarda una imagen en base64 dentro de data/uploads y devuelve la ruta relativa. */
export async function saveImage(base64: string, prefix: string): Promise<string | null> {
  if (typeof base64 !== 'string' || !base64) return null;
  let mime = 'image/jpeg';
  let data = base64;
  if (base64.startsWith('data:')) {
    const m = base64.match(/^data:(image\/[a-z]+);base64,(.*)$/i);
    if (!m) return null;
    mime = m[1];
    data = m[2];
  }
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length) return null;
  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${prefix}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  await writeFile(path.join(UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}
