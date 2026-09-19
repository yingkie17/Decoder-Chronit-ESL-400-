# =============================================================================
# CHRONIT ECOSYSTEM — Web de Cliente (Next.js) — feed + cuenta del piloto
# Conecta a PostgreSQL (base universal) y usa Valkey para la sesión.
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 🔥 Indica al código que estamos en BUILD (NEXT_PHASE).
# Esto hace que session.ts use un mock y NO intente conectar a Valkey
# durante `npm run build` (evita "getaddrinfo ENOTFOUND valkey").
ENV NEXT_PHASE=phase-production-build

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# El usuario `node` de la imagen corre como uid 1000, que coincide con el
# dueño del directorio de uploads montado desde el host (bind mount). Así el
# contenedor puede escribir las fotos. Antes se usaba `nextjs` (uid 100), que
# era "otros" sobre el volumen → EACCES al registrar con foto.
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3001
CMD ["node", "server.js"]
