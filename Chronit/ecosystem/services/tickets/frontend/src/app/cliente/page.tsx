// =============================================================================
// CHRONIT — Kiosco de Cliente (página)
// -----------------------------------------------------------------------------
// Pantalla self-service para el lugar físico. Renderiza el componente
// <ClienteKiosk />.
// =============================================================================
import ClienteKiosk from '@/components/ClienteKiosk';

export const metadata = { title: 'CHRONIT — Kiosco de piloto' };

export default function ClientePage() {
  return <ClienteKiosk />;
}
