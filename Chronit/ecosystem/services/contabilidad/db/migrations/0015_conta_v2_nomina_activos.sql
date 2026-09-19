-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v2)
-- Migración 0015: NÓMINA, ADELANTOS y ACTIVOS FIJOS con depreciación
-- -----------------------------------------------------------------------------
-- Idempotente y aditiva.
--
--   nomina : periodo, sueldo base, bonos, propinas incluidas, descuentos,
--            adelantos y total a pagar. Genera recibo PDF y asiento contable.
--   activos_fijos: depreciación automática por línea recta mensual,
--            con asiento contable y reporte de valor en libros.
-- =============================================================================

CREATE TABLE IF NOT EXISTS conta_nomina (
    id                  SERIAL PRIMARY KEY,
    uuid_global         UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    sucursal_id         INTEGER REFERENCES conta_sucursales(id),
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    periodo_desde       DATE NOT NULL,
    periodo_hasta       DATE NOT NULL,
    sueldo_base         NUMERIC(12,2) NOT NULL DEFAULT 0,
    bonos               NUMERIC(12,2) NOT NULL DEFAULT 0,
    propinas_incluidas  NUMERIC(12,2) NOT NULL DEFAULT 0,
    descuentos          NUMERIC(12,2) NOT NULL DEFAULT 0,
    adelantos           NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_pagar         NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado              TEXT NOT NULL DEFAULT 'borrador',  -- borrador | aprobada | pagada
    pagado_en           TIMESTAMPTZ,
    pagado_por          INTEGER REFERENCES usuarios(id),
    creado_por          INTEGER REFERENCES usuarios(id),
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    asiento_id          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conta_nomina_usuario ON conta_nomina(usuario_id, periodo_desde DESC);
CREATE INDEX IF NOT EXISTS idx_conta_nomina_estado ON conta_nomina(estado);

CREATE TABLE IF NOT EXISTS conta_adelantos (
    id             SERIAL PRIMARY KEY,
    sucursal_id    INTEGER REFERENCES conta_sucursales(id),
    usuario_id     INTEGER NOT NULL REFERENCES usuarios(id),
    monto          NUMERIC(12,2) NOT NULL DEFAULT 0,
    motivo         TEXT,
    estado         TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | descontado | pagado | anulado
    nomina_id      INTEGER REFERENCES conta_nomina(id),
    autorizado_por INTEGER REFERENCES usuarios(id),
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_adelantos_usuario ON conta_adelantos(usuario_id, estado);

-- -----------------------------------------------------------------------------
-- ACTIVOS FIJOS
--   depreciacion mensual (línea recta) = (costo - valor_residual) / vida_util_meses
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_activos_fijos (
    id                     SERIAL PRIMARY KEY,
    sucursal_id            INTEGER REFERENCES conta_sucursales(id),
    nombre                 TEXT NOT NULL,
    tipo                   TEXT,
    marca                  TEXT,
    modelo                 TEXT,
    numero_serie           TEXT,
    fecha_adquisicion      DATE,
    costo                  NUMERIC(12,2) NOT NULL DEFAULT 0,
    vida_util_meses        INTEGER NOT NULL DEFAULT 60,
    valor_residual         NUMERIC(12,2) NOT NULL DEFAULT 0,
    depreciacion_acumulada NUMERIC(12,2) NOT NULL DEFAULT 0,
    valor_libro            NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado                 TEXT NOT NULL DEFAULT 'activo',  -- activo | baja | vendido
    foto_url               TEXT,
    creado_en              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_activos_estado ON conta_activos_fijos(estado);

CREATE TABLE IF NOT EXISTS conta_depreciaciones (
    id          SERIAL PRIMARY KEY,
    activo_id   INTEGER NOT NULL REFERENCES conta_activos_fijos(id) ON DELETE CASCADE,
    periodo     TEXT NOT NULL,                 -- 'YYYY-MM'
    monto       NUMERIC(12,2) NOT NULL DEFAULT 0,
    acumulada   NUMERIC(12,2) NOT NULL DEFAULT 0,
    asiento_id  INTEGER,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (activo_id, periodo)
);
CREATE INDEX IF NOT EXISTS idx_conta_deprec_periodo ON conta_depreciaciones(periodo);

COMMENT ON TABLE conta_depreciaciones IS 'Depreciación mensual línea recta. Un registro por activo y periodo (idempotente).';
