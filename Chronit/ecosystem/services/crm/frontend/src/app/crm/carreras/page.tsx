// =============================================================================
// CHRONIT ECOSYSTEM — CRM: Carreras (/crm/carreras)
// -----------------------------------------------------------------------------
// Resultados de carrera registrados por el Chronit Core, cruzados con el piloto
// y el evento. Filtros avanzados, paginación y exportación CSV.
// =============================================================================
'use client';

import { Navbar } from '@/components/Navbar';
import GuardLoading from '@/components/GuardLoading';
import { Filtros } from '@/components/Filtros';
import type { CampoFiltro } from '@/components/Filtros';
import { TablaDatos, Paginacion, fecha } from '@/components/TablaDatos';
import type { ColumnaTabla } from '@/components/TablaDatos';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { CRM_ROLES } from '@/lib/api';
import { useListadoCrm, nombreCSV } from '@/lib/useListado';

// Columnas devueltas por /api/crm/carreras (mismo orden que el backend).
const COLUMNAS: ColumnaTabla[] = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'fecha', titulo: 'Fecha' },
  { clave: 'evento_nombre', titulo: 'Evento' },
  { clave: 'piloto', titulo: 'Piloto' },
  { clave: 'piloto_carnet', titulo: 'Carnet' },
  { clave: 'posicion', titulo: 'Posición' },
  { clave: 'tiempo_total', titulo: 'Tiempo total' },
  { clave: 'mejor_vuelta', titulo: 'Mejor vuelta' },
  { clave: 'vuelta_rapida', titulo: 'Vuelta rápida' },
  { clave: 'circuito', titulo: 'Circuito' },
];

const CAMPOS: CampoFiltro[] = [
  { clave: 'q', etiqueta: 'Búsqueda (piloto, carnet, circuito, evento)', tipo: 'texto', ancho: 260 },
  { clave: 'evento_id', etiqueta: 'Evento (ID)', tipo: 'numero' },
  { clave: 'usuario_id', etiqueta: 'Piloto (ID)', tipo: 'numero' },
  { clave: 'circuito', etiqueta: 'Circuito', tipo: 'texto' },
  { clave: 'posicion_min', etiqueta: 'Posición mínima', tipo: 'numero' },
  { clave: 'posicion_max', etiqueta: 'Posición máxima', tipo: 'numero' },
  { clave: 'desde', etiqueta: 'Fecha desde', tipo: 'fecha' },
  { clave: 'hasta', etiqueta: 'Fecha hasta', tipo: 'fecha' },
];

const FILTROS_INICIALES: Record<string, string> = {
  q: '', evento_id: '', usuario_id: '', circuito: '',
  posicion_min: '', posicion_max: '', desde: '', hasta: '',
};

const FORMATO: Record<string, (f: Record<string, unknown>) => string> = {
  fecha,
};

export default function CarrerasPage() {
  const { ready } = useAuthGuard(CRM_ROLES);
  const l = useListadoCrm('/api/crm/carreras', FILTROS_INICIALES);

  if (!ready) return <GuardLoading />;

  return (
    <>
      <Navbar />
      <main className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Carreras</h1>
            <p className="page-sub">
              Resultados de carrera del Chronit Core cruzados con piloto y evento.
            </p>
          </div>
          <div className="acciones">
            <button className="btn" onClick={() => void l.exportar(nombreCSV('carreras'))}>Exportar CSV</button>
          </div>
        </header>

        <Filtros
          campos={CAMPOS}
          valores={l.filtros}
          onChange={l.campo}
          onBuscar={l.buscar}
          onLimpiar={l.limpiar}
          buscando={l.cargando}
        />

        {l.error && (
          <p className="card" style={{ color: 'var(--danger)', padding: 12, marginBottom: 14 }}>{l.error}</p>
        )}

        <TablaDatos columnas={COLUMNAS} filas={l.datos} formato={FORMATO} cargando={l.cargando} />

        <Paginacion
          page={l.page}
          paginas={l.paginacion.paginas}
          total={l.paginacion.total}
          cargando={l.cargando}
          onPagina={l.setPage}
        />
      </main>
    </>
  );
}
