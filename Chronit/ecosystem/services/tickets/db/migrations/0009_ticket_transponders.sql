-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0009: transponder POR EVENTO (copia provisional)
-- -----------------------------------------------------------------------------
-- REQ 3 (TASK tickets): los transponders se asignan DENTRO de cada evento y la
-- asignación NO vive en el core durante la operación de taquilla/vestidor.
--   * La lista de transponders se lee del core (control de carrera); tickets
--     guarda una COPIA PROVISIONAL de la asignación piloto↔transponder.
--   * Un transponder asignado en el evento A NO aparece asignado en el evento B
--     (la unicidad es por evento, no global).
--   * Dentro del MISMO evento, un transponder no puede estar en dos pilotos.
--   * El core sólo configura la asignación REAL cuando selecciona el evento y
--     arranca la carrera (no al crear el evento).
--
-- Modelo: 1 ticket = 1 piloto en 1 evento, por lo que la asignación provisional
-- se guarda en tickets.transponder_id (id del transponder en el core).
-- =============================================================================

-- 1) Asignación provisional por piloto/evento
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS transponder_id INTEGER;

-- 2) Unicidad INTRA-evento: el mismo transponder no puede repetirse en el mismo
--    evento. El índice es parcial (sólo filas con transponder asignado) y por
--    evento, así que el mismo transponder puede existir provisionalmente en
--    eventos distintos sin "aparecer asignado" en el otro.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tickets_transponder_evento
    ON tickets (evento_id, transponder_id)
    WHERE transponder_id IS NOT NULL;

-- 3) Documentación
COMMENT ON COLUMN tickets.transponder_id IS
  'Transponder provisional asignado al piloto DENTRO de este evento (copia local de tickets, uid del core). Único por evento; NO modifica el core.';
