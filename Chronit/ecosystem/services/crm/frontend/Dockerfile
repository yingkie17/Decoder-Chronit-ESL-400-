# =============================================================================
# CHRONIT ECOSYSTEM — CRM INTERNO (Next.js) — proyecto independiente
# -----------------------------------------------------------------------------
# Servicio aislado del resto de paneles: no comparte código fuente ni
# contenedor. Se publica en el puerto 3003 y sólo se comunica con los backends
# por API (autenticación en tickets-backend, datos en crm-backend).
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3003
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3003
CMD ["node", "server.js"]
