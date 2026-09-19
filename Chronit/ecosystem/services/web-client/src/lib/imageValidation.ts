// =============================================================================
// CHRONIT WEB CLIENT — Validación de imágenes
// -----------------------------------------------------------------------------
// Reglas únicas para toda la app (subida de foto de perfil, portada y creación
// de piloto):
//   - Formatos admitidos: JPG, PNG y WebP.
//   - Tamaño máximo: 5 MB (optimiza el rendimiento del cliente y del servidor).
// =============================================================================

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ACCEPTED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
export const ACCEPTED_IMAGE_ATTR = 'image/jpeg,image/png,image/webp';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGE_MB = 5;

export interface ImageValidation {
  ok: boolean;
  error?: string;
}

/**
 * Valida formato y tamaño de un archivo de imagen.
 * Se considera válido si el MIME está admitido o, en su defecto, la extensión.
 */
export function validateImageFile(file: File): ImageValidation {
  const typeOk = ACCEPTED_IMAGE_TYPES.includes(file.type);
  const extOk = ACCEPTED_IMAGE_EXT.some((ext) => file.name.toLowerCase().endsWith(ext));
  if (!typeOk && !extOk) {
    return { ok: false, error: 'Formato no admitido. Usa una imagen JPG, PNG o WebP.' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `La imagen supera el tamaño máximo de ${MAX_IMAGE_MB} MB.` };
  }
  return { ok: true };
}

/** Mensaje claro para errores de acceso a la cámara (permisos, hardware, etc.). */
export function cameraErrorMessage(err: unknown): string {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'La cámara requiere una conexión segura (HTTPS). Ábrela desde https:// o localhost.';
  }
  const name = (err as DOMException)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Permiso de cámara denegado. Habilítalo en los ajustes del navegador e inténtalo de nuevo.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No se encontró ninguna cámara disponible en este dispositivo.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'La cámara está siendo usada por otra aplicación. Ciérrala e inténtalo de nuevo.';
    case 'OverconstrainedError':
      return 'La cámara no cumple con los requisitos solicitados por el navegador.';
    default:
      return 'No se pudo acceder a la cámara. Verifica los permisos del navegador.';
  }
}
