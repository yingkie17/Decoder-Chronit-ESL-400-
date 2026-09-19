-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0001: esquema de Tickets, Colas y Palmarés
-- -----------------------------------------------------------------------------
-- Complementa init.sql (roles, usuarios, config_pantalla).
-- Unifica el esquema con la base local SQLite de Chronit mediante uuid_global.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- EVENTOS (espejo de future_events de Chronit / fuente de verdad: Chronit)
-- El sistema de tickets mantiene una copia solo-lectura para asignar tickets,
-- pero la lógica de Ready/llamada vive en Chronit (se sincroniza vía sentinela).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventos (
    id             SERIAL PRIMARY KEY,
    uuid_global    UUID NOT NULL UNIQUE,        -- id compartido con future_events
    nombre         TEXT NOT NULL,
    fecha          DATE,
    hora           TIME,
    estado         TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | activo | finalizado
    tipo_carrera   TEXT,                        -- position | time_attack | classification | ...
    tipo_pista     TEXT,
    largo_km       NUMERIC(6,3),
    responsable    TEXT,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- TICKETS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
    id               SERIAL PRIMARY KEY,
    uuid_global      UUID NOT NULL UNIQUE,
    usuario_id       INTEGER NOT NULL REFERENCES usuarios(id),
    evento_id        INTEGER REFERENCES eventos(id),      -- se asigna cuando se paga
    numero           INTEGER NOT NULL,                     -- secuencial por evento
    estado           TEXT NOT NULL DEFAULT 'pendiente_pago',
    -- pendiente_pago | pagado | asignado | en_pista | finalizado
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    pagado_en        TIMESTAMPTZ,
    asignado_en      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tickets_evento ON tickets(evento_id);
CREATE INDEX IF NOT EXISTS idx_tickets_usuario ON tickets(usuario_id);

-- -----------------------------------------------------------------------------
-- COLAS (estado de llamada a vestidor de cada ticket)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS colas (
    id          SERIAL PRIMARY KEY,
    ticket_id   INTEGER NOT NULL UNIQUE REFERENCES tickets(id),
    evento_id   INTEGER REFERENCES eventos(id),
    estado      TEXT NOT NULL DEFAULT 'espera',
    -- espera | llamado | vestidor1 | vestidor2 | ready | en_pista
    vestidor    INTEGER,                          -- 1 | 2 | NULL
    llamada_en  TIMESTAMPTZ,
    ready_en    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_colas_evento ON colas(evento_id);
CREATE INDEX IF NOT EXISTS idx_colas_estado ON colas(estado);

-- -----------------------------------------------------------------------------
-- RESULTADOS DE CARRERA (historial del piloto) — espejo de race_drivers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resultados_carrera (
    id            SERIAL PRIMARY KEY,
    uuid_global   UUID NOT NULL UNIQUE,
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
    evento_id     INTEGER REFERENCES eventos(id),
    fecha         TIMESTAMPTZ,
    posicion      INTEGER,
    tiempo_total  TEXT,
    mejor_vuelta  TEXT,
    circuito      TEXT,
    vuelta_rapida BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_resultados_usuario ON resultados_carrera(usuario_id);

-- -----------------------------------------------------------------------------
-- LOGROS / PREMIOS (palmarés) — separado del historial
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS logros (
    id             SERIAL PRIMARY KEY,
    uuid_global    UUID NOT NULL UNIQUE,
    usuario_id     INTEGER NOT NULL REFERENCES usuarios(id),
    tipo           TEXT NOT NULL,                -- trofeo | medalla | titulo | record | logro
    descripcion    TEXT,
    evento_id_ref  INTEGER REFERENCES eventos(id),  -- opcional
    fecha          TIMESTAMPTZ,
    imagen         TEXT
);
CREATE INDEX IF NOT EXISTS idx_logros_usuario ON logros(usuario_id);

-- -----------------------------------------------------------------------------
-- COLA DE SINCRONIZACIÓN (outbox) — operaciones pendientes de replicar
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_operaciones (
    id            SERIAL PRIMARY KEY,
    origen        TEXT NOT NULL,                 -- sqlite | postgres
    tabla         TEXT NOT NULL,
    operacion     TEXT NOT NULL,                 -- insert | update | delete
    uuid_ref      UUID NOT NULL,
    payload       JSONB,
    timestamp     TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado        TEXT NOT NULL DEFAULT 'pendiente'  -- pendiente | aplicada | conflicto
);
CREATE INDEX IF NOT EXISTS idx_sync_pendientes ON sync_operaciones(estado, timestamp);
