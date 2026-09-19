// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: motor de PROMOCIONES
// -----------------------------------------------------------------------------
// Evalúa las promociones vigentes contra las líneas de una venta y devuelve el
// descuento que corresponde. El resultado se SNAPSHOTEA en
// conta_ventas.promociones_aplicadas y el descuento se reparte proporcionalmente
// entre las líneas afectadas (igual que el descuento global), de modo que los
// reportes nunca tengan que recalcular la promoción.
//
// `conta_promociones.condiciones` (JSONB) admite:
//   producto_ids    int[]   productos a los que aplica (vacío/ausente = todos)
//   combo_ids       int[]   combos a los que aplica
//   categoria       text    categoría de producto (carrera|comida|bebida|...)
//   cantidad_minima int     mínimo de unidades en el alcance
//   monto_minimo    num     subtotal bruto mínimo del alcance
//   dias_semana     int[]   0=domingo … 6=sábado
//   hora_desde      "HH:MM" hora local (America/La_Paz) desde
//   hora_hasta      "HH:MM" hora local hasta
//
// `tipo` de promoción:
//   descuento    -> descuento_tipo: monto | porcentaje
//   n_x_m        -> condiciones.n y condiciones.m (2x1 = n:2, m:1)
//   precio_fijo  -> descuento_valor es el precio final por unidad
//   promo_horario-> igual que descuento, pero exige hora_desde/hora_hasta
// =============================================================================
import { num, round2, fechaISO } from './helpers.js';

const TZ = 'America/La_Paz';

const dowLocal = (d = new Date()) => {
  // 0=domingo … 6=sábado en zona Bolivia (mediodía para evitar saltos de día).
  return new Date(`${fechaISO(d)}T12:00:00`).getDay();
};

const horaLocalHHMM = (d = new Date()) => {
  const s = new Date(d).toLocaleTimeString('en-GB', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  });
  return s;
};

/** ¿La promoción está vigente por fecha, día de semana y rango horario? */
export function promocionVigente(p, ahora = new Date()) {
  const hoy = fechaISO(ahora);
  if (p.vigencia_desde && String(p.vigencia_desde).slice(0, 10) > hoy) return false;
  if (p.vigencia_hasta && String(p.vigencia_hasta).slice(0, 10) < hoy) return false;

  const c = p.condiciones || {};
  if (Array.isArray(p.dias_semana) && p.dias_semana.length) {
    if (!p.dias_semana.includes(dowLocal(ahora))) return false;
  }
  // dias_semana también puede venir dentro de condiciones.
  if (Array.isArray(c.dias_semana) && c.dias_semana.length) {
    if (!c.dias_semana.includes(dowLocal(ahora))) return false;
  }
  if (c.hora_desde || c.hora_hasta) {
    const ahoraHM = horaLocalHHMM(ahora);
    if (c.hora_desde && ahoraHM < String(c.hora_desde)) return false;
    if (c.hora_hasta && ahoraHM > String(c.hora_hasta)) return false;
  }
  return true;
}

/** Lee las promociones activas y vigentes. */
export async function promocionesVigentes(db, ahora = new Date()) {
  const { rows } = await db.query(
    `SELECT * FROM conta_promociones
      WHERE activo = true
        AND (vigencia_desde IS NULL OR vigencia_desde <= $1)
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= $1)
      ORDER BY id`,
    [fechaISO(ahora)]
  );
  return rows.filter((p) => promocionVigente(p, ahora));
}

/** ¿La línea entra en el alcance de la promoción? */
function lineaEnAlcance(linea, condiciones) {
  const c = condiciones || {};
  if (Array.isArray(c.producto_ids) && c.producto_ids.length) {
    if (!linea.producto_id || !c.producto_ids.map(Number).includes(Number(linea.producto_id))) return false;
  }
  if (Array.isArray(c.combo_ids) && c.combo_ids.length) {
    if (!linea.combo_id || !c.combo_ids.map(Number).includes(Number(linea.combo_id))) return false;
  }
  if (c.categoria) {
    if (String(linea.categoria || '') !== String(c.categoria)) return false;
  }
  return true;
}

/**
 * Calcula el descuento de UNA promoción sobre las líneas.
 * Devuelve { descuento, lineas_idx, detalle } (descuento 0 si no aplica).
 */
export function calcularDescuentoPromocion(p, lineas) {
  const c = p.condiciones || {};
  const alcanzadas = [];
  lineas.forEach((l, i) => { if (lineaEnAlcance(l, c)) alcanzadas.push(i); });
  if (!alcanzadas.length) return { descuento: 0, lineas_idx: [], detalle: 'sin líneas en el alcance' };

  const cantTotal = round2(alcanzadas.reduce((a, i) => a + num(lineas[i].cantidad), 0));
  const brutoTotal = round2(alcanzadas.reduce((a, i) => a + num(lineas[i].bruto), 0));

  if (c.cantidad_minima != null && cantTotal < num(c.cantidad_minima)) {
    return { descuento: 0, lineas_idx: alcanzadas, detalle: `requiere ${c.cantidad_minima} unidades (hay ${cantTotal})` };
  }
  if (c.monto_minimo != null && brutoTotal < num(c.monto_minimo)) {
    return { descuento: 0, lineas_idx: alcanzadas, detalle: `requiere monto mínimo ${c.monto_minimo} (hay ${brutoTotal})` };
  }

  const tipo = p.descuento_tipo || 'monto';
  const valor = num(p.descuento_valor);
  let descuento = 0;
  let detalle = '';

  if (p.tipo === 'n_x_m') {
    // 2x1 -> por cada N unidades se cobran M (la más barata gratis).
    const n = num(c.n, 2) || 2;
    const m = num(c.m, 1);
    const precioPromedio = cantTotal > 0 ? brutoTotal / cantTotal : 0;
    const grupos = Math.floor(cantTotal / n);
    const gratis = Math.max(0, (n - m)) * grupos;
    descuento = round2(gratis * precioPromedio);
    detalle = `${n}x${m} sobre ${grupos} grupo(s)`;
  } else if (p.tipo === 'precio_fijo') {
    descuento = round2(Math.max(0, brutoTotal - valor * cantTotal));
    detalle = `precio fijo ${valor} por unidad`;
  } else if (tipo === 'porcentaje') {
    descuento = round2(brutoTotal * (valor / 100));
    detalle = `${valor}% sobre ${brutoTotal}`;
  } else {
    descuento = round2(Math.min(valor, brutoTotal));
    detalle = `monto fijo ${valor}`;
  }

  if (descuento > brutoTotal) descuento = brutoTotal;
  return { descuento: round2(descuento), lineas_idx: alcanzadas, detalle };
}

/**
 * Evalúa TODAS las promociones y decide cuáles aplicar.
 * Devuelve { aplicadas: [{promocion_id, nombre, descuento, detalle}], descuento, por_linea: Map }
 *   por_linea: índice de línea -> descuento promocional asignado
 */
export function evaluarPromociones(promos, lineas, { acumulables = false, forzarIds = [] } = {}) {
  const candidatas = [];
  for (const p of promos) {
    if (p.requiere_autorizacion && !forzarIds.includes(Number(p.id))) continue;
    const r = calcularDescuentoPromocion(p, lineas);
    if (r.descuento > 0) {
      candidatas.push({
        promocion_id: p.id, nombre: p.nombre, tipo: p.tipo, descuento: r.descuento, detalle: r.detalle,
        lineas_idx: r.lineas_idx, requiere_autorizacion: !!p.requiere_autorizacion,
      });
    }
  }
  candidatas.sort((a, b) => b.descuento - a.descuento);

  let elegidas = [];
  if (acumulables) {
    elegidas = candidatas;
  } else {
    // Solo la mejor para cada conjunto de líneas (evita apilar sobre lo mismo).
    const usadas = new Set();
    for (const c of candidatas) {
      if (c.lineas_idx.some((i) => usadas.has(i))) continue;
      elegidas.push(c);
      c.lineas_idx.forEach((i) => usadas.add(i));
    }
    if (elegidas.length > 1) elegidas = [elegidas[0]];
  }

  const descuentoTotal = round2(elegidas.reduce((a, e) => a + e.descuento, 0));
  const porLinea = new Map();
  if (descuentoTotal > 0) {
    // Reparto proporcional al bruto de las líneas de cada promoción elegida.
    for (const e of elegidas) {
      const brutoAlc = round2(e.lineas_idx.reduce((a, i) => a + num(lineas[i].bruto), 0));
      let asignado = 0;
      e.lineas_idx.forEach((i, k) => {
        const esUltima = k === e.lineas_idx.length - 1;
        const parte = esUltima
          ? round2(e.descuento - asignado)
          : round2(brutoAlc > 0 ? e.descuento * (num(lineas[i].bruto) / brutoAlc) : 0);
        asignado = round2(asignado + parte);
        porLinea.set(i, round2((porLinea.get(i) || 0) + parte));
      });
    }
  }

  return {
    aplicadas: elegidas.map(({ promocion_id, nombre, tipo, descuento, detalle, requiere_autorizacion }) => ({
      promocion_id, nombre, tipo, descuento, detalle, requiere_autorizacion: !!requiere_autorizacion,
    })),
    descuento: descuentoTotal,
    por_linea: porLinea,
  };
}
