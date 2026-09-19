-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0011: número de ticket ÚNICO GLOBAL
-- -----------------------------------------------------------------------------
-- El número de ticket debe ser único entre TODOS los eventos: no puede existir
-- el mismo número en dos eventos. Antes se generaba con MAX(numero)+1 por
-- evento, por lo que se repetía entre eventos distintos.
--
-- Se renumera lo existente de forma determinista, se impone la restricción
-- UNIQUE y se deja una secuencia global como valor por defecto: cualquier INSERT
-- que omita 'numero' recibe un número único automáticamente.
-- =============================================================================

-- Secuencia global del número de ticket.
CREATE SEQUENCE IF NOT EXISTS tickets_numero_seq;

-- Renumerar los tickets existentes conservando el orden relativo (por número y
-- luego por id) para eliminar duplicados entre eventos antes de aplicar UNIQUE.
WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY numero, id) AS rn
    FROM tickets
)
UPDATE tickets t
SET numero = ordered.rn
FROM ordered
WHERE t.id = ordered.id;

-- Dejar la secuencia justo por encima del máximo actual.
SELECT setval(
    'tickets_numero_seq',
    COALESCE((SELECT MAX(numero) FROM tickets), 0) + 1,
    false
);

-- Restricción de unicidad global del número de ticket.
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_numero_key;
ALTER TABLE tickets ADD CONSTRAINT tickets_numero_key UNIQUE (numero);

-- Los INSERT que omitan 'numero' toman el siguiente de la secuencia global.
ALTER TABLE tickets ALTER COLUMN numero SET DEFAULT nextval('tickets_numero_seq');
ALTER SEQUENCE tickets_numero_seq OWNED BY tickets.numero;
