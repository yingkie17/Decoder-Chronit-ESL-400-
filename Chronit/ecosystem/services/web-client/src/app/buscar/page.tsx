import Navbar from '@/components/Navbar';
import PilotoBusqueda from '@/components/PilotoBusqueda';

export const dynamic = 'force-dynamic';

export default function BuscarPage() {
  return (
    <main style={{ minHeight: '100vh' }}>
      <Navbar />
      <div style={{ maxWidth: 820, margin: '0 auto', padding: 24 }}>
        <h1 style={{ marginBottom: 6 }}>🔎 Buscar pilotos</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          Encuentra a otro piloto por nombre, apellido, carnet o teléfono para ver sus resultados.
        </p>
        <PilotoBusqueda />
      </div>
    </main>
  );
}
