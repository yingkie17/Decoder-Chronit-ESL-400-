// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: VENTAS (POS) — núcleo del módulo
// -----------------------------------------------------------------------------
//   POST /api/conta/ventas            -> registrar venta (caja, items, IVA,
//                                        descuento, propina, pagos, tickets)
//   GET  /api/conta/ventas            -> listar con filtros
//   GET  /api/conta/ventas/:id        -> detalle completo
//   POST /api/conta/ventas/:id/anular -> anular (solo supervisor+)
//
// REGLAS IMPLEMENTADAS
//   * Venta inmutable: nunca se borra -> anulada = true + motivo + auditoría.
//   * Se SNAPSHOTEA: precio, IVA (modo y %), descuento, nombre del cajero,
//     responsable de la cuenta destino y modo de IVA por defecto aplicado.
//   * Cuenta destino OBLIGATORIA si el método de pago es qr o transferencia.
//   * Descuento > configuracion.umbral_descuento_supervisor -> autorización
//     de supervisor (carnet + contraseña) dentro del mismo request.
//   * NIT del cliente: siempre disponible (opcional). Si
//     configuracion.requiere_nit_por_defecto = true se exige, salvo exención
//     autorizada por supervisor.
//   * Combo 'unico' -> 1 línea; 'desglosado' -> N líneas con
//     es_componente_combo = true y combo_padre_id.
// =============================================================================
import { Router } from 'express';
import { query, withTx, esErrorDeConexion } from '../db/pool.js';
import { disponible, encolar } from '../db/outbox.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireSupervisorPin } from '../middleware/pin.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, round2, uuid, fechaISO } from '../utils/helpers.js';
import {
  getConfigMap, valorConfig, resolverIvaModo, resolverIvaPorcentaje,
  calcularLineaFiscal, validarAutorizacion, nombreSnapshot, calcularDistribucionPropina,
  resolverTipoOperacion, resolverRegimen, totalesFiscales,
  reservarNumeroFactura, itPorcentaje, sieteRgPorcentaje, periodoFiscalCerrado,
} from '../utils/finanzas.js';
import { preciosDeLista, listaVigente } from './catalogo.js';
import { promocionesVigentes, evaluarPromociones } from '../utils/promociones.js';
import { asientoDeVenta } from '../utils/contabilidad.js';
import { crearAlerta } from '../utils/alertas.js';

export const ventasRouter = Router();

const PUEDE_VENDER = ['cajero', 'supervisor', 'admin'];
const ES_SUPERVISOR = (rol) => ['supervisor', 'admin', 'desarrollador'].includes(rol);

// ---------------------------------------------------------------------------
// Construcción de líneas de venta (productos y combos) con IVA resuelto
// ---------------------------------------------------------------------------
async function construirLineas(db, { items, configMap }) {
  const { rows: productos } = await db.query('SELECT * FROM conta_productos WHERE activo = true');
  const { rows: combos } = await db.query('SELECT * FROM conta_combos WHERE activo = true');
  const prodById = new Map(productos.map((p) => [p.id, p]));
  const prodByName = new Map(productos.map((p) => [p.nombre, p]));
  const comboById = new Map(combos.map((c) => [c.id, c]));

  const lista = await listaVigente(db);
  const precios = await preciosDeLista(db, lista ? lista.id : null);
  const comboModoDefault = valorConfig(configMap, 'combo_modo_default', 'unico');

  const lineas = [];
  for (const it of items) {
    const cantidad = num(it.cantidad, 1) || 1;
    const descItem = num(it.descuento);

    if (it.combo_id) {
      const combo = comboById.get(Number(it.combo_id));
      if (!combo) { const e = new Error(`Combo ${it.combo_id} no encontrado o inactivo`); e.status = 400; throw e; }
      const ivaModo = resolverIvaModo(combo.iva_modo_hereda ? 'hereda' : combo.iva_modo, configMap);
      const ivaPct = resolverIvaPorcentaje(null, configMap, ivaModo);
      const modoFact = combo.modo_facturacion || comboModoDefault;
      const componentes = Array.isArray(combo.items) ? combo.items : [];

      if (modoFact === 'desglosado' && componentes.length) {
        // Línea padre: nodo de agrupación (sin dinero).
        const idxPadre = lineas.length;
        lineas.push({
          producto_id: null, combo_id: combo.id, nombre_snapshot: `${combo.nombre} (combo)`,
          categoria: 'combo',
          cantidad, precio_unitario: 0, bruto: 0, descuento_item: 0,
          es_componente_combo: false, combo_padre_idx: null,
          iva_modo: ivaModo, iva_porcentaje: ivaPct,
        });
        // Componentes: precios de lista escalados para que sumen el precio del combo.
        const hijos = [];
        for (const comp of componentes) {
          const prod = comp.producto_id ? prodById.get(Number(comp.producto_id)) : prodByName.get(comp.producto);
          if (!prod) continue;
          const cantComp = num(comp.cantidad, 1) || 1;
          const precioLista = num(precios.get(prod.id)?.precio ?? 0);
          hijos.push({ prod, cantComp, precioLista });
        }
        const brutoHijos = hijos.reduce((a, h) => a + h.precioLista * h.cantComp, 0);
        const objetivo = num(it.precio_unitario != null ? it.precio_unitario : combo.precio) * cantidad;
        const factor = brutoHijos > 0 ? objetivo / brutoHijos : 0;
        for (const h of hijos) {
          const pu = round2(h.precioLista * factor);
          lineas.push({
            producto_id: h.prod.id, combo_id: combo.id, nombre_snapshot: h.prod.nombre,
            categoria: h.prod.categoria || 'otro',
            cantidad: h.cantComp * cantidad, precio_unitario: pu, bruto: round2(pu * h.cantComp * cantidad),
            descuento_item: 0, es_componente_combo: true, combo_padre_idx: idxPadre,
            iva_modo: ivaModo, iva_porcentaje: ivaPct,
            vueltas: h.prod.vueltas ?? null, duracion_min: h.prod.duracion_min ?? null,
          });
        }
      } else {
        // Modo 'unico': una sola línea por el combo.
        const pu = num(it.precio_unitario != null ? it.precio_unitario : combo.precio);
        lineas.push({
          producto_id: null, combo_id: combo.id, nombre_snapshot: combo.nombre,
          categoria: 'combo',
          cantidad, precio_unitario: pu, bruto: round2(pu * cantidad), descuento_item: descItem,
          es_componente_combo: false, combo_padre_idx: null,
          iva_modo: ivaModo, iva_porcentaje: ivaPct,
        });
      }
      continue;
    }

    const prod = prodById.get(Number(it.producto_id));
    if (!prod) { const e = new Error(`Producto ${it.producto_id} no encontrado o inactivo`); e.status = 400; throw e; }
    const pu = num(it.precio_unitario != null ? it.precio_unitario : (precios.get(prod.id)?.precio ?? 0));
    const ivaModo = resolverIvaModo(prod.iva_modo, configMap);
    const ivaPct = resolverIvaPorcentaje(prod, configMap, ivaModo);
    lineas.push({
      producto_id: prod.id, combo_id: null, nombre_snapshot: prod.nombre,
      categoria: prod.categoria || 'otro',
      cantidad, precio_unitario: pu, bruto: round2(pu * cantidad), descuento_item: descItem,
      es_componente_combo: false, combo_padre_idx: null,
      iva_modo: ivaModo, iva_porcentaje: ivaPct,
      vueltas: prod.vueltas ?? null, duracion_min: prod.duracion_min ?? null,
    });
  }

  if (!lineas.length) { const e = new Error('La venta debe tener al menos un ítem'); e.status = 400; throw e; }
  return lineas;
}

// ---------------------------------------------------------------------------
// Núcleo reutilizable: REGISTRAR VENTA.
// Lo usan la ruta HTTP y el reconciliador offline (outbox), de modo que una
// venta encolada sin conexión se registre exactamente por el mismo camino
// (mismas validaciones, mismos snapshots, misma auditoría).
// ---------------------------------------------------------------------------
export async function registrarVenta({ body: bodyIn, usuario, ip }) {
    const body = bodyIn || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) { const e = new Error('La venta debe tener al menos un ítem'); e.status = 400; throw e; }
    const pagos = Array.isArray(body.pagos) ? body.pagos : [];
    if (!pagos.length) { const e = new Error('La venta debe tener al menos un pago'); e.status = 400; throw e; }

    return withTx(async (client) => {
      const configMap = await getConfigMap(client);

      // --- Cajero (snapshot) ---
      const { rows: cj } = await client.query(
        'SELECT id, nombre, apellido, carnet, rol FROM usuarios WHERE id = $1', [usuario.id]
      );
      if (!cj.length) { const e = new Error('Usuario no encontrado'); e.status = 401; throw e; }
      const cajero = cj[0];

      // --- Sesión de caja (obligatoria para el rol cajero) ---
      let sesionId = body.sesion_caja_id || null;
      let sucursalSesion = null;
      if (!sesionId) {
        const { rows: abierta } = await client.query(
          `SELECT id FROM conta_sesiones_caja WHERE cajero_id = $1 AND estado = 'abierta' LIMIT 1`,
          [cajero.id]
        );
        sesionId = abierta.length ? abierta[0].id : null;
      }
      if (!sesionId && cajero.rol === 'cajero') {
        const e = new Error('Debes ABRIR CAJA antes de registrar ventas.');
        e.status = 409; e.code = 'CAJA_CERRADA'; throw e;
      }
      if (sesionId) {
        const { rows: s } = await client.query(
          `SELECT id, estado, sucursal_id FROM conta_sesiones_caja WHERE id = $1`, [sesionId]
        );
        if (!s.length || s[0].estado !== 'abierta') {
          const e = new Error('La sesión de caja indicada no está abierta'); e.status = 409; throw e;
        }
        sucursalSesion = s[0].sucursal_id;
      }

      // --- Sucursal (multi-sucursal): body > sesión de caja > sucursal por defecto ---
      let sucursalId = body.sucursal_id ? Number(body.sucursal_id) : sucursalSesion;
      if (!sucursalId) {
        const { rows: suc } = await client.query(
          'SELECT id FROM conta_sucursales WHERE activo = true ORDER BY id LIMIT 1'
        );
        sucursalId = suc.length ? suc[0].id : null;
      }

      // --- Régimen tributario y tipo de operación (módulo fiscal Bolivia) ---
      // El TIPO DE OPERACIÓN decide si la venta lleva IVA desglosado o no:
      //   facturado    -> IVA (incluido | agregado | exento) + IT
      //   no_facturado -> sin desglose de IVA, pero el IT SÍ se calcula
      //   exento       -> como no_facturado, marcado explícitamente
      //   cortesia     -> importe 0 (solo auditoría)
      // El RÉGIMEN decide si se aplica SIETE-RG (5% unificado) en lugar de
      // IVA + IT por separado.
      const tipoOperacion = resolverTipoOperacion(body, configMap);
      const regimen = resolverRegimen(configMap);
      const itPct = itPorcentaje(configMap);
      const sieteRgPct = sieteRgPorcentaje(configMap);
      const esFacturado = tipoOperacion === 'facturado';
      if (esFacturado && !valorConfig(configMap, 'facturacion_habilitada', false)) {
        const e = new Error(
          'La facturación está deshabilitada en la configuración (facturacion_habilitada = false).');
        e.status = 400; e.code = 'FACTURACION_DESHABILITADA'; throw e;
      }

      // --- Guardia de período fiscal CERRADO ---
      // Un período cerrado no admite ventas nuevas (la corrección se hace con
      // nota de crédito). Configurable con libro_periodo_cerrado_bloquea.
      if (valorConfig(configMap, 'libro_periodo_cerrado_bloquea', true)) {
        const [anioHoy, mesHoy] = fechaISO(new Date()).split('-').map(Number);
        if (await periodoFiscalCerrado(client, {
          sucursal_id: sucursalId, anio: anioHoy, mes: mesHoy,
        })) {
          const e = new Error('El período fiscal actual está CERRADO: no se pueden registrar ventas. ' +
            'Use una nota de crédito para corregir.');
          e.status = 409; e.code = 'PERIODO_CERRADO'; throw e;
        }
      }

      // --- Líneas + IVA ---
      const lineas = await construirLineas(client, { items, configMap });
      const brutoTotal = round2(lineas.reduce((a, l) => a + l.bruto, 0));

      // --- Promociones vigentes (se aplican ANTES del descuento manual) ---
      // El resultado se snapshotea en la venta: los reportes no recalculan nada.
      const promoForzadas = (Array.isArray(body.promocion_ids) ? body.promocion_ids : []).map(Number);
      const promoAuto = !!valorConfig(configMap, 'promociones_auto', true);
      let promoRes = { aplicadas: [], descuento: 0, por_linea: new Map() };
      if (promoAuto || promoForzadas.length) {
        const promos = await promocionesVigentes(client);
        promoRes = evaluarPromociones(promos, lineas, {
          acumulables: !!valorConfig(configMap, 'promociones_acumulables', false),
          forzarIds: promoForzadas,
        });
      }
      for (const [i, d] of promoRes.por_linea) {
        lineas[i].descuento_promocion = d;
        lineas[i].descuento_item = round2(lineas[i].descuento_item + d);
      }

      const descuentoItemTotal = round2(lineas.reduce((a, l) => a + l.descuento_item, 0));
      const descuentoGlobal = Math.max(num(body.descuento_global), 0);
      const descuentoTotal = round2(descuentoItemTotal + descuentoGlobal);

      // Una promoción marcada 'requiere_autorizacion' solo se aplica si un
      // supervisor la autoriza en la misma petición (no se auto-aplica nunca).
      if (promoRes.aplicadas.some((a) => a.requiere_autorizacion) && !ES_SUPERVISOR(cajero.rol)) {
        const aut = await validarAutorizacion(client, body.autorizacion);
        if (!aut) {
          const e = new Error('La promoción aplicada requiere autorización de un supervisor.');
          e.status = 403; e.code = 'REQUIERE_AUTORIZACION'; throw e;
        }
      }

      // --- Autorización por descuento por encima del umbral ---
      const umbralDesc = num(valorConfig(configMap, 'umbral_descuento_supervisor', 50));
      let autorizadorDescuento = null;
      if (descuentoTotal > umbralDesc) {
        if (ES_SUPERVISOR(cajero.rol)) {
          autorizadorDescuento = cajero;
        } else {
          autorizadorDescuento = await validarAutorizacion(client, body.autorizacion);
          if (!autorizadorDescuento) {
            const e = new Error(
              `El descuento (${descuentoTotal}) supera el umbral permitido (${umbralDesc}). ` +
              'Se requiere autorización de un supervisor.');
            e.status = 403; e.code = 'REQUIERE_AUTORIZACION'; throw e;
          }
        }
      }

      // --- Datos fiscales del cliente: NIT + razón social ---
      // Requisitos (configurables, solo para ventas FACTURADAS):
      //   facturacion_requiere_nit          -> exige NIT
      //   facturacion_requiere_razon_social -> exige razón social
      // Un supervisor (o su PIN) puede eximir cualquiera de los dos.
      const nitCliente = body.nit_cliente ? String(body.nit_cliente).trim() : null;
      const razonSocial = body.razon_social_cliente ? String(body.razon_social_cliente).trim() : null;
      const tipoFactura = body.tipo_factura
        || String(valorConfig(configMap, 'tipo_factura_default', 'factura'));
      const exigeDatos = tipoFactura !== 'recibo';
      const cfgNit = esFacturado
        ? !!valorConfig(configMap, 'facturacion_requiere_nit', false)
        : !!valorConfig(configMap, 'requiere_nit_por_defecto', false);
      const requiereNit = exigeDatos && cfgNit;
      const requiereRazon = exigeDatos && esFacturado
        && !!valorConfig(configMap, 'facturacion_requiere_razon_social', false);
      const faltaNit = requiereNit && !nitCliente;
      const faltaRazon = requiereRazon && !razonSocial;
      let autorizadorNit = null;
      if (faltaNit || faltaRazon) {
        if (ES_SUPERVISOR(cajero.rol)) {
          autorizadorNit = cajero;
        } else {
          const aut = body.autorizacion ? await validarAutorizacion(client, body.autorizacion) : null;
          if (!aut) {
            const faltantes = [faltaNit ? 'NIT' : null, faltaRazon ? 'razón social' : null]
              .filter(Boolean).join(' y ');
            const e = new Error(`La configuración exige ${faltantes} del cliente para emitir factura. ` +
              'Se requiere autorización de un supervisor (PIN) para eximir.');
            e.status = 400; e.code = 'REQUIERE_DATOS_FISCALES'; throw e;
          }
          autorizadorNit = aut;
        }
      }

      // --- Reparto del descuento global proporcional al bruto de cada línea ---
      let acumuladoAsignado = 0;
      const lineasCalc = lineas.map((l, i) => {
        let d = l.descuento_item;
        if (descuentoGlobal > 0 && brutoTotal > 0) {
          const esUltima = i === lineas.length - 1;
          const parte = esUltima
            ? round2(descuentoGlobal - acumuladoAsignado)
            : round2(descuentoGlobal * (l.bruto / brutoTotal));
          acumuladoAsignado = round2(acumuladoAsignado + parte);
          d = round2(d + parte);
        }
        const calc = calcularLineaFiscal({
          bruto: l.bruto, descuento: d, iva_modo: l.iva_modo, iva_porcentaje: l.iva_porcentaje,
          tipo_operacion: tipoOperacion, it_porcentaje: itPct,
        });
        // Se exponen también los nombres "de negocio" (iva_modo_aplicado /
        // iva_porcentaje_aplicado) que es como se persisten y se devuelven en el
        // detalle de la venta: así la respuesta del POST coincide con el GET.
        return {
          ...l, ...calc,
          iva_modo_aplicado: calc.iva_modo_aplicado,
          iva_porcentaje_aplicado: calc.iva_pct_aplicado,
        };
      });

      const subtotal = brutoTotal;
      const descuentoAplicado = round2(lineasCalc.reduce((a, l) => a + l.descuento, 0));
      const propinaMonto = round2(Math.max(num(body.propina?.monto), 0));

      // Totales fiscales: con régimen SIETE-RG no se desglosa IVA/IT (se aplica
      // el 5% unificado en `iue_retenido`); en régimen general se suman las
      // bases imponibles, el IVA y el IT de cada línea.
      const totales = totalesFiscales({
        lineas: lineasCalc, propina: propinaMonto, regimen, sieteRgPct,
      });
      const ivaTotal = totales.iva_total;
      const totalFinal = totales.total_final;
      // `base_imponible` (columna v1) es el INGRESO reconocido: total cobrado
      // menos IVA y propina. En régimen general coincide con base_imponible_iva;
      // en SIETE-RG no hay desglose de IVA (base_imponible_iva = 0 por diseño),
      // por lo que sin esta fórmula el asiento contable no cuadraría.
      const baseImponible = round2(totalFinal - propinaMonto - ivaTotal);

      // --- Pagos: validación de métodos y cuenta destino obligatoria en QR ---
      const { rows: metodos } = await client.query('SELECT * FROM conta_metodos_pago');
      const metodoById = new Map(metodos.map((m) => [m.id, m]));
      let sumaPagos = 0;
      const pagosPreparados = [];
      for (const p of pagos) {
        const metodo = metodoById.get(Number(p.metodo_pago_id));
        if (!metodo) { const e = new Error(`Método de pago ${p.metodo_pago_id} inválido`); e.status = 400; throw e; }
        const montoPago = num(p.monto);
        // Las cortesías se pagan con monto 0 (no hay ingreso); el resto exige > 0.
        if (montoPago < 0 || (montoPago === 0 && tipoOperacion !== 'cortesia')) {
          const e = new Error('Cada pago debe tener monto mayor a 0'); e.status = 400; throw e;
        }
        const exigeCuenta = metodo.tipo === 'qr' || metodo.tipo === 'transferencia';
        if (exigeCuenta && !p.cuenta_destino_id) {
          const e = new Error(`El método ${metodo.nombre} exige seleccionar una cuenta destino.`);
          e.status = 400; e.code = 'CUENTA_REQUERIDA'; throw e;
        }
        let responsableSnapshot = null;
        if (p.cuenta_destino_id) {
          const { rows: cta } = await client.query(
            'SELECT id, activo FROM conta_cuentas_destino WHERE id = $1', [p.cuenta_destino_id]
          );
          if (!cta.length) { const e = new Error('Cuenta destino inexistente'); e.status = 400; throw e; }
          const { rows: resp } = await client.query(
            `SELECT usuario_id FROM conta_cuenta_responsable_historial
              WHERE cuenta_id = $1 AND hasta IS NULL LIMIT 1`,
            [p.cuenta_destino_id]
          );
          responsableSnapshot = resp.length ? resp[0].usuario_id : null;
        }
        sumaPagos = round2(sumaPagos + montoPago);
        pagosPreparados.push({ ...p, metodo, montoPago, responsableSnapshot });
      }
      if (Math.abs(sumaPagos - totalFinal) > 0.02) {
        const e = new Error(`Los pagos (${sumaPagos}) no cuadran con el total de la venta (${totalFinal}).`);
        e.status = 400; e.code = 'PAGOS_NO_CUADRAN'; throw e;
      }

      // --- Numeración fiscal: SOLO las ventas FACTURADAS consumen dosificación ---
      // El incremento es ATÓMICO (SELECT ... FOR UPDATE dentro de la transacción
      // que abrió withTx): dos ventas simultáneas nunca reciben el mismo número.
      let reserva = null;
      if (esFacturado) {
        reserva = await reservarNumeroFactura(client, {
          sucursal_id: sucursalId, tipo_factura: tipoFactura,
        });
        if (!reserva) {
          const e = new Error(`No hay una dosificación activa con rango disponible para '${tipoFactura}'. ` +
            'Configure o active una dosificación antes de facturar.');
          e.status = 409; e.code = 'SIN_DOSIFICACION'; throw e;
        }
      }
      const numFactura = reserva ? reserva.numero_factura : null;
      // tipo_factura_snapshot: 'sin_factura' cuando la venta no se factura.
      const tipoFacturaSnapshot = esFacturado ? tipoFactura : 'sin_factura';
      // IVA "de cabecera" (referencia del modo/tasa por defecto aplicado).
      // La tasa sale de la clave fiscal canónica (`iva_pct_default`), con la
      // clave legacy como respaldo: así el snapshot de cabecera coincide con el
      // de las líneas cuando el supervisor cambia la alícuota.
      const ivaModoVenta = esFacturado
        ? String(valorConfig(configMap, 'iva_modo_default', 'incluido')) : 'no_aplica';
      const ivaPctVenta = esFacturado
        ? resolverIvaPorcentaje(null, configMap, ivaModoVenta) : 0;

      // --- INSERT VENTA (con TODOS los snapshots fiscales) ---
      const { rows: ventaRows } = await client.query(
        `INSERT INTO conta_ventas
           (uuid_global, sucursal_id, sesion_caja_id, cajero_id, subtotal, descuento, base_imponible, iva_total,
            propina, total_final, moneda, estado, notas, tipo_factura, nit_cliente,
            razon_social_cliente, cajero_nombre_snapshot, iva_modo_default_snapshot,
            descuento_autorizado_por, promociones_aplicadas,
            tipo_operacion, regimen_aplicado, iva_modo_aplicado, iva_pct_aplicado,
            it_pct_aplicado, it_total, iue_pct_aplicado, iue_retenido, itf_total,
            base_imponible_iva, base_imponible_it,
            nit_cliente_snapshot, razon_social_cliente_snapshot, tipo_factura_snapshot,
            numero_factura, cuf, cuis, cun, dosificacion_id, siat_estado, libro_ventas_incluido)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pagada',$12,$13,$14,$15,$16,$17,$18,$19::jsonb,
                 $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)
         RETURNING *`,
        [
          uuid(), sucursalId, sesionId, cajero.id, subtotal, descuentoAplicado, baseImponible, ivaTotal,
          propinaMonto, totalFinal, body.moneda || 'BOB', body.notas || null, tipoFacturaSnapshot,
          nitCliente, razonSocial, nombreSnapshot(cajero),
          String(valorConfig(configMap, 'iva_modo_default', 'incluido')),
          autorizadorDescuento ? autorizadorDescuento.id : null,
          promoRes.aplicadas.length ? JSON.stringify(promoRes.aplicadas) : null,
          // --- snapshot fiscal ---
          tipoOperacion, regimen, ivaModoVenta, ivaPctVenta,
          tipoOperacion === 'cortesia' ? 0 : itPct, totales.it_total,
          totales.iue_pct_aplicado, totales.iue_retenido, totales.itf_total,
          totales.base_imponible_iva, totales.base_imponible_it,
          nitCliente, razonSocial, tipoFacturaSnapshot,
          numFactura,
          reserva ? reserva.cuf : null, reserva ? reserva.cuis : null, reserva ? reserva.cun : null,
          reserva ? reserva.dosificacion.id : null,
          esFacturado ? 'pendiente' : 'no_aplica',
          esFacturado,
        ]
      );
      const venta = ventaRows[0];
      // Referencia no fiscal para mensajes internos (movimientos, asientos).
      const refVenta = numFactura || `V-${String(venta.id).padStart(6, '0')}`;

      // --- INSERT LÍNEAS (con snapshots fiscales por línea) ---
      const idsLineas = [];
      for (const l of lineasCalc) {
        const padreId = l.combo_padre_idx != null ? idsLineas[l.combo_padre_idx] : null;
        const { rows } = await client.query(
          `INSERT INTO conta_venta_items
             (venta_id, producto_id, combo_id, cantidad, precio_unitario, descuento, subtotal,
              iva_modo_aplicado, iva_porcentaje_aplicado, iva_linea, base_imponible_linea,
              es_componente_combo, combo_padre_id, nombre_snapshot,
              tipo_operacion_snapshot, iva_pct_aplicado, it_pct_aplicado, it_linea,
              precio_base, precio_final, producto_tipo_snapshot)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                   $15,$16,$17,$18,$19,$20,$21) RETURNING id`,
          [
            venta.id, l.producto_id, l.combo_id, l.cantidad, l.precio_unitario, l.descuento,
            l.total, l.iva_modo_aplicado, l.iva_pct_aplicado, l.iva_linea, l.base_imponible,
            l.es_componente_combo, padreId, l.nombre_snapshot,
            l.tipo_operacion_snapshot, l.iva_pct_aplicado, l.it_pct_aplicado, l.it_linea,
            l.precio_base, l.precio_final, l.categoria || null,
          ]
        );
        idsLineas.push(rows[0].id);
      }

      // --- INSERT PAGOS + movimientos de caja ---
      const pagosCreados = [];
      for (const p of pagosPreparados) {
        const { rows } = await client.query(
          `INSERT INTO conta_pagos
             (venta_id, metodo_pago_id, monto, cuenta_destino_id, cuenta_responsable_id_snapshot,
              referencia_qr, estado_confirmacion, confirmado_por, confirmado_en)
           VALUES ($1,$2,$3,$4,$5,$6,'confirmado',$7, now()) RETURNING *`,
          [venta.id, p.metodo.id, p.montoPago, p.cuenta_destino_id || null, p.responsableSnapshot,
           p.referencia_qr || null, cajero.id]
        );
        pagosCreados.push(rows[0]);
        if (sesionId) {
          await client.query(
            `INSERT INTO conta_movimientos_caja (sesion_caja_id, sucursal_id, tipo, monto, motivo, venta_id, creado_por)
             VALUES ($1,$2,'venta',$3,$4,$5,$6)`,
            [sesionId, sucursalId, p.montoPago, `Venta ${refVenta} (${p.metodo.nombre})`, venta.id, cajero.id]
          );
        }
      }

      // --- PROPINA ---
      let propinaCreada = null;
      let distribucionPropina = [];
      if (propinaMonto > 0) {
        if (!valorConfig(configMap, 'propina_habilitada', true)) {
          const e = new Error('Las propinas están deshabilitadas en la configuración.'); e.status = 400; throw e;
        }
        const modoConfig = String(valorConfig(configMap, 'propina_modo', 'acumulada'));
        const modo = modoConfig === 'mixta'
          ? (body.propina?.modo === 'inmediata' ? 'inmediata' : 'acumulada')
          : modoConfig;
        const metodoPropina = body.propina?.metodo || 'efectivo';

        const { rows: pr } = await client.query(
          `INSERT INTO conta_propinas (venta_id, sesion_caja_id, monto, metodo, modo, detalle, estado, creado_por)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
          [venta.id, sesionId, propinaMonto, metodoPropina, modo,
           JSON.stringify({ propina_distribucion: valorConfig(configMap, 'propina_distribucion', 'por_cajero'),
                            cajero: nombreSnapshot(cajero) }),
           modo === 'inmediata' ? 'pagada' : 'distribuida', cajero.id]
        );
        propinaCreada = pr[0];

        // Beneficiarios: pilotos/karts de la venta (si la distribución es por_kart).
        const usuariosTicket = (Array.isArray(body.tickets) ? body.tickets : [])
          .map((t) => Number(t.usuario_id)).filter(Boolean);
        distribucionPropina = await calcularDistribucionPropina(client, {
          modo: String(valorConfig(configMap, 'propina_distribucion', 'por_cajero')),
          monto: propinaMonto, cajero, usuariosTicket,
          pesos: valorConfig(configMap, 'propina_distribucion_pesos', null),
        });
        for (const d of distribucionPropina) {
          await client.query(
            `INSERT INTO conta_propina_distribucion (propina_id, usuario_id, rol, monto, estado, pagado_en, pagado_por)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [d.propina_id || propinaCreada.id, d.usuario_id, d.rol, d.monto,
             modo === 'inmediata' ? 'pagada' : 'pendiente',
             modo === 'inmediata' ? new Date() : null,
             modo === 'inmediata' ? cajero.id : null]
          );
        }
        if (sesionId) {
          await client.query(
            `INSERT INTO conta_movimientos_caja (sesion_caja_id, sucursal_id, tipo, monto, motivo, propina_id, creado_por)
             VALUES ($1,$2,'propina',$3,$4,$5,$6)`,
            [sesionId, sucursalId, propinaMonto, `Propina venta ${refVenta} (${modo})`, propinaCreada.id, cajero.id]
          );
        }
        await auditar(client, {
          usuario_id: cajero.id, accion: 'crear', entidad: 'propina', entidad_id: propinaCreada.id,
          datos_despues: propinaCreada, ip,
        });
      }

      // --- TICKETS (generar / enlazar / enriquecer) ---
      const tickets = Array.isArray(body.tickets) ? body.tickets : [];
      const ticketsResultado = [];
      const primerPago = pagosPreparados[0];
      for (const t of tickets) {
        let fila = null;
        if (t.ticket_id) {
          const { rows: ex } = await client.query('SELECT * FROM tickets WHERE id = $1', [t.ticket_id]);
          if (!ex.length) { const e = new Error(`Ticket ${t.ticket_id} no existe`); e.status = 400; throw e; }
          fila = ex[0];
        } else if (t.usuario_id) {
          // El ecosistema garantiza UN ticket por (usuario_id, evento_id)
          // (constraint uniq_tickets_usuario_evento). Si el piloto ya tiene
          // ticket para ese evento se REUTILIZA y se enriquece (misma lógica de
          // deduplicación que usa el servicio de sync), en lugar de fallar.
          const eventoId = t.evento_id || null;
          if (eventoId) {
            const { rows: prev } = await client.query(
              'SELECT * FROM tickets WHERE usuario_id = $1 AND evento_id = $2 LIMIT 1',
              [t.usuario_id, eventoId]
            );
            if (prev.length) fila = prev[0];
          }
          if (!fila) {
            const { rows } = await client.query(
              `INSERT INTO tickets (uuid_global, usuario_id, evento_id, estado, pagado_en)
               VALUES ($1,$2,$3,'ASIGNADO', now())
               RETURNING *`,
              [uuid(), t.usuario_id, eventoId]
            );
            fila = rows[0];
          }
        } else {
          continue;
        }
        const nuevoEstado = fila.estado === 'PENDIENTE' ? 'ASIGNADO' : fila.estado;
        const productoId = t.producto_id
          || (body.tickets?.find?.((x) => x.ticket_id === fila.id)?.producto_id) || null;
        // --- Snapshots operativos del ticket (migración 0020) -----------------
        // El ticket debe quedar AUTO-CONTENIDO: si mañana cambia el nombre del
        // piloto, del evento, del producto o se reasigna el kart, el ticket
        // histórico sigue mostrando lo que realmente se vendió e imprimió.
        const lineaProd = productoId
          ? lineas.find((l) => Number(l.producto_id) === Number(productoId)) : null;
        const { rows: ctxOp } = await client.query(
          `SELECT u.nombre, u.apellido, u.carnet,
                  e.nombre AS evento_nombre, e.modo AS evento_modo,
                  k.numero AS kart_numero, k.transponder AS transponder_codigo
             FROM usuarios u
             LEFT JOIN eventos e ON e.id = $2::int
             LEFT JOIN karts k ON k.id = $3::int
            WHERE u.id = $1`,
          [fila.usuario_id, fila.evento_id, fila.kart_id]
        );
        const op = ctxOp[0] || {};
        const promo = promoRes.aplicadas[0] || null;
        const pilotoNombre = (op.nombre || op.apellido)
          ? `${op.nombre || ''} ${op.apellido || ''}`.trim() : null;
        const { rows: upd } = await client.query(
          `UPDATE tickets
              SET venta_id = $1, sesion_caja_id = $2, cajero_id = $3, cajero_nombre_snapshot = $4,
                  metodo_pago_id = $5, cuenta_destino_id = $6, hora_venta = now(), producto_id = $7,
                  numero_factura = $8, nit_cliente = $9, razon_social_cliente = $10,
                  estado = $11, pagado_en = COALESCE(pagado_en, now()),
                  tipo_operacion = $12, cuf = $13, iva_modo_aplicado = $14, iva_pct_aplicado = $15,
                  cajero_carnet_snapshot = $16, sucursal_id = $17,
                  cantidad_vueltas = $18, duracion_min = $19,
                  promocion_id = $20, tipo_promocion = $21, promocion_nombre_snapshot = $22,
                  promocion_descuento = $23, promociones_aplicadas = $24::jsonb,
                  piloto_nombre_snapshot = $25, piloto_carnet_snapshot = $26,
                  evento_nombre_snapshot = $27, modo_carrera_snapshot = $28,
                  kart_numero_snapshot = $29, transponder_codigo_snapshot = $30
            WHERE id = $31
            RETURNING id, uuid_global, numero, estado, evento_id, usuario_id, venta_id,
                      sesion_caja_id, cajero_id, cajero_nombre_snapshot, cajero_carnet_snapshot,
                      hora_venta, metodo_pago_id, cuenta_destino_id, producto_id, numero_factura,
                      nit_cliente, razon_social_cliente, pagado_en,
                      tipo_operacion, cuf, iva_modo_aplicado, iva_pct_aplicado,
                      cantidad_vueltas, duracion_min, promocion_id, tipo_promocion,
                      promocion_nombre_snapshot, promocion_descuento, promociones_aplicadas,
                      sucursal_id, piloto_nombre_snapshot, piloto_carnet_snapshot,
                      evento_nombre_snapshot, modo_carrera_snapshot,
                      kart_numero_snapshot, transponder_codigo_snapshot,
                      impreso_en, veces_impreso`,
          [venta.id, sesionId, cajero.id, nombreSnapshot(cajero),
           primerPago ? primerPago.metodo.id : null,
           primerPago ? (primerPago.cuenta_destino_id || null) : null,
           productoId, numFactura, esFacturado ? nitCliente : null, esFacturado ? razonSocial : null,
           nuevoEstado,
           // Datos fiscales (v3): solo se imprimen si la venta es facturada.
           tipoOperacion, reserva ? reserva.cuf : null, ivaModoVenta, ivaPctVenta,
           // Datos operativos (v3.1 / migración 0020).
           cajero.carnet || null, sucursalId,
           lineaProd ? (lineaProd.vueltas ?? null) : null,
           lineaProd ? (lineaProd.duracion_min ?? null) : null,
           promo ? promo.promocion_id : null,
           promo ? promo.tipo : null,
           promo ? promo.nombre : null,
           promoRes.descuento > 0 ? promoRes.descuento : 0,
           promoRes.aplicadas.length ? JSON.stringify(promoRes.aplicadas) : null,
           pilotoNombre, op.carnet || null,
           op.evento_nombre || null, op.evento_modo || null,
           op.kart_numero != null ? String(op.kart_numero) : null,
           op.transponder_codigo || null,
           fila.id]
        );
        ticketsResultado.push(upd[0]);
      }
      await client.query('UPDATE conta_ventas SET conteo_tickets = $1 WHERE id = $2',
        [ticketsResultado.length, venta.id]);

      // --- LIBRO DE VENTAS (formato SIN) ---
      // Solo las ventas FACTURADAS alimentan el libro fiscal. Las no facturadas
      // quedan con libro_ventas_incluido = false (aparecen en reportes internos,
      // pero NO en el libro que se remite al SIN).
      if (esFacturado) {
        const fechaFactura = fechaISO(new Date(venta.creado_en));
        const [anio, mes] = fechaFactura.split('-').map(Number);
        await client.query(
          `INSERT INTO conta_libro_ventas
             (sucursal_id, periodo_mes, periodo_anio, fecha_factura, numero_factura,
              nit_cliente, razon_social_cliente, importe_total, importe_base_iva, iva_total,
              it_total, tipo_factura, cuf, estado_sin, venta_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (sucursal_id, periodo_anio, periodo_mes, numero_factura) DO NOTHING`,
          [sucursalId, mes, anio, fechaFactura, numFactura, nitCliente, razonSocial,
           totalFinal, totales.base_imponible_iva, totales.iva_total,
           totales.it_total, tipoFactura, reserva ? reserva.cuf : null,
           esFacturado ? 'pendiente' : 'no_aplica', venta.id]
        );
      }

      // --- ALERTA: dosificación por agotarse (>= 90% del rango autorizado) ---
      if (reserva && reserva.porcentaje_consumido >= 90) {
        await crearAlerta(client, {
          tipo: 'dosificacion_por_agotarse',
          severidad: reserva.porcentaje_consumido >= 98 ? 'alta' : 'media',
          mensaje: `La dosificación #${reserva.dosificacion.id} (${reserva.dosificacion.tipo_factura}) ` +
            `consumió el ${round2(reserva.porcentaje_consumido)}% de su rango. ` +
            `Restan ${reserva.restantes} números.`,
          entidad: 'conta_dosificaciones', entidad_id: reserva.dosificacion.id,
          sucursal_id: sucursalId,
          datos: { numero: reserva.numero, rango_hasta: reserva.dosificacion.rango_hasta },
          notificar: false,
        });
      }

      // --- ASIENTO CONTABLE automático (misma transacción que la venta) ---
      // Se pasan los pagos ya normalizados (monto + tipo/nombre del método)
      // porque el motor de asientos no conoce los ids del catálogo.
      await asientoDeVenta(client, {
        venta: { ...venta, numero_factura: numFactura, sucursal_id: sucursalId },
        pagos: pagosCreados.map((p, i) => ({
          monto: p.monto,
          metodo_tipo: pagosPreparados[i].metodo.tipo,
          metodo_nombre: pagosPreparados[i].metodo.nombre,
        })),
        usuario_id: cajero.id,
      });

      // --- AUDITORÍA ---
      await auditar(client, {
        usuario_id: cajero.id, accion: 'crear', entidad: 'venta', entidad_id: venta.id,
        datos_despues: {
          ...venta,
          autorizador_datos_fiscales: autorizadorNit ? autorizadorNit.id : null,
          eximido_nit: !!(faltaNit && autorizadorNit),
          eximido_razon_social: !!(faltaRazon && autorizadorNit),
        },
        ip,
      });
      await auditar(client, {
        usuario_id: cajero.id, accion: 'crear', entidad: 'pago', entidad_id: venta.id,
        datos_despues: { pagos: pagosCreados }, ip,
      });
      // Auditoría de la OPERACIÓN FISCAL (emisión de factura + consumo de
      // dosificación): queda el rastro de qué número y CUF se asignaron.
      if (esFacturado) {
        await auditar(client, {
          usuario_id: cajero.id, accion: 'emitir_factura', entidad: 'conta_libro_ventas',
          entidad_id: venta.id,
          datos_antes: { dosificacion_numero_actual: reserva.numero - 1 },
          datos_despues: {
            dosificacion_id: reserva.dosificacion.id, numero_factura: numFactura, cuf: reserva.cuf,
            nit_cliente: nitCliente, razon_social_cliente: razonSocial, tipo_factura: tipoFactura,
            regimen, tipo_operacion: tipoOperacion,
            base_imponible_iva: totales.base_imponible_iva, iva_total: totales.iva_total,
            it_total: totales.it_total, iue_retenido: totales.iue_retenido,
          },
          ip,
        });
      }

      return {
        venta: {
          ...venta, numero_factura: numFactura, referencia: refVenta,
          promociones_aplicadas: promoRes.aplicadas.length ? promoRes.aplicadas : null,
        },
        fiscal: {
          tipo_operacion: tipoOperacion,
          regimen,
          base_imponible_iva: totales.base_imponible_iva,
          base_imponible_it: totales.base_imponible_it,
          iva_total: totales.iva_total,
          it_total: totales.it_total,
          iue_retenido: totales.iue_retenido,
          itf_total: totales.itf_total,
          numero_factura: numFactura,
          cuf: reserva ? reserva.cuf : null,
          dosificacion_id: reserva ? reserva.dosificacion.id : null,
        },
        items: lineasCalc,
        pagos: pagosCreados,
        propina: propinaCreada,
        propina_distribucion: distribucionPropina,
        tickets: ticketsResultado,
      };
    });
}

// ---------------------------------------------------------------------------
// POST /api/conta/ventas — REGISTRAR VENTA
// Si PostgreSQL no responde, la venta se ENCOLA en el outbox SQLite y se
// reconcilia automáticamente al volver la base (respuesta 202).
// ---------------------------------------------------------------------------
ventasRouter.post('/', requireAuth, requireRole(...PUEDE_VENDER), async (req, res) => {
  const body = req.body || {};
  try {
    const resultado = await registrarVenta({ body, usuario: req.user, ip: ipDe(req) });
    res.status(201).json(resultado);
  } catch (e) {
    if (esErrorDeConexion(e) && disponible()) {
      try {
        const enc = encolar('venta', { body, usuario: req.user, ip: ipDe(req) });
        return res.status(202).json({
          encolado: true,
          outbox_id: enc.id,
          creado_en: enc.creado_en,
          mensaje: 'PostgreSQL no está disponible: la venta quedó en cola y se sincronizará automáticamente.',
        });
      } catch (e2) {
        return res.status(503).json({ error: `Base de datos no disponible y el outbox falló: ${e2.message}` });
      }
    }
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

// ---------------------------------------------------------------------------
// GET /api/conta/ventas — listar
// ---------------------------------------------------------------------------
ventasRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { desde, hasta, cajero_id, sesion_caja_id, estado, q } = req.query;
    const params = [];
    let sql = `
      SELECT v.*,
             NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS cajero_actual,
             (SELECT COUNT(*)::int FROM tickets t WHERE t.venta_id = v.id) AS tickets
        FROM conta_ventas v
        LEFT JOIN usuarios u ON u.id = v.cajero_id
       WHERE 1=1`;
    if (desde) { params.push(desde); sql += ` AND v.creado_en >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); sql += ` AND v.creado_en < ($${params.length}::date + INTERVAL '1 day')`; }
    if (cajero_id) { params.push(cajero_id); sql += ` AND v.cajero_id = $${params.length}`; }
    if (sesion_caja_id) { params.push(sesion_caja_id); sql += ` AND v.sesion_caja_id = $${params.length}`; }
    if (estado === 'anulada') sql += ' AND v.anulada = true';
    if (estado === 'pagada') sql += ' AND v.anulada = false';
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (v.numero_factura ILIKE $${params.length} OR v.nit_cliente ILIKE $${params.length}
                    OR v.razon_social_cliente ILIKE $${params.length})`;
    }
    sql += ' ORDER BY v.creado_en DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map((v) => ({
      ...v,
      subtotal: num(v.subtotal), descuento: num(v.descuento), base_imponible: num(v.base_imponible),
      iva_total: num(v.iva_total), propina: num(v.propina), total_final: num(v.total_final),
      it_total: num(v.it_total), iue_retenido: num(v.iue_retenido), itf_total: num(v.itf_total),
      base_imponible_iva: num(v.base_imponible_iva), base_imponible_it: num(v.base_imponible_it),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/conta/ventas/:id — detalle
// ---------------------------------------------------------------------------
ventasRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT v.*, NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS cajero_actual
         FROM conta_ventas v LEFT JOIN usuarios u ON u.id = v.cajero_id WHERE v.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Venta no encontrada' });
    const { rows: items } = await query(
      `SELECT i.*, p.nombre AS producto_nombre, c.nombre AS combo_nombre
         FROM conta_venta_items i
         LEFT JOIN conta_productos p ON p.id = i.producto_id
         LEFT JOIN conta_combos c ON c.id = i.combo_id
        WHERE i.venta_id = $1 ORDER BY i.id`,
      [req.params.id]
    );
    const { rows: pagos } = await query(
      `SELECT pg.*, mp.nombre AS metodo_nombre, mp.tipo AS metodo_tipo,
              cd.nombre AS cuenta_nombre,
              NULLIF(TRIM(COALESCE(r.nombre,'') || ' ' || COALESCE(r.apellido,'')), '') AS responsable_nombre
         FROM conta_pagos pg
         JOIN conta_metodos_pago mp ON mp.id = pg.metodo_pago_id
         LEFT JOIN conta_cuentas_destino cd ON cd.id = pg.cuenta_destino_id
         LEFT JOIN usuarios r ON r.id = pg.cuenta_responsable_id_snapshot
        WHERE pg.venta_id = $1 ORDER BY pg.id`,
      [req.params.id]
    );
    const { rows: propinas } = await query(
      `SELECT * FROM conta_propinas WHERE venta_id = $1 ORDER BY id DESC`, [req.params.id]
    );
    const { rows: tickets } = await query(
      `SELECT id, numero, estado, uuid_global, hora_venta, numero_factura, nit_cliente, razon_social_cliente,
              cajero_nombre_snapshot, evento_id, usuario_id
         FROM tickets WHERE venta_id = $1 ORDER BY id`,
      [req.params.id]
    );
    const v = rows[0];
    res.json({
      venta: {
        ...v,
        subtotal: num(v.subtotal), descuento: num(v.descuento), base_imponible: num(v.base_imponible),
        iva_total: num(v.iva_total), propina: num(v.propina), total_final: num(v.total_final),
        it_total: num(v.it_total), iue_retenido: num(v.iue_retenido), itf_total: num(v.itf_total),
        base_imponible_iva: num(v.base_imponible_iva), base_imponible_it: num(v.base_imponible_it),
      },
      items: items.map((i) => ({
        ...i, cantidad: num(i.cantidad), precio_unitario: num(i.precio_unitario),
        descuento: num(i.descuento), subtotal: num(i.subtotal),
        iva_porcentaje_aplicado: num(i.iva_porcentaje_aplicado), iva_linea: num(i.iva_linea),
        base_imponible_linea: num(i.base_imponible_linea),
        iva_pct_aplicado: num(i.iva_pct_aplicado), it_pct_aplicado: num(i.it_pct_aplicado),
        it_linea: num(i.it_linea), precio_base: num(i.precio_base), precio_final: num(i.precio_final),
      })),
      pagos: pagos.map((p) => ({ ...p, monto: num(p.monto) })),
      propinas: propinas.map((p) => ({ ...p, monto: num(p.monto) })),
      tickets,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/conta/ventas/:id/anular — venta inmutable, solo se anula
// ---------------------------------------------------------------------------
ventasRouter.post('/:id/anular', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { motivo } = req.body || {};
    if (!motivo) return res.status(400).json({ error: 'El motivo de anulación es obligatorio' });
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_ventas WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Venta no encontrada'); e.status = 404; throw e; }
      if (rows[0].anulada) { const e = new Error('La venta ya está anulada'); e.status = 409; throw e; }
      const venta = rows[0];

      // Inmutabilidad del período: si el mes fiscal ya se cerró, la venta NO se
      // puede anular; la vía correcta es una nota de crédito.
      const [anioV, mesV] = fechaISO(new Date(venta.creado_en)).split('-').map(Number);
      if (await periodoFiscalCerrado(client, {
        sucursal_id: venta.sucursal_id, anio: anioV, mes: mesV,
      })) {
        const e = new Error('El período fiscal está CERRADO: la venta no se puede anular. ' +
          'Emita una nota de crédito.');
        e.status = 409; e.code = 'PERIODO_CERRADO'; throw e;
      }

      const { rows: upd } = await client.query(
        `UPDATE conta_ventas SET anulada = true, estado = 'anulada', motivo_anulacion = $1
          WHERE id = $2 RETURNING *`,
        [motivo, req.params.id]
      );
      // El libro de ventas refleja la anulación (la fila nunca se borra).
      await client.query(
        `UPDATE conta_libro_ventas SET estado_sin = 'anulado' WHERE venta_id = $1`, [req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'anular', entidad: 'venta', entidad_id: req.params.id,
        datos_antes: venta, datos_despues: { ...upd[0], motivo }, ip: ipDe(req),
      });
      if (venta.tipo_operacion === 'facturado') {
        await auditar(client, {
          usuario_id: req.user.id, accion: 'anular_factura', entidad: 'conta_libro_ventas',
          entidad_id: venta.id,
          datos_antes: { numero_factura: venta.numero_factura, cuf: venta.cuf, estado_sin: 'pendiente' },
          datos_despues: { numero_factura: venta.numero_factura, cuf: venta.cuf, estado_sin: 'anulado',
            motivo },
          ip: ipDe(req),
        });
      }
      return upd[0];
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/conta/ventas/:id/nota-credito — alias de conveniencia de
// POST /api/conta/notas-credito con la venta original tomada de la URL.
// Reutiliza EXACTAMENTE el mismo handler (misma validación, mismo PIN, misma
// auditoría), para no duplicar la lógica fiscal de la nota de crédito.
// ---------------------------------------------------------------------------
ventasRouter.post('/:id/nota-credito', requireAuth,
  requireRole('cajero', 'supervisor', 'contador', 'admin'),
  requireSupervisorPin('nota_credito'), async (req, res) => {
    req.body = { ...(req.body || {}), venta_original_id: req.params.id };
    const { emitirNotaCredito } = await import('./notas_credito.js');
    return emitirNotaCredito(req, res);
  });
