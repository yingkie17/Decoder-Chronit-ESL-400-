-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0005: Un solo ticket por piloto y evento
-- -----------------------------------------------------------------------------
-- Hallazgo C: podían existir tickets duplicados para el mismo (usuario, evento)
-- con distintos uuid_global (uno creado por el kiosco/taquilla y otro generado
-- por el sentinela desde future_event_drivers). El vínculo por uuid_global no
-- los detectaba porque los IDs eran distintos.
--
-- Esta migración:
--   1) Elimina los duplicados históricos, conservando UN ticket por (usuario,evento).
--   2) Crea un índice único parcial para impedir que vuelvan a ocurrir.
--
-- evento_id NULL queda excluido del índice: un ticket puede nacer "pendiente"
-- sin evento y asignarse después sin chocar con otro pendiente sin evento.
-- =============================================================================

-- 1) Borrar colas huérfanas de los tickets duplicados (FK a tickets).
DELETE FROM colas
WHERE ticket_id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY usuario_id, evento_id
            ORDER BY id DESC
        ) AS rn
        FROM tickets
        WHERE evento_id IS NOT NULL
    ) d
    WHERE d.rn > 1
);

-- 2) Borrar los tickets duplicados (se conserva el de mayor id por cada
--    usuario+evento).
DELETE FROM tickets
WHERE id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY usuario_id, evento_id
            ORDER BY id DESC
        ) AS rn
        FROM tickets
        WHERE evento_id IS NOT NULL
    ) d
    WHERE d.rn > 1
);

-- 3) Índice único parcial: garantiza un ticket por (usuario, evento) asignado.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tickets_usuario_evento
    ON tickets (usuario_id, evento_id)
    WHERE evento_id IS NOT NULL;
