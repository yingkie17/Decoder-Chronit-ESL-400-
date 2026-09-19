// =============================================================================
// CHRONIT ECOSYSTEM — CRM: Tickets (/crm/tickets)
// -----------------------------------------------------------------------------
// Une el ticket operativo con su venta y sus datos de control contable:
// vueltas, promoción, impresión y cajera. Filtros avanzados, paginación y
// exportación CSV (consultas y exportes auditados en el backend).
// =============================================================================
'use client';

import { Navbar } from '@/components/Navbar';
import GuardLoading from '@/components/GuardLoading';
import { Filtros } from '@/components/Filtros';
import type { CampoFiltro } from '@/components/Filtros';
import { TablaDatos, Paginacion, fechaHora, money } from '@/components/TablaDatos';
import type { ColumnaTabla } from '@/components/TablaDatos';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { CRM_ROLES } from '@/lib/api';
import { useListadoCrm, nombreCSV } from '@/lib/useListado';

// Columnas devueltas por /api/crm/tickets (mismo orden que el backend).
const COLUMNAS: ColumnaTabla[] = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'numero', titulo: 'Número' },
  { clave: 'estado', titulo: 'Estado' },
  { clave: 'creado_en', titulo: 'Creado' },
  { clave: 'hora_venta', titulo: 'Hora de venta' },
  { clave: 'impreso_en', titulo: 'Impreso en' },
  { clave: 'veces_impreso', titulo: 'Veces impreso' },
  { clave: 'piloto', titulo: 'Piloto' },
  { clave: 'piloto_carnet', titulo: 'Carnet piloto' },
  { clave: 'evento_nombre', titulo: 'Evento' },
  { clave: 'cantidad_vueltas', titulo: 'Vueltas' },
  { clave: 'duracion_min', titulo: 'Duración (min)' },
  { clave: 'tipo_promocion', titulo: 'Tipo promoción' },
  { clave: 'promocion_nombre_snapshot', titulo: 'Promoción' },
  { clave: 'promocion_descuento', titulo: 'Descuento' },
  { clave: 'tipo_operacion', titulo: 'Operación' },
  { clave: 'numero_factura', titulo: 'Factura' },
  { clave: 'cajero_carnet_snapshot', titulo: 'Cajera (carnet)' },
  { clave: 'venta_total', titulo: 'Total venta' },
  { clave: 'sucursal_id', titulo: 'Sucursal' },
];

const CAMPOS: CampoFiltro[] = [
  { clave: 'q', etiqueta: 'Búsqueda (número, piloto, factura)', tipo: 'texto', ancho: 260 },
  {
    clave: 'estado', etiqueta: 'Estado', tipo: 'select',
    opciones: ['PENDIENTE', 'ASIGNADO', 'LLAMANDO', 'PREPARADO', 'ACTIVO', 'FINALIZADO', 'AUSENTE', 'USADO', 'REVOCADO']
      .map((v) => ({ valor: v, etiqueta: v })),
  },
  { clave: 'evento_id', etiqueta: 'Evento (ID)', tipo: 'numero' },
  { clave: 'cajero_id', etiqueta: 'Cajera (ID)', tipo: 'numero' },
  { clave: 'sucursal_id', etiqueta: 'Sucursal (ID)', tipo: 'numero' },
  {
    clave: 'tipo_operacion', etiqueta: 'Tipo de operación', tipo: 'select',
    opciones: ['facturado', 'no_facturado', 'cortesia', 'exento'].map((v) => ({ valor: v, etiqueta: v })),
  },
  { clave: 'promocion_id', etiqueta: 'Promoción (ID)', tipo: 'numero' },
  { clave: 'tipo_promocion', etiqueta: 'Tipo de promoción', tipo: 'texto' },
  {
    clave: 'impreso', etiqueta: 'Impreso', tipo: 'select',
    opciones: [{ valor: 'true', etiqueta: 'Sí' }, { valor: 'false', etiqueta: 'No' }],
  },
  { clave: 'desde', etiqueta: 'Creado desde', tipo: 'fecha' },
  { clave: 'hasta', etiqueta: 'Creado hasta', tipo: 'fecha' },
];

const FILTROS_INICIALES: Record<string, string> = {
  q: '', estado: '', evento_id: '', cajero_id: '', sucursal_id: '', tipo_operacion: '',
  promocion_id: '', tipo_promocion: '', impreso: '', desde: '', hasta: '',
};

const FORMATO: Record<string, (f: Record<string, unknown>) => string> = {
  creado_en: fechaHora,
  hora_venta: fechaHora,
  impreso_en: fechaHora,
  venta_total: money,
  promocion_descuento: money,
};

export default function TicketsPage() {
  const { ready } = useAuthGuard(CRM_ROLES);
  const l = useListadoCrm('/api/crm/tickets', FILTROS_INICIALES);

  if (!ready) return <GuardLoading />;

  return (
    <>
      <Navbar />
      <main className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Tickets</h1>
            <p className="page-sub">
              Ticket operativo cruzado con su venta, promoción, impresión y cajera.
            </p>
          </div>
          <div className="acciones">
            <button className="btn" onClick={() => void l.exportar(nombreCSV('tickets'))}>Exportar CSV</button>
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
