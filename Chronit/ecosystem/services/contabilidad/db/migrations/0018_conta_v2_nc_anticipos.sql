-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v2)
-- Migración 0018: nota de crédito sobre ANTICIPOS
-- -----------------------------------------------------------------------------
-- Idempotente y aditiva.
--
-- Un anticipo que se devuelve debe emitir un comprobante (nota de crédito).
-- La migración 0011 declaró conta_notas_credito.venta_original_id NOT NULL
-- porque sólo existían devoluciones de ventas. Aquí:
--   * la columna pasa a ser NULL-able (una NC puede no tener venta),
--   * se añade anticipo_id para enlazar la devolución del anticipo,
--   * se exige (por CHECK lógico, no constraint) que al menos uno de los dos
--     referentes esté presente: se valida en el backend.
-- =============================================================================

ALTER TABLE conta_notas_credito ALTER COLUMN venta_original_id DROP NOT NULL;
ALTER TABLE conta_notas_credito ADD COLUMN IF NOT EXISTS anticipo_id INTEGER REFERENCES conta_anticipos(id);

CREATE INDEX IF NOT EXISTS idx_conta_nc_anticipo ON conta_notas_credito(anticipo_id);

COMMENT ON COLUMN conta_notas_credito.anticipo_id IS 'Nota de crédito que devuelve un anticipo (venta_original_id queda NULL en ese caso).';
