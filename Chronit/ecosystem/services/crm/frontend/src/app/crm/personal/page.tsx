// =============================================================================
// CHRONIT ECOSYSTEM — CRM: Personal y control biométrico (/crm/personal)
// -----------------------------------------------------------------------------
// Dos listados sobre la arquitectura biométrica ya preparada:
//   * Empleados  -> fichas laborales + días trabajados + última marcación.
//   * Asistencia -> marcaciones de entrada/salida.
// El módulo funciona aunque aún no haya hardware conectado: las tablas y los
// endpoints existen y quedan listos para cuando se instale el dispositivo.
// =============================================================================
'use client';

import { Navbar } from '@/components/Navbar';
import GuardLoading from '@/components/GuardLoading';
import { Filtros } from '@/components/Filtros';
import type { CampoFiltro } from '@/components/Filtros';
import { TablaDatos, Paginacion, fecha, fechaHora, siNo } from '@/components/TablaDatos';
import type { ColumnaTabla } from '@/components/TablaDatos';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { CRM_ROLES } from '@/lib/api';
import { useListadoCrm, nombreCSV } from '@/lib/useListado';

// --- Empleados -------------------------------------------------------------

// Columnas devueltas por /api/crm/personal/empleados (mismo orden que el backend).
const COLUMNAS_EMPLEADOS: ColumnaTabla[] = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'codigo_empleado', titulo: 'Código' },
  { clave: 'empleado', titulo: 'Empleado' },
  { clave: 'carnet', titulo: 'Carnet' },
  { clave: 'cargo', titulo: 'Cargo' },
  { clave: 'departamento', titulo: 'Departamento' },
  { clave: 'fecha_ingreso', titulo: 'Ingreso' },
  { clave: 'horas_contrato', titulo: 'Horas contrato' },
  { clave: 'activo', titulo: 'Activo' },
  { clave: 'dias_trabajados', titulo: 'Días trabajados' },
  { clave: 'ultima_marcacion', titulo: 'Última marcación' },
];

const CAMPOS_EMPLEADOS: CampoFiltro[] = [
  { clave: 'q', etiqueta: 'Búsqueda (nombre, carnet, código, cargo)', tipo: 'texto', ancho: 280 },
  {
    clave: 'activo', etiqueta: 'Estado', tipo: 'select',
    opciones: [{ valor: 'true', etiqueta: 'Activos' }, { valor: 'false', etiqueta: 'Inactivos' }],
  },
  { clave: 'departamento', etiqueta: 'Departamento', tipo: 'texto' },
  { clave: 'cargo', etiqueta: 'Cargo', tipo: 'texto' },
];

const FILTROS_EMPLEADOS: Record<string, string> = {
  q: '', activo: '', departamento: '', cargo: '',
};

const FORMATO_EMPLEADOS: Record<string, (f: Record<string, unknown>) => string> = {
  fecha_ingreso: fecha,
  ultima_marcacion: fechaHora,
  activo: siNo,
  horas_contrato: (f) => (f.horas_contrato === null || f.horas_contrato === undefined ? '—' : String(f.horas_contrato)),
  dias_trabajados: (f) => String(f.dias_trabajados ?? '—'),
};

// --- Asistencia ------------------------------------------------------------

// Columnas devueltas por /api/crm/personal/asistencia (mismo orden que el backend).
const COLUMNAS_ASISTENCIA: ColumnaTabla[] = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'empleado', titulo: 'Empleado' },
  { clave: 'carnet', titulo: 'Carnet' },
  { clave: 'tipo', titulo: 'Tipo' },
  { clave: 'ocurrido_en', titulo: 'Fecha y hora' },
  { clave: 'origen', titulo: 'Origen' },
  { clave: 'dispositivo', titulo: 'Dispositivo' },
  { clave: 'verificado', titulo: 'Verificado' },
  { clave: 'observacion', titulo: 'Observación' },
];

const CAMPOS_ASISTENCIA: CampoFiltro[] = [
  { clave: 'q', etiqueta: 'Búsqueda (empleado, carnet, dispositivo)', tipo: 'texto', ancho: 260 },
  {
    clave: 'tipo', etiqueta: 'Tipo', tipo: 'select',
    opciones: ['entrada', 'salida'].map((v) => ({ valor: v, etiqueta: v })),
  },
  {
    clave: 'origen', etiqueta: 'Origen', tipo: 'select',
    opciones: ['biometrico', 'manual', 'importado'].map((v) => ({ valor: v, etiqueta: v })),
  },
  {
    clave: 'verificado', etiqueta: 'Verificado', tipo: 'select',
    opciones: [{ valor: 'true', etiqueta: 'Sí' }, { valor: 'false', etiqueta: 'No' }],
  },
  { clave: 'empleado_id', etiqueta: 'Empleado (ID)', tipo: 'numero' },
  { clave: 'dispositivo_id', etiqueta: 'Dispositivo (ID)', tipo: 'numero' },
  { clave: 'desde', etiqueta: 'Desde', tipo: 'fecha' },
  { clave: 'hasta', etiqueta: 'Hasta', tipo: 'fecha' },
];

const FILTROS_ASISTENCIA: Record<string, string> = {
  q: '', tipo: '', origen: '', verificado: '', empleado_id: '', dispositivo_id: '', desde: '', hasta: '',
};

const FORMATO_ASISTENCIA: Record<string, (f: Record<string, unknown>) => string> = {
  ocurrido_en: fechaHora,
  verificado: siNo,
};

export default function PersonalPage() {
  const { ready } = useAuthGuard(CRM_ROLES);
  const empleados = useListadoCrm('/api/crm/personal/empleados', FILTROS_EMPLEADOS);
  const asistencia = useListadoCrm('/api/crm/personal/asistencia', FILTROS_ASISTENCIA);

  if (!ready) return <GuardLoading />;

  return (
    <>
      <Navbar />
      <main className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Personal y control biométrico</h1>
            <p className="page-sub">
              Horas de entrada y salida, días trabajados y gestión de personal.
              La arquitectura está lista para el dispositivo biométrico.
            </p>
          </div>
        </header>

        <h2 className="seccion-titulo">Empleados</h2>
        <header className="page-header" style={{ marginBottom: 10 }}>
          <p className="page-sub">Fichas laborales con días trabajados y última marcación registrada.</p>
          <div className="acciones">
            <button className="btn" onClick={() => void empleados.exportar(nombreCSV('personal_empleados'))}>
              Exportar CSV
            </button>
          </div>
        </header>

        <Filtros
          campos={CAMPOS_EMPLEADOS}
          valores={empleados.filtros}
          onChange={empleados.campo}
          onBuscar={empleados.buscar}
          onLimpiar={empleados.limpiar}
          buscando={empleados.cargando}
        />

        {empleados.error && (
          <p className="card" style={{ color: 'var(--danger)', padding: 12, marginBottom: 14 }}>{empleados.error}</p>
        )}

        <TablaDatos
          columnas={COLUMNAS_EMPLEADOS}
          filas={empleados.datos}
          formato={FORMATO_EMPLEADOS}
          cargando={empleados.cargando}
        />

        <Paginacion
          page={empleados.page}
          paginas={empleados.paginacion.paginas}
          total={empleados.paginacion.total}
          cargando={empleados.cargando}
          onPagina={empleados.setPage}
        />

        <h2 className="seccion-titulo">Asistencia</h2>
        <header className="page-header" style={{ marginBottom: 10 }}>
          <p className="page-sub">Marcaciones de entrada y salida registradas por el personal.</p>
          <div className="acciones">
            <button className="btn" onClick={() => void asistencia.exportar(nombreCSV('personal_asistencia'))}>
              Exportar CSV
            </button>
          </div>
        </header>

        <Filtros
          campos={CAMPOS_ASISTENCIA}
          valores={asistencia.filtros}
          onChange={asistencia.campo}
          onBuscar={asistencia.buscar}
          onLimpiar={asistencia.limpiar}
          buscando={asistencia.cargando}
        />

        {asistencia.error && (
          <p className="card" style={{ color: 'var(--danger)', padding: 12, marginBottom: 14 }}>{asistencia.error}</p>
        )}

        <TablaDatos
          columnas={COLUMNAS_ASISTENCIA}
          filas={asistencia.datos}
          formato={FORMATO_ASISTENCIA}
          cargando={asistencia.cargando}
        />

        <Paginacion
          page={asistencia.page}
          paginas={asistencia.paginacion.paginas}
          total={asistencia.paginacion.total}
          cargando={asistencia.cargando}
          onPagina={asistencia.setPage}
        />
      </main>
    </>
  );
}
