// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: KARDEX e INVENTARIO
// -----------------------------------------------------------------------------
// Libro de movimientos de inventario con COSTO PROMEDIO PONDERADO.
//
//   entrada -> sube stock; recalcula el costo promedio ponderado
//   salida  -> baja stock valorizado al costo promedio vigente
//   ajuste  -> fija el stock físico contado (la diferencia se valora al costo)
//
// Cada movimiento guarda el SALDO (cantidad y valor) resultante, de modo que
// los reportes de valorización no tengan que recalcular la historia.
// =============================================================================
import { num, round2 } from './helpers.js';

/** Lee el estado de inventario actual del producto. */
export async function estadoProducto(db, productoId) {
  const { rows } = await db.query(
    'SELECT id, nombre, stock_actual, costo_unitario FROM conta_productos WHERE id = $1',
    [productoId]
  );
  if (!rows.length) { const e = new Error(`Producto ${productoId} inexistente`); e.status = 400; throw e; }
  const p = rows[0];
  return {
    id: p.id, nombre: p.nombre,
    stock: round2(num(p.stock_actual)),
    costo: round2(num(p.costo_unitario)),
  };
}

/**
 * Registra un movimiento de kardex y actualiza el producto.
 * Devuelve { saldo_cantidad, saldo_valor, costo_unitario }.
 */
export async function movimientoKardex(db, {
  producto_id, tipo, cantidad, costo_unitario = null,
  referencia_tipo = null, referencia_id = null,
  sucursal_id = null, usuario_id = null,
}) {
  const cant = round2(Math.abs(num(cantidad)));
  if (cant <= 0) return null;

  const actual = await estadoProducto(db, producto_id);
  let nuevoStock = actual.stock;
  let nuevoCosto = actual.costo;
  let saldoValor = 0;

  if (tipo === 'entrada') {
    const costoEntrada = round2(costo_unitario != null ? num(costo_unitario) : actual.costo);
    const valorActual = round2(actual.stock * actual.costo);
    const valorEntrada = round2(cant * costoEntrada);
    nuevoStock = round2(actual.stock + cant);
    saldoValor = round2(valorActual + valorEntrada);
    // Costo promedio ponderado del stock resultante.
    nuevoCosto = nuevoStock > 0 ? round2(saldoValor / nuevoStock) : 0;
  } else if (tipo === 'salida') {
    if (actual.stock < cant) {
      const e = new Error(
        `Stock insuficiente de "${actual.nombre}": hay ${actual.stock} y se piden ${cant}`
      );
      e.status = 409; e.code = 'STOCK_INSUFICIENTE';
      throw e;
    }
    nuevoStock = round2(actual.stock - cant);
    saldoValor = round2(nuevoStock * actual.costo);
  } else {
    // ajuste: `cantidad` es el stock físico contado.
    nuevoStock = cant;
    saldoValor = round2(nuevoStock * actual.costo);
  }

  const { rows } = await db.query(
    `INSERT INTO conta_kardex
       (sucursal_id, producto_id, tipo, cantidad, costo_unitario, saldo_cantidad, saldo_valor,
        referencia_tipo, referencia_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [sucursal_id, producto_id, tipo,
     tipo === 'salida' ? cant : (tipo === 'ajuste' ? round2(cant - actual.stock) : cant),
     tipo === 'entrada' && costo_unitario != null ? round2(num(costo_unitario)) : actual.costo,
     nuevoStock, saldoValor, referencia_tipo, referencia_id, usuario_id]
  );

  await db.query(
    'UPDATE conta_productos SET stock_actual = $1, costo_unitario = $2 WHERE id = $3',
    [nuevoStock, nuevoCosto, producto_id]
  );

  return {
    kardex: rows[0],
    saldo_cantidad: nuevoStock,
    saldo_valor: saldoValor,
    costo_unitario: nuevoCosto,
  };
}

/**
 * Valorización completa del inventario (para el reporte de kardex).
 * `soloStockBajo` filtra los productos bajo su stock mínimo.
 */
export async function valorizacion(db, { sucursal_id = null, soloStockBajo = false } = {}) {
  const params = [];
  let sql = `
    SELECT p.id, p.nombre, p.categoria, p.stock_actual, p.stock_minimo, p.costo_unitario,
           ROUND(p.stock_actual * p.costo_unitario, 2) AS valor_total
      FROM conta_productos p
     WHERE p.activo = true`;
  if (sucursal_id) { params.push(sucursal_id); sql += ` AND p.sucursal_id = $${params.length}`; }
  if (soloStockBajo) sql += ' AND p.stock_actual <= p.stock_minimo';
  sql += ' ORDER BY p.nombre';
  const { rows } = await db.query(sql, params);
  const total = round2(rows.reduce((a, r) => a + num(r.valor_total), 0));
  return {
    productos: rows.map((r) => ({
      ...r,
      stock_actual: num(r.stock_actual), stock_minimo: num(r.stock_minimo),
      costo_unitario: num(r.costo_unitario), valor_total: num(r.valor_total),
    })),
    total_valorizado: total,
  };
}
