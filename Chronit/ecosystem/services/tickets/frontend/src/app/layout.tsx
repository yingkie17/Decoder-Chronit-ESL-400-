import type { Metadata } from 'next';
import './globals.css';
import ServerStatusBanner from '@/components/ServerStatusBanner';
import FullscreenButton from '@/components/FullscreenButton';

export const metadata: Metadata = {
  title: 'gokart/tickets',
  description: 'Sistema de registro, tickets y colas para carreras de karting',
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
      <body>
        {children}
        <ServerStatusBanner />
        <FullscreenButton />
      </body>
    </html>
  );
}
