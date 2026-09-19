-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v2)
-- Migración 0009: sucursales, turnos, PIN de supervisor y multi-sucursal
-- -----------------------------------------------------------------------------
-- Idempotente: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.
-- Aditiva: no elimina ni renombra columnas existentes; el módulo v1 sigue
-- funcionando sin cambios aunque estas columnas queden en NULL.
--
-- Contenido:
--   1) conta_sucursales          + seed de 1 sucursal por defecto
--   2) conta_turnos              (agrupa sesiones de caja; cierra el supervisor)
--   3) conta_supervisor_pins     (PIN 4-6 dígitos con bcrypt)
--   4) sucursal_id en tablas transaccionales (multi-sucursal)
--   5) turno_id en sesiones_caja y ventas
--   6) costo_unitario / stock en productos (base para kardex y valorización)
--   7) claves de configuración nuevas (backup, alertas, PIN, umbrales)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) SUCURSALES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_sucursales (
    id         SERIAL PRIMARY KEY,
    nombre     TEXT NOT NULL,
    direccion  TEXT,
    telefono   TEXT,
    activo     BOOLEAN NOT NULL DEFAULT true,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_sucursales_nombre ON conta_sucursales(nombre);

INSERT INTO conta_sucursales (nombre, direccion, telefono)
SELECT 'Sucursal Central', 'Oficina central', NULL
WHERE NOT EXISTS (SELECT 1 FROM conta_sucursales);

-- -----------------------------------------------------------------------------
-- 2) TURNOS — agrupan varias sesiones de caja de una misma jornada.
--    El turno lo abre/cierra un supervisor.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_turnos (
    id             SERIAL PRIMARY KEY,
    sucursal_id    INTEGER REFERENCES conta_sucursales(id),
    supervisor_id  INTEGER REFERENCES usuarios(id),
    apertura_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    cierre_en      TIMESTAMPTZ,
    estado         TEXT NOT NULL DEFAULT 'abierto',   -- abierto | cerrado
    notas          TEXT
);
CREATE INDEX IF NOT EXISTS idx_conta_turnos_estado ON conta_turnos(estado, apertura_en DESC);
CREATE INDEX IF NOT EXISTS idx_conta_turnos_sucursal ON conta_turnos(sucursal_id, apertura_en DESC);
-- Solo puede haber un turno abierto por sucursal a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_turno_abierto
    ON conta_turnos(sucursal_id) WHERE estado = 'abierto' AND sucursal_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3) PIN DE SUPERVISOR — autorizaciones rápidas en el POS sin cerrar sesión.
--    El PIN se guarda hasheado con bcrypt (4-6 dígitos).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_supervisor_pins (
    id         SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    pin_hash   TEXT NOT NULL,
    activo     BOOLEAN NOT NULL DEFAULT true,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un único PIN activo por usuario.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conta_pin_usuario
    ON conta_supervisor_pins(usuario_id) WHERE activo = true;

-- -----------------------------------------------------------------------------
-- 4) MULTI-SUCURSAL: toda tabla transaccional lleva sucursal_id.
--    Se deja NULL-able para no romper filas históricas del módulo v1.
-- -----------------------------------------------------------------------------
ALTER TABLE conta_productos            ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE conta_listas_precios       ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE conta_promociones          ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE conta_combos               ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE conta_cuentas_destino      ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE conta_sesiones_caja        ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE conta_ventas               ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE conta_egresos              ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE conta_movimientos_caja     ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE conta_propinas             ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);
ALTER TABLE conta_auditoria            ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES conta_sucursales(id);

-- -----------------------------------------------------------------------------
-- 5) TURNO en sesiones de caja y ventas
-- -----------------------------------------------------------------------------
ALTER TABLE conta_sesiones_caja ADD COLUMN IF NOT EXISTS turno_id INTEGER REFERENCES conta_turnos(id);
ALTER TABLE conta_ventas        ADD COLUMN IF NOT EXISTS turno_id INTEGER REFERENCES conta_turnos(id);
CREATE INDEX IF NOT EXISTS idx_conta_ventas_sucursal ON conta_ventas(sucursal_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_conta_sesiones_turno  ON conta_sesiones_caja(turno_id);

-- -----------------------------------------------------------------------------
-- 6) Inventario: costo y stock en el producto (kardex / valorización)
-- -----------------------------------------------------------------------------
ALTER TABLE conta_productos ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE conta_productos ADD COLUMN IF NOT EXISTS stock_actual   NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE conta_productos ADD COLUMN IF NOT EXISTS stock_minimo   NUMERIC(12,2) NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 7) Claves de configuración nuevas
--    Se usan INSERT ... ON CONFLICT DO NOTHING para respetar valores ya editados.
-- -----------------------------------------------------------------------------
INSERT INTO conta_configuracion (clave, valor, descripcion) VALUES
    ('sucursal_default',              '1'::jsonb,       'Sucursal por defecto cuando el usuario no tiene una asignada.'),
    ('iva_pct_default',               '13'::jsonb,      'Alias de iva_porcentaje_default (nombre usado en reportes y UI).'),
    ('requiere_nit_default',          'false'::jsonb,   'Alias de requiere_nit_por_defecto.'),
    ('pin_supervisor_habilitado',     'true'::jsonb,    'Permite autorizaciones rápidas con PIN de supervisor.'),
    ('backup_retention_years',        '8'::jsonb,       'Años de retención fiscal de los respaldos (Bolivia: 8).'),
    ('backup_hora',                   '"02:00"'::jsonb, 'Hora local (America/La_Paz) del respaldo diario.'),
    ('backup_destino',                'null'::jsonb,    'Destino externo rclone (B2/S3). null = solo local.'),
    ('backup_gpg_habilitado',         'true'::jsonb,    'Cifra los respaldos con GPG.'),
    ('alertas_habilitadas',           'true'::jsonb,    'Activa el worker de alertas.'),
    ('alertas_config', '{"canales":["in_app"],"telegram_token":null,"telegram_chat_id":null,"email":null,"diferencia_caja_umbral":20,"caja_abierta_horas":14,"qr_sin_confirmar_horas":2,"propinas_pendientes_dias":7,"stock_bajo_unidades":5,"anticipo_aviso_dias":3}'::jsonb,
                                      'Tipos y canales de alerta (in-app, Telegram, email) y sus umbrales.'),
    ('anticipo_dias_vencimiento',     '30'::jsonb,      'Días por defecto de vencimiento de un anticipo.'),
    ('cxc_dias_vencimiento',          '30'::jsonb,      'Días por defecto de vencimiento de una cuenta por cobrar.'),
    ('cxp_dias_vencimiento',          '30'::jsonb,      'Días por defecto de vencimiento de una cuenta por pagar.'),
    ('dosificacion_activa',           'false'::jsonb,   'Activa el uso de dosificaciones SIAT al emitir facturas.'),
    ('siat_habilitado',               'false'::jsonb,   'Activa el envío a SIAT (SOAP). En v1 solo estructura + export CSV.')
ON CONFLICT (clave) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 8) Backfill: las filas históricas quedan en la sucursal por defecto.
-- -----------------------------------------------------------------------------
UPDATE conta_productos       SET sucursal_id = (SELECT MIN(id) FROM conta_sucursales) WHERE sucursal_id IS NULL;
UPDATE conta_listas_precios  SET sucursal_id = (SELECT MIN(id) FROM conta_sucursales) WHERE sucursal_id IS NULL;
UPDATE conta_promociones     SET sucursal_id = (SELECT MIN(id) FROM conta_sucursales) WHERE sucursal_id IS NULL;
UPDATE conta_combos          SET sucursal_id = (SELECT MIN(id) FROM conta_sucursales) WHERE sucursal_id IS NULL;
UPDATE conta_cuentas_destino SET sucursal_id = (SELECT MIN(id) FROM conta_sucursales) WHERE sucursal_id IS NULL;
UPDATE conta_sesiones_caja   SET sucursal_id = (SELECT MIN(id) FROM conta_sucursales) WHERE sucursal_id IS NULL;
UPDATE conta_ventas          SET sucursal_id = (SELECT MIN(id) FROM conta_sucursales) WHERE sucursal_id IS NULL;
UPDATE conta_egresos         SET sucursal_id = (SELECT MIN(id) FROM conta_sucursales) WHERE sucursal_id IS NULL;
UPDATE conta_movimientos_caja SET sucursal_id = (SELECT MIN(id) FROM conta_sucursales) WHERE sucursal_id IS NULL;
UPDATE conta_propinas        SET sucursal_id = (SELECT MIN(id) FROM conta_sucursales) WHERE sucursal_id IS NULL;

COMMENT ON TABLE conta_turnos IS 'Turno de caja por sucursal; agrupa varias sesiones de caja de una jornada.';
COMMENT ON TABLE conta_supervisor_pins IS 'PIN (4-6 dígitos, bcrypt) para autorizaciones rápidas de supervisor en el POS.';
