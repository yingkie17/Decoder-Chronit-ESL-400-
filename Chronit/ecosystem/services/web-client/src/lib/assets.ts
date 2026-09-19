// =============================================================================
// CHRONIT WEB CLIENT — Assets (logo + imágenes de marca)
// -----------------------------------------------------------------------------
// Las imágenes se sirven desde el servicio de generación de imágenes para que
// la web tenga un aspecto realista sin depender de archivos locales.
// =============================================================================

const img = (prompt: string, size: string) =>
  `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=${size}`;

// Logo (pequeño, para la barra de navegación y el pie)
export const LOGO_SRC = '/logo.svg';

// Portadas del carrusel de la landing (diseños que "venden la experiencia")
export const CAROUSEL_SLIDES = [
  img(
    'professional go-kart racing driver in full helmet and suit on a lit indoor track at night, motion blur, dramatic golden lighting, cinematic, photorealistic',
    'landscape_16_9'
  ),
  img(
    'aerial view of a colorful outdoor karting circuit at sunset with karts racing, flags and tire barriers, vibrant, cinematic, photorealistic',
    'landscape_16_9'
  ),
  img(
    'karting podium celebration trophy moment, confetti, driver in racing suit raising a gold trophy, dark background with neon accents, cinematic, photorealistic',
    'landscape_16_9'
  ),
];

// Portada por defecto del perfil del piloto
export const DEFAULT_COVER = img(
  'dark moody motorsport pit lane with a racing kart silhouette and soft golden light glow, wide cinematic banner, photorealistic',
  'landscape_16_9'
);
