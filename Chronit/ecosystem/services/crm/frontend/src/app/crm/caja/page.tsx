// =============================================================================
// CHRONIT ECOSYSTEM — CRM: Caja (/crm/caja)
// -----------------------------------------------------------------------------
// Sesiones de caja del módulo contable cruzadas con su cajera, sucursal y
// resultado de ventas. Filtros avanzados, paginación y exportación CSV.
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

// Columnas devueltas por /api/crm/caja (mismo orden que el backend).
const COLUMNAS: ColumnaTabla[] = [
  { clave: 'id', titulo: 'Sesión' },
  { clave: 'estado', titulo: 'Estado' },
  { clave: 'apertura_en', titulo: 'Apertura' },
  { clave: 'cierre_en', titulo: 'Cierre' },
  { clave: 'cajero', titulo: 'Cajera' },
  { clave: 'cajero_carnet', titulo: 'Carnet' },
  { clave: 'sucursal', titulo: 'Sucursal' },
  { clave: 'monto_inicial', titulo: 'Monto inicial' },
  { clave: 'ventas', titulo: 'Nº de ventas' },
  { clave: 'total_vendido', titulo: 'Total vendido' },
  { clave: 'monto_esperado_efectivo', titulo: 'Esperado en efectivo' },
  { clave: 'monto_contado_efectivo', titulo: 'Contado' },
  { clave: 'diferencia', titulo: 'Diferencia' },
];

const CAMPOS: CampoFiltro[] = [
  { clave: 'q', etiqueta: 'Búsqueda (cajera, carnet, sucursal)', tipo: 'texto', ancho: 240 },
  {
    clave: 'estado', etiqueta: 'Estado', tipo: 'select',
    opciones: [{ valor: 'abierto', etiqueta: 'Abierto' }, { valor: 'cerrado', etiqueta: 'Cerrado' }],
  },
  { clave: 'cajero_id', etiqueta: 'Cajera (ID)', tipo: 'numero' },
  { clave: 'sucursal_id', etiqueta: 'Sucursal (ID)', tipo: 'numero' },
  { clave: 'desde', etiqueta: 'Apertura desde', tipo: 'fecha' },
  { clave: 'hasta', etiqueta: 'Apertura hasta', tipo: 'fecha' },
];

const FILTROS_INICIALES: Record<string, string> = {
  q: '', estado: '', cajero_id: '', sucursal_id: '', desde: '', hasta: '',
};

const FORMATO: Record<string, (f: Record<string, unknown>) => string> = {
  apertura_en: fechaHora,
  cierre_en: fechaHora,
  monto_inicial: money,
  total_vendido: money,
  monto_esperado_efectivo: money,
  monto_contado_efectivo: money,
  diferencia: money,
};

export default function CajaPage() {
  const { ready } = useAuthGuard(CRM_ROLES);
  const l = useListadoCrm('/api/crm/caja', FILTROS_INICIALES);

  if (!ready) return <GuardLoading />;

  return (
    <>
      <Navbar />
      <main className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Caja</h1>
            <p className="page-sub">
              Sesiones de caja con su cajera, sucursal y resultado de ventas.
            </p>
          </div>
          <div className="acciones">
            <button className="btn" onClick={() => void l.exportar(nombreCSV('caja'))}>Exportar CSV</button>
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
