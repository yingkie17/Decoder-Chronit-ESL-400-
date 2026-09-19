// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: ALERTAS (detección + notificación)
// -----------------------------------------------------------------------------
// Cada alerta se guarda en conta_alertas (historial) y, según
// configuracion.alertas_config.canales, se notifica por:
//   in_app   -> la fila en conta_alertas (el frontend las lista)
//   telegram -> Bot API de Telegram (token + chat_id en la config)
//   email    -> relay HTTP configurado en alertas_config.email_webhook
//               (se envía un POST JSON; permite engancharlo a cualquier
//                proveedor sin añadir dependencias al backend)
//
// El worker evalúa periódicamente los 9 tipos de alerta pedidos:
//   diferencia_caja, descuento_sin_autorizacion, qr_sin_confirmar,
//   caja_abierta, propinas_pendientes, anticipo_vencido,
//   depreciacion_pendiente, siat_rechazado, stock_bajo.
//
// Anti-ruido: no se repite una alerta del mismo tipo/entidad si ya hay una
// sin leer creada en las últimas VENTANA_DEDUPE_HORAS horas.
// =============================================================================
import { num, round2, fechaISO } from './helpers.js';

const VENTANA_DEDUPE_HORAS = Number(process.env.ALERTAS_DEDUPE_HORAS || 12);
const INTERVALO_MS = Number(process.env.ALERTAS_INTERVAL_MS || 300000);

const CONFIG_DEFECTO = {
  canales: ['in_app'],
  telegram_token: null,
  telegram_chat_id: null,
  email_webhook: null,
  diferencia_caja_umbral: 20,
  caja_abierta_horas: 14,
  qr_sin_confirmar_horas: 2,
  propinas_pendientes_dias: 7,
  stock_bajo_unidades: 5,
  anticipo_aviso_dias: 3,
};

/** Configuración de alertas (con valores por defecto si falta alguna clave). */
export async function getConfigAlertas(db) {
  const { rows } = await db.query(
    `SELECT valor FROM conta_configuracion WHERE clave = 'alertas_config'`
  );
  const valor = rows.length ? rows[0].valor : null;
  return { ...CONFIG_DEFECTO, ...(valor && typeof valor === 'object' ? valor : {}) };
}

/**
 * Crea una alerta (con deduplicación) y la notifica por los canales activos.
 * Devuelve la fila creada o null si se deduplicó.
 */
export async function crearAlerta(db, {
  tipo, severidad = 'media', mensaje, entidad = null, entidad_id = null,
  datos = null, sucursal_id = null, notificar = true,
}) {
  const { rows: dup } = await db.query(
    `SELECT id FROM conta_alertas
      WHERE tipo = $1 AND COALESCE(entidad,'') = COALESCE($2,'')
        AND COALESCE(entidad_id::text,'') = COALESCE($3::text,'')
        AND leida = false
        AND creado_en > now() - ($4 || ' hours')::interval
      LIMIT 1`,
    [tipo, entidad, entidad_id == null ? null : String(entidad_id), String(VENTANA_DEDUPE_HORAS)]
  );
  if (dup.length) return null;

  const { rows } = await db.query(
    `INSERT INTO conta_alertas (tipo, severidad, mensaje, entidad, entidad_id, sucursal_id, datos)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
    [tipo, severidad, mensaje, entidad, entidad_id == null ? null : String(entidad_id),
     sucursal_id, datos ? JSON.stringify(datos) : null]
  );
  const alerta = rows[0];
  if (notificar) {
    const cfg = await getConfigAlertas(db);
    await notificarAlerta(db, alerta, cfg).catch(() => { /* la alerta ya quedó registrada */ });
  }
  return alerta;
}

/** Envía la alerta por los canales configurados (nunca lanza). */
export async function notificarAlerta(db, alerta, cfg) {
  const canales = Array.isArray(cfg.canales) ? cfg.canales : ['in_app'];
  // in_app no requiere envío: la fila ya existe. Solo se marca como notificada.
  let enviada = canales.includes('in_app');

  if (canales.includes('telegram') && cfg.telegram_token && cfg.telegram_chat_id) {
    const texto = `🚨 [${String(alerta.severidad).toUpperCase()}] ${alerta.tipo}\n${alerta.mensaje}`;
    const ok = await fetch(
      `https://api.telegram.org/bot${cfg.telegram_token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text: texto }),
      }
    ).then((r) => r.ok).catch(() => false);
    enviada = enviada || ok;
  }

  if (canales.includes('email') && cfg.email_webhook) {
    const ok = await fetch(cfg.email_webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: cfg.email || null,
        subject: `[CHRONIT] Alerta ${alerta.tipo}`,
        text: `${alerta.mensaje}\nSeveridad: ${alerta.severidad}\nEntidad: ${alerta.entidad} #${alerta.entidad_id}`,
        alerta,
      }),
    }).then((r) => r.ok).catch(() => false);
    enviada = enviada || ok;
  }

  if (enviada) {
    await db.query(
      `UPDATE conta_alertas SET notificada = true, notificada_en = now() WHERE id = $1`,
      [alerta.id]
    );
  }
  return enviada;
}

// ---------------------------------------------------------------------------
// DETECCIÓN
// ---------------------------------------------------------------------------

/** Revisa los 9 tipos de alerta. Devuelve cuántas se crearon por tipo. */
export async function evaluarAlertas(db) {
  const cfg = await getConfigAlertas(db);
  const creadas = {};

  const sumar = (tipo) => { creadas[tipo] = (creadas[tipo] || 0) + 1; };

  // 1) diferencia_caja — cierres con diferencia por encima del umbral.
  {
    const { rows } = await db.query(
      `SELECT id, cajero_id, diferencia, sucursal_id
         FROM conta_sesiones_caja
        WHERE estado = 'cerrada' AND COALESCE(diferencia,0) <> 0
          AND ABS(diferencia) > $1
          AND cierre_en > now() - interval '7 days'`,
      [num(cfg.diferencia_caja_umbral)]
    );
    for (const s of rows) {
      const a = await crearAlerta(db, {
        tipo: 'diferencia_caja',
        severidad: Math.abs(num(s.diferencia)) > num(cfg.diferencia_caja_umbral) * 3 ? 'alta' : 'media',
        mensaje: `Diferencia de caja de ${round2(num(s.diferencia))} BOB en la sesión #${s.id}`,
        entidad: 'sesion_caja', entidad_id: s.id, datos: { diferencia: num(s.diferencia) },
        sucursal_id: s.sucursal_id,
      });
      if (a) sumar('diferencia_caja');
    }
  }

  // 2) descuento_sin_autorizacion — descuentos por encima del umbral sin autorizador.
  {
    const { rows: cfgU } = await db.query(
      `SELECT valor FROM conta_configuracion WHERE clave = 'umbral_descuento_supervisor'`
    );
    const umbral = cfgU.length ? num(cfgU[0].valor, 50) : 50;
    const { rows } = await db.query(
      `SELECT id, descuento, cajero_id, sucursal_id, numero_factura
         FROM conta_ventas
        WHERE anulada = false AND descuento > $1 AND descuento_autorizado_por IS NULL
          AND creado_en > now() - interval '7 days'`,
      [umbral]
    );
    for (const v of rows) {
      const a = await crearAlerta(db, {
        tipo: 'descuento_sin_autorizacion', severidad: 'alta',
        mensaje: `Venta ${v.numero_factura || v.id} con descuento ${round2(num(v.descuento))} sin autorizador registrado`,
        entidad: 'venta', entidad_id: v.id, datos: { descuento: num(v.descuento) },
        sucursal_id: v.sucursal_id,
      });
      if (a) sumar('descuento_sin_autorizacion');
    }
  }

  // 3) qr_sin_confirmar — pagos QR/transferencia pendientes de confirmar.
  {
    const { rows } = await db.query(
      `SELECT pg.id, pg.monto, v.sucursal_id, v.numero_factura
         FROM conta_pagos pg
         JOIN conta_ventas v ON v.id = pg.venta_id
         JOIN conta_metodos_pago mp ON mp.id = pg.metodo_pago_id
        WHERE pg.estado_confirmacion = 'pendiente'
          AND mp.tipo IN ('qr','transferencia')
          AND pg.creado_en < now() - ($1 || ' hours')::interval`,
      [String(num(cfg.qr_sin_confirmar_horas, 2))]
    );
    for (const p of rows) {
      const a = await crearAlerta(db, {
        tipo: 'qr_sin_confirmar', severidad: 'alta',
        mensaje: `Pago QR de ${round2(num(p.monto))} BOB sin confirmar (venta ${p.numero_factura || '?'})`,
        entidad: 'pago', entidad_id: p.id, datos: { monto: num(p.monto) },
        sucursal_id: p.sucursal_id,
      });
      if (a) sumar('qr_sin_confirmar');
    }
  }

  // 4) caja_abierta — sesiones abiertas demasiado tiempo.
  {
    const { rows } = await db.query(
      `SELECT id, cajero_id, apertura_en, sucursal_id,
              ROUND(EXTRACT(EPOCH FROM (now() - apertura_en)) / 3600, 1) AS horas
         FROM conta_sesiones_caja
        WHERE estado = 'abierta'
          AND apertura_en < now() - ($1 || ' hours')::interval`,
      [String(num(cfg.caja_abierta_horas, 14))]
    );
    for (const s of rows) {
      const a = await crearAlerta(db, {
        tipo: 'caja_abierta', severidad: 'media',
        mensaje: `Caja #${s.id} abierta hace ${s.horas} h sin cerrar`,
        entidad: 'sesion_caja', entidad_id: s.id, datos: { horas: num(s.horas) },
        sucursal_id: s.sucursal_id,
      });
      if (a) sumar('caja_abierta');
    }
  }

  // 5) propinas_pendientes — distribuciones pendientes de pago.
  {
    const { rows } = await db.query(
      `SELECT pd.usuario_id, MIN(pd.id) AS id, SUM(pd.monto) AS total,
              MIN(p.creado_en) AS desde, MIN(p.sucursal_id) AS sucursal_id
         FROM conta_propina_distribucion pd
         JOIN conta_propinas p ON p.id = pd.propina_id
        WHERE pd.estado = 'pendiente'
        GROUP BY pd.usuario_id
       HAVING MIN(p.creado_en) < now() - ($1 || ' days')::interval`,
      [String(num(cfg.propinas_pendientes_dias, 7))]
    );
    for (const r of rows) {
      const a = await crearAlerta(db, {
        tipo: 'propinas_pendientes', severidad: 'baja',
        mensaje: `Propinas pendientes de pago a usuario #${r.usuario_id}: ${round2(num(r.total))} BOB`,
        entidad: 'propina_distribucion', entidad_id: r.id,
        datos: { usuario_id: r.usuario_id, total: num(r.total) },
        sucursal_id: r.sucursal_id,
      });
      if (a) sumar('propinas_pendientes');
    }
  }

  // 6) anticipo_vencido — anticipos vencidos (o por vencer) sin aplicar.
  {
    const { rows } = await db.query(
      `SELECT id, cliente_nombre, monto, estado, vencimiento, sucursal_id
         FROM conta_anticipos
        WHERE estado = 'pendiente' AND vencimiento IS NOT NULL
          AND vencimiento <= CURRENT_DATE + ($1 || ' days')::interval`,
      [String(num(cfg.anticipo_aviso_dias, 3))]
    );
    for (const r of rows) {
      const vencido = r.vencimiento < fechaISO();
      const a = await crearAlerta(db, {
        tipo: 'anticipo_vencido', severidad: vencido ? 'alta' : 'media',
        mensaje: `Anticipo de ${r.cliente_nombre || 'cliente'} (${round2(num(r.monto))} BOB) ` +
                 (vencido ? `vencido el ${fechaISO(r.vencimiento)}` : `vence el ${fechaISO(r.vencimiento)}`),
        entidad: 'anticipo', entidad_id: r.id, datos: { monto: num(r.monto) },
        sucursal_id: r.sucursal_id,
      });
      if (a) sumar('anticipo_vencido');
    }
    // Se marcan como vencidos los que ya pasaron la fecha.
    await db.query(
      `UPDATE conta_anticipos SET estado = 'vencido'
        WHERE estado = 'pendiente' AND vencimiento IS NOT NULL AND vencimiento < CURRENT_DATE`
    );
  }

  // 7) depreciacion_pendiente — activos sin depreciar en el mes anterior.
  {
    const { rows } = await db.query(
      `SELECT a.id, a.nombre, a.sucursal_id
         FROM conta_activos_fijos a
        WHERE a.estado = 'activo'
          AND NOT EXISTS (
            SELECT 1 FROM conta_depreciaciones d
             WHERE d.activo_id = a.id
               AND d.periodo = to_char((CURRENT_DATE - interval '1 month'), 'YYYY-MM')
          )`
    );
    for (const a of rows) {
      const al = await crearAlerta(db, {
        tipo: 'depreciacion_pendiente', severidad: 'baja',
        mensaje: `Activo "${a.nombre}" sin depreciación registrada del mes anterior`,
        entidad: 'activo_fijo', entidad_id: a.id, sucursal_id: a.sucursal_id,
      });
      if (al) sumar('depreciacion_pendiente');
    }
  }

  // 8) siat_rechazado — facturas rechazadas por el SIN (cuando se active).
  {
    const { rows } = await db.query(
      `SELECT id, numero_factura, siat_mensaje, sucursal_id
         FROM conta_ventas WHERE siat_estado = 'rechazado'`
    );
    for (const v of rows) {
      const a = await crearAlerta(db, {
        tipo: 'siat_rechazado', severidad: 'critica',
        mensaje: `Factura ${v.numero_factura || v.id} rechazada por el SIN: ${v.siat_mensaje || 'sin detalle'}`,
        entidad: 'venta', entidad_id: v.id, sucursal_id: v.sucursal_id,
      });
      if (a) sumar('siat_rechazado');
    }
  }

  // 9) stock_bajo — productos por debajo del stock mínimo.
  {
    const { rows } = await db.query(
      `SELECT id, nombre, stock_actual, stock_minimo, sucursal_id
         FROM conta_productos
        WHERE activo = true AND stock_actual <= GREATEST(stock_minimo, $1)`,
      [num(cfg.stock_bajo_unidades, 5)]
    );
    for (const p of rows) {
      const a = await crearAlerta(db, {
        tipo: 'stock_bajo', severidad: 'baja',
        mensaje: `Stock bajo de "${p.nombre}": ${round2(num(p.stock_actual))} unidades`,
        entidad: 'producto', entidad_id: p.id, datos: { stock: num(p.stock_actual) },
        sucursal_id: p.sucursal_id,
      });
      if (a) sumar('stock_bajo');
    }
  }

  return creadas;
}

let _corriendo = false;

async function ciclo(db) {
  if (_corriendo) return;
  _corriendo = true;
  try {
    const creadas = await evaluarAlertas(db);
    const total = Object.values(creadas).reduce((a, n) => a + n, 0);
    if (total) console.log(`[conta:alertas] ${total} alerta(s):`, creadas);
  } catch (e) {
    console.error('[conta:alertas] error en el ciclo:', e.message);
  } finally {
    _corriendo = false;
  }
}

/** Arranca el worker periódico de alertas (idempotente). */
export function iniciarWorkerAlertas(db) {
  if (process.env.ALERTAS_WORKER === 'false') {
    console.log('[conta:alertas] worker desactivado (ALERTAS_WORKER=false)');
    return null;
  }
  console.log(`[conta:alertas] worker activo cada ${INTERVALO_MS} ms`);
  const t = setInterval(() => ciclo(db), INTERVALO_MS);
  t.unref?.();
  // Primer ciclo diferido: no compite con migraciones ni con el arranque.
  setTimeout(() => ciclo(db), 20000).unref?.();
  return t;
}
