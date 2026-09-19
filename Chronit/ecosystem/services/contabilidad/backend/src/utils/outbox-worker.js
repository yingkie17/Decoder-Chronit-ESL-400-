// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: reconciliador del outbox offline
// -----------------------------------------------------------------------------
// Cada OUTBOX_INTERVAL_MS (15 s por defecto) intenta reenviar a PostgreSQL las
// operaciones que quedaron encoladas en SQLite mientras la base no estaba
// disponible. Usa EXACTAMENTE la misma función de negocio que la ruta HTTP
// (`registrarVenta`), así que la venta reconciliada conserva validaciones,
// snapshots y auditoría.
//
// Si la base sigue caída, el ciclo se detiene sin acumular intentos.
// Cada operación corrupta se reintenta hasta OUTBOX_MAX_INTENTOS y luego se
// queda marcada como 'error' para revisión manual.
// =============================================================================
import { pendientes, marcarOk, marcarError, disponible, motivoNoDisponible, estado } from '../db/outbox.js';
import { esErrorDeConexion } from '../db/pool.js';
import { registrarVenta } from '../routes/ventas.js';

const INTERVALO = Number(process.env.OUTBOX_INTERVAL_MS || 15000);
const LOTE = Number(process.env.OUTBOX_LOTE || 20);

let _corriendo = false;

/**
 * Procesa un lote del outbox.
 * Devuelve { procesados, errores, detenido?, motivo? }.
 */
export async function reconciliar({ limite = LOTE } = {}) {
  if (!disponible()) {
    return { procesados: 0, errores: 0, detenido: true, motivo: 'outbox no disponible' };
  }
  let procesados = 0;
  let errores = 0;

  for (const fila of pendientes(limite)) {
    try {
      if (fila.tipo !== 'venta') {
        marcarError(fila.id, `tipo de operación no soportado: ${fila.tipo}`);
        errores++;
        continue;
      }
      const r = await registrarVenta(fila.payload);
      marcarOk(fila.id, `venta_id=${r?.venta?.id ?? '?'} factura=${r?.venta?.numero_factura ?? '?'}`);
      procesados++;
      console.log(`[conta:outbox] reconciliada operación #${fila.id} -> venta ${r?.venta?.id}`);
    } catch (e) {
      if (esErrorDeConexion(e)) {
        // PostgreSQL sigue caída: se corta el ciclo sin penalizar los intentos.
        return { procesados, errores, detenido: true, motivo: 'PostgreSQL aún no disponible' };
      }
      marcarError(fila.id, e.message);
      errores++;
      console.error(`[conta:outbox] operación #${fila.id} falló: ${e.message}`);
    }
  }
  return { procesados, errores };
}

/** Ejecuta un ciclo sin solaparse con el anterior. */
async function ciclo() {
  if (_corriendo) return;
  _corriendo = true;
  try {
    const r = await reconciliar();
    if (r.procesados || r.errores) {
      console.log(`[conta:outbox] ciclo: ${r.procesados} ok, ${r.errores} con error`);
    }
  } catch (e) {
    console.error('[conta:outbox] error en el ciclo:', e.message);
  } finally {
    _corriendo = false;
  }
}

/** Arranca el worker periódico (idempotente). */
export function iniciarWorker() {
  if (process.env.OUTBOX_WORKER === 'false') {
    console.log('[conta:outbox] worker desactivado (OUTBOX_WORKER=false)');
    return null;
  }
  if (!disponible()) {
    console.warn(`[conta:outbox] worker no iniciado: SQLite del outbox no disponible — ${motivoNoDisponible()}`);
    return null;
  }
  console.log(`[conta:outbox] worker activo cada ${INTERVALO} ms`);
  const t = setInterval(ciclo, INTERVALO);
  t.unref?.();
  // Un primer ciclo diferido para no competir con las migraciones de arranque.
  setTimeout(ciclo, 5000).unref?.();
  return t;
}

export { estado as estadoOutbox };
