// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: utilidades y tipos compartidos
// =============================================================================
'use client';

export const TZ = 'America/La_Paz';

export const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const haceISO = (dias: number) =>
  new Date(Date.now() - (dias - 1) * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });

export const money = (n: unknown) => (Number(n) || 0).toLocaleString('es-BO', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
export const fecha = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('es-BO') : '—');
export const fechaHora = (v: unknown) => (v ? new Date(String(v)).toLocaleString('es-BO', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—');
export const hora = (v: unknown) => (v
  ? new Date(String(v)).toLocaleTimeString('es-BO', { hour12: false })
  : '—');

export interface Columna { clave: string; titulo: string; tipo: string; ancho?: number }
export interface Reporte {
  clave: string; titulo: string; subtitulo?: string;
  columnas: Columna[]; filas: Record<string, unknown>[]; resumen?: Record<string, string>;
}
export interface Cuenta {
  id: number; nombre: string; tipo: string; es_efectivo_caja: boolean; activo: boolean;
  titular?: string | null; banco?: string | null; numero?: string | null;
  responsable_id?: number | null; responsable_nombre?: string | null; responsable_carnet?: string | null;
}
export interface SesionCaja {
  id: number; cajero_nombre?: string | null; cajero_carnet?: string | null;
  apertura_en: string; cierre_en: string | null; estado: string;
  monto_inicial: number; monto_esperado_efectivo: number | null;
  monto_contado_efectivo: number | null; diferencia: number | null;
  notas_cierre?: string | null; motivo_reapertura?: string | null;
}
export interface Venta {
  id: number; numero_factura: string | null; cajero_nombre_snapshot: string | null;
  creado_en: string; subtotal: number; descuento: number; base_imponible: number;
  iva_total: number; propina: number; total_final: number; anulada: boolean;
  motivo_anulacion?: string | null; tipo_factura: string | null;
  nit_cliente: string | null; razon_social_cliente: string | null; tickets: number; moneda: string;
}
export interface Impuesto {
  id: number; nombre: string; porcentaje: number; tipo: string;
  aplica_a: string[] | null; activo: boolean;
}
export interface ConfigRow {
  clave: string; valor: unknown; descripcion: string | null;
  editable_por_rol: string[] | null; actualizado_en: string | null;
  actualizado_por_nombre: string | null;
}

/** Formatea una celda de reporte según el descriptor de columna. */
export function celdaReporte(c: Columna, fila: Record<string, unknown>): string {
  const v = fila[c.clave];
  if (v === null || v === undefined) return '—';
  if (c.tipo === 'moneda') return money(v);
  if (c.tipo === 'entero') return String(v);
  if (c.tipo === 'fecha') return fecha(v);
  if (c.tipo === 'fecha_hora') return fechaHora(v);
  return String(v);
}

/** Tabla genérica de resultados de reporte (columnas + filas + totales). */
export function TablaReporte({ columnas, filas }: { columnas: Columna[]; filas: Record<string, unknown>[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tbl">
        <thead>
          <tr>{columnas.map((c) => <th key={c.clave}>{c.titulo}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>{columnas.map((c) => <td key={c.clave}>{celdaReporte(c, f)}</td>)}</tr>
          ))}
          {!filas.length && (
            <tr><td colSpan={columnas.length} style={{ color: '#5f7095' }}>Sin datos en el período.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Bloque de tarjetas con el resumen (clave -> valor ya formateado) de un reporte. */
export function TarjetasResumen({ resumen }: { resumen: Record<string, string> }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', marginBottom: 14 }}>
      {Object.entries(resumen).map(([k, v]) => (
        <div key={k} className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700 }}>{v}</div>
          <div style={{ color: '#8aa4c7', fontSize: '0.76rem' }}>{k}</div>
        </div>
      ))}
    </div>
  );
}

export const ETIQUETA_ROL: Record<string, string> = {
  piloto: 'Piloto', cajero: 'Cajero', coordinador: 'Coordinador', supervisor: 'Supervisor',
  contador: 'Contador', socio: 'Socio', admin: 'Admin', desarrollador: 'Desarrollador',
  dueno: 'Dueño', kart: 'Kart',
};
