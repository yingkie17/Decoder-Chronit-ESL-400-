// =============================================================================
// CHRONIT ECOSYSTEM — CRM: exportación de datos (CSV / JSON)
// -----------------------------------------------------------------------------
// Todos los listados del CRM pueden exportarse. El CSV se genera con separador
// ';' (igual que los libros SIN de contabilidad) y BOM UTF-8 para que Excel lo
// abra correctamente en Windows.
// =============================================================================

/** Escapa un valor para CSV: comillas dobles duplicadas y campos entrecomillados. */
function celda(valor) {
  if (valor === null || valor === undefined) return '';
  let s;
  if (valor instanceof Date) {
    s = valor.toISOString();
  } else if (typeof valor === 'object') {
    s = JSON.stringify(valor);
  } else {
    s = String(valor);
  }
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Convierte filas en CSV.
 * @param {{ clave: string, titulo: string }[]} columnas
 * @param {object[]} filas
 */
export function aCSV(columnas, filas) {
  const cabecera = columnas.map((c) => celda(c.titulo)).join(';');
  const cuerpo = filas.map((f) => columnas.map((c) => celda(f[c.clave])).join(';')).join('\n');
  return `\uFEFF${cabecera}\n${cuerpo}\n`;
}

/** Envía la respuesta como descarga CSV. */
export function responderCSV(res, nombreArchivo, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.send(csv);
}

/** Nombre de archivo con fecha (YYYY-MM-DD) para las descargas. */
export function nombreConFecha(base) {
  const hoy = new Date().toISOString().slice(0, 10);
  return `${base}_${hoy}.csv`;
}
