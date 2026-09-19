// =============================================================================
// CHRONIT ECOSYSTEM — CRM: constructor de filtros SQL parametrizados
// -----------------------------------------------------------------------------
// Los filtros avanzados del CRM se arman SIEMPRE con placeholders ($1, $2, …):
// nunca se interpola el valor recibido del usuario en el SQL. Este helper evita
// inyección y mantiene las consultas legibles.
//
// Uso:
//   const w = new Where();
//   w.eq('t.estado', req.query.estado)
//    .desde('t.creado_en', req.query.desde)
//    .hasta('t.creado_en', req.query.hasta)
//    .texto(['t.numero', 'u.carnet'], req.query.q);
//   query(`SELECT ... FROM tickets t ${w.sql} ORDER BY t.id DESC LIMIT ${lim}`, w.valores)
// =============================================================================

/** Valor "vacío" que se ignora silenciosamente en todos los filtros. */
const vacio = (v) => v === undefined || v === null || v === '';

export class Where {
  constructor() {
    this.partes = [];
    this.params = [];
  }

  /** Registra un valor y devuelve su placeholder ($n). */
  ph(valor) {
    this.params.push(valor);
    return `$${this.params.length}`;
  }

  /** fila.column = valor */
  eq(columna, valor) {
    if (vacio(valor)) return this;
    this.partes.push(`${columna} = ${this.ph(valor)}`);
    return this;
  }

  /** Filtro booleano tolerante a 'true'/'false' de la URL. */
  bool(columna, valor) {
    if (vacio(valor)) return this;
    const b = valor === true || valor === 'true' || valor === '1';
    this.partes.push(`${columna} = ${this.ph(b)}`);
    return this;
  }

  /** fila.column IN (...) — recibe lista separada por comas o un array. */
  en(columna, valores) {
    if (vacio(valores)) return this;
    const lista = (Array.isArray(valores) ? valores : String(valores).split(','))
      .map((v) => String(v).trim())
      .filter(Boolean);
    if (!lista.length) return this;
    this.partes.push(`${columna} = ANY(${this.ph(lista)})`);
    return this;
  }

  /** fila.column >= fecha (inclusive). `tipo` = date | timestamptz */
  desde(columna, valor, tipo = 'date') {
    if (vacio(valor)) return this;
    this.partes.push(`${columna} >= ${this.ph(valor)}::${tipo}`);
    return this;
  }

  /** fila.column < (fecha + 1 día): incluye TODO el día 'hasta'. */
  hasta(columna, valor, tipo = 'date') {
    if (vacio(valor)) return this;
    this.partes.push(`${columna} < (${this.ph(valor)}::${tipo} + interval '1 day')`);
    return this;
  }

  /** fila.column >= mínimo numérico. */
  min(columna, valor) {
    if (vacio(valor)) return this;
    this.partes.push(`${columna} >= ${this.ph(valor)}::numeric`);
    return this;
  }

  /** fila.column <= máximo numérico. */
  max(columna, valor) {
    if (vacio(valor)) return this;
    this.partes.push(`${columna} <= ${this.ph(valor)}::numeric`);
    return this;
  }

  /** Búsqueda libre (ILIKE %q%) sobre una o varias columnas. */
  texto(columnas, valor) {
    if (vacio(valor)) return this;
    const ph = this.ph(`%${String(valor).trim()}%`);
    this.partes.push(`(${columnas.map((c) => `${c} ILIKE ${ph}`).join(' OR ')})`);
    return this;
  }

  /** Condición SQL ya formada (sin valores del usuario). */
  raw(sql) {
    if (!sql) return this;
    this.partes.push(`(${sql})`);
    return this;
  }

  sql() {
    return this.partes.length ? `WHERE ${this.partes.join(' AND ')}` : '';
  }

  get valores() {
    return this.params;
  }
}

const LIMITE_MAX = 200;
const LIMITE_DEFECTO = 50;

/** Normaliza page/limit y devuelve los fragmentos LIMIT/OFFSET (enteros seguros). */
export function paginacion(query, limiteDefecto = LIMITE_DEFECTO) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  let limit = parseInt(query.limit, 10) || limiteDefecto;
  limit = Math.min(Math.max(limit, 1), LIMITE_MAX);
  const offset = (page - 1) * limit;
  return { page, limit, offset, sql: `LIMIT ${limit} OFFSET ${offset}` };
}

/** Total de filas + metadatos de paginación para la respuesta. */
export function metaPaginacion(total, page, limit) {
  return { total, page, limit, paginas: Math.max(1, Math.ceil(total / limit)) };
}
