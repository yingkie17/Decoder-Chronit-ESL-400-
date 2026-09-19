-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v2)
-- Migración 0016: PLAN DE CUENTAS, ASIENTOS CONTABLES y ALERTAS
-- -----------------------------------------------------------------------------
-- Idempotente y aditiva.
--
--   cuentas_contables: plan de cuentas mínimo (Bolivia, partida doble).
--   asientos_contables + asiento_lineas: libro diario / mayor / balance.
--   alertas: historial de alertas generadas por el worker (in-app, Telegram,
--            email). La configuración de canales vive en configuracion.
--
-- Todo asiento DEBE cuadrar (debe = haber); el backend lo valida y esta
-- migración lo deja consultable con una vista de control.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) PLAN DE CUENTAS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_cuentas_contables (
    id        SERIAL PRIMARY KEY,
    codigo    TEXT NOT NULL UNIQUE,
    nombre    TEXT NOT NULL,
    tipo      TEXT NOT NULL,             -- activo | pasivo | patrimonio | ingreso | costo | gasto
    padre_id  INTEGER REFERENCES conta_cuentas_contables(id),
    activo    BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_ctas_tipo ON conta_cuentas_contables(tipo, codigo);

-- -----------------------------------------------------------------------------
-- 2) ASIENTOS CONTABLES (libro diario)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_asientos_contables (
    id                SERIAL PRIMARY KEY,
    uuid_global       UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    sucursal_id       INTEGER REFERENCES conta_sucursales(id),
    fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo              TEXT NOT NULL DEFAULT 'automatico',   -- automatico | manual | cierre | apertura
    descripcion       TEXT NOT NULL,
    referencia_tipo   TEXT,   -- venta|nota_credito|compra|egreso|propina|nomina|depreciacion|anticipo|manual
    referencia_id     INTEGER,
    total_debe        NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_haber       NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado            TEXT NOT NULL DEFAULT 'registrado',   -- registrado | anulado
    creado_por        INTEGER REFERENCES usuarios(id),
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_asientos_fecha ON conta_asientos_contables(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_conta_asientos_ref ON conta_asientos_contables(referencia_tipo, referencia_id);

CREATE TABLE IF NOT EXISTS conta_asiento_lineas (
    id                SERIAL PRIMARY KEY,
    asiento_id        INTEGER NOT NULL REFERENCES conta_asientos_contables(id) ON DELETE CASCADE,
    cuenta_contable   TEXT NOT NULL,      -- código del plan de cuentas (snapshot)
    cuenta_id         INTEGER REFERENCES conta_cuentas_contables(id),
    debe              NUMERIC(12,2) NOT NULL DEFAULT 0,
    haber             NUMERIC(12,2) NOT NULL DEFAULT 0,
    descripcion       TEXT
);
CREATE INDEX IF NOT EXISTS idx_conta_asiento_lineas_asiento ON conta_asiento_lineas(asiento_id);
CREATE INDEX IF NOT EXISTS idx_conta_asiento_lineas_cuenta ON conta_asiento_lineas(cuenta_contable);

-- -----------------------------------------------------------------------------
-- 3) ALERTAS (historial; las notificaciones las envía un worker)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_alertas (
    id          BIGSERIAL PRIMARY KEY,
    tipo        TEXT NOT NULL,      -- diferencia_caja|descuento_sin_autorizacion|qr_sin_confirmar|
                                    -- caja_abierta|propinas_pendientes|anticipo_vencido|
                                    -- depreciacion_pendiente|siat_rechazado|stock_bajo
    severidad   TEXT NOT NULL DEFAULT 'media',   -- baja | media | alta | critica
    mensaje     TEXT NOT NULL,
    entidad     TEXT,
    entidad_id  TEXT,
    sucursal_id INTEGER REFERENCES conta_sucursales(id),
    datos       JSONB,
    leida       BOOLEAN NOT NULL DEFAULT false,
    notificada  BOOLEAN NOT NULL DEFAULT false,
    notificada_en TIMESTAMPTZ,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_alertas_leida ON conta_alertas(leida, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_conta_alertas_tipo ON conta_alertas(tipo, creado_en DESC);

-- -----------------------------------------------------------------------------
-- 4) SEED del plan de cuentas mínimo
--    (jerárquico: padre -> hijo; los códigos de 4 dígitos son las imputables)
-- -----------------------------------------------------------------------------
INSERT INTO conta_cuentas_contables (codigo, nombre, tipo, padre_id) VALUES
    ('1',    'ACTIVO',                    'activo',     NULL),
    ('2',    'PASIVO',                    'pasivo',     NULL),
    ('3',    'PATRIMONIO',                'patrimonio', NULL),
    ('4',    'INGRESOS',                  'ingreso',    NULL),
    ('5',    'COSTOS',                    'costo',      NULL),
    ('6',    'GASTOS',                    'gasto',      NULL)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO conta_cuentas_contables (codigo, nombre, tipo, padre_id)
SELECT v.codigo, v.nombre, v.tipo, p.id
  FROM (VALUES
    ('1101', 'Caja',                  'activo'),
    ('1102', 'Bancos',                'activo'),
    ('1103', 'Cuentas por Cobrar',    'activo'),
    ('1104', 'Inventario',            'activo'),
    ('1201', 'Activos Fijos',         'activo'),
    ('1202', 'Depreciación Acumulada','activo'),
    ('2101', 'Cuentas por Pagar',     'pasivo'),
    ('2102', 'IVA por Pagar',         'pasivo'),
    ('2103', 'Anticipos de Clientes', 'pasivo'),
    ('2104', 'Sueldos por Pagar',     'pasivo'),
    ('3101', 'Capital',               'patrimonio'),
    ('3102', 'Resultados Acumulados', 'patrimonio'),
    ('4101', 'Ingresos por Ventas',   'ingreso'),
    ('4102', 'Devoluciones y Notas de Crédito', 'ingreso'),
    ('5101', 'Costo de Ventas',       'costo'),
    ('6101', 'Gastos Operativos',     'gasto'),
    ('6102', 'Sueldos y Salarios',    'gasto'),
    ('6103', 'Depreciación',          'gasto'),
    ('6104', 'Propinas Pagadas',      'gasto')
  ) AS v(codigo, nombre, tipo)
  JOIN conta_cuentas_contables p ON p.codigo = CASE
        WHEN v.tipo = 'activo'     THEN '1'
        WHEN v.tipo = 'pasivo'     THEN '2'
        WHEN v.tipo = 'patrimonio' THEN '3'
        WHEN v.tipo = 'ingreso'    THEN '4'
        WHEN v.tipo = 'costo'      THEN '5'
        ELSE '6' END
ON CONFLICT (codigo) DO NOTHING;

COMMENT ON TABLE conta_cuentas_contables IS 'Plan de cuentas mínimo (Bolivia, partida doble). Los códigos de 4 dígitos son imputables.';
COMMENT ON TABLE conta_alertas IS 'Historial de alertas. Los canales (in-app, Telegram, email) se configuran en conta_configuracion.alertas_config.';
