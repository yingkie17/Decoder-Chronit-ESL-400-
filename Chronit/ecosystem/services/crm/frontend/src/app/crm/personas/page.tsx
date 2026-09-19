// =============================================================================
// CHRONIT ECOSYSTEM — CRM: Personas (/crm/personas)
// -----------------------------------------------------------------------------
// Vista 360° de los usuarios del ecosistema con su actividad agregada (tickets
// y carreras). Filtros avanzados, paginación y exportación CSV. Toda consulta
// y exportación queda auditada en el backend.
// =============================================================================
'use client';

import { Navbar } from '@/components/Navbar';
import GuardLoading from '@/components/GuardLoading';
import { Filtros } from '@/components/Filtros';
import type { CampoFiltro } from '@/components/Filtros';
import { TablaDatos, Paginacion, fechaHora, siNo } from '@/components/TablaDatos';
import type { ColumnaTabla } from '@/components/TablaDatos';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { CRM_ROLES } from '@/lib/api';
import { useListadoCrm, nombreCSV } from '@/lib/useListado';

// Columnas devueltas por /api/crm/personas (mismo orden que el backend).
const COLUMNAS: ColumnaTabla[] = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'nombre', titulo: 'Nombre' },
  { clave: 'apellido', titulo: 'Apellido' },
  { clave: 'carnet', titulo: 'Carnet' },
  { clave: 'email', titulo: 'Correo' },
  { clave: 'telefono', titulo: 'Teléfono' },
  { clave: 'nacionalidad', titulo: 'Nacionalidad' },
  { clave: 'genero', titulo: 'Género' },
  { clave: 'edad', titulo: 'Edad' },
  { clave: 'rol', titulo: 'Rol' },
  { clave: 'turno', titulo: 'Turno' },
  { clave: 'es_invitado', titulo: 'Invitado' },
  { clave: 'bloqueado', titulo: 'Bloqueado' },
  { clave: 'tickets_total', titulo: 'Tickets' },
  { clave: 'carreras_total', titulo: 'Carreras' },
  { clave: 'creado_en', titulo: 'Alta' },
];

const CAMPOS: CampoFiltro[] = [
  { clave: 'q', etiqueta: 'Búsqueda (nombre, carnet, correo, teléfono)', tipo: 'texto', ancho: 260 },
  {
    clave: 'rol', etiqueta: 'Rol', tipo: 'select',
    opciones: ['piloto', 'cajero', 'coordinador', 'supervisor', 'contador', 'socio', 'dueno', 'admin', 'desarrollador']
      .map((v) => ({ valor: v, etiqueta: v })),
  },
  { clave: 'nacionalidad', etiqueta: 'Nacionalidad', tipo: 'texto' },
  {
    clave: 'genero', etiqueta: 'Género', tipo: 'select',
    opciones: [{ valor: 'masculino', etiqueta: 'Masculino' }, { valor: 'femenino', etiqueta: 'Femenino' }],
  },
  { clave: 'turno', etiqueta: 'Turno', tipo: 'texto' },
  {
    clave: 'es_invitado', etiqueta: 'Invitado', tipo: 'select',
    opciones: [{ valor: 'true', etiqueta: 'Sí' }, { valor: 'false', etiqueta: 'No' }],
  },
  {
    clave: 'bloqueado', etiqueta: 'Bloqueado', tipo: 'select',
    opciones: [{ valor: 'true', etiqueta: 'Sí' }, { valor: 'false', etiqueta: 'No' }],
  },
  { clave: 'edad_min', etiqueta: 'Edad mínima', tipo: 'numero' },
  { clave: 'edad_max', etiqueta: 'Edad máxima', tipo: 'numero' },
  { clave: 'desde', etiqueta: 'Alta desde', tipo: 'fecha' },
  { clave: 'hasta', etiqueta: 'Alta hasta', tipo: 'fecha' },
];

const FILTROS_INICIALES: Record<string, string> = {
  q: '', rol: '', nacionalidad: '', genero: '', turno: '',
  es_invitado: '', bloqueado: '', edad_min: '', edad_max: '', desde: '', hasta: '',
};

const FORMATO: Record<string, (f: Record<string, unknown>) => string> = {
  creado_en: fechaHora,
  es_invitado: siNo,
  bloqueado: siNo,
};

export default function PersonasPage() {
  const { ready } = useAuthGuard(CRM_ROLES);
  const l = useListadoCrm('/api/crm/personas', FILTROS_INICIALES);

  if (!ready) return <GuardLoading />;

  return (
    <>
      <Navbar />
      <main className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Personas</h1>
            <p className="page-sub">
              Vista 360° de los usuarios del ecosistema con su actividad en tickets y carreras.
            </p>
          </div>
          <div className="acciones">
            <button className="btn" onClick={() => void l.exportar(nombreCSV('personas'))}>Exportar CSV</button>
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
