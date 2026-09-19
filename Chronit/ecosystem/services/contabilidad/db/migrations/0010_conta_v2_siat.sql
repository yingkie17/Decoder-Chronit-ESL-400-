-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v2)
-- Migración 0010: SIAT-READY (Bolivia) — estructura + numeración fiscal
-- -----------------------------------------------------------------------------
-- Idempotente y aditiva. NO integra SOAP: solo deja la estructura lista para
-- activarla (dosificaciones, CUF/CUIS/CUN, estado de envío) y los campos que
-- necesitan los exports "Libro Ventas" / "Libro Compras" en formato SIN.
--
--   siat_estado: no_aplica | pendiente | enviado | aceptado | rechazado
--
-- Regla: el `dosificacion_id` y el `tipo_factura` se SNAPSHOTEAN en la venta,
-- de modo que un cambio posterior de dosificación no altere facturas emitidas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) DOSIFICACIONES — rangos autorizados por el SIN para emitir facturas.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_dosificaciones (
    id              SERIAL PRIMARY KEY,
    sucursal_id     INTEGER REFERENCES conta_sucursales(id),
    tipo_factura    TEXT NOT NULL DEFAULT 'factura',   -- factura | recibo | nota_credito
    rango_desde     INTEGER NOT NULL DEFAULT 1,
    rango_hasta     INTEGER NOT NULL DEFAULT 1000,
    numero_actual   INTEGER NOT NULL DEFAULT 0,
    cuf_base        TEXT,
    cuis            TEXT,
    cun             TEXT,
    vigencia_desde  DATE,
    vigencia_hasta  DATE,
    activo          BOOLEAN NOT NULL DEFAULT true,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_dosif_sucursal ON conta_dosificaciones(sucursal_id, activo);

-- -----------------------------------------------------------------------------
-- 2) Campos SIAT en la venta (se llenan solo si la dosificación está activa)
-- -----------------------------------------------------------------------------
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS cuf               TEXT;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS cuis              TEXT;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS cun               TEXT;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS dosificacion_id   INTEGER REFERENCES conta_dosificaciones(id);
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS siat_estado       TEXT NOT NULL DEFAULT 'no_aplica';
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS siat_enviado_en   TIMESTAMPTZ;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS siat_codigo_respuesta TEXT;
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS siat_mensaje      TEXT;

CREATE INDEX IF NOT EXISTS idx_conta_ventas_siat ON conta_ventas(siat_estado, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_conta_ventas_nit  ON conta_ventas(nit_cliente);

-- Rango de numeración correlativa por dosificación (para el número de factura).
ALTER TABLE conta_dosificaciones ADD COLUMN IF NOT EXISTS numero_reservado INTEGER NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 3) Libro de Compras — número de factura del proveedor + estado SIAT
--    (la tabla conta_compras la crea la migración 0013; aquí solo se dejan las
--     claves de configuración del export, para no crear dependencias).
-- -----------------------------------------------------------------------------
INSERT INTO conta_configuracion (clave, valor, descripcion) VALUES
    ('libro_ventas_codigo_sin',  '"1"'::jsonb, 'Código de documento SIN para el Libro de Ventas (export CSV).'),
    ('libro_compras_codigo_sin', '"2"'::jsonb, 'Código de documento SIN para el Libro de Compras (export CSV).'),
    ('nit_empresa',              'null'::jsonb, 'NIT del emisor, usado en los encabezados de exportación SIN.')
ON CONFLICT (clave) DO NOTHING;

COMMENT ON TABLE conta_dosificaciones IS 'Rangos de numeración autorizados por el SIN (Bolivia). Estructura lista; integración SOAP desactivada en v1.';
