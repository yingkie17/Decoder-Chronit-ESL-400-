-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD
-- Migración 0005: conciliación de cuentas QR contra el banco
-- -----------------------------------------------------------------------------
-- El contador ingresa el monto reportado por el banco para una cuenta y un día;
-- el sistema compara contra lo registrado y guarda la diferencia.
-- =============================================================================

CREATE TABLE IF NOT EXISTS conta_qr_conciliacion (
    id                    SERIAL PRIMARY KEY,
    cuenta_destino_id     INTEGER NOT NULL REFERENCES conta_cuentas_destino(id),
    fecha                 DATE NOT NULL,
    monto_reportado_banco NUMERIC(12,2) NOT NULL DEFAULT 0,
    monto_sistema         NUMERIC(12,2) NOT NULL DEFAULT 0,
    diferencia            NUMERIC(12,2) NOT NULL DEFAULT 0,
    observaciones         TEXT,
    conciliado_por        INTEGER REFERENCES usuarios(id),
    conciliado_en         TIMESTAMPTZ,
    creado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cuenta_destino_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_conta_qr_conc_fecha ON conta_qr_conciliacion(fecha DESC);
