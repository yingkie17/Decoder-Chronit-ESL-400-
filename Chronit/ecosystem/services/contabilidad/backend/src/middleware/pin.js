// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: PIN de SUPERVISOR (autorización rápida)
// -----------------------------------------------------------------------------
// El cajero no cierra su sesión para autorizar una operación sensible: el
// supervisor teclea su PIN (4-6 dígitos) en el POS.
//
//   POST /api/conta/autorizar   { pin, accion, contexto }
//
// El middleware `requireSupervisorPin(accion)` protege:
//   descuentos > umbral, egresos > umbral, anulaciones, reaperturas de caja,
//   notas de crédito y cambios de configuración.
//
// Reglas:
//   * Si quien pide ya es supervisor+ (o admin/desarrollador) NO necesita PIN.
//   * Si no, se exige `pin` en el body (o cabecera `x-supervisor-pin`).
//   * El PIN se compara con bcrypt contra conta_supervisor_pins (activo = true).
//   * TODA autorización queda auditada: quién, cuándo y para qué.
//   * Tras varios fallos seguidos de un mismo usuario se bloquea un rato.
// =============================================================================
import bcrypt from 'bcryptjs';
import { query, db } from '../db/pool.js';
import { esSupervisorPlus } from './auth.js';

const MAX_FALLOS = Number(process.env.PIN_MAX_FALLOS || 5);
const BLOQUEO_MS = Number(process.env.PIN_BLOQUEO_MS || 120000);

// Control de intentos fallidos en memoria: usuario_id -> { fallos, hasta }
const intentos = new Map();

export function pinHabilitado() {
  return process.env.PIN_SUPERVISOR !== 'false';
}

function bloqueado(usuarioId) {
  const r = intentos.get(usuarioId);
  if (!r) return 0;
  if (r.hasta && r.hasta > Date.now()) return Math.ceil((r.hasta - Date.now()) / 1000);
  if (r.hasta && r.hasta <= Date.now()) intentos.delete(usuarioId);
  return 0;
}

function registrarFallo(usuarioId) {
  const r = intentos.get(usuarioId) || { fallos: 0, hasta: 0 };
  r.fallos += 1;
  if (r.fallos >= MAX_FALLOS) { r.hasta = Date.now() + BLOQUEO_MS; r.fallos = 0; }
  intentos.set(usuarioId, r);
}

/** Limpia el contador de intentos tras una autorización correcta. */
export function limpiarIntentos(usuarioId) {
  intentos.delete(usuarioId);
}

/**
 * Verifica un PIN contra los PIN activos de supervisores.
 * Devuelve el usuario autorizador, o null.
 * `usuarioId` limita la comprobación a ese supervisor (opcional).
 */
export async function verificarPin(db, { pin, usuario_id = null }) {
  if (!pinHabilitado()) return null;
  const limpio = String(pin || '').trim();
  if (!/^\d{4,6}$/.test(limpio)) return null;

  const params = [];
  let sql = `
    SELECT sp.id, sp.pin_hash, u.id AS usuario_id, u.nombre, u.apellido, u.carnet, u.rol
      FROM conta_supervisor_pins sp
      JOIN usuarios u ON u.id = sp.usuario_id
     WHERE sp.activo = true AND COALESCE(u.bloqueado, false) = false`;
  if (usuario_id) { params.push(usuario_id); sql += ` AND sp.usuario_id = $${params.length}`; }

  const { rows } = await db.query(sql, params);
  for (const r of rows) {
    if (!esSupervisorPlus(r.rol)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(limpio, r.pin_hash)) return r;
  }
  return null;
}

/**
 * Middleware: exige autorización de supervisor para una acción concreta.
 * Si el usuario ya es supervisor+ pasa directo (se registra como autorizador).
 * Deja `req.autorizador` con el supervisor que autorizó (o el propio usuario).
 */
export function requireSupervisorPin(accion) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'No autenticado' });

      if (esSupervisorPlus(req.user.rol)) {
        req.autorizador = req.user;
        req.autorizacionPor = 'rol';
        return next();
      }

      const espera = bloqueado(req.user.id);
      if (espera) {
        return res.status(429).json({
          error: `Demasiados intentos de PIN. Reintenta en ${espera} s.`, code: 'PIN_BLOQUEADO',
        });
      }

      const pin = req.body?.pin ?? req.headers['x-supervisor-pin'];
      const aut = await verificarPin(db, { pin });
      if (!aut) {
        registrarFallo(req.user.id);
        return res.status(403).json({
          error: 'Se requiere el PIN de un supervisor para autorizar esta acción.',
          code: 'REQUIERE_PIN_SUPERVISOR',
        });
      }
      limpiarIntentos(req.user.id);
      req.autorizador = aut;
      req.autorizacionPor = 'pin';
      // Auditoría obligatoria de la autorización (quién autoriza y para qué).
      await query(
        `INSERT INTO conta_auditoria (usuario_id, accion, entidad, entidad_id, datos_despues, ip)
         VALUES ($1,'autorizar','autorizacion_pin',$2,$3::jsonb,$4)`,
        [aut.usuario_id, String(req.user.id),
         JSON.stringify({
           accion, autorizado_por: aut.usuario_id, autorizado_por_carnet: aut.carnet,
           solicitado_por: req.user.id, contexto: req.body?.contexto || null,
           ruta: `${req.method} ${req.originalUrl}`,
         }),
         req.ip || null]
      );
      return next();
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  };
}
