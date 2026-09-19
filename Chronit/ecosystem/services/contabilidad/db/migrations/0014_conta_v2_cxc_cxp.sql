-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v2)
-- Migración 0014: CUENTAS POR COBRAR / PAGAR + EMPRESAS y CONVENIOS
-- -----------------------------------------------------------------------------
-- Idempotente y aditiva.
--
--   cuentas_cobrar: saldo por cliente (venta a crédito), antigüedad 30/60/90.
--   cuentas_pagar : saldo por proveedor (compra a crédito), antigüedad 30/60/90.
--   empresas      : clientes corporativos.
--   convenios     : tarifa especial y cupo mensual por empresa.
-- =============================================================================

CREATE TABLE IF NOT EXISTS conta_cuentas_cobrar (
    id              SERIAL PRIMARY KEY,
    uuid_global     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    sucursal_id     INTEGER REFERENCES conta_sucursales(id),
    cliente_id      INTEGER,               -- FK lógica a usuarios (piloto) — nullable
    cliente_nombre  TEXT,
    cliente_nit     TEXT,
    venta_id        INTEGER REFERENCES conta_ventas(id),
    monto           NUMERIC(12,2) NOT NULL DEFAULT 0,
    monto_pagado    NUMERIC(12,2) NOT NULL DEFAULT 0,
    saldo           NUMERIC(12,2) NOT NULL DEFAULT 0,
    vencimiento     DATE,
    estado          TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | pagada | vencida | anulada
    creado_por      INTEGER REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_cxc_estado ON conta_cuentas_cobrar(estado, vencimiento);
CREATE INDEX IF NOT EXISTS idx_conta_cxc_cliente ON conta_cuentas_cobrar(cliente_nombre);

CREATE TABLE IF NOT EXISTS conta_cuentas_pagar (
    id              SERIAL PRIMARY KEY,
    uuid_global     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    sucursal_id     INTEGER REFERENCES conta_sucursales(id),
    proveedor_id    INTEGER REFERENCES conta_proveedores(id),
    compra_id       INTEGER REFERENCES conta_compras(id),
    monto           NUMERIC(12,2) NOT NULL DEFAULT 0,
    monto_pagado    NUMERIC(12,2) NOT NULL DEFAULT 0,
    saldo           NUMERIC(12,2) NOT NULL DEFAULT 0,
    vencimiento     DATE,
    estado          TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | pagada | vencida | anulada
    creado_por      INTEGER REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_cxp_estado ON conta_cuentas_pagar(estado, vencimiento);
CREATE INDEX IF NOT EXISTS idx_conta_cxp_prov ON conta_cuentas_pagar(proveedor_id);

-- -----------------------------------------------------------------------------
-- EMPRESAS y CONVENIOS (clientes corporativos con tarifa especial y cupo)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_empresas (
    id         SERIAL PRIMARY KEY,
    nombre     TEXT NOT NULL,
    nit        TEXT,
    contacto   TEXT,
    telefono   TEXT,
    email      TEXT,
    direccion  TEXT,
    activo     BOOLEAN NOT NULL DEFAULT true,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_empresas_nombre ON conta_empresas(nombre);

CREATE TABLE IF NOT EXISTS conta_convenios (
    id                SERIAL PRIMARY KEY,
    sucursal_id       INTEGER REFERENCES conta_sucursales(id),
    empresa_id        INTEGER NOT NULL REFERENCES conta_empresas(id),
    tarifa_especial   NUMERIC(12,2),
    cupo_mensual      INTEGER,
    vigencia_desde    DATE,
    vigencia_hasta    DATE,
    activo            BOOLEAN NOT NULL DEFAULT true,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_convenios_empresa ON conta_convenios(empresa_id, activo);

-- Pagos de CxC / CxP (historial de cobros y pagos parciales).
CREATE TABLE IF NOT EXISTS conta_cobros_pagos (
    id            SERIAL PRIMARY KEY,
    tipo          TEXT NOT NULL,        -- cobro (CxC) | pago (CxP)
    referencia_id INTEGER NOT NULL,     -- id de conta_cuentas_cobrar / conta_cuentas_pagar
    monto         NUMERIC(12,2) NOT NULL DEFAULT 0,
    metodo_pago_id INTEGER REFERENCES conta_metodos_pago(id),
    cuenta_destino_id INTEGER REFERENCES conta_cuentas_destino(id),
    observacion   TEXT,
    creado_por    INTEGER REFERENCES usuarios(id),
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_cobros_ref ON conta_cobros_pagos(tipo, referencia_id);

COMMENT ON TABLE conta_cuentas_cobrar IS 'Cuentas por cobrar a clientes, con saldo y antigüedad 30/60/90.';
COMMENT ON TABLE conta_cuentas_pagar IS 'Cuentas por pagar a proveedores, con saldo y antigüedad 30/60/90.';
