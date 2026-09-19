-- =============================================================================
-- CHRONIT ECOSYSTEM — CRM interno centralizado (Fase 4)
-- -----------------------------------------------------------------------------
-- Este módulo es de SOLO LECTURA sobre los datos de los demás sistemas
-- (carreras, tickets, caja/contabilidad, usuarios, página web). Por eso su
-- migración NO crea tablas de negocio nuevas: sólo
--
--   1. crm_auditoria                        -> registro de operaciones sensibles
--                                              (consultas con filtros y exportes).
--   2. Arquitectura del MÓDULO BIOMÉTRICO   -> tablas preparadas para registrar
--      (empleados, dispositivos y asistencia) las horas de entrada/salida, los
--      días trabajados y la gestión de personal.
--
-- Idempotente: puede re-ejecutarse sin efectos secundarios.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Auditoría del CRM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_auditoria (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  accion      TEXT NOT NULL,              -- consultar | exportar
  recurso     TEXT NOT NULL,              -- personas | tickets | carreras | caja | ...
  filtros     JSONB,
  filas       INTEGER,
  formato     TEXT,                       -- json | csv
  ip          TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_auditoria_creado  ON crm_auditoria (creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_crm_auditoria_recurso ON crm_auditoria (recurso, creado_en DESC);

COMMENT ON TABLE crm_auditoria IS
  'Registro de operaciones sensibles del CRM (consultas filtradas y exportes).';

-- ---------------------------------------------------------------------------
-- 2. MÓDULO BIOMÉTRICO — arquitectura preparada (aún sin datos)
-- ---------------------------------------------------------------------------
-- Dispositivos de marcaje (lector de huella, reconocimiento facial, tarjeta…).
CREATE TABLE IF NOT EXISTS crm_biometrico_dispositivos (
  id            BIGSERIAL PRIMARY KEY,
  nombre        TEXT NOT NULL,
  ubicacion     TEXT,
  tipo          TEXT NOT NULL DEFAULT 'huella',   -- huella | rostro | tarjeta | pin
  identificador TEXT,                              -- serie / IP / MAC del equipo
  activo        BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE crm_biometrico_dispositivos IS
  'Lectores biométricos de asistencia. Preparado para el módulo de personal.';

-- Ficha laboral del empleado, enlazada al usuario del ecosistema.
CREATE TABLE IF NOT EXISTS crm_empleados (
  id                BIGSERIAL PRIMARY KEY,
  usuario_id        INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  codigo_empleado   TEXT UNIQUE,
  cargo             TEXT,
  departamento      TEXT,
  fecha_ingreso     DATE,
  fecha_baja        DATE,
  horas_contrato    NUMERIC(6,2),               -- jornada contractual semanal
  activo            BOOLEAN NOT NULL DEFAULT true,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_empleados_usuario ON crm_empleados (usuario_id);
CREATE INDEX IF NOT EXISTS idx_crm_empleados_activo  ON crm_empleados (activo);

COMMENT ON TABLE crm_empleados IS
  'Ficha laboral del personal. Base del módulo biométrico (entrada/salida).';

-- Marcaciones de asistencia: cada entrada o salida del empleado.
CREATE TABLE IF NOT EXISTS crm_asistencia (
  id             BIGSERIAL PRIMARY KEY,
  empleado_id    BIGINT NOT NULL REFERENCES crm_empleados(id) ON DELETE CASCADE,
  dispositivo_id BIGINT REFERENCES crm_biometrico_dispositivos(id) ON DELETE SET NULL,
  tipo           TEXT NOT NULL,                  -- entrada | salida
  ocurrido_en    TIMESTAMPTZ NOT NULL,
  origen         TEXT NOT NULL DEFAULT 'biometrico', -- biometrico | manual | api
  verificado     BOOLEAN NOT NULL DEFAULT false,
  observacion    TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_asistencia_empleado ON crm_asistencia (empleado_id, ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS idx_crm_asistencia_fecha    ON crm_asistencia (ocurrido_en DESC);

COMMENT ON TABLE crm_asistencia IS
  'Marcaciones de entrada/salida. Origen biométrico (o manual justificado).';

-- Resumen diario por empleado: primera entrada, última salida y nº de marcas.
-- El CRM lo consulta ya agregado para no recalcular en cada petición.
CREATE OR REPLACE VIEW crm_asistencia_diaria AS
SELECT
  a.empleado_id,
  (a.ocurrido_en AT TIME ZONE 'America/La_Paz')::date AS dia,
  MIN(a.ocurrido_en) FILTER (WHERE a.tipo = 'entrada') AS primera_entrada,
  MAX(a.ocurrido_en) FILTER (WHERE a.tipo = 'salida')  AS ultima_salida,
  COUNT(*) FILTER (WHERE a.tipo = 'entrada')::int AS entradas,
  COUNT(*) FILTER (WHERE a.tipo = 'salida')::int  AS salidas
FROM crm_asistencia a
GROUP BY a.empleado_id, (a.ocurrido_en AT TIME ZONE 'America/La_Paz')::date;

COMMENT ON VIEW crm_asistencia_diaria IS
  'Resumen diario de asistencia por empleado (días trabajados y horas).';
