import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CHRONIT · Contabilidad',
  description: 'Panel contable, financiero y fiscal de CHRONIT',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
