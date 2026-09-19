// =============================================================================
// CHRONIT WEB CLIENT — Carrusel de la landing (Client Component)
// -----------------------------------------------------------------------------
// Menú de imágenes que se deslizan automáticamente (diseños que venden la
// experiencia de karting de CHRONIT).
// =============================================================================
'use client';

import { useEffect, useState } from 'react';
import { CAROUSEL_SLIDES } from '@/lib/assets';

const CAPTIONS = [
  'Vive la adrenalina del karting profesional',
  'Circuito, tiempos y competencia real',
  'Resultados, premios y tu historial en vivo',
];

export default function Carousel() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % CAROUSEL_SLIDES.length), 4200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="hero-img" style={{ position: 'relative', height: 420 }}>
      {CAROUSEL_SLIDES.map((src, idx) => (
        <div
          key={idx}
          style={{
            position: 'absolute',
            inset: 0,
            opacity: idx === i ? 1 : 0,
            transition: 'opacity 0.7s ease',
            backgroundImage: `url(${src})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      ))}
      {/* degradado para legibilidad */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(11,13,18,0.9), rgba(11,13,18,0.1) 60%)',
        }}
      />
      <div style={{ position: 'absolute', left: 32, bottom: 32, right: 32 }}>
        <h1 style={{ fontSize: '1.9rem', marginBottom: 8, textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>
          {CAPTIONS[i]}
        </h1>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {CAROUSEL_SLIDES.map((_, idx) => (
            <span
              key={idx}
              style={{
                width: 26,
                height: 5,
                borderRadius: 99,
                background: idx === i ? 'var(--accent)' : 'rgba(255,255,255,0.3)',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
