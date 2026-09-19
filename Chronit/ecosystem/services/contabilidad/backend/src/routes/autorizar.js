// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: AUTORIZACIÓN RÁPIDA con PIN de supervisor
// -----------------------------------------------------------------------------
//   POST /api/conta/autorizar   { pin, accion, contexto }
//
// El cajero NO cierra sesión: el supervisor teclea su PIN (4-6 dígitos) y la
// operación sensible queda autorizada y AUDITADA.
//
//   GET  /api/conta/autorizar/estado   -> ¿el PIN está habilitado? ¿bloqueado?
//
// Acciones cubiertas (middleware requireSupervisorPin en las rutas):
//   descuentos > umbral, egresos > umbral, anulaciones, reaperturas de caja,
//   notas de crédito y cambios de configuración.
//
// Auditoría obligatoria: quién autoriza, cuándo y para qué (contexto).
// =============================================================================
import { Router } from 'express';
import { db } from '../db/pool.js';
import { requireAuth, esSupervisorPlus } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { verificarPin, pinHabilitado } from '../middleware/pin.js';

export const autorizarRouter = Router();

// Acciones que el POS/backend puede pedir autorizar. Es una lista abierta
// (se acepta cualquier acción no vacía) pero estas son las conocidas.
export const ACCIONES_AUTORIZABLES = [
  'descuento', 'egreso', 'anulacion', 'reapertura', 'nota_credito',
  'cambio_config', 'propina_anulacion', 'eximir_nit', 'precio_especial',
  'apertura_caja', 'otro',
];

autorizarRouter.get('/estado', requireAuth, (req, res) => {
  const supervisor = esSupervisorPlus(req.user?.rol);
  res.json({
    pin_habilitado: pinHabilitado(),
    // Un supervisor+ no necesita PIN: autoriza con su propio rol.
    requiere_pin: !supervisor,
    rol: req.user?.rol || null,
    acciones: ACCIONES_AUTORIZABLES,
  });
});

autorizarRouter.post('/', requireAuth, async (req, res) => {
  try {
    const { pin, accion, contexto } = req.body || {};
    const accionFinal = String(accion || 'otro').trim() || 'otro';

    // Un supervisor+ autoriza por rol, sin PIN.
    if (esSupervisorPlus(req.user.rol)) {
      await auditar(null, {
        usuario_id: req.user.id, accion: 'autorizar', entidad: 'autorizacion_rol',
        entidad_id: accionFinal,
        datos_despues: { accion: accionFinal, autorizado_por_rol: req.user.rol, contexto: contexto || null },
        ip: ipDe(req),
      });
      return res.json({
        autorizado: true, por: 'rol', accion: accionFinal,
        autorizador: { id: req.user.id, rol: req.user.rol },
      });
    }

    if (!pinHabilitado()) {
      return res.status(503).json({ error: 'La autorización por PIN está deshabilitada', code: 'PIN_DESHABILITADO' });
    }

    const aut = await verificarPin(db, { pin });
    if (!aut) {
      return res.status(403).json({
        error: 'PIN inválido o sin permiso de supervisor', code: 'PIN_INVALIDO',
      });
    }

    await auditar(null, {
      usuario_id: aut.usuario_id, accion: 'autorizar', entidad: 'autorizacion_pin',
      entidad_id: accionFinal,
      datos_despues: {
        accion: accionFinal, autorizado_por: aut.usuario_id, autorizado_por_carnet: aut.carnet,
        solicitado_por: req.user.id, contexto: contexto || null,
        ruta: `${req.method} ${req.originalUrl}`,
      },
      ip: ipDe(req),
    });

    res.json({
      autorizado: true, por: 'pin', accion: accionFinal,
      autorizador: {
        id: aut.usuario_id, nombre: aut.nombre, apellido: aut.apellido,
        carnet: aut.carnet, rol: aut.rol,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
