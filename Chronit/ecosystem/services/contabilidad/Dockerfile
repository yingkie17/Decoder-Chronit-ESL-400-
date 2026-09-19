# =============================================================================
# CHRONIT ECOSYSTEM — Módulo de Contabilidad (Node.js + Express)
# Contexto de build: ./services/contabilidad
# =============================================================================
FROM node:20-alpine

WORKDIR /app

# Manifiestos primero (caché de capas)
COPY backend/package*.json ./

# better-sqlite3 es nativo: necesita cadena de compilación. Se instala, se
# compila y luego se eliminan las herramientas para no engordar la imagen.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm install --omit=dev \
 && apk del .build-deps

# Herramientas del RESPALDO FISCAL (backup diario):
#   pg_dump / pg_restore -> volcado y prueba de restauración
#   gnupg                -> cifrado simétrico AES256 del respaldo
#   rclone               -> copia externa a Backblaze B2 / S3
RUN apk add --no-cache gnupg rclone ca-certificates \
 && (apk add --no-cache postgresql17-client || apk add --no-cache postgresql16-client)

# Código fuente
COPY backend/src ./src

# Migraciones SQL (runner propio del módulo)
COPY db/migrations ./db/migrations

# Cola offline (SQLite) — se monta un volumen sobre /app/data en compose.
RUN mkdir -p /app/data

# Directorio de respaldos fiscales (se monta un volumen en compose).
RUN mkdir -p /app/backups

ENV NODE_ENV=production
EXPOSE 4100

# Migraciones + seed idempotentes antes de arrancar el API.
CMD ["sh", "-c", "node src/db/migrate.js && node src/db/seed.js && node src/index.js"]
