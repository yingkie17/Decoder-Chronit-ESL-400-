-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD
-- Migración 0004: propinas y su distribución
-- -----------------------------------------------------------------------------
-- Modos de propina (configuracion.propina_modo): inmediata | acumulada | mixta
--   inmediata -> se distribuye y paga en el mismo cierre
--   acumulada -> queda pendiente hasta que un supervisor autorice el pago
--   mixta     -> el cajero elige por venta
-- La anulación de una propina solo la puede hacer un supervisor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS conta_propinas (
    id               SERIAL PRIMARY KEY,
    venta_id         INTEGER REFERENCES conta_ventas(id),
    sesion_caja_id   INTEGER REFERENCES conta_sesiones_caja(id),
    monto            NUMERIC(12,2) NOT NULL DEFAULT 0,
    metodo           TEXT NOT NULL DEFAULT 'efectivo',   -- efectivo | qr | transferencia
    modo             TEXT NOT NULL DEFAULT 'acumulada',  -- inmediata | acumulada
    detalle          JSONB NOT NULL DEFAULT '{}'::jsonb,
    estado           TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | distribuida | pagada | anulada
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    creado_por       INTEGER REFERENCES usuarios(id),
    anulada_por      INTEGER REFERENCES usuarios(id),
    motivo_anulacion TEXT
);
CREATE INDEX IF NOT EXISTS idx_conta_propinas_sesion ON conta_propinas(sesion_caja_id);
CREATE INDEX IF NOT EXISTS idx_conta_propinas_estado ON conta_propinas(estado, creado_en DESC);

CREATE TABLE IF NOT EXISTS conta_propina_distribucion (
    id          SERIAL PRIMARY KEY,
    propina_id  INTEGER NOT NULL REFERENCES conta_propinas(id) ON DELETE CASCADE,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
    rol         TEXT,
    monto       NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado      TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | pagada | anulada
    pagado_en   TIMESTAMPTZ,
    pagado_por  INTEGER REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_conta_propina_dist_propina ON conta_propina_distribucion(propina_id);
CREATE INDEX IF NOT EXISTS idx_conta_propina_dist_usuario ON conta_propina_distribucion(usuario_id, estado);

-- FK diferidas: conta_movimientos_caja.propina_id -> conta_propinas(id)
ALTER TABLE conta_movimientos_caja
    DROP CONSTRAINT IF EXISTS fk_conta_mov_propina;
ALTER TABLE conta_movimientos_caja
    ADD CONSTRAINT fk_conta_mov_propina FOREIGN KEY (propina_id) REFERENCES conta_propinas(id);

-- FK diferida: conta_movimientos_caja.egreso_id -> conta_egresos(id)
ALTER TABLE conta_movimientos_caja
    DROP CONSTRAINT IF EXISTS fk_conta_mov_egreso;
ALTER TABLE conta_movimientos_caja
    ADD CONSTRAINT fk_conta_mov_egreso FOREIGN KEY (egreso_id) REFERENCES conta_egresos(id);
