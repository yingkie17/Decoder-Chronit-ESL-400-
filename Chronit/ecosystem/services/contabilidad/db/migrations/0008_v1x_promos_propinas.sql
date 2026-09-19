-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD
-- Migración 0008: cierre de v1 (promociones automáticas + pesos de propina)
-- -----------------------------------------------------------------------------
-- Idempotente y aditivo. NO toca tablas del módulo de tickets.
--
--   1) conta_ventas.promociones_aplicadas  -> snapshot de las promociones que
--      efectivamente se aplicaron en la venta (nunca se recalcula en reportes).
--   2) Nuevas claves de configuración:
--        promociones_auto           (bool)  aplicar promociones en el POS
--        promociones_acumulables    (bool)  permitir apilar varias promociones
--        propina_distribucion_pesos (jsonb) pesos cuando la distribución = mixto
-- =============================================================================

-- --- 1) Snapshot de promociones aplicadas ------------------------------------
ALTER TABLE conta_ventas ADD COLUMN IF NOT EXISTS promociones_aplicadas JSONB;

COMMENT ON COLUMN conta_ventas.promociones_aplicadas IS
  'Snapshot JSONB de las promociones aplicadas (id, nombre, descuento). No se recalcula.';

-- --- 2) Configuración --------------------------------------------------------
INSERT INTO conta_configuracion (clave, valor, descripcion) VALUES
  ('promociones_auto', 'true'::jsonb,
   'Aplicar automáticamente las promociones vigentes al registrar una venta en el POS.'),
  ('promociones_acumulables', 'false'::jsonb,
   'Permitir apilar varias promociones sobre la misma venta (por defecto solo la mejor).'),
  ('propina_distribucion_pesos', '{"cajero": 0.5, "equipo": 0.5}'::jsonb,
   'Pesos de reparto usados cuando propina_distribucion = mixto. Deben sumar 1.')
ON CONFLICT (clave) DO NOTHING;
