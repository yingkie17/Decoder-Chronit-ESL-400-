-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD
-- Migración 0001: roles extendidos + configuración + impuestos + auditoría
-- -----------------------------------------------------------------------------
-- Idempotente: puede ejecutarse varias veces sin efectos secundarios.
-- No modifica ninguna tabla existente del módulo de tickets (solo hace INSERT
-- de roles nuevos, que es aditivo).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Roles nuevos del módulo contable (JSONB de permisos)
--    Se conservan los roles existentes (piloto, cajero, coordinador, admin,
--    desarrollador) y se AGREGAN supervisor, contador, socio y dueno.
-- -----------------------------------------------------------------------------
INSERT INTO roles (nombre, permisos) VALUES
    ('supervisor', '{
        "abrir_caja": true, "cerrar_caja": true, "reabrir_caja": true,
        "registrar_ventas": true, "registrar_egresos": true,
        "autorizar_descuentos": true, "autorizar_egresos": true,
        "autorizar_anulaciones": true, "editar_configuracion": true,
        "rotar_qr": true, "ver_todas_cajas": true, "ver_reportes": true,
        "pagar_propinas": true, "anular_propinas": true
    }'),
    ('contador', '{
        "gestionar_catalogo": true, "gestionar_precios": true,
        "gestionar_promociones": true, "gestionar_cuentas": true,
        "registrar_egresos": true, "registrar_ingresos": true,
        "ver_reportes": true, "exportar": true, "config_impuestos": true,
        "conciliar_qr": true, "ver_propinas": true
    }'),
    ('socio', '{
        "ver_reportes": true, "ver_qr": true, "ver_propinas": true,
        "solo_lectura": true
    }'),
    ('dueno', '{
        "ver_dashboard": true, "ver_rentabilidad": true,
        "ver_comparativos": true, "solo_lectura": true
    }')
ON CONFLICT (nombre) DO UPDATE SET permisos = EXCLUDED.permisos;

-- -----------------------------------------------------------------------------
-- 2) Configuración del sistema contable (clave -> valor JSONB)
--    editable_por_rol: roles autorizados a modificar la clave.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_configuracion (
    id                SERIAL PRIMARY KEY,
    clave             TEXT NOT NULL UNIQUE,
    valor             JSONB NOT NULL DEFAULT 'null'::jsonb,
    descripcion       TEXT,
    editable_por_rol  TEXT[] NOT NULL DEFAULT ARRAY['supervisor','admin','desarrollador'],
    actualizado_por   INTEGER REFERENCES usuarios(id),
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3) Impuestos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_impuestos (
    id              SERIAL PRIMARY KEY,
    nombre          TEXT NOT NULL UNIQUE,
    porcentaje      NUMERIC(5,2) NOT NULL DEFAULT 0,
    tipo            TEXT NOT NULL DEFAULT 'iva',   -- iva | exento | otro
    aplica_a        TEXT[] NOT NULL DEFAULT ARRAY['productos'],
    activo          BOOLEAN NOT NULL DEFAULT true,
    vigencia_desde  DATE,
    vigencia_hasta  DATE
);

-- -----------------------------------------------------------------------------
-- 4) Auditoría (obligatoria para ventas, pagos, cajas, egresos, propinas,
--    cuentas destino y configuración)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conta_auditoria (
    id              BIGSERIAL PRIMARY KEY,
    usuario_id      INTEGER REFERENCES usuarios(id),
    accion          TEXT NOT NULL,            -- crear | editar | eliminar | anular | reabrir | autorizar | rotar | pago
    entidad         TEXT NOT NULL,            -- venta | pago | sesion_caja | egreso | propina | cuenta_destino | configuracion | usuario
    entidad_id      TEXT,
    datos_antes     JSONB,
    datos_despues   JSONB,
    ip              TEXT,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_auditoria_entidad ON conta_auditoria(entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_conta_auditoria_usuario ON conta_auditoria(usuario_id, creado_en DESC);
