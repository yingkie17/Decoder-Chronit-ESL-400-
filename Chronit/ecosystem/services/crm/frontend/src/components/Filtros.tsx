// =============================================================================
// CHRONIT ECOSYSTEM — CRM: barra de filtros reutilizable
// -----------------------------------------------------------------------------
// Todas las vistas de listado del CRM comparten el mismo patrón: una fila de
// campos de filtro (texto/select/fecha/número) y dos acciones (Buscar/Limpiar).
// Este componente sólo pinta los campos y delega el estado en la página.
// =============================================================================
'use client';

export type TipoCampo = 'texto' | 'select' | 'fecha' | 'numero';

export interface CampoFiltro {
  clave: string;
  etiqueta: string;
  tipo: TipoCampo;
  opciones?: { valor: string; etiqueta: string }[];
  ancho?: number;
}

interface Props {
  campos: CampoFiltro[];
  valores: Record<string, string>;
  onChange: (clave: string, valor: string) => void;
  onBuscar: () => void;
  onLimpiar: () => void;
  buscando?: boolean;
}

export function Filtros({ campos, valores, onChange, onBuscar, onLimpiar, buscando }: Props) {
  // Enter en cualquier campo dispara la búsqueda (flujo de trabajo rápido).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onBuscar();
  };

  return (
    <section className="card" style={{ marginBottom: 14 }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        {campos.map((c) => (
          <div key={c.clave} style={{ flex: '1 1 180px', minWidth: 150, maxWidth: c.ancho }}>
            <label className="label" htmlFor={`f_${c.clave}`}>{c.etiqueta}</label>
            {c.tipo === 'select' ? (
              <select
                id={`f_${c.clave}`}
                className="input"
                value={valores[c.clave] ?? ''}
                onChange={(e) => onChange(c.clave, e.target.value)}
              >
                <option value="">Todos</option>
                {(c.opciones || []).map((o) => (
                  <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
                ))}
              </select>
            ) : (
              <input
                id={`f_${c.clave}`}
                className="input"
                type={c.tipo === 'fecha' ? 'date' : c.tipo === 'numero' ? 'number' : 'text'}
                value={valores[c.clave] ?? ''}
                onChange={(e) => onChange(c.clave, e.target.value)}
                onKeyDown={onKeyDown}
              />
            )}
          </div>
        ))}

        <div className="row" style={{ gap: 8, flex: '0 0 auto' }}>
          <button className="btn btn-primary" onClick={onBuscar} disabled={buscando}>
            {buscando ? 'Buscando…' : 'Buscar'}
          </button>
          <button className="btn" onClick={onLimpiar} disabled={buscando}>
            Limpiar
          </button>
        </div>
      </div>
    </section>
  );
}
