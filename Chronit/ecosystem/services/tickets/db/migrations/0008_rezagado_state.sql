-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0008: Estado REZAGADO en la máquina de tickets
-- -----------------------------------------------------------------------------
-- PROMPT INTEGRACIÓN TICKETS ↔ CARRERA:
--   * AUSENTE  : el piloto no se presentó pero PERMANECE en el evento y puede
--                volver a ser llamado a vestidores (estado no terminal).
--   * REZAGADO : el piloto nunca se presentó. Se ELIMINA del evento (y de la
--                lista de carrera) y su ticket vuelve a la lista de tickets
--                pendientes con este estado, para poder reasignarse a otro
--                evento (o reactivarse a PENDIENTE).
--
-- No hay CHECK en la columna `tickets.estado`, por lo que basta documentar el
-- vocabulario. La máquina de estados queda:
--   PENDIENTE -> ASIGNADO -> LLAMANDO -> PREPARADO -> ACTIVO -> FINALIZADO
--   + AUSENTE (temporal, rellamable) + REZAGADO (fuera del evento)
--   + USADO / REVOCADO (terminales)
-- =============================================================================

COMMENT ON COLUMN tickets.estado IS
  'PENDIENTE | ASIGNADO | LLAMANDO | PREPARADO | ACTIVO | FINALIZADO | AUSENTE | REZAGADO | USADO | REVOCADO';

-- La cola de vestidor ahora también conserva el estado 'ausente' para los
-- pilotos marcados como AUSENTE temporal (seguían en el evento).
COMMENT ON COLUMN colas.estado IS
  'espera | llamado | vestidor1 | vestidor2 | ready | en_pista | ausente';
