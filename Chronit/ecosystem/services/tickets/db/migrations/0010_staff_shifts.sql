-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0010: personal por turnos y vestidores
-- -----------------------------------------------------------------------------
-- El administrador gestiona "personal" (cajeros y coordinadores) que trabajan
-- en distintos turnos. Cada trabajador queda asignado a un turno y, si es
-- coordinador de vestidor, a un vestidor (1 o 2).
--
--   * turno    -> etiqueta libre del turno (p.ej. 'Mañana', 'Tarde', 'Noche').
--   * vestidor -> 1 o 2 cuando el trabajador opera un vestidor; NULL si no.
-- =============================================================================

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS turno TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS vestidor INTEGER;

-- El vestidor sólo admite 1 o 2 (mismo rango que las colas).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_vestidor'
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT chk_usuarios_vestidor CHECK (vestidor IN (1, 2));
  END IF;
END $$;

COMMENT ON COLUMN usuarios.turno IS
  'Turno de trabajo del personal (Mañana/Tarde/Noche...). Sólo aplica a cajero/coordinador.';
COMMENT ON COLUMN usuarios.vestidor IS
  'Vestidor asignado al coordinador (1 o 2). NULL para cajeros y demás roles.';
