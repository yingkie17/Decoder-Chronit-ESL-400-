-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v2)
-- Migración 0011: NOTAS DE CRÉDITO (devoluciones) — totales o parciales
-- -----------------------------------------------------------------------------
-- Idempotente y aditiva.
--
-- Reglas:
--   * La venta original NUNCA se borra (solo se referencia).
--   * La nota de crédito tiene numeración secuencial propia y es CUF-ready.
--   * Reembolso: efectivo | cortesia | saldo_favor.
--   * El asiento contable automático lo genera el backend.
-- =============================================================================

CREATE TABLE IF NOT EXISTS conta_notas_credito (
    id                  SERIAL PRIMARY KEY,
    uuid_global         UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    sucursal_id         INTEGER REFERENCES conta_sucursales(id),
    venta_original_id   INTEGER NOT NULL REFERENCES conta_ventas(id),
    numero              TEXT,
    motivo              TEXT NOT NULL,
    tipo                TEXT NOT NULL DEFAULT 'parcial',      -- total | parcial
    reembolso           TEXT NOT NULL DEFAULT 'efectivo',     -- efectivo | cortesia | saldo_favor
    monto               NUMERIC(12,2) NOT NULL DEFAULT 0,
    moneda              TEXT NOT NULL DEFAULT 'BOB',
    estado              TEXT NOT NULL DEFAULT 'emitida',      -- emitida | anulada
    creado_por          INTEGER REFERENCES usuarios(id),
    autorizado_por      INTEGER REFERENCES usuarios(id),
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    cuf                 TEXT,
    siat_estado         TEXT NOT NULL DEFAULT 'no_aplica',
    asiento_id          INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_nc_numero ON conta_notas_credito(numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conta_nc_venta ON conta_notas_credito(venta_original_id);
CREATE INDEX IF NOT EXISTS idx_conta_nc_creado ON conta_notas_credito(creado_en DESC);

CREATE TABLE IF NOT EXISTS conta_nota_credito_items (
    id             SERIAL PRIMARY KEY,
    nota_id        INTEGER NOT NULL REFERENCES conta_notas_credito(id) ON DELETE CASCADE,
    venta_item_id  INTEGER REFERENCES conta_venta_items(id),
    cantidad       NUMERIC(12,2) NOT NULL DEFAULT 0,
    monto          NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conta_nc_items_nota ON conta_nota_credito_items(nota_id);

-- La venta original guarda cuánto se le devolvió (no se recalcula en reportes).
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS monto_notas_credito NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Movimiento de caja: enlaza el movimiento con la nota de crédito.
ALTER TABLE conta_movimientos_caja ADD COLUMN IF NOT EXISTS nota_credito_id INTEGER;

-- Secuencia de numeración de notas de crédito (global).
CREATE SEQUENCE IF NOT EXISTS conta_notas_credito_seq START 1;

COMMENT ON TABLE conta_notas_credito IS 'Notas de crédito (devoluciones). La venta original nunca se borra; el asiento contable es automático.';
