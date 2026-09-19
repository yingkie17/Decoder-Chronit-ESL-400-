-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD
-- Migración 0002: catálogo (productos, listas de precios, precios,
--                  promociones, combos, métodos de pago, cuentas destino y
--                  historial de responsables de cuenta)
-- -----------------------------------------------------------------------------
-- Idempotente (IF NOT EXISTS en todo).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PRODUCTOS
--   iva_modo: hereda | incluido | agregado | exento
--   categoria: carrera | comida | bebida | combo | servicio | otro
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_productos (
    id              SERIAL PRIMARY KEY,
    nombre          TEXT NOT NULL,
    tipo            TEXT NOT NULL DEFAULT 'producto',   -- producto | carrera | combo | servicio
    vueltas         INTEGER,
    duracion_min    INTEGER,
    categoria       TEXT NOT NULL DEFAULT 'otro',
    activo          BOOLEAN NOT NULL DEFAULT true,
    iva_modo        TEXT NOT NULL DEFAULT 'hereda',     -- hereda|incluido|agregado|exento
    iva_porcentaje  NUMERIC(5,2),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_productos_nombre ON conta_productos(nombre);

-- -----------------------------------------------------------------------------
-- LISTAS DE PRECIOS (vigencia por rango de fechas y/o días de la semana)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_listas_precios (
    id              SERIAL PRIMARY KEY,
    nombre          TEXT NOT NULL,
    vigencia_desde  DATE,
    vigencia_hasta  DATE,
    dias_semana     INTEGER[],       -- 0=domingo … 6=sábado. NULL = todos los días.
    activo          BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_listas_nombre ON conta_listas_precios(nombre);

CREATE TABLE IF NOT EXISTS conta_precios (
    id           SERIAL PRIMARY KEY,
    lista_id     INTEGER NOT NULL REFERENCES conta_listas_precios(id) ON DELETE CASCADE,
    producto_id  INTEGER NOT NULL REFERENCES conta_productos(id) ON DELETE CASCADE,
    precio       NUMERIC(12,2) NOT NULL DEFAULT 0,
    moneda       TEXT NOT NULL DEFAULT 'BOB',
    UNIQUE (lista_id, producto_id)
);

-- -----------------------------------------------------------------------------
-- PROMOCIONES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_promociones (
    id                     SERIAL PRIMARY KEY,
    nombre                 TEXT NOT NULL,
    tipo                   TEXT NOT NULL DEFAULT 'descuento',  -- descuento | 2x1 | combo | otro
    condiciones            JSONB NOT NULL DEFAULT '{}'::jsonb,
    descuento_tipo         TEXT NOT NULL DEFAULT 'monto',      -- monto | porcentaje
    descuento_valor        NUMERIC(12,2) NOT NULL DEFAULT 0,
    vigencia_desde         DATE,
    vigencia_hasta         DATE,
    activo                 BOOLEAN NOT NULL DEFAULT true,
    requiere_autorizacion  BOOLEAN NOT NULL DEFAULT false
);

-- -----------------------------------------------------------------------------
-- COMBOS
--   modo_facturacion: unico (1 línea) | desglosado (N líneas con es_componente_combo)
--   iva_modo_hereda: si true, el combo hereda el iva_modo de configuración.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_combos (
    id                SERIAL PRIMARY KEY,
    nombre            TEXT NOT NULL,
    items             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{producto_id, cantidad}]
    precio            NUMERIC(12,2) NOT NULL DEFAULT 0,
    activo            BOOLEAN NOT NULL DEFAULT true,
    modo_facturacion  TEXT NOT NULL DEFAULT 'unico',        -- unico | desglosado
    iva_modo_hereda   BOOLEAN NOT NULL DEFAULT true,
    iva_modo          TEXT NOT NULL DEFAULT 'hereda',
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_combos_nombre ON conta_combos(nombre);

-- -----------------------------------------------------------------------------
-- MÉTODOS DE PAGO (efectivo | qr | transferencia | tarjeta | cortesia)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_metodos_pago (
    id      SERIAL PRIMARY KEY,
    nombre  TEXT NOT NULL UNIQUE,
    tipo    TEXT NOT NULL DEFAULT 'efectivo'
);

-- -----------------------------------------------------------------------------
-- CUENTAS DESTINO (caja física, cuentas QR / bancarias)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_cuentas_destino (
    id                SERIAL PRIMARY KEY,
    nombre            TEXT NOT NULL,
    tipo              TEXT NOT NULL DEFAULT 'qr',   -- efectivo | qr | transferencia | tarjeta
    titular           TEXT,
    banco             TEXT,
    numero            TEXT,
    es_efectivo_caja  BOOLEAN NOT NULL DEFAULT false,
    activo            BOOLEAN NOT NULL DEFAULT true,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_cuentas_nombre ON conta_cuentas_destino(nombre);

-- -----------------------------------------------------------------------------
-- HISTORIAL DE RESPONSABLES DE CUENTA (rotación de responsables de QR)
--   Una fila por asignación. La asignación vigente es la de `hasta IS NULL`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_cuenta_responsable_historial (
    id            SERIAL PRIMARY KEY,
    cuenta_id     INTEGER NOT NULL REFERENCES conta_cuentas_destino(id) ON DELETE CASCADE,
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
    desde         TIMESTAMPTZ NOT NULL DEFAULT now(),
    hasta         TIMESTAMPTZ,
    motivo        TEXT,
    asignado_por  INTEGER REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_conta_responsable_cuenta ON conta_cuenta_responsable_historial(cuenta_id, desde DESC);
-- Solo puede haber un responsable vigente por cuenta.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_responsable_vigente
    ON conta_cuenta_responsable_historial(cuenta_id) WHERE hasta IS NULL;
