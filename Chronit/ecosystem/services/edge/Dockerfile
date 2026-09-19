# =============================================================================
# CHRONIT ECOSYSTEM — Borde TLS (nginx) — OPCIONAL
# -----------------------------------------------------------------------------
# Termina TLS en un único punto y reenvía a los servicios internos por HTTP
# dentro de la red `chronit-network`. Los puertos públicos se espejan 1:1 con
# los de cada servicio, de modo que los frontends siguen resolviendo sus APIs
# con el mismo puerto (sólo cambia http:// por https://).
#
# Se levanta SÓLO con el overlay `docker-compose.tls.yml` (los servicios base
# ceden sus puertos de host). No afecta al entorno HTTP de desarrollo.
# =============================================================================
FROM nginx:alpine

# openssl para generar el certificado autofirmado la primera vez.
RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY tls.conf /etc/nginx/snippets/tls.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000 3001 3002 3003 4000 4100 4200

ENTRYPOINT ["/entrypoint.sh"]
