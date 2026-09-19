// =============================================================================
// CHRONIT WEB CLIENT — Avatar de usuario (Client Component)
// -----------------------------------------------------------------------------
// Resuelve la ruta de la foto (canónica /uploads/... servida por nginx :5001),
// y usa una imagen por defecto local si no hay foto o si la carga falla.
// =============================================================================
'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_AVATAR, useImageUrl } from '@/lib/imageClient';

interface Props {
  foto?: string | null;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Imagen de reserva. Por defecto, el avatar genérico local. */
  fallback?: string;
}

export default function UserAvatar({ foto, alt = '', className, style, fallback = DEFAULT_AVATAR }: Props) {
  const url = useImageUrl(foto);
  const [broken, setBroken] = useState(false);

  // Al cambiar la foto, reintenta la carga.
  useEffect(() => setBroken(false), [foto]);

  const src = broken || !url ? fallback : url;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
