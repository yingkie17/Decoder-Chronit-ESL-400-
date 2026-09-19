-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD
-- Migración 0007: SEED inicial (idempotente)
-- -----------------------------------------------------------------------------
-- Valores por defecto para arrancar el módulo sin configuración manual:
--   * 11 claves de configuración
--   * 2 impuestos (IVA 13%, Exento 0%)
--   * 5 productos (3 carreras + 2 combos) con lista de precios vigente
--   * 2 combos
--   * 4 métodos de pago
--   * 2 cuentas destino (caja física + QR genérico)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CONFIGURACIÓN
-- -----------------------------------------------------------------------------
INSERT INTO conta_configuracion (clave, valor, descripcion, editable_por_rol) VALUES
    ('umbral_egreso_cajero',        '500'::jsonb,       'Monto máximo de egreso que un cajero puede registrar sin autorización de supervisor.', ARRAY['supervisor','admin','desarrollador']),
    ('umbral_descuento_supervisor', '50'::jsonb,        'Descuento máximo que un cajero puede aplicar sin autorización de supervisor.', ARRAY['supervisor','admin','desarrollador']),
    ('iva_modo_default',            '"incluido"'::jsonb,'Modo de IVA por defecto para productos con iva_modo=hereda.', ARRAY['contador','supervisor','admin','desarrollador']),
    ('iva_porcentaje_default',      '13'::jsonb,        'Porcentaje de IVA por defecto (%).', ARRAY['contador','supervisor','admin','desarrollador']),
    ('tipo_factura_default',        '"factura"'::jsonb, 'Tipo de factura por defecto emitida en las ventas.', ARRAY['contador','supervisor','admin','desarrollador']),
    ('requiere_nit_por_defecto',    'false'::jsonb,     'Si es true, se exige NIT del cliente al emitir factura (eximible con autorización de supervisor).', ARRAY['supervisor','admin','desarrollador']),
    ('propina_habilitada',          'true'::jsonb,      'Habilita el registro de propinas.', ARRAY['supervisor','admin','desarrollador']),
    ('propina_modo',                '"acumulada"'::jsonb, 'inmediata | acumulada | mixta.', ARRAY['supervisor','admin','desarrollador']),
    ('propina_porcentaje_sugerido', '10'::jsonb,        'Porcentaje de propina sugerido en el POS (%).', ARRAY['supervisor','admin','desarrollador']),
    ('propina_distribucion',        '"por_cajero"'::jsonb, 'por_cajero | por_kart | por_equipo | mixto.', ARRAY['supervisor','admin','desarrollador']),
    ('combo_modo_default',          '"unico"'::jsonb,   'Modo de facturación por defecto de combos: unico | desglosado.', ARRAY['contador','supervisor','admin','desarrollador'])
ON CONFLICT (clave) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2) IMPUESTOS
-- -----------------------------------------------------------------------------
INSERT INTO conta_impuestos (nombre, porcentaje, tipo, aplica_a, activo) VALUES
    ('IVA 13%', 13.00, 'iva',    ARRAY['productos','combos','servicios'], true),
    ('Exento',   0.00, 'exento', ARRAY['productos','combos','servicios'], true)
ON CONFLICT (nombre) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3) PRODUCTOS
-- -----------------------------------------------------------------------------
INSERT INTO conta_productos (nombre, tipo, vueltas, duracion_min, categoria, iva_modo) VALUES
    ('Carrera 5 vueltas',  'carrera', 5,  NULL, 'carrera', 'incluido'),
    ('Carrera 10 vueltas', 'carrera', 10, NULL, 'carrera', 'incluido'),
    ('Carrera 15 vueltas', 'carrera', 15, NULL, 'carrera', 'incluido'),
    ('Combo Simple',       'combo',   NULL, NULL, 'combo',  'incluido'),
    ('Combo Comida',       'combo',   NULL, NULL, 'comida', 'incluido')
ON CONFLICT (nombre) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4) COMBOS (modo unico por defecto)
-- -----------------------------------------------------------------------------
INSERT INTO conta_combos (nombre, items, precio, modo_facturacion, iva_modo_hereda) VALUES
    ('Combo Simple',  '[{"producto":"Carrera 10 vueltas","cantidad":1}]'::jsonb, 120.00, 'unico', true),
    ('Combo Comida',  '[{"producto":"Carrera 10 vueltas","cantidad":1},{"producto":"Combo Simple","cantidad":1}]'::jsonb, 160.00, 'unico', true)
ON CONFLICT (nombre) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5) LISTA DE PRECIOS VIGENTE + PRECIOS
-- -----------------------------------------------------------------------------
INSERT INTO conta_listas_precios (nombre, vigencia_desde, vigencia_hasta, activo)
SELECT 'Lista General', CURRENT_DATE - 1, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM conta_listas_precios WHERE nombre = 'Lista General');

INSERT INTO conta_precios (lista_id, producto_id, precio, moneda)
SELECT l.id, p.id, v.precio, 'BOB'
FROM conta_listas_precios l
CROSS JOIN (VALUES
    ('Carrera 5 vueltas',   60.00),
    ('Carrera 10 vueltas', 100.00),
    ('Carrera 15 vueltas', 140.00),
    ('Combo Simple',       120.00),
    ('Combo Comida',       180.00)
) AS v(nombre, precio)
JOIN conta_productos p ON p.nombre = v.nombre
WHERE l.nombre = 'Lista General'
ON CONFLICT (lista_id, producto_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6) MÉTODOS DE PAGO
-- -----------------------------------------------------------------------------
INSERT INTO conta_metodos_pago (nombre, tipo) VALUES
    ('Efectivo',      'efectivo'),
    ('QR',            'qr'),
    ('Transferencia', 'transferencia'),
    ('Cortesía',      'cortesia')
ON CONFLICT (nombre) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7) CUENTAS DESTINO
-- -----------------------------------------------------------------------------
INSERT INTO conta_cuentas_destino (nombre, tipo, titular, banco, numero, es_efectivo_caja, activo) VALUES
    ('Caja física',        'efectivo', 'CHRONIT', NULL,                        NULL,          true,  true),
    ('QR Genérico',        'qr',       'CHRONIT', 'Banco (placeholder)',        '000-0000000', false, true)
ON CONFLICT (nombre) DO NOTHING;
