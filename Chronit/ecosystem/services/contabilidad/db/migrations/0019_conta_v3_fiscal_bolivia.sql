-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v3)
-- Migración 0019: CUMPLIMIENTO FISCAL BOLIVIA + toggle facturado/no facturado
-- -----------------------------------------------------------------------------
-- Idempotente y ADITIVA. No elimina ni renombra columnas existentes: el módulo
-- contable v2 sigue funcionando aunque estas columnas queden en NULL.
--
-- Impuestos Bolivia contemplados:
--   IVA  13%   -> solo cuando la venta es FACTURADA (incluido o agregado).
--   IT    3%   -> SIEMPRE, sobre ingresos brutos (facturado o no).
--   IUE  25%   -> anual (informativo / retención).
--   ITF 0.15%  -> débito bancario (informativo).
--   SIETE-RG 5% bimestral (IVA+IT+IUE unificados) si ventas anuales < Bs 400.000.
--
-- Regla de oro: TODA venta SNAPSHOTEA los impuestos aplicados. Cambiar una tasa
-- o el régimen NO altera las ventas pasadas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CONFIGURACIÓN FISCAL (nuevas claves; respeta valores ya editados)
-- -----------------------------------------------------------------------------
INSERT INTO conta_configuracion (clave, valor, descripcion, editable_por_rol) VALUES
    ('facturacion_habilitada',        'false'::jsonb,        'Toggle maestro: habilita la emisión de facturas.', ARRAY['supervisor','admin','desarrollador']),
    ('facturacion_modo_default',      '"no_facturado"'::jsonb, 'Modo por defecto en el POS: no_facturado | facturado.', ARRAY['supervisor','admin','desarrollador']),
    ('facturacion_requiere_nit',      'false'::jsonb,        'Exige NIT del cliente cuando la venta es facturada.', ARRAY['supervisor','admin','desarrollador']),
    ('facturacion_requiere_razon_social', 'false'::jsonb,    'Exige razón social del cliente cuando la venta es facturada.', ARRAY['supervisor','admin','desarrollador']),
    ('iva_pct_default',               '13'::jsonb,           'Alícuota del IVA (Impuesto al Valor Agregado). Clave fiscal canónica; reemplaza a iva_porcentaje_default.', ARRAY['supervisor','admin','desarrollador']),
    ('it_pct_default',                '3'::jsonb,            'Alícuota del IT (Impuesto a las Transacciones).', ARRAY['supervisor','admin','desarrollador']),
    ('iue_pct_default',               '25'::jsonb,           'Alícuota del IUE (Impuesto a las Utilidades).', ARRAY['supervisor','admin','desarrollador']),
    ('itf_pct_default',               '0.15'::jsonb,         'Alícuota del ITF (Impuesto a las Transacciones Financieras).', ARRAY['supervisor','admin','desarrollador']),
    ('regimen',                       '"general"'::jsonb,    'Régimen tributario: general | siete_rg.', ARRAY['supervisor','admin','desarrollador']),
    ('siete_rg_pct',                  '5'::jsonb,            'Alícuota unificada del régimen SIETE-RG (IVA+IT+IUE).', ARRAY['supervisor','admin','desarrollador']),
    ('siete_rg_limite_anual',         '400000'::jsonb,       'Límite anual de ventas (Bs) para permanecer en SIETE-RG.', ARRAY['supervisor','admin','desarrollador']),
    ('libro_periodo_cerrado_bloquea', 'true'::jsonb,         'Bloquea nuevos registros en un período fiscal cerrado.', ARRAY['supervisor','admin','desarrollador'])
ON CONFLICT (clave) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2) HISTORIAL DE TASAS DE IMPUESTO
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_tasas_impuesto (
    id              SERIAL PRIMARY KEY,
    codigo          TEXT NOT NULL,
    nombre          TEXT NOT NULL,
    pct             NUMERIC(6,3) NOT NULL DEFAULT 0,
    vigencia_desde  DATE,
    vigencia_hasta  DATE,
    activo          BOOLEAN NOT NULL DEFAULT true,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_tasas_codigo ON conta_tasas_impuesto(codigo);

INSERT INTO conta_tasas_impuesto (codigo, nombre, pct, vigencia_desde, activo) VALUES
    ('IVA',      'Impuesto al Valor Agregado',              13,    DATE '2015-01-01', true),
    ('IT',       'Impuesto a las Transacciones',             3,    DATE '2015-01-01', true),
    ('IUE',      'Impuesto sobre las Utilidades',           25,    DATE '2015-01-01', true),
    ('ITF',      'Impuesto a las Transacciones Financieras', 0.15, DATE '2015-01-01', true),
    ('SIETE_RG', 'Régimen SIETE-RG (IVA+IT+IUE unificados)',  5,    DATE '2024-01-01', true)
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3) DOSIFICACIONES SIAT — columnas que exige el flujo fiscal (sucursal SIN,
--    leyenda y unicidad del rango). La tabla ya existe desde la migración 0010.
-- -----------------------------------------------------------------------------
ALTER TABLE conta_dosificaciones ADD COLUMN IF NOT EXISTS sucursal_sin INTEGER;
ALTER TABLE conta_dosificaciones ADD COLUMN IF NOT EXISTS leyenda TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_dosif_rango
    ON conta_dosificaciones(sucursal_id, tipo_factura, sucursal_sin, rango_desde, rango_hasta);

-- Dosificación PLACEHOLDER (inactiva) para pruebas del flujo fiscal.
INSERT INTO conta_dosificaciones
    (sucursal_id, tipo_factura, sucursal_sin, rango_desde, rango_hasta, numero_actual,
     cuf_base, cuis, cun, leyenda, vigencia_desde, vigencia_hasta, activo)
SELECT (SELECT MIN(id) FROM conta_sucursales), 'factura', 0, 1, 1000, 0,
       'TEST-CUF-BASE', 'TEST-CUIS', 'TEST-CUN',
       'DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL',
       CURRENT_DATE, CURRENT_DATE + INTERVAL '365 days', false
WHERE NOT EXISTS (SELECT 1 FROM conta_dosificaciones);

-- -----------------------------------------------------------------------------
-- 4) VENTAS — snapshot fiscal completo
-- -----------------------------------------------------------------------------
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS tipo_operacion        TEXT NOT NULL DEFAULT 'no_facturado';
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS regimen_aplicado      TEXT;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS iva_modo_aplicado     TEXT;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS iva_pct_aplicado      NUMERIC(6,3);
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS it_pct_aplicado       NUMERIC(6,3);
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS it_total              NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS iue_pct_aplicado      NUMERIC(6,3);
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS iue_retenido          NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS itf_total             NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS base_imponible_iva    NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS base_imponible_it     NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS nit_cliente_snapshot  TEXT;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS razon_social_cliente_snapshot TEXT;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS tipo_factura_snapshot TEXT;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS siat_respuesta        JSONB;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS libro_ventas_incluido BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conta_ventas_tipo_operacion') THEN
        ALTER TABLE conta_ventas ADD CONSTRAINT chk_conta_ventas_tipo_operacion
            CHECK (tipo_operacion IN ('facturado','no_facturado','cortesia','exento'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conta_ventas_tipo_operacion ON conta_ventas(tipo_operacion, creado_en DESC);

-- Backfill: las filas históricas previas al módulo fiscal quedan como
-- 'no_facturado' (default) con sus totales v1 intactos; no se recalculan.
UPDATE conta_ventas SET base_imponible_iva = base_imponible WHERE base_imponible_iva = 0;
UPDATE conta_ventas SET base_imponible_it  = base_imponible WHERE base_imponible_it = 0;
UPDATE conta_ventas SET tipo_factura_snapshot = tipo_factura WHERE tipo_factura_snapshot IS NULL;
UPDATE conta_ventas SET nit_cliente_snapshot = nit_cliente WHERE nit_cliente_snapshot IS NULL;
UPDATE conta_ventas SET razon_social_cliente_snapshot = razon_social_cliente
 WHERE razon_social_cliente_snapshot IS NULL;

-- -----------------------------------------------------------------------------
-- 5) LÍNEAS DE VENTA — snapshot fiscal por línea
-- -----------------------------------------------------------------------------
ALTER TABLE conta_venta_items ADD COLUMN IF NOT EXISTS tipo_operacion_snapshot TEXT;
ALTER TABLE conta_venta_items ADD COLUMN IF NOT EXISTS iva_pct_aplicado         NUMERIC(6,3);
ALTER TABLE conta_venta_items ADD COLUMN IF NOT EXISTS it_pct_aplicado          NUMERIC(6,3);
ALTER TABLE conta_venta_items ADD COLUMN IF NOT EXISTS it_linea                 NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE conta_venta_items ADD COLUMN IF NOT EXISTS precio_base              NUMERIC(12,2);
ALTER TABLE conta_venta_items ADD COLUMN IF NOT EXISTS precio_final             NUMERIC(12,2);
ALTER TABLE conta_venta_items ADD COLUMN IF NOT EXISTS producto_tipo_snapshot   TEXT;

-- Backfill de la nueva columna desde la nomenclatura v1 (misma semántica).
UPDATE conta_venta_items SET iva_pct_aplicado = iva_porcentaje_aplicado WHERE iva_pct_aplicado IS NULL;
UPDATE conta_venta_items SET precio_base  = base_imponible_linea WHERE precio_base  IS NULL;
UPDATE conta_venta_items SET precio_final = subtotal             WHERE precio_final IS NULL;

-- -----------------------------------------------------------------------------
-- 6) NOTAS DE CRÉDITO — campos fiscales
-- -----------------------------------------------------------------------------
ALTER TABLE conta_notas_credito ADD COLUMN IF NOT EXISTS tipo_operacion  TEXT;
ALTER TABLE conta_notas_credito ADD COLUMN IF NOT EXISTS iva_total       NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE conta_notas_credito ADD COLUMN IF NOT EXISTS it_total        NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE conta_notas_credito ADD COLUMN IF NOT EXISTS cuf             TEXT;
ALTER TABLE conta_notas_credito ADD COLUMN IF NOT EXISTS siat_estado     TEXT DEFAULT 'no_aplica';
ALTER TABLE conta_notas_credito ADD COLUMN IF NOT EXISTS siat_respuesta  JSONB;

-- -----------------------------------------------------------------------------
-- 7) LIBRO DE VENTAS (formato SIN) — inmutable una vez cerrado el período
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_libro_ventas (
    id                      SERIAL PRIMARY KEY,
    sucursal_id             INTEGER REFERENCES conta_sucursales(id),
    periodo_mes             INTEGER NOT NULL,
    periodo_anio            INTEGER NOT NULL,
    fecha_factura           DATE NOT NULL,
    numero_factura          TEXT,
    nit_cliente             TEXT,
    razon_social_cliente    TEXT,
    importe_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
    importe_base_iva        NUMERIC(12,2) NOT NULL DEFAULT 0,
    iva_total               NUMERIC(12,2) NOT NULL DEFAULT 0,
    it_total                NUMERIC(12,2) NOT NULL DEFAULT 0,
    tipo_factura            TEXT,
    cuf                     TEXT,
    estado_sin              TEXT NOT NULL DEFAULT 'pendiente',
    venta_id                INTEGER REFERENCES conta_ventas(id),
    generado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_libro_ventas
    ON conta_libro_ventas(sucursal_id, periodo_anio, periodo_mes, numero_factura);
CREATE INDEX IF NOT EXISTS idx_conta_libro_ventas_periodo
    ON conta_libro_ventas(periodo_anio, periodo_mes, sucursal_id);

-- -----------------------------------------------------------------------------
-- 8) LIBRO DE COMPRAS (formato SIN)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_libro_compras (
    id                      SERIAL PRIMARY KEY,
    sucursal_id             INTEGER REFERENCES conta_sucursales(id),
    periodo_mes             INTEGER NOT NULL,
    periodo_anio            INTEGER NOT NULL,
    fecha_factura           DATE NOT NULL,
    numero_factura          TEXT,
    nit_proveedor           TEXT,
    razon_social_proveedor  TEXT,
    importe_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
    importe_base_iva        NUMERIC(12,2) NOT NULL DEFAULT 0,
    iva_total               NUMERIC(12,2) NOT NULL DEFAULT 0,
    it_total                NUMERIC(12,2) NOT NULL DEFAULT 0,
    tipo_factura            TEXT,
    cuf                     TEXT,
    estado_sin              TEXT NOT NULL DEFAULT 'pendiente',
    compra_id               INTEGER REFERENCES conta_compras(id),
    generado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_libro_compras
    ON conta_libro_compras(sucursal_id, periodo_anio, periodo_mes, numero_factura);
CREATE INDEX IF NOT EXISTS idx_conta_libro_compras_periodo
    ON conta_libro_compras(periodo_anio, periodo_mes, sucursal_id);

-- -----------------------------------------------------------------------------
-- 9) PERÍODOS FISCALES — permiten "cerrar el mes" y bloquear cambios.
--    Tabla de apoyo no listada en la especificación, necesaria para cumplir la
--    regla "libro ventas/compras inmutable una vez generado el período".
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_periodos_fiscales (
    id           SERIAL PRIMARY KEY,
    sucursal_id  INTEGER REFERENCES conta_sucursales(id),
    periodo_anio INTEGER NOT NULL,
    periodo_mes  INTEGER NOT NULL,
    estado       TEXT NOT NULL DEFAULT 'abierto',   -- abierto | cerrado
    cerrado_por  INTEGER REFERENCES usuarios(id),
    cerrado_en   TIMESTAMPTZ,
    observacion  TEXT,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_periodo_fiscal
    ON conta_periodos_fiscales(sucursal_id, periodo_anio, periodo_mes);

-- -----------------------------------------------------------------------------
-- 10) TICKETS — datos fiscales para la impresión (facturado vs no facturado)
-- -----------------------------------------------------------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tipo_operacion   TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cuf              TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS iva_modo_aplicado TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS iva_pct_aplicado  NUMERIC(6,3);

COMMENT ON TABLE conta_libro_ventas IS 'Libro de Ventas en formato SIN (Bolivia). Se puebla al facturar y queda inmutable al cerrar el período.';
COMMENT ON TABLE conta_libro_compras IS 'Libro de Compras en formato SIN (Bolivia). Se puebla al confirmar compras y queda inmutable al cerrar el período.';
COMMENT ON TABLE conta_tasas_impuesto IS 'Historial de tasas impositivas (IVA, IT, IUE, ITF, SIETE-RG). Las ventas snapshotean la tasa aplicada.';
COMMENT ON TABLE conta_periodos_fiscales IS 'Cierre de períodos fiscales: un período cerrado no admite nuevos asientos de venta/compra (solo notas de crédito).';
