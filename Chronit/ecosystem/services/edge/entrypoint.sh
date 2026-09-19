#!/bin/sh
# =============================================================================
# CHRONIT ECOSYSTEM — Borde TLS: arranque
# -----------------------------------------------------------------------------
# Certificado:
#   * PRODUCCIÓN: monta tu certificado en /etc/nginx/certs con los nombres
#     server.crt (cadena completa) y server.key (clave privada). Ej. Let's
#     Encrypt:
#       cp /etc/letsencrypt/live/<dominio>/fullchain.pem services/edge/certs/server.crt
#       cp /etc/letsencrypt/live/<dominio>/privkey.pem   services/edge/certs/server.key
#     Si ambos existen, NO se genera nada (se usan tal cual).
#   * DESARROLLO / RED INTERNA: si faltan, se genera un certificado autofirmado
#     con CN=${TLS_CN} y los SAN indicados (el navegador avisará hasta instalar
#     uno válido).
#
# Variables:
#   TLS_CN         Nombre común del certificado autofirmado (default: localhost)
#   TLS_IP         IP a incluir en el SAN (default: 127.0.0.1)
#   TLS_EXTRA_SAN  SANs adicionales separados por coma (ej. "DNS:kiosco.local")
# =============================================================================
set -e

CERT_DIR=/etc/nginx/certs
CRT="$CERT_DIR/server.crt"
KEY="$CERT_DIR/server.key"
mkdir -p "$CERT_DIR"

if [ -f "$CRT" ] && [ -f "$KEY" ]; then
  echo "[edge] Usando el certificado existente en $CERT_DIR (server.crt/server.key)"
else
  CN="${TLS_CN:-localhost}"
  IP="${TLS_IP:-127.0.0.1}"
  SAN="DNS:localhost,DNS:$CN,IP:127.0.0.1,IP:$IP"
  if [ -n "$TLS_EXTRA_SAN" ]; then
    SAN="$SAN,$TLS_EXTRA_SAN"
  fi

  echo "[edge] Generando certificado AUTOFIRMADO (CN=$CN, SAN=$SAN)..."
  echo "[edge] AVISO: es un certificado de desarrollo; el navegador mostrará un"
  echo "[edge] aviso de seguridad. Para producción, monta un certificado válido."
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$KEY" \
    -out "$CRT" \
    -subj "/C=BO/O=CHRONIT/CN=$CN" \
    -addext "subjectAltName=$SAN" >/dev/null 2>&1
  chmod 600 "$KEY"
  echo "[edge] Certificado autofirmado listo en $CERT_DIR"
fi

exec nginx -g 'daemon off;'
