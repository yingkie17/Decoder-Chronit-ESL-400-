-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v2)
-- Migración 0013: PROVEEDORES, COMPRAS e INVENTARIO (kardex)
-- -----------------------------------------------------------------------------
-- Idempotente y aditiva.
--
-- Al CONFIRMAR una compra:
--   * se genera una ENTRADA de kardex por cada ítem,
--   * se actualiza el costo promedio ponderado y el stock del producto,
--   * se crea una cuenta por pagar (conta_cuentas_pagar, migración 0014),
--   * se genera el asiento contable automático.
-- =============================================================================

CREATE TABLE IF NOT EXISTS conta_proveedores (
    id                SERIAL PRIMARY KEY,
    sucursal_id       INTEGER REFERENCES conta_sucursales(id),
    nombre            TEXT NOT NULL,
    nit               TEXT,
    contacto          TEXT,
    telefono          TEXT,
    email             TEXT,
    condiciones_pago  TEXT,
    activo            BOOLEAN NOT NULL DEFAULT true,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_proveedores_nombre ON conta_proveedores(nombre);

CREATE TABLE IF NOT EXISTS conta_compras (
    id                    SERIAL PRIMARY KEY,
    uuid_global           UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    sucursal_id           INTEGER REFERENCES conta_sucursales(id),
    proveedor_id          INTEGER REFERENCES conta_proveedores(id),
    numero_factura_prov   TEXT,
    fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
    subtotal              NUMERIC(12,2) NOT NULL DEFAULT 0,
    iva                   NUMERIC(12,2) NOT NULL DEFAULT 0,
    total                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado                TEXT NOT NULL DEFAULT 'borrador',  -- borrador|confirmada|pagada|anulada
    comprobante_url       TEXT,
    creado_por            INTEGER REFERENCES usuarios(id),
    confirmado_por        INTEGER REFERENCES usuarios(id),
    confirmado_en         TIMESTAMPTZ,
    creado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
    asiento_id            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conta_compras_estado ON conta_compras(estado, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_conta_compras_prov ON conta_compras(proveedor_id);

CREATE TABLE IF NOT EXISTS conta_compra_items (
    id              SERIAL PRIMARY KEY,
    compra_id       INTEGER NOT NULL REFERENCES conta_compras(id) ON DELETE CASCADE,
    producto_id     INTEGER REFERENCES conta_productos(id),
    cantidad        NUMERIC(12,2) NOT NULL DEFAULT 0,
    costo_unitario  NUMERIC(12,2) NOT NULL DEFAULT 0,
    subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conta_compra_items_compra ON conta_compra_items(compra_id);

-- -----------------------------------------------------------------------------
-- KARDEX — libro de movimientos de inventario (entrada | salida | ajuste)
--   Los saldos se SNAPSHOTEAN tras cada movimiento: los reportes no recalculan.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_kardex (
    id                SERIAL PRIMARY KEY,
    sucursal_id       INTEGER REFERENCES conta_sucursales(id),
    producto_id       INTEGER NOT NULL REFERENCES conta_productos(id),
    tipo              TEXT NOT NULL,          -- entrada | salida | ajuste
    cantidad          NUMERIC(12,2) NOT NULL DEFAULT 0,
    costo_unitario    NUMERIC(12,2) NOT NULL DEFAULT 0,
    saldo_cantidad    NUMERIC(12,2) NOT NULL DEFAULT 0,
    saldo_valor       NUMERIC(12,2) NOT NULL DEFAULT 0,
    referencia_tipo   TEXT,                   -- compra | venta | ajuste | inicial
    referencia_id     INTEGER,
    created_by        INTEGER REFERENCES usuarios(id),
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_kardex_producto ON conta_kardex(producto_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_conta_kardex_ref ON conta_kardex(referencia_tipo, referencia_id);

-- Los egresos pueden venir de un proveedor (compra al contado).
ALTER TABLE conta_egresos ADD COLUMN IF NOT EXISTS proveedor_id INTEGER REFERENCES conta_proveedores(id);

COMMENT ON TABLE conta_kardex IS 'Movimientos de inventario con saldo snapshot. Costo promedio ponderado por producto.';
