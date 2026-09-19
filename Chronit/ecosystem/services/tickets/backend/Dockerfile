# =============================================================================
# CHRONIT ECOSYSTEM — Backend de Tickets (Node.js + Express)
# Contexto de build: ./services/tickets
# =============================================================================
FROM node:20-alpine

WORKDIR /app

# Copiar primero los manifiestos para aprovechar la caché de capas
COPY backend/package*.json ./

RUN npm install

# Copiar código fuente
COPY backend/src ./src

# Copiar migraciones SQL (para el runner de migraciones)
COPY db/migrations ./db/migrations

ENV NODE_ENV=production
EXPOSE 4000

# Aplicar migraciones de esquema (tickets/colas/eventos) + seed de usuarios
# por defecto antes de arrancar. Así los 3 usuarios de prueba (ADMIN-001,
# CAJERO-001, COORD-001) siempre existen, incluso tras `docker compose down -v`.
CMD ["sh", "-c", "node src/db/migrate.js && node src/db/seed.js && node src/index.js"]
