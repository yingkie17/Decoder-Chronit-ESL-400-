# =============================================================================
# CHRONIT ECOSYSTEM — CRM interno centralizado (Node.js + Express)
# Contexto de build: ./services/crm
# -----------------------------------------------------------------------------
# Servicio de SOLO LECTURA sobre la base de datos del ecosistema. Comparte la
# sesión (Valkey) y el JWT_SECRET con los demás backends.
# =============================================================================
FROM node:20-alpine

WORKDIR /app

# Manifiesto primero (caché de capas)
COPY backend/package*.json ./
RUN npm install --omit=dev

# Código fuente
COPY backend/src ./src

# Migraciones SQL (runner propio del CRM: auditoría + arquitectura biométrica)
COPY db/migrations ./db/migrations

ENV NODE_ENV=production
EXPOSE 4200

# Migraciones idempotentes antes de arrancar el API (read-only salvo auditoría).
CMD ["sh", "-c", "node src/db/migrate.js && node src/index.js"]
