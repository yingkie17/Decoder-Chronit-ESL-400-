-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD
-- Migración 0003: cajas, ventas, items, pagos, movimientos y egresos
-- -----------------------------------------------------------------------------
-- Reglas de negocio codificadas aquí:
--   * Las ventas son INMUTABLES: nunca se borran (se marcan anulada=true).
--   * Todo monto es numeric(12,2) y toda fecha timestamptz.
--   * Los datos aplicados se SNAPSHOTEAN en la venta y sus líneas (precio, IVA,
--     modo de IVA, descuento, nombre del cajero, responsable de la cuenta).
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- SESIONES DE CAJA
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_sesiones_caja (
    id                       SERIAL PRIMARY KEY,
    cajero_id                INTEGER NOT NULL REFERENCES usuarios(id),
    apertura_en              TIMESTAMPTZ NOT NULL DEFAULT now(),
    cierre_en                TIMESTAMPTZ,
    monto_inicial            NUMERIC(12,2) NOT NULL DEFAULT 0,
    monto_esperado_efectivo  NUMERIC(12,2),
    monto_contado_efectivo   NUMERIC(12,2),
    diferencia               NUMERIC(12,2),
    estado                   TEXT NOT NULL DEFAULT 'abierta',  -- abierta | cerrada
    notas_cierre             TEXT,
    reabierta_por            INTEGER REFERENCES usuarios(id),
    motivo_reapertura        TEXT
);
CREATE INDEX IF NOT EXISTS idx_conta_sesiones_cajero ON conta_sesiones_caja(cajero_id, estado);
CREATE INDEX IF NOT EXISTS idx_conta_sesiones_apertura ON conta_sesiones_caja(apertura_en DESC);
-- Un cajero no puede tener dos cajas abiertas a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_sesion_abierta
    ON conta_sesiones_caja(cajero_id) WHERE estado = 'abierta';

-- -----------------------------------------------------------------------------
-- VENTAS (inmutables)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_ventas (
    id                        SERIAL PRIMARY KEY,
    uuid_global               UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    sesion_caja_id            INTEGER REFERENCES conta_sesiones_caja(id),
    cajero_id                 INTEGER REFERENCES usuarios(id),
    subtotal                  NUMERIC(12,2) NOT NULL DEFAULT 0,
    descuento                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    base_imponible            NUMERIC(12,2) NOT NULL DEFAULT 0,
    iva_total                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    propina                   NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_final               NUMERIC(12,2) NOT NULL DEFAULT 0,
    moneda                    TEXT NOT NULL DEFAULT 'BOB',
    estado                    TEXT NOT NULL DEFAULT 'pagada',   -- pagada | anulada
    notas                     TEXT,
    creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    anulada                   BOOLEAN NOT NULL DEFAULT false,
    motivo_anulacion          TEXT,
    tipo_factura              TEXT,
    nit_cliente               TEXT,
    razon_social_cliente      TEXT,
    numero_factura            TEXT,
    cajero_nombre_snapshot    TEXT,
    iva_modo_default_snapshot TEXT,
    descuento_autorizado_por  INTEGER REFERENCES usuarios(id),
    conteo_tickets            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conta_ventas_sesion ON conta_ventas(sesion_caja_id);
CREATE INDEX IF NOT EXISTS idx_conta_ventas_cajero ON conta_ventas(cajero_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_conta_ventas_creado ON conta_ventas(creado_en DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_ventas_factura ON conta_ventas(numero_factura) WHERE numero_factura IS NOT NULL;

-- -----------------------------------------------------------------------------
-- LÍNEAS DE VENTA (snapshot de precio / IVA / descuento aplicado)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_venta_items (
    id                       SERIAL PRIMARY KEY,
    venta_id                 INTEGER NOT NULL REFERENCES conta_ventas(id) ON DELETE CASCADE,
    producto_id              INTEGER REFERENCES conta_productos(id),
    combo_id                 INTEGER REFERENCES conta_combos(id),
    cantidad                 NUMERIC(12,2) NOT NULL DEFAULT 1,
    precio_unitario          NUMERIC(12,2) NOT NULL DEFAULT 0,
    descuento                NUMERIC(12,2) NOT NULL DEFAULT 0,
    subtotal                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    iva_modo_aplicado        TEXT NOT NULL DEFAULT 'incluido',
    iva_porcentaje_aplicado  NUMERIC(5,2) NOT NULL DEFAULT 0,
    iva_linea                NUMERIC(12,2) NOT NULL DEFAULT 0,
    base_imponible_linea     NUMERIC(12,2) NOT NULL DEFAULT 0,
    es_componente_combo      BOOLEAN NOT NULL DEFAULT false,
    combo_padre_id           INTEGER,      -- FK lógica a conta_venta_items(id) de la línea padre
    nombre_snapshot          TEXT
);
CREATE INDEX IF NOT EXISTS idx_conta_venta_items_venta ON conta_venta_items(venta_id);
CREATE INDEX IF NOT EXISTS idx_conta_venta_items_producto ON conta_venta_items(producto_id);

-- -----------------------------------------------------------------------------
-- PAGOS (uno o varios por venta)
--   cuenta_responsable_id_snapshot: quién era el responsable de la cuenta
--   destino AL MOMENTO del pago (no se recalcula en reportes).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_pagos (
    id                             SERIAL PRIMARY KEY,
    venta_id                       INTEGER NOT NULL REFERENCES conta_ventas(id) ON DELETE CASCADE,
    metodo_pago_id                 INTEGER NOT NULL REFERENCES conta_metodos_pago(id),
    monto                          NUMERIC(12,2) NOT NULL DEFAULT 0,
    cuenta_destino_id              INTEGER REFERENCES conta_cuentas_destino(id),
    cuenta_responsable_id_snapshot INTEGER REFERENCES usuarios(id),
    referencia_qr                  TEXT,
    estado_confirmacion            TEXT NOT NULL DEFAULT 'confirmado',  -- pendiente | confirmado
    confirmado_por                 INTEGER REFERENCES usuarios(id),
    confirmado_en                  TIMESTAMPTZ,
    creado_en                      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_pagos_venta ON conta_pagos(venta_id);
CREATE INDEX IF NOT EXISTS idx_conta_pagos_cuenta ON conta_pagos(cuenta_destino_id, creado_en DESC);

-- -----------------------------------------------------------------------------
-- MOVIMIENTOS DE CAJA (libro mayor de la sesión)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_movimientos_caja (
    id              SERIAL PRIMARY KEY,
    sesion_caja_id  INTEGER NOT NULL REFERENCES conta_sesiones_caja(id) ON DELETE CASCADE,
    tipo            TEXT NOT NULL,     -- venta | egreso | propina | retiro | ingreso | apertura | cierre
    monto           NUMERIC(12,2) NOT NULL DEFAULT 0,
    motivo          TEXT,
    venta_id        INTEGER REFERENCES conta_ventas(id),
    egreso_id       INTEGER,
    propina_id      INTEGER,
    creado_por      INTEGER REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_mov_sesion ON conta_movimientos_caja(sesion_caja_id, creado_en);

-- -----------------------------------------------------------------------------
-- EGRESOS (gastos de caja; sujetos a umbral / autorización de supervisor)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_egresos (
    id                     SERIAL PRIMARY KEY,
    sesion_caja_id         INTEGER REFERENCES conta_sesiones_caja(id),
    categoria              TEXT NOT NULL DEFAULT 'otros',
    monto                  NUMERIC(12,2) NOT NULL DEFAULT 0,
    descripcion            TEXT,
    comprobante_url        TEXT,
    creado_por             INTEGER REFERENCES usuarios(id),
    autorizado_por         INTEGER REFERENCES usuarios(id),
    requiere_autorizacion  BOOLEAN NOT NULL DEFAULT false,
    creado_en              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_egresos_sesion ON conta_egresos(sesion_caja_id);
CREATE INDEX IF NOT EXISTS idx_conta_egresos_creado ON conta_egresos(creado_en DESC);
