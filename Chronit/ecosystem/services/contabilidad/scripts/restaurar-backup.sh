#!/bin/sh
# =============================================================================
# CHRONIT ECOSYSTEM — Restauración de un respaldo fiscal
# -----------------------------------------------------------------------------
# Uso:
#   ./restaurar-backup.sh <archivo.dump[.gpg]> [DATABASE_URL]
#
#   - Si el archivo termina en .gpg se descifra con BACKUP_GPG_PASSPHRASE
#     (o se pide por prompt si no está definida).
#   - Se restaura en una base de datos de PRUEBA (por defecto chronit_restore)
#     para no tocar la base en producción.
#
# Ejemplo (dentro del contenedor):
#   docker exec -it chronit-contabilidad-backend \
#     sh /app/scripts/restaurar-backup.sh /app/backups/chronit_2026-09-17_....dump.gpg
#
# Prueba mensual: el programador del backend ejecuta `pg_restore --list` sobre
# el último respaldo el día 1 de cada mes (ver POST /api/conta/backup/verificar).
# =============================================================================
set -eu

ARCHIVO="${1:-}"
DESTINO_DB="${2:-}"

if [ -z "$ARCHIVO" ]; then
  echo "Uso: $0 <archivo.dump[.gpg]> [DATABASE_URL]" >&2
  exit 1
fi

if [ ! -f "$ARCHIVO" ]; then
  echo "ERROR: no existe el archivo $ARCHIVO" >&2
  exit 1
fi

if [ -z "$DESTINO_DB" ]; then
  # Base de prueba: nunca se restaura encima de la base en uso.
  BASE_ORIGEN="${DATABASE_URL:-postgresql://chronit:chronit_secret@postgres:5432/chronit}"
  DESTINO_DB="$(echo "$BASE_ORIGEN" | sed 's#/[^/]*$#/chronit_restore#')"
fi

TMP=""
case "$ARCHIVO" in
  *.gpg)
    PASSPHRASE="${BACKUP_GPG_PASSPHRASE:-}"
    if [ -z "$PASSPHRASE" ]; then
      printf 'Passphrase GPG: '
      stty -echo 2>/dev/null || true
      read -r PASSPHRASE
      stty echo 2>/dev/null || true
      echo
    fi
    TMP="$(mktemp /tmp/restore-XXXXXX.dump)"
    echo "==> Descifrando $ARCHIVO"
    printf '%s' "$PASSPHRASE" | gpg --batch --yes --quiet --decrypt \
      --passphrase-fd 0 --output "$TMP" "$ARCHIVO"
    ORIGEN="$TMP"
    ;;
  *)
    ORIGEN="$ARCHIVO"
    ;;
esac

trap 'if [ -n "$TMP" ]; then rm -f "$TMP"; fi' EXIT

echo "==> Validando el volcado (pg_restore --list)"
TABLAS="$(pg_restore --list "$ORIGEN" | grep -c 'TABLE DATA' || true)"
echo "    Tablas con datos detectadas: $TABLAS"

echo "==> Restaurando en $DESTINO_DB (--clean --if-exists)"
pg_restore --dbname="$DESTINO_DB" --clean --if-exists --no-owner --no-acl "$ORIGEN"

echo "==> Listo. Verifique con: psql \"$DESTINO_DB\" -c '\\dt conta_*'"
