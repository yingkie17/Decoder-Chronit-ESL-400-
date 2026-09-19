-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0003: Unificar estados de Tickets
-- -----------------------------------------------------------------------------
-- El flujo del PROMPT MAESTRO define UNA sola máquina de estados para el ticket:
--
--      PENDIENTE -> ASIGNADO -> LLAMANDO -> PREPARADO -> ACTIVO -> FINALIZADO
--
--   * PENDIENTE : ticket generado, a la espera de pago       (antes pendiente_pago)
--   * ASIGNADO  : ticket pagado y listo para correr          (antes pagado / asignado)
--   * LLAMANDO  : llamado a vestidores                       (se deriva de cola 'llamado')
--   * PREPARADO : listo para competir (Ready)                (se deriva de cola 'ready')
--   * ACTIVO    : en pista compitiendo                       (antes en_pista)
--   * FINALIZADO: carrera terminada, no reasignable          (antes finalizado)
--
-- La tabla `colas` conserva su estado operativo de vestidor (espera|llamado|ready)
-- porque la pantalla pública y las vistas de vestidores lo consultan por su clave
-- específica. El ticket es la fuente de verdad del ciclo de vida.
--
-- Esta migración renombra los valores históricos; es idempotente porque sólo
-- actúa sobre valores antiguos que ya no se generan en el nuevo código.
-- =============================================================================

-- tickets.estado: renombrar valores históricos al nuevo vocabulario
UPDATE tickets SET estado = 'PENDIENTE'  WHERE estado = 'pendiente_pago';
UPDATE tickets SET estado = 'ASIGNADO'   WHERE estado IN ('pagado', 'asignado');
UPDATE tickets SET estado = 'ACTIVO'     WHERE estado = 'en_pista';
UPDATE tickets SET estado = 'FINALIZADO' WHERE estado = 'finalizado';

-- El estado inicial de un ticket nuevo es PENDIENTE (a la espera de pago).
ALTER TABLE tickets ALTER COLUMN estado SET DEFAULT 'PENDIENTE';

-- Reflejar el ciclo de vida dentro de la propia tabla `tickets`.
-- Se deja documentado el conjunto permitido para que el código nuevo lo respete.
COMMENT ON COLUMN tickets.estado IS
  'PENDIENTE | ASIGNADO | LLAMANDO | PREPARADO | ACTIVO | FINALIZADO';
