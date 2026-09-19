// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: motor de ASIENTOS CONTABLES automáticos
// -----------------------------------------------------------------------------
// Partida doble (Bolivia). Todo asiento se genera dentro de la MISMA transacción
// que el documento que lo origina, de modo que si el documento se revierte el
// asiento también.
//
// Documentos que generan asiento automático:
//   venta, nota_credito, compra, egreso, propina pagada, nomina,
//   depreciacion, anticipo (registro y aplicación).
//
// El plan de cuentas es el de conta_cuentas_contables (migración 0016/0017).
// =============================================================================
import { num, round2, uuid, fechaISO } from './helpers.js';

// Códigos del plan de cuentas mínimo.
export const CUENTAS = {
  CAJA: '1101',
  BANCOS: '1102',
  CXC: '1103',
  INVENTARIO: '1104',
  ANTICIPOS_PROVEEDORES: '1105',
  ACTIVOS: '1201',
  DEPRECIACION_ACUMULADA: '1202',
  CXP: '2101',
  IVA_POR_PAGAR: '2102',
  ANTICIPOS_CLIENTES: '2103',
  SUELDOS_POR_PAGAR: '2104',
  PROPINAS_POR_PAGAR: '2105',
  IVA_CREDITO_FISCAL: '2106',
  CAPITAL: '3101',
  RESULTADOS: '3102',
  INGRESOS: '4101',
  DEVOLUCIONES: '4102',
  OTROS_INGRESOS: '4103',
  COSTO_VENTAS: '5101',
  GASTOS: '6101',
  SUELDOS: '6102',
  DEPRECIACION: '6103',
  PROPINAS_PAGADAS: '6104',
};

/** Cuenta de contrapartida según el tipo de método de pago. */
export function cuentaDeMetodo(tipoMetodo) {
  return tipoMetodo === 'efectivo' ? CUENTAS.CAJA : CUENTAS.BANCOS;
}

/**
 * Registra un asiento contable (valida que cuadre).
 * `lineas`: [{ cuenta, debe, haber, descripcion }]
 * Devuelve la fila del asiento creado (o null si no hay líneas con importe).
 */
export async function registrarAsiento(db, {
  fecha = null, descripcion, referencia_tipo = null, referencia_id = null,
  lineas = [], usuario_id = null, sucursal_id = null, tipo = 'automatico',
}) {
  const filas = lineas
    .map((l) => ({
      cuenta_contable: String(l.cuenta),
      debe: round2(num(l.debe)),
      haber: round2(num(l.haber)),
      descripcion: l.descripcion || null,
    }))
    .filter((l) => l.debe > 0 || l.haber > 0);

  if (!filas.length) return null;

  const totalDebe = round2(filas.reduce((a, l) => a + l.debe, 0));
  const totalHaber = round2(filas.reduce((a, l) => a + l.haber, 0));
  if (Math.abs(totalDebe - totalHaber) > 0.02) {
    const e = new Error(
      `El asiento no cuadra: debe ${totalDebe} ≠ haber ${totalHaber} (${descripcion})`
    );
    e.status = 500;
    throw e;
  }

  const { rows } = await db.query(
    `INSERT INTO conta_asientos_contables
       (uuid_global, sucursal_id, fecha, tipo, descripcion, referencia_tipo, referencia_id,
        total_debe, total_haber, estado, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'registrado',$10) RETURNING *`,
    [uuid(), sucursal_id, fecha || fechaISO(), tipo, descripcion,
     referencia_tipo, referencia_id, totalDebe, totalHaber, usuario_id]
  );
  const asiento = rows[0];

  for (const l of filas) {
    await db.query(
      `INSERT INTO conta_asiento_lineas (asiento_id, cuenta_contable, debe, haber, descripcion)
       VALUES ($1,$2,$3,$4,$5)`,
      [asiento.id, l.cuenta_contable, l.debe, l.haber, l.descripcion]
    );
  }
  return asiento;
}

// ---------------------------------------------------------------------------
// ASIENTOS POR DOCUMENTO
// ---------------------------------------------------------------------------

/**
 * VENTA: el dinero entra a Caja/Bancos; se reconoce el ingreso, el IVA por
 * pagar y la propina como pasivo (se entrega al personal después).
 *
 * Si parte del total se cubrió con el saldo a favor del cliente
 * (`venta.monto_anticipo_aplicado`), esa porción NO entra a caja: cancela el
 * pasivo "Anticipos de Clientes". Por eso los `pagos` suman
 * (total_final - monto_anticipo_aplicado).
 */
export async function asientoDeVenta(db, { venta, pagos = [], usuario_id = null }) {
  const total = round2(num(venta.total_final));
  if (total <= 0) return null;

  const base = round2(num(venta.base_imponible));
  const iva = round2(num(venta.iva_total));
  const propina = round2(num(venta.propina));
  const aplicadoAnticipo = round2(num(venta.monto_anticipo_aplicado));

  const lineas = [];
  const pagosValidos = pagos.filter((p) => num(p.monto) > 0);
  for (const p of pagosValidos) {
    lineas.push({
      cuenta: cuentaDeMetodo(p.metodo_tipo),
      debe: round2(num(p.monto)), haber: 0,
      descripcion: `Cobro ${p.metodo_nombre || ''} ${venta.numero_factura || ''}`.trim(),
    });
  }
  if (!pagosValidos.length && aplicadoAnticipo <= 0) {
    lineas.push({ cuenta: CUENTAS.CAJA, debe: total, haber: 0, descripcion: 'Cobro de venta' });
  }
  if (aplicadoAnticipo > 0) {
    lineas.push({
      cuenta: CUENTAS.ANTICIPOS_CLIENTES, debe: aplicadoAnticipo, haber: 0,
      descripcion: 'Aplicación de anticipo',
    });
  }

  lineas.push({ cuenta: CUENTAS.INGRESOS, debe: 0, haber: base, descripcion: 'Ingreso por venta' });
  if (iva > 0) lineas.push({ cuenta: CUENTAS.IVA_POR_PAGAR, debe: 0, haber: iva, descripcion: 'IVA débito fiscal' });
  if (propina > 0) lineas.push({ cuenta: CUENTAS.PROPINAS_POR_PAGAR, debe: 0, haber: propina, descripcion: 'Propina por distribuir' });

  return registrarAsiento(db, {
    descripcion: `Venta ${venta.numero_factura || venta.id}`,
    referencia_tipo: 'venta', referencia_id: venta.id,
    lineas, usuario_id, sucursal_id: venta.sucursal_id,
  });
}

/**
 * NOTA DE CRÉDITO: revierte el ingreso y el IVA, y devuelve el dinero.
 * La proporción base/IVA se toma del snapshot de la venta original.
 */
export async function asientoDeNotaCredito(db, { nota, ventaOriginal, usuario_id = null }) {
  const monto = round2(num(nota.monto));
  if (monto <= 0) return null;

  const total = round2(num(ventaOriginal.total_final));
  const factor = total > 0 ? monto / total : 1;
  const base = round2(num(ventaOriginal.base_imponible) * factor);
  const iva = round2(monto - base);

  const lineas = [
    { cuenta: CUENTAS.DEVOLUCIONES, debe: base, haber: 0, descripcion: 'Devolución (nota de crédito)' },
  ];
  if (iva > 0) {
    lineas.push({ cuenta: CUENTAS.IVA_POR_PAGAR, debe: iva, haber: 0, descripcion: 'Reverso de IVA débito fiscal' });
  }
  lineas.push({
    cuenta: nota.reembolso === 'saldo_favor' ? CUENTAS.ANTICIPOS_CLIENTES : CUENTAS.CAJA,
    debe: 0, haber: monto,
    descripcion: nota.reembolso === 'saldo_favor' ? 'Saldo a favor del cliente' : 'Reembolso al cliente',
  });

  return registrarAsiento(db, {
    descripcion: `Nota de crédito ${nota.numero} (venta ${ventaOriginal.numero_factura || ventaOriginal.id})`,
    referencia_tipo: 'nota_credito', referencia_id: nota.id,
    lineas, usuario_id, sucursal_id: nota.sucursal_id,
  });
}

/** COMPRA: entra inventario + IVA crédito fiscal, nace la cuenta por pagar. */
export async function asientoDeCompra(db, { compra, usuario_id = null }) {
  const subtotal = round2(num(compra.subtotal));
  const iva = round2(num(compra.iva));
  const total = round2(num(compra.total));
  if (total <= 0) return null;

  const lineas = [
    { cuenta: CUENTAS.INVENTARIO, debe: subtotal, haber: 0, descripcion: 'Entrada de inventario' },
  ];
  if (iva > 0) lineas.push({ cuenta: CUENTAS.IVA_CREDITO_FISCAL, debe: iva, haber: 0, descripcion: 'IVA crédito fiscal' });
  lineas.push({ cuenta: CUENTAS.CXP, debe: 0, haber: total, descripcion: 'Cuenta por pagar al proveedor' });

  return registrarAsiento(db, {
    descripcion: `Compra ${compra.numero_factura_prov || compra.id}`,
    referencia_tipo: 'compra', referencia_id: compra.id,
    lineas, usuario_id, sucursal_id: compra.sucursal_id,
  });
}

/** EGRESO de caja: gasto contra caja. */
export async function asientoDeEgreso(db, { egreso, usuario_id = null }) {
  const monto = round2(num(egreso.monto));
  if (monto <= 0) return null;
  return registrarAsiento(db, {
    descripcion: `Egreso ${egreso.categoria}: ${egreso.descripcion || ''}`.trim(),
    referencia_tipo: 'egreso', referencia_id: egreso.id,
    lineas: [
      { cuenta: CUENTAS.GASTOS, debe: monto, haber: 0, descripcion: egreso.categoria },
      { cuenta: CUENTAS.CAJA, debe: 0, haber: monto, descripcion: 'Salida de caja' },
    ],
    usuario_id, sucursal_id: egreso.sucursal_id,
  });
}

/** PROPINA PAGADA: se cancela el pasivo contra caja. */
export async function asientoDePropinaPagada(db, { propina, monto, usuario_id = null, sucursal_id = null }) {
  const m = round2(num(monto));
  if (m <= 0) return null;
  return registrarAsiento(db, {
    descripcion: `Pago de propinas (propina ${propina.id})`,
    referencia_tipo: 'propina', referencia_id: propina.id,
    lineas: [
      { cuenta: CUENTAS.PROPINAS_POR_PAGAR, debe: m, haber: 0, descripcion: 'Pago de propinas' },
      { cuenta: CUENTAS.CAJA, debe: 0, haber: m, descripcion: 'Salida de caja' },
    ],
    usuario_id, sucursal_id,
  });
}

/** NÓMINA: sueldo devengado contra sueldos por pagar. */
export async function asientoDeNomina(db, { nomina, usuario_id = null }) {
  const total = round2(num(nomina.total_pagar));
  if (total <= 0) return null;
  return registrarAsiento(db, {
    descripcion: `Nómina ${nomina.periodo_desde} a ${nomina.periodo_hasta}`,
    referencia_tipo: 'nomina', referencia_id: nomina.id,
    lineas: [
      { cuenta: CUENTAS.SUELDOS, debe: total, haber: 0, descripcion: 'Sueldos y salarios' },
      { cuenta: CUENTAS.SUELDOS_POR_PAGAR, debe: 0, haber: total, descripcion: 'Sueldos por pagar' },
    ],
    usuario_id, sucursal_id: nomina.sucursal_id,
  });
}

/** DEPRECIACIÓN: gasto contra depreciación acumulada. */
export async function asientoDeDepreciacion(db, { activo, monto, periodo, usuario_id = null }) {
  const m = round2(num(monto));
  if (m <= 0) return null;
  return registrarAsiento(db, {
    descripcion: `Depreciación ${periodo} — ${activo.nombre}`,
    referencia_tipo: 'depreciacion', referencia_id: activo.id,
    lineas: [
      { cuenta: CUENTAS.DEPRECIACION, debe: m, haber: 0, descripcion: `Depreciación ${periodo}` },
      { cuenta: CUENTAS.DEPRECIACION_ACUMULADA, debe: 0, haber: m, descripcion: `Depreciación acumulada ${periodo}` },
    ],
    usuario_id, sucursal_id: activo.sucursal_id,
  });
}

/** ANTICIPO registrado: entra el dinero, nace el pasivo con el cliente. */
export async function asientoDeAnticipo(db, { anticipo, tipoMetodo = 'efectivo', usuario_id = null }) {
  const monto = round2(num(anticipo.monto));
  if (monto <= 0) return null;
  return registrarAsiento(db, {
    descripcion: `Anticipo de ${anticipo.cliente_nombre || 'cliente'}`,
    referencia_tipo: 'anticipo', referencia_id: anticipo.id,
    lineas: [
      { cuenta: cuentaDeMetodo(tipoMetodo), debe: monto, haber: 0, descripcion: 'Ingreso de anticipo' },
      { cuenta: CUENTAS.ANTICIPOS_CLIENTES, debe: 0, haber: monto, descripcion: 'Anticipo de cliente' },
    ],
    usuario_id, sucursal_id: anticipo.sucursal_id,
  });
}

/** ANTICIPO APLICADO a una venta: se cancela el pasivo contra el cobro. */
export async function asientoDeAnticipoAplicado(db, {
  anticipo, venta, monto, tipoMetodo = 'efectivo', usuario_id = null,
}) {
  const m = round2(num(monto));
  if (m <= 0) return null;
  return registrarAsiento(db, {
    descripcion: `Aplicación de anticipo a venta ${venta.numero_factura || venta.id}`,
    referencia_tipo: 'anticipo', referencia_id: anticipo.id,
    lineas: [
      { cuenta: CUENTAS.ANTICIPOS_CLIENTES, debe: m, haber: 0, descripcion: 'Anticipo aplicado' },
      { cuenta: cuentaDeMetodo(tipoMetodo), debe: 0, haber: m, descripcion: 'Anticipo aplicado a venta' },
    ],
    usuario_id, sucursal_id: venta.sucursal_id,
  });
}
