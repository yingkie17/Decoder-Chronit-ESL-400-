/** @type {import('next').NextConfig} */
// Cabeceras de seguridad comunes (defensa en profundidad). HSTS se emite en el
// borde TLS (services/edge/nginx.conf), donde vive el certificado.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
