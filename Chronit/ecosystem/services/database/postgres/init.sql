-- =============================================================================
-- CHRONIT ECOSYSTEM — PostgreSQL: esquema inicial del módulo de Tickets/Colas
-- -----------------------------------------------------------------------------
-- Se crean las tablas base de usuarios/roles y de configuración. Las tablas de
-- tickets, colas, resultados y palmarés se añaden en la fase de "Modelos de BD".
-- =============================================================================

-- Usuarios y roles (web de pilotos + kiosco + admin)
CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    nombre      TEXT NOT NULL UNIQUE,          -- piloto | cajero | coordinador | admin | desarrollador
    permisos    JSONB NOT NULL DEFAULT '{}',   -- ej: {"pagar": true, "asignar": false}
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios (
    id            SERIAL PRIMARY KEY,
    uuid_global   UUID NOT NULL UNIQUE,        -- identidad compartida con SQLite
    nombre        TEXT NOT NULL,
    apellido      TEXT NOT NULL DEFAULT '',
    email         TEXT,
    telefono      TEXT,
    carnet        TEXT NOT NULL,               -- clave natural humana
    password_hash TEXT NOT NULL,
    foto          TEXT,
    nacionalidad  TEXT,                        -- código ISO 3166-1 alpha-2 (ej: 'CL')
    rol           TEXT NOT NULL DEFAULT 'piloto' REFERENCES roles(nombre),
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usuarios_carnet     ON usuarios(carnet);
CREATE INDEX IF NOT EXISTS idx_usuarios_email      ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_telefono   ON usuarios(telefono);
CREATE INDEX IF NOT EXISTS idx_usuarios_uuid_global ON usuarios(uuid_global);

-- Configuración de la pantalla pública (carrusel de imágenes/videos)
CREATE TABLE IF NOT EXISTS config_pantalla (
    id            SERIAL PRIMARY KEY,
    tipo          TEXT NOT NULL,                -- imagen | video
    url           TEXT NOT NULL,
    duracion_seg  INTEGER NOT NULL DEFAULT 5,
    activo        BOOLEAN NOT NULL DEFAULT true,
    orden         INTEGER NOT NULL DEFAULT 0,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roles base (idempotente)
INSERT INTO roles (nombre, permisos) VALUES
    ('piloto',       '{"registrar_web": true, "ver_historial": true, "ver_palmares": true}'),
    ('cajero',       '{"registrar": true, "pagar": true, "asignar_evento": true}'),
    ('coordinador',  '{"llamar": true, "marcar_ready": true, "gestionar_vestidores": true}'),
    ('admin',        '{"configurar_pantalla": true, "gestionar_usuarios": true, "gestionar_eventos": true, "ver_reportes": true, "gestionar_roles": true}'),
    ('desarrollador','{"gestionar_usuarios": true, "gestionar_eventos": true, "configurar_pantalla": true, "ver_reportes": true, "gestionar_roles": true}')
ON CONFLICT (nombre) DO NOTHING;
