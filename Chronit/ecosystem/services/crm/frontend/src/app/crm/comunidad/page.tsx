// =============================================================================
// CHRONIT ECOSYSTEM — CRM: Comunidad (/crm/comunidad)
// -----------------------------------------------------------------------------
// Publicaciones del feed del portal con su autor, evento asociado e interacción
// (comentarios y "me gusta"). Filtros avanzados, paginación y exportación CSV.
// =============================================================================
'use client';

import { Navbar } from '@/components/Navbar';
import GuardLoading from '@/components/GuardLoading';
import { Filtros } from '@/components/Filtros';
import type { CampoFiltro } from '@/components/Filtros';
import { TablaDatos, Paginacion, fechaHora } from '@/components/TablaDatos';
import type { ColumnaTabla } from '@/components/TablaDatos';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { CRM_ROLES } from '@/lib/api';
import { useListadoCrm, nombreCSV } from '@/lib/useListado';

// Columnas devueltas por /api/crm/comunidad (mismo orden que el backend).
const COLUMNAS: ColumnaTabla[] = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'tipo', titulo: 'Tipo' },
  { clave: 'titulo', titulo: 'Título' },
  { clave: 'contenido', titulo: 'Contenido' },
  { clave: 'autor', titulo: 'Autor' },
  { clave: 'autor_carnet', titulo: 'Carnet autor' },
  { clave: 'autor_rol', titulo: 'Rol autor' },
  { clave: 'evento_nombre', titulo: 'Evento' },
  { clave: 'comentarios', titulo: 'Comentarios' },
  { clave: 'me_gusta', titulo: 'Me gusta' },
  { clave: 'creado_en', titulo: 'Creado' },
];

const CAMPOS: CampoFiltro[] = [
  { clave: 'q', etiqueta: 'Búsqueda (título, contenido, autor)', tipo: 'texto', ancho: 260 },
  {
    clave: 'tipo', etiqueta: 'Tipo', tipo: 'select',
    opciones: ['noticia', 'evento', 'foto', 'resultado'].map((v) => ({ valor: v, etiqueta: v })),
  },
  { clave: 'autor_id', etiqueta: 'Autor (ID)', tipo: 'numero' },
  { clave: 'evento_id', etiqueta: 'Evento (ID)', tipo: 'numero' },
  { clave: 'desde', etiqueta: 'Creado desde', tipo: 'fecha' },
  { clave: 'hasta', etiqueta: 'Creado hasta', tipo: 'fecha' },
];

const FILTROS_INICIALES: Record<string, string> = {
  q: '', tipo: '', autor_id: '', evento_id: '', desde: '', hasta: '',
};

const FORMATO: Record<string, (f: Record<string, unknown>) => string> = {
  creado_en: fechaHora,
};

export default function ComunidadPage() {
  const { ready } = useAuthGuard(CRM_ROLES);
  const l = useListadoCrm('/api/crm/comunidad', FILTROS_INICIALES);

  if (!ready) return <GuardLoading />;

  return (
    <>
      <Navbar />
      <main className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Comunidad</h1>
            <p className="page-sub">
              Publicaciones del portal con su autor, evento e interacción generada.
            </p>
          </div>
          <div className="acciones">
            <button className="btn" onClick={() => void l.exportar(nombreCSV('comunidad'))}>Exportar CSV</button>
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
