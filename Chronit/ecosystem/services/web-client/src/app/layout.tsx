import type { Metadata } from 'next';
import './globals.css';
import OfflineBanner from '@/components/OfflineBanner';
import FullscreenButton from '@/components/FullscreenButton';

export const metadata: Metadata = {
  title: 'gokart.bo',
  description: 'Tus tiempos, premios, tickets y eventos de carreras de karting.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}<OfflineBanner /><FullscreenButton /></body>
    </html>
  );
}
