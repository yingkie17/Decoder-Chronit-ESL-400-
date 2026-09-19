// =============================================================================
// CHRONIT ECOSYSTEM — CRM: Auditoría (/crm/auditoria)
// -----------------------------------------------------------------------------
// Bitácora de las operaciones sensibles del CRM: cada consulta filtrada y cada
// exportación queda registrada en `crm_auditoria` con usuario, recurso, filtros,
// filas devueltas, formato e IP. Esta vista permite revisarla.
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

// Columnas devueltas por /api/crm/auditoria (mismo orden que el backend).
const COLUMNAS: ColumnaTabla[] = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'creado_en', titulo: 'Fecha y hora' },
  { clave: 'usuario', titulo: 'Usuario' },
  { clave: 'usuario_carnet', titulo: 'Carnet' },
  { clave: 'accion', titulo: 'Acción' },
  { clave: 'recurso', titulo: 'Recurso' },
  { clave: 'formato', titulo: 'Formato' },
  { clave: 'filas', titulo: 'Filas' },
  { clave: 'ip', titulo: 'IP' },
  { clave: 'filtros', titulo: 'Filtros' },
];

const CAMPOS: CampoFiltro[] = [
  { clave: 'q', etiqueta: 'Búsqueda (usuario, carnet, recurso)', tipo: 'texto', ancho: 260 },
  {
    clave: 'accion', etiqueta: 'Acción', tipo: 'select',
    opciones: ['consultar', 'exportar'].map((v) => ({ valor: v, etiqueta: v })),
  },
  { clave: 'recurso', etiqueta: 'Recurso', tipo: 'texto' },
  {
    clave: 'formato', etiqueta: 'Formato', tipo: 'select',
    opciones: ['json', 'csv'].map((v) => ({ valor: v, etiqueta: v })),
  },
  { clave: 'usuario_id', etiqueta: 'Usuario (ID)', tipo: 'numero' },
  { clave: 'desde', etiqueta: 'Desde', tipo: 'fecha' },
  { clave: 'hasta', etiqueta: 'Hasta', tipo: 'fecha' },
];

const FILTROS_INICIALES: Record<string, string> = {
  q: '', accion: '', recurso: '', formato: '', usuario_id: '', desde: '', hasta: '',
};

const FORMATO: Record<string, (f: Record<string, unknown>) => string> = {
  creado_en: fechaHora,
  // Los filtros aplicados se guardan como JSONB: se muestran en una línea.
  filtros: (f) => {
    if (f.filtros === null || f.filtros === undefined) return '—';
    const s = JSON.stringify(f.filtros);
    return s.length > 80 ? `${s.slice(0, 78)}…` : s;
  },
};

export default function AuditoriaPage() {
  const { ready } = useAuthGuard(CRM_ROLES);
  const l = useListadoCrm('/api/crm/auditoria', FILTROS_INICIALES);

  if (!ready) return <GuardLoading />;

  return (
    <>
      <Navbar />
      <main className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Auditoría</h1>
            <p className="page-sub">
              Registro de consultas y exportaciones realizadas desde el CRM.
            </p>
          </div>
          <div className="acciones">
            <button className="btn" onClick={() => void l.exportar(nombreCSV('auditoria'))}>Exportar CSV</button>
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
