// =============================================================================
// CHRONIT ECOSYSTEM — CRM: ejecución de un listado filtrado
// -----------------------------------------------------------------------------
// Todas las vistas del CRM (personas, tickets, carreras, caja, comunidad y
// personal) comparten el mismo comportamiento:
//
//   * filtros avanzados parametrizados (Where)
//   * paginación con total de filas
//   * exportación a CSV con el mismo conjunto de filtros (?formato=csv)
//   * auditoría de la consulta y del exporte
//
// Cada recurso sólo declara su SQL (select/from/where/order) y sus columnas.
// =============================================================================
import { soloLectura } from '../db/pool.js';
import { paginacion, metaPaginacion } from './sql.js';
import { aCSV, responderCSV, nombreConFecha } from './exportar.js';
import { auditar, filtrosDe } from './audit.js';

// Tope de filas para una exportación: evita volcar tablas enteras por descuido.
const LIMITE_EXPORT = 20000;

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{
 *   recurso: string,
 *   columnas: { clave: string, titulo: string }[],
 *   construir: (query: object) => { select: string, from: string, where: any, order: string },
 * }} def
 */
export async function listar(req, res, def) {
  const q = req.query || {};
  const { select, from, where, order } = def.construir(q);
  const exportar = q.formato === 'csv';

  try {
    if (exportar) {
      const { rows } = await soloLectura(
        `SELECT ${select} ${from} ${where.sql()} ORDER BY ${order} LIMIT ${LIMITE_EXPORT}`,
        where.valores
      );
      await auditar({
        req, accion: 'exportar', recurso: def.recurso,
        filtros: filtrosDe(q), filas: rows.length, formato: 'csv',
      });
      return responderCSV(res, nombreConFecha(`crm_${def.recurso}`), aCSV(def.columnas, rows));
    }

    const { page, limit, sql: pagSql } = paginacion(q);
    const totalRes = await soloLectura(
      `SELECT COUNT(*)::int AS total ${from} ${where.sql()}`,
      where.valores
    );
    const total = totalRes.rows[0]?.total ?? 0;

    const { rows } = await soloLectura(
      `SELECT ${select} ${from} ${where.sql()} ORDER BY ${order} ${pagSql}`,
      where.valores
    );

    await auditar({
      req, accion: 'consultar', recurso: def.recurso,
      filtros: filtrosDe(q), filas: rows.length, formato: 'json',
    });

    res.json({ datos: rows, paginacion: metaPaginacion(total, page, limit) });
  } catch (e) {
    console.error(`[crm:${def.recurso}]`, e.message);
    res.status(500).json({ error: e.message });
  }
}
