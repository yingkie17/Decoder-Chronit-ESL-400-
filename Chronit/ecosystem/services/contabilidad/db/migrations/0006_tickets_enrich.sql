-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD
-- Migración 0006: ENRIQUECER la tabla `tickets` + `usuarios.nit_personal`
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente. NO rompe el módulo de tickets: todas las columnas
-- nuevas son NULLables y con default implícito NULL, por lo que los INSERT
-- existentes (kiosco, invitados, taquilla) siguen funcionando sin cambios.
--
-- El ticket imprimible usa estos campos para mostrar: nombre del cajero
-- (snapshot), hora exacta de venta, evento, modo, piloto, carnet, kart,
-- transponder, código único y QR firmado.
-- =============================================================================

-- --- Vínculo venta <-> ticket -------------------------------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS venta_id INTEGER REFERENCES conta_ventas(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sesion_caja_id INTEGER REFERENCES conta_sesiones_caja(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cajero_id INTEGER REFERENCES usuarios(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cajero_nombre_snapshot TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS metodo_pago_id INTEGER REFERENCES conta_metodos_pago(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cuenta_destino_id INTEGER REFERENCES conta_cuentas_destino(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS hora_venta TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS producto_id INTEGER REFERENCES conta_productos(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS numero_factura TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS nit_cliente TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS razon_social_cliente TEXT;

CREATE INDEX IF NOT EXISTS idx_tickets_venta ON tickets(venta_id);
CREATE INDEX IF NOT EXISTS idx_tickets_sesion_caja ON tickets(sesion_caja_id);

-- --- NIT personal del usuario (dato tributario opcional del staff) -----------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nit_personal TEXT;

COMMENT ON COLUMN tickets.hora_venta IS 'Hora exacta de la venta (se imprime HH:MM:SS en el ticket).';
COMMENT ON COLUMN tickets.cajero_nombre_snapshot IS 'Nombre del cajero al momento de la venta (snapshot, no se recalcula).';
COMMENT ON COLUMN tickets.venta_id IS 'Venta del módulo de contabilidad que originó/generó este ticket.';
