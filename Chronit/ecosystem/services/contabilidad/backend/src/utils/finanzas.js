// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: reglas financieras (IVA, autorizaciones,
// propinas, numeración de facturas)
// -----------------------------------------------------------------------------
// TODA la aritmética monetaria del módulo vive aquí para que las ventas, los
// reportes y la impresión usen exactamente la misma fórmula.
//
// IVA (dos opciones, por producto):
//   hereda   -> usa configuracion.iva_modo_default
//   incluido -> base_imponible = precio / (1 + iva); iva_linea = precio - base
//   agregado -> base_imponible = precio;             iva_linea = precio * iva
//   exento   -> iva_linea = 0
// El modo y el porcentaje aplicados se SNAPSHOTEAN en conta_venta_items.
// =============================================================================
import bcrypt from 'bcryptjs';
import { round2, num, fechaISO } from './helpers.js';
import { esSupervisorPlus } from '../middleware/auth.js';
import { verificarPin } from '../middleware/pin.js';

export const IVA_MODOS = ['hereda', 'incluido', 'agregado', 'exento'];

/** Lee toda la configuración como mapa { clave: valor }. */
export async function getConfigMap(db) {
  const { rows } = await db.query('SELECT clave, valor FROM conta_configuracion');
  const map = {};
  for (const r of rows) map[r.clave] = r.valor;
  return map;
}

export function valorConfig(map, clave, def) {
  const v = map ? map[clave] : undefined;
  return v === undefined || v === null ? def : v;
}

/** Resuelve el modo de IVA efectivo de un producto (aplicando 'hereda'). */
export function resolverIvaModo(ivaModoProducto, configMap) {
  const modo = ivaModoProducto && ivaModoProducto !== 'hereda'
    ? ivaModoProducto
    : String(valorConfig(configMap, 'iva_modo_default', 'incluido'));
  return IVA_MODOS.includes(modo) ? modo : 'incluido';
}

/** Resuelve el porcentaje de IVA efectivo (0 si el modo es exento). */
export function resolverIvaPorcentaje(producto, configMap, modoEfectivo) {
  if (modoEfectivo === 'exento') return 0;
  const p = producto && producto.iva_porcentaje != null ? num(producto.iva_porcentaje) : null;
  if (p != null) return p;
  // v3: `iva_pct_default` es la clave fiscal canónica; `iva_porcentaje_default`
  // se mantiene como respaldo de compatibilidad con la configuración v1.
  if (configMap && configMap.iva_pct_default !== undefined) {
    return num(configMap.iva_pct_default, 13);
  }
  return num(valorConfig(configMap, 'iva_porcentaje_default', 13));
}

/**
 * Calcula una línea de venta con el IVA ya aplicado.
 * `bruto` = precio_unitario * cantidad (antes de descuento de línea).
 */
export function calcularLinea({ bruto, descuento = 0, iva_modo, iva_porcentaje }) {
  const b = round2(bruto);
  const desc = round2(Math.min(Math.max(num(descuento), 0), b));
  const neto = round2(b - desc);
  const tasa = num(iva_porcentaje) / 100;

  let base, iva, total;
  if (iva_modo === 'exento' || tasa === 0) {
    base = neto; iva = 0; total = neto;
  } else if (iva_modo === 'agregado') {
    base = neto;
    iva = round2(neto * tasa);
    total = round2(neto + iva);
  } else {
    // incluido (por defecto)
    base = round2(neto / (1 + tasa));
    iva = round2(neto - base);
    total = neto;
  }
  return { bruto: b, descuento: desc, neto, base_imponible: base, iva_linea: iva, total };
}

/**
 * Valida las credenciales de un usuario autorizador (supervisor o superior).
 * Se usa para autorizar descuentos por encima del umbral, egresos grandes,
 * anulaciones y exención de NIT, sin interrumpir la sesión del cajero.
 * Devuelve el usuario autorizador o null.
 */
export async function validarAutorizacion(db, autorizacion) {
  if (!autorizacion) return null;

  // Autorización RÁPIDA por PIN de supervisor (4-6 dígitos, bcrypt).
  // El cajero no cierra sesión: el supervisor teclea su PIN en el POS.
  if (autorizacion.pin) {
    const aut = await verificarPin(db, { pin: autorizacion.pin });
    if (!aut) return null;
    return {
      id: aut.usuario_id, nombre: aut.nombre, apellido: aut.apellido,
      carnet: aut.carnet, rol: aut.rol, por_pin: true,
    };
  }

  // Autorización por credenciales completas de un supervisor.
  if (!autorizacion.carnet || !autorizacion.password) return null;
  const { rows } = await db.query(
    `SELECT id, nombre, apellido, carnet, rol, password_hash
       FROM usuarios WHERE LOWER(carnet) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1`,
    [autorizacion.carnet]
  );
  const u = rows[0];
  if (!u || !u.password_hash) return null;
  if (!esSupervisorPlus(u.rol)) return null;
  const ok = await bcrypt.compare(autorizacion.password, u.password_hash);
  return ok ? u : null;
}

/** Nombre para snapshot del cajero (no se recalcula en reportes). */
export function nombreSnapshot(u) {
  if (!u) return null;
  return `${u.nombre || ''} ${u.apellido || ''}`.trim() || u.carnet || null;
}

/**
 * Calcula la distribución de una propina según configuracion.propina_distribucion.
 *   por_cajero -> 100% al cajero que registró la venta
 *   por_kart   -> reparto equitativo entre los pilotos/karts de la venta
 *                 (si la venta no tiene tickets asociados, va al cajero)
 *   por_equipo -> reparto equitativo entre el personal de caja activo
 *   mixto      -> reparte según `pesos` (config propina_distribucion_pesos):
 *                 { cajero, equipo, pilotos } — se normalizan para sumar 1.
 *                 Por defecto { cajero: 0.5, equipo: 0.5 }.
 * Devuelve [{ usuario_id, rol, monto }].
 */
export async function calcularDistribucionPropina(db, { modo, monto, cajero, usuariosTicket = [], pesos = null }) {
  const total = round2(num(monto));
  if (total <= 0) return [];

  const repartir = (ids, importe) => {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return [];
    const cuota = round2(importe / uniq.length);
    const filas = uniq.map((id) => ({ usuario_id: id, rol: null, monto: cuota }));
    // Ajuste de céntimos: la diferencia va al primero.
    const suma = round2(filas.reduce((a, f) => a + f.monto, 0));
    const dif = round2(importe - suma);
    if (dif !== 0) filas[0].monto = round2(filas[0].monto + dif);
    return filas;
  };

  const personalCaja = async () => {
    const { rows } = await db.query(
      `SELECT id FROM usuarios WHERE rol IN ('cajero','coordinador') AND COALESCE(bloqueado,false) = false ORDER BY id`
    );
    return rows.map((r) => r.id);
  };

  let filas = [];
  if (modo === 'por_kart') {
    filas = repartir(usuariosTicket, total);
    if (!filas.length) filas = repartir([cajero.id], total);
  } else if (modo === 'por_equipo') {
    filas = repartir(await personalCaja(), total);
    if (!filas.length) filas = repartir([cajero.id], total);
  } else if (modo === 'mixto') {
    // Pesos configurables (config propina_distribucion_pesos).
    const p = pesos && typeof pesos === 'object' ? pesos : { cajero: 0.5, equipo: 0.5 };
    const buckets = [
      { ids: [cajero.id], peso: Math.max(num(p.cajero), 0) },
      { ids: await personalCaja(), peso: Math.max(num(p.equipo), 0) },
      { ids: usuariosTicket, peso: Math.max(num(p.pilotos), 0) },
    ].filter((b) => b.peso > 0 && b.ids.length);
    const sumaPesos = buckets.reduce((a, b) => a + b.peso, 0);
    if (!buckets.length || sumaPesos <= 0) {
      filas = repartir([cajero.id], total);
    } else {
      // Se reparte proporcionalmente y el residuo de céntimos va al primero.
      let asignado = 0;
      const partes = buckets.map((b, i) => {
        const esUltima = i === buckets.length - 1;
        const importe = esUltima
          ? round2(total - asignado)
          : round2(total * (b.peso / sumaPesos));
        asignado = round2(asignado + importe);
        return { ids: b.ids, importe };
      });
      for (const parte of partes) filas = filas.concat(repartir(parte.ids, parte.importe));
    }
  } else {
    // por_cajero (default)
    filas = repartir([cajero.id], total);
  }

  // Rellena el rol de cada beneficiario para el reporte.
  const ids = filas.map((f) => f.usuario_id);
  if (ids.length) {
    const { rows } = await db.query('SELECT id, rol FROM usuarios WHERE id = ANY($1::int[])', [ids]);
    const mapa = new Map(rows.map((r) => [r.id, r.rol]));
    filas = filas.map((f) => ({ ...f, rol: mapa.get(f.usuario_id) || null }));
  }
  return filas;
}

/** Número de factura formateado a partir del id de la venta (único). */
export function numeroFactura(ventaId) {
  return `F-${String(ventaId).padStart(6, '0')}`;
}

// =============================================================================
// MÓDULO FISCAL BOLIVIA (v3)
// -----------------------------------------------------------------------------
// Reglas:
//   * tipo_operacion decide si la venta lleva IVA desglosado o no.
//   * El IT (Impuesto a las Transacciones, 3%) se calcula SIEMPRE sobre la base
//     imponible, esté la venta facturada o no (es un impuesto a los ingresos
//     brutos, no al consumo).
//   * Régimen SIETE-RG: no se desglosa IVA/IT; se aplica 5% unificado sobre el
//     total y se guarda en `iue_retenido` (así los reportes no recalculan).
//   * TODO se snapshotea en la venta y en cada línea: cambiar una tasa después
//     NO altera los registros históricos.
// =============================================================================

export const TIPOS_OPERACION = ['facturado', 'no_facturado', 'cortesia', 'exento'];
export const REGIMENES = ['general', 'siete_rg'];

/** Normaliza el tipo de operación pedido; por defecto lo que diga la config. */
export function resolverTipoOperacion(body, configMap) {
  const pedido = body && body.tipo_operacion ? String(body.tipo_operacion) : null;
  if (pedido && TIPOS_OPERACION.includes(pedido)) return pedido;
  const def = String(valorConfig(configMap, 'facturacion_modo_default', 'no_facturado'));
  return TIPOS_OPERACION.includes(def) ? def : 'no_facturado';
}

/** Normaliza el régimen tributario (general | siete_rg). */
export function resolverRegimen(configMap) {
  const r = String(valorConfig(configMap, 'regimen', 'general'));
  return REGIMENES.includes(r) ? r : 'general';
}

/**
 * Calcula una línea aplicando las reglas fiscales bolivianas.
 *
 *   facturado    -> IVA según `iva_modo` (incluido | agregado | exento | hereda)
 *   no_facturado -> sin desglose de IVA; el precio es la base
 *   exento       -> como no_facturado pero marcado explícitamente
 *   cortesia     -> importe 0 (solo para auditoría)
 *
 * Devuelve, además del cálculo v1, los snapshots fiscales de la línea:
 *   precio_base, iva_linea, it_linea, precio_final, iva_modo_aplicado,
 *   iva_pct_aplicado, it_pct_aplicado, tipo_operacion_snapshot
 */
export function calcularLineaFiscal({
  bruto, descuento = 0, iva_modo, iva_porcentaje,
  tipo_operacion = 'no_facturado', it_porcentaje = 0,
}) {
  const base = calcularLinea({ bruto, descuento, iva_modo, iva_porcentaje });
  const esFacturado = tipo_operacion === 'facturado';
  const esCortesia = tipo_operacion === 'cortesia';

  let precioBase;
  let ivaLinea;
  let ivaModoAplicado;
  let ivaPct;
  if (esCortesia) {
    precioBase = 0; ivaLinea = 0; ivaModoAplicado = 'no_aplica'; ivaPct = 0;
  } else if (esFacturado) {
    precioBase = base.base_imponible;
    ivaLinea = base.iva_linea;
    ivaModoAplicado = iva_modo;
    ivaPct = num(iva_porcentaje);
  } else {
    // no_facturado | exento — el cliente paga el precio; no se desglosa IVA.
    precioBase = base.neto;
    ivaLinea = 0;
    ivaModoAplicado = 'no_aplica';
    ivaPct = 0;
  }

  // El IT aplica siempre salvo en cortesías (no hay ingreso).
  const itPct = esCortesia ? 0 : num(it_porcentaje);
  const itLinea = esCortesia ? 0 : round2((precioBase * itPct) / 100);

  // Lo que efectivamente paga el cliente:
  //   cortesía   -> 0
  //   facturado  -> según el modo de IVA (incluido = neto, agregado = neto+IVA)
  //   resto      -> el precio (neto), sin agregar IVA
  const precioFinal = esCortesia ? 0 : (esFacturado ? base.total : base.neto);

  return {
    bruto: base.bruto,
    descuento: base.descuento,
    neto: base.neto,
    // Nomenclatura v1 (base_imponible): en ventas no facturadas la base es el
    // precio cobrado (no se desglosa IVA); en cortesías la base es 0.
    base_imponible: esCortesia ? 0 : precioBase,
    iva_linea: ivaLinea,
    total: precioFinal,
    // --- snapshots fiscales ---
    tipo_operacion_snapshot: tipo_operacion,
    iva_modo_aplicado: ivaModoAplicado,
    iva_pct_aplicado: ivaPct,
    it_pct_aplicado: itPct,
    it_linea: itLinea,
    precio_base: precioBase,
    precio_final: precioFinal,
  };
}

/**
 * Totales fiscales de la venta a partir de las líneas ya calculadas.
 * `propina` se suma al total pero NO es base de IVA/IT.
 */
export function totalesFiscales({ lineas, propina = 0, regimen = 'general', sieteRgPct = 5 }) {
  const baseIva = round2(lineas.reduce((a, l) => a + num(l.precio_base), 0));
  const baseIt = round2(lineas.reduce((a, l) => a + num(l.precio_base), 0));
  const brutoFinal = round2(lineas.reduce((a, l) => a + num(l.precio_final), 0));

  if (regimen === 'siete_rg') {
    // Régimen unificado: NO se desglosa IVA ni IT.
    const unificado = round2((brutoFinal * num(sieteRgPct, 5)) / 100);
    return {
      base_imponible_iva: 0,
      base_imponible_it: 0,
      iva_total: 0,
      it_total: 0,
      iue_pct_aplicado: num(sieteRgPct, 5),
      iue_retenido: unificado,
      itf_total: 0,
      total_final: round2(brutoFinal + num(propina)),
    };
  }

  return {
    base_imponible_iva: baseIva,
    base_imponible_it: baseIt,
    iva_total: round2(lineas.reduce((a, l) => a + num(l.iva_linea), 0)),
    it_total: round2(lineas.reduce((a, l) => a + num(l.it_linea), 0)),
    iue_pct_aplicado: null,
    iue_retenido: 0,
    itf_total: 0,
    total_final: round2(brutoFinal + num(propina)),
  };
}

/**
 * CUF PLACEHOLDER (integrable con el SIN). Se deriva de la base autorizada +
 * número + fecha; la integración SOAP real está desactivada en esta versión.
 */
export function generarCuf({ dosificacion, numero, fecha }) {
  const base = (dosificacion && dosificacion.cuf_base) || 'CUF';
  const nro = String(numero).padStart(8, '0');
  const f = String(fecha || fechaISO()).replace(/-/g, '');
  return `${base}${nro}${f}`;
}

/**
 * Reserva ATÓMICA del siguiente número de factura desde la dosificación activa.
 * Usa SELECT ... FOR UPDATE para que dos ventas simultáneas nunca repitan
 * número. Devuelve null si no hay dosificación activa con rango disponible.
 */
export async function reservarNumeroFactura(client, { sucursal_id = null, tipo_factura = 'factura' } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM conta_dosificaciones
      WHERE activo = true
        AND tipo_factura = $2
        AND (sucursal_id = $1 OR sucursal_id IS NULL)
        AND numero_actual + 1 <= rango_hasta
        AND (vigencia_desde IS NULL OR vigencia_desde <= CURRENT_DATE)
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= CURRENT_DATE)
      ORDER BY sucursal_id NULLS LAST, id
      LIMIT 1
      FOR UPDATE`,
    [sucursal_id, tipo_factura]
  );
  if (!rows.length) return null;
  const dosif = rows[0];

  const { rows: upd } = await client.query(
    `UPDATE conta_dosificaciones SET numero_actual = numero_actual + 1 WHERE id = $1 RETURNING *`,
    [dosif.id]
  );
  const d = upd[0];
  const numero = num(d.numero_actual);
  const rango = num(d.rango_hasta) - num(d.rango_desde) + 1;
  const consumido = rango > 0 ? ((numero - num(d.rango_desde) + 1) / rango) * 100 : 0;

  return {
    dosificacion: d,
    numero,
    numero_factura: String(numero).padStart(8, '0'),
    cuf: generarCuf({ dosificacion: d, numero }),
    cuis: d.cuis, cun: d.cun,
    restantes: Math.max(0, num(d.rango_hasta) - numero),
    porcentaje_consumido: num(consumido),
  };
}

/** Porcentaje de IT vigente según configuración (default 3%). */
export function itPorcentaje(configMap) {
  return num(valorConfig(configMap, 'it_pct_default', 3), 3);
}

/** Porcentaje unificado SIETE-RG (default 5%). */
export function sieteRgPorcentaje(configMap) {
  return num(valorConfig(configMap, 'siete_rg_pct', 5), 5);
}

/**
 * ¿El período fiscal (sucursal + año + mes) está CERRADO?
 * Un período cerrado no admite nuevos registros de venta/compra ni
 * anulaciones: la única vía de corrección es una nota de crédito.
 */
export async function periodoFiscalCerrado(db, { sucursal_id = null, anio, mes }) {
  const { rows } = await db.query(
    `SELECT estado FROM conta_periodos_fiscales
      WHERE periodo_anio = $1 AND periodo_mes = $2
        AND (sucursal_id = $3 OR sucursal_id IS NULL)
      ORDER BY sucursal_id NULLS LAST LIMIT 1`,
    [anio, mes, sucursal_id]
  );
  return rows.length > 0 && rows[0].estado === 'cerrado';
}
