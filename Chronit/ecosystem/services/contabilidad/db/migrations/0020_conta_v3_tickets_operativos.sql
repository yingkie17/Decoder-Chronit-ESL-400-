-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD
-- Migración 0020: campos OPERATIVOS y de control en la tabla `tickets`
-- -----------------------------------------------------------------------------
-- Aditiva e idempotente. Continúa el patrón de 0006 y 0019: el módulo de
-- contabilidad enriquece `tickets` (cuyo esquema base crea tickets-backend)
-- para que cada ticket sea un registro AUTO-CONTENIDO e inmutable.
--
-- Motivo: el ticket impreso debe poder auditarse sin recalcular nada y sin
-- depender de que el producto, el evento, el kart o el piloto sigan existiendo
-- o con el mismo dato. Por eso se guardan SNAPSHOTS.
--
-- Campos añadidos (solicitud de control contable/operativo):
--   1) Servicio     : vueltas y duración contratadas.
--   2) Promoción    : tipo, id, nombre, descuento y snapshot completo.
--   3) Impresión    : fecha/hora exacta y número de impresiones.
--   4) Cajera       : carnet (id y nombre ya existen desde 0006).
--   5) Contexto     : sucursal, piloto, evento/modo, kart y transponder.
--
-- NOTA SOBRE "OBLIGATORIO": las columnas descriptivas son NULLables para NO
-- romper los INSERT existentes del módulo de tickets (kiosco, invitados,
-- taquilla) que no las conocen. El carácter obligatorio se garantiza en la
-- capa de aplicación: `registrarVenta` las puebla SIEMPRE. Las columnas con
-- valor por defecto lógico (contadores y montos) son NOT NULL DEFAULT.
-- =============================================================================

-- --- 1) Servicio contratado ---------------------------------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cantidad_vueltas INTEGER;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS duracion_min     INTEGER;

-- --- 2) Promoción aplicada ----------------------------------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS promocion_id INTEGER
    REFERENCES conta_promociones(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tipo_promocion TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS promocion_nombre_snapshot TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS promocion_descuento NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS promociones_aplicadas JSONB;

-- --- 3) Impresión -------------------------------------------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS impreso_en     TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS veces_impreso  INTEGER NOT NULL DEFAULT 0;

-- --- 4) Cajera que atendió (identificación completa) --------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cajero_carnet_snapshot TEXT;

-- --- 5) Contexto operativo (snapshots para auditoría) -------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sucursal_id             INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS piloto_nombre_snapshot  TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS piloto_carnet_snapshot  TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS evento_nombre_snapshot  TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS modo_carrera_snapshot   TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS kart_numero_snapshot    TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS transponder_codigo_snapshot TEXT;

-- --- Índices de consulta operativa -------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tickets_sucursal ON tickets(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_tickets_impreso  ON tickets(impreso_en);

-- --- Documentación en la propia base -----------------------------------------
COMMENT ON COLUMN tickets.cantidad_vueltas IS 'Vueltas del servicio contratado (snapshot del producto al momento de la venta).';
COMMENT ON COLUMN tickets.duracion_min IS 'Duración en minutos del servicio contratado (snapshot).';
COMMENT ON COLUMN tickets.promocion_id IS 'Promoción aplicada a la venta que originó el ticket.';
COMMENT ON COLUMN tickets.tipo_promocion IS 'Tipo de la promoción aplicada: descuento | n_x_m | precio_fijo | promo_horario.';
COMMENT ON COLUMN tickets.promocion_nombre_snapshot IS 'Nombre de la promoción al momento de la venta (snapshot).';
COMMENT ON COLUMN tickets.promocion_descuento IS 'Descuento total otorgado por promociones en la venta.';
COMMENT ON COLUMN tickets.promociones_aplicadas IS 'Snapshot JSONB completo de las promociones aplicadas (no se recalcula).';
COMMENT ON COLUMN tickets.impreso_en IS 'Fecha y hora exacta de la ÚLTIMA impresión del ticket.';
COMMENT ON COLUMN tickets.veces_impreso IS 'Número de veces que el ticket fue impreso (control anti-reimpresión).';
COMMENT ON COLUMN tickets.cajero_carnet_snapshot IS 'Carnet de la cajera que atendió la operación (snapshot).';
COMMENT ON COLUMN tickets.sucursal_id IS 'Sucursal donde se emitió el ticket.';
COMMENT ON COLUMN tickets.piloto_nombre_snapshot IS 'Nombre completo del piloto al momento de la venta (snapshot).';
COMMENT ON COLUMN tickets.piloto_carnet_snapshot IS 'Carnet del piloto al momento de la venta (snapshot).';
COMMENT ON COLUMN tickets.evento_nombre_snapshot IS 'Nombre del evento al momento de la venta (snapshot).';
COMMENT ON COLUMN tickets.modo_carrera_snapshot IS 'Modo de carrera del evento al momento de la venta (snapshot).';
COMMENT ON COLUMN tickets.kart_numero_snapshot IS 'Número de kart asignado al momento de la impresión (snapshot).';
COMMENT ON COLUMN tickets.transponder_codigo_snapshot IS 'Código del transponder al momento de la impresión (snapshot).';
