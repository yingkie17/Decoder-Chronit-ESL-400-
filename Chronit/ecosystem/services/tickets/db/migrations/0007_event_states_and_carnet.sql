-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0007: Estados terminales y de evento ampliados
-- -----------------------------------------------------------------------------
-- PROMPT FINAL:
--   * Estados de Ticket: añade USADO y REVOCADO a la máquina de estados
--     (además de AUSENTE ya documentado). FINALIZADO/USADO/REVOCADO son terminales.
--   * Estados de Evento: añade 'preparada', 'incompleto', 'insuficiente',
--     'cancelado' al vocabulario de `eventos.estado`.
--   * Unicidad de carnet: índice único en `usuarios.carnet` (solo si no existen
--     duplicados históricos; si los hay, se impone a nivel de aplicación).
-- =============================================================================

-- Ticket: documentar estados terminales ampliados (USADO / REVOCADO)
COMMENT ON COLUMN tickets.estado IS
  'PENDIENTE | ASIGNADO | LLAMANDO | PREPARADO | ACTIVO | FINALIZADO | AUSENTE | USADO | REVOCADO';

-- Evento: documentar todos los estados del ciclo de vida
COMMENT ON COLUMN eventos.estado IS
  'pendiente | llamando | preparada | activo | finalizado | incompleto | insuficiente | cancelado';

-- Unicidad de carnet. Solo se crea el índice si no hay duplicados en la BD
-- actual, para no romper la migración con datos históricos. Si existen
-- duplicados, la validación se hace a nivel de aplicación (routes/auth.js).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT carnet FROM usuarios GROUP BY carnet HAVING COUNT(*) > 1
    ) d
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_usuarios_carnet ON usuarios (carnet);
  END IF;
END $$;
