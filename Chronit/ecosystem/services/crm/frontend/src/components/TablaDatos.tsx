// =============================================================================
// CHRONIT ECOSYSTEM — CRM: tabla de datos reutilizable + formato uniforme
// -----------------------------------------------------------------------------
// Renderiza los listados del CRM sobre `table.tbl`. La página declara las
// columnas (clave + título, en el orden del backend) y, opcionalmente, un
// formateador por columna para fechas, booleanos o importes.
// =============================================================================
'use client';

export interface ColumnaTabla {
  clave: string;
  titulo: string;
}

interface Props {
  columnas: ColumnaTabla[];
  filas: Record<string, unknown>[];
  // Formateador opcional por clave de columna: recibe la fila completa.
  formato?: Record<string, (fila: Record<string, unknown>) => React.ReactNode>;
  cargando?: boolean;
}

export function TablaDatos({ columnas, filas, formato, cargando }: Props) {
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="tbl">
        <thead>
          <tr>{columnas.map((c) => <th key={c.clave}>{c.titulo}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>
              {columnas.map((c) => (
                <td key={c.clave}>{formato?.[c.clave] ? formato[c.clave](f) : celda(c.clave, f)}</td>
              ))}
            </tr>
          ))}
          {!filas.length && (
            <tr>
              <td colSpan={columnas.length} style={{ color: 'var(--text-faint)', padding: 16 }}>
                {cargando ? 'Cargando…' : 'Sin resultados con los filtros aplicados.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Valor por defecto de una celda: vacío -> guion. */
function celda(clave: string, fila: Record<string, unknown>): React.ReactNode {
  const v = fila[clave];
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v);
}

/** Pie de paginación uniforme: Anterior/Siguiente + "Página X de Y · N registros". */
export function Paginacion({
  page,
  paginas,
  total,
  cargando,
  onPagina,
}: {
  page: number;
  paginas: number;
  total: number;
  cargando?: boolean;
  onPagina: (p: number) => void;
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
      <span className="page-sub">
        Página {page} de {paginas} · {total} {total === 1 ? 'registro' : 'registros'}
      </span>
      <div className="acciones">
        <button className="btn" disabled={cargando || page <= 1} onClick={() => onPagina(page - 1)}>
          Anterior
        </button>
        <button className="btn" disabled={cargando || page >= paginas} onClick={() => onPagina(page + 1)}>
          Siguiente
        </button>
      </div>
    </div>
  );
}

// --- Formato uniforme de valores (fechas en es-BO) -------------------------

const NADA = '—';

export const fecha = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('es-BO') : NADA);

export const fechaHora = (v: unknown) =>
  v
    ? new Date(String(v)).toLocaleString('es-BO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : NADA;

export const numero = (v: unknown) => (v === null || v === undefined ? NADA : String(v));

export const money = (v: unknown) =>
  v === null || v === undefined
    ? NADA
    : Number(v).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const siNo = (v: unknown) => (v === null || v === undefined ? NADA : v ? 'Sí' : 'No');

export const texto = (v: unknown) => (v === null || v === undefined || v === '' ? NADA : String(v));

/** Formateador genérico de Boolean para columnas de tipo "Sí/No". */
export function boolCol(fila: Record<string, unknown>, clave: string): React.ReactNode {
  const v = fila[clave];
  return v ? 'Sí' : 'No';
}
