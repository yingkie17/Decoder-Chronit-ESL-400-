-- =============================================================================
-- CHRONIT ECOSYSTEM — Sistema de Tickets: bitácora de operaciones sensibles
-- -----------------------------------------------------------------------------
-- Registra quién hizo qué sobre qué entidad, con el estado anterior y el nuevo.
-- Es la contraparte en el sistema de tickets de `conta_auditoria` (contabilidad)
-- y `crm_auditoria` (CRM), para cumplir con "registrar todas las operaciones
-- sensibles para auditorías".
--
-- El `usuario_carnet` se guarda como snapshot: si el usuario se elimina, la
-- bitácora conserva la identidad de quien ejecutó la operación.
-- =============================================================================

CREATE TABLE IF NOT EXISTS tickets_auditoria (
  id            BIGSERIAL PRIMARY KEY,
  usuario_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_carnet TEXT,
  accion        TEXT NOT NULL,
  entidad       TEXT NOT NULL,
  entidad_id    TEXT,
  datos_antes   JSONB,
  datos_despues JSONB,
  ip            TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_auditoria_creado  ON tickets_auditoria (creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_auditoria_accion  ON tickets_auditoria (accion);
CREATE INDEX IF NOT EXISTS idx_tickets_auditoria_entidad ON tickets_auditoria (entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_tickets_auditoria_usuario ON tickets_auditoria (usuario_id);
