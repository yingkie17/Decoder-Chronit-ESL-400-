-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0006: Karts/Transponders, kart por ticket,
-- modo invitado, bloqueo de cuentas y configuración completa de eventos.
-- -----------------------------------------------------------------------------
-- Requisitos del PROMPT FINAL:
--   * Gestión de Karts: un kart NO puede asignarse a dos pilotos en el mismo
--     evento. Se modela el kart asignado sobre el ticket (tickets.kart_id) y un
--     índice único parcial (kart_id, evento_id) impone la regla.
--   * Lista de usuarios completa: todos los roles deben ver ticket, kart,
--     evento, transponder y rol. Habilitamos columnas es_invitado y bloqueado
--     en `usuarios` para soportar el modo "invitado" y el bloqueo de cuentas.
--   * Configuración completa del evento por modo de carrera (tiempo, vueltas,
--     clasificación, resistencia): se añaden las columnas al espejo `eventos`.
--   * Estado AUSENTE en la máquina de estados del ticket (solo documentación;
--     no hay CHECK en la columna, por lo que se actualiza el comentario).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Tabla de karts / transponders
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS karts (
    id             SERIAL PRIMARY KEY,
    numero         INTEGER NOT NULL UNIQUE,              -- Kart #N
    transponder    TEXT UNIQUE,                          -- TP-101
    activo         BOOLEAN NOT NULL DEFAULT true,
    estado         TEXT NOT NULL DEFAULT 'disponible',   -- disponible | asignado
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2) tickets.kart_id — kart asignado al piloto en ese evento
-- -----------------------------------------------------------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS kart_id INTEGER REFERENCES karts(id);

-- Regla: un kart no puede repetirse dentro de un mismo evento (dos pilotos no
-- pueden usar el mismo kart en la misma carrera). tickets.kart_id es NULL si
-- no hay kart asignado, y el índice parcial sólo cubre filas con kart.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tickets_kart_evento
    ON tickets (kart_id, evento_id)
    WHERE kart_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3) usuarios: modo invitado y bloqueo de cuenta
-- -----------------------------------------------------------------------------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS es_invitado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado BOOLEAN NOT NULL DEFAULT false;

-- -----------------------------------------------------------------------------
-- 4) eventos: configuración completa según modo de carrera
-- -----------------------------------------------------------------------------
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS modo TEXT;                  -- por_tiempo | por_vueltas | clasificacion | resistencia
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS vueltas INTEGER;            -- por vueltas
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS duracion_min INTEGER;       -- por tiempo / resistencia
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS vueltas_clasificacion INTEGER; -- clasificación
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS pilotos_por_equipo INTEGER; -- resistencia (relevos)
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS max_pilotos INTEGER;        -- cupo máximo

-- -----------------------------------------------------------------------------
-- 5) Estado AUSENTE en la máquina de estados del ticket (documentación)
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN tickets.estado IS
  'PENDIENTE | ASIGNADO | LLAMANDO | PREPARADO | ACTIVO | FINALIZADO | AUSENTE';
COMMENT ON COLUMN karts.estado IS
  'disponible | asignado';
