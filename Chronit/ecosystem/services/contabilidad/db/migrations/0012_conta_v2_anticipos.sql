-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v2)
-- Migración 0012: ANTICIPOS (pagos a cuenta, sin venta)
-- -----------------------------------------------------------------------------
-- Idempotente y aditiva.
--
-- Flujo:
--   * Se registra un anticipo SIN venta (método de pago + cuenta destino).
--   * Se aplica total o parcialmente a una venta futura.
--   * Se puede devolver emitiendo una nota de crédito.
--   * estado: pendiente | aplicado | devuelto | vencido
-- =============================================================================

CREATE TABLE IF NOT EXISTS conta_anticipos (
    id                 SERIAL PRIMARY KEY,
    uuid_global        UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    sucursal_id        INTEGER REFERENCES conta_sucursales(id),
    cliente_id         INTEGER,            -- FK lógica a usuarios (piloto) — nullable
    cliente_nombre     TEXT,
    cliente_nit        TEXT,
    monto              NUMERIC(12,2) NOT NULL DEFAULT 0,
    monto_aplicado     NUMERIC(12,2) NOT NULL DEFAULT 0,
    saldo              NUMERIC(12,2) NOT NULL DEFAULT 0,
    moneda             TEXT NOT NULL DEFAULT 'BOB',
    metodo_pago_id     INTEGER REFERENCES conta_metodos_pago(id),
    cuenta_destino_id  INTEGER REFERENCES conta_cuentas_destino(id),
    referencia_qr      TEXT,
    estado             TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente|aplicado|devuelto|vencido
    vencimiento        DATE,
    creado_por         INTEGER REFERENCES usuarios(id),
    creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_anticipos_estado ON conta_anticipos(estado, vencimiento);
CREATE INDEX IF NOT EXISTS idx_conta_anticipos_cliente ON conta_anticipos(cliente_id);

CREATE TABLE IF NOT EXISTS conta_anticipo_aplicaciones (
    id              SERIAL PRIMARY KEY,
    anticipo_id     INTEGER NOT NULL REFERENCES conta_anticipos(id) ON DELETE CASCADE,
    venta_id        INTEGER NOT NULL REFERENCES conta_ventas(id),
    monto_aplicado  NUMERIC(12,2) NOT NULL DEFAULT 0,
    creado_por      INTEGER REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_anticipo_apl_anticipo ON conta_anticipo_aplicaciones(anticipo_id);
CREATE INDEX IF NOT EXISTS idx_conta_anticipo_apl_venta ON conta_anticipo_aplicaciones(venta_id);

-- Movimiento de caja: enlaza el movimiento con el anticipo.
ALTER TABLE conta_movimientos_caja ADD COLUMN IF NOT EXISTS anticipo_id INTEGER;

-- Lo que se pagó con saldo a favor del cliente queda registrado en la venta.
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS monto_anticipo_aplicado NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON TABLE conta_anticipos IS 'Anticipos de clientes: se registran sin venta y se aplican (total o parcial) a ventas futuras.';
