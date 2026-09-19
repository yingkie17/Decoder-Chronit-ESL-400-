-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0002: Web de cliente (perfil ampliado + feed social)
-- -----------------------------------------------------------------------------
-- 1) Amplía `usuarios` con edad y género (registro desde la web y desde el
--    kiosco de cliente). El sync usa columnas explícitas, por lo que no rompe.
-- 2) Crea el feed social noticias/eventos: `posts`, `post_likes`, `post_comments`.
-- =============================================================================

-- Perfil ampliado del piloto ------------------------------------------------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS edad INTEGER;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS genero TEXT;   -- masculino | femenino
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS portada TEXT;  -- foto de portada (cover)

-- FEED SOCIAL ---------------------------------------------------------------
-- Publicaciones del kart: noticias, eventos, fotos, resultados. autor_id es el
-- usuario que la publica (staff/admin normalmente, pero cualquier piloto puede
-- publicar un estado). tipo controla el render (noticia|evento|foto|resultado).
CREATE TABLE IF NOT EXISTS posts (
    id             SERIAL PRIMARY KEY,
    uuid_global    UUID NOT NULL UNIQUE,
    autor_id       INTEGER REFERENCES usuarios(id),
    tipo           TEXT NOT NULL DEFAULT 'noticia',  -- noticia | evento | foto | resultado
    titulo         TEXT,
    contenido      TEXT,
    imagen         TEXT,
    evento_id      INTEGER REFERENCES eventos(id),   -- opcional, para rela carreras
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_autor ON posts(autor_id);
CREATE INDEX IF NOT EXISTS idx_posts_creado ON posts(creado_en DESC NULLS LAST);

-- "Me gusta" de una publicación (un like por usuario y post)
CREATE TABLE IF NOT EXISTS post_likes (
    id          SERIAL PRIMARY KEY,
    post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (post_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);

-- Comentarios de una publicación
CREATE TABLE IF NOT EXISTS post_comments (
    id          SERIAL PRIMARY KEY,
    post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    autor_id    INTEGER REFERENCES usuarios(id),
    contenido   TEXT NOT NULL,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id);
