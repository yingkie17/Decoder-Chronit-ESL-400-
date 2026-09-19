// =============================================================================
// CHRONIT ECOSYSTEM — Botón de pantalla completa (Client)
// -----------------------------------------------------------------------------
// Botón discreto flotante que oculta los marcos del navegador para mostrar la
// pantalla a pantalla completa. Misma opción que en la pantalla en pista.
// Se monta en el layout raíz para que esté disponible en TODAS las pantallas.
// =============================================================================
'use client';

import { useEffect, useState } from 'react';

function getFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  return (
    document.fullscreenElement ||
    (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ||
    null
  );
}

export default function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!getFullscreenElement());
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggle = () => {
    const docEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => void;
    };
    const doc = document as Document & { webkitExitFullscreen?: () => void };

    if (!getFullscreenElement()) {
      const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
      if (req) req.call(docEl);
    } else {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) exit.call(doc);
    }
  };

  const label = isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa';

  return (
    <button
      type="button"
      className="fullscreen-btn"
      onClick={toggle}
      title={label}
      aria-label={label}
    >
      ⛶
    </button>
  );
}
