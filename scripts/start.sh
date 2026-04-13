#!/bin/bash

# Colores para que sea fácil de leer
VERDE='\033[0;32m'
AMARILLO='\033[1;33m'
NC='\033[0m' # Sin color

echo -e "${AMARILLO}--- PROTOCOLO DE CONEXIÓN SEGURA CHRONIT ---${NC}"

# 1. Instrucción de Hardware
echo -e "1. ${AMARILLO}ASEGÚRATE:${NC} El cable USB debe estar DESCONECTADO de la laptop."
echo -e "2. ${AMARILLO}PASO:${NC} Conecta la fuente de poder al Chronit y espera 3 segundos."
read -p "Presiona [Enter] cuando el Chronit tenga energía..."

echo -e "3. ${AMARILLO}PASO:${NC} Ahora conecta el cable USB a la laptop."
read -p "Presiona [Enter] cuando hayas conectado el USB..."

# 2. Detección Automática
PORT=$(ls /dev/ttyUSB* 2>/dev/null | head -n 1)

if [ -z "$PORT" ]; then
    echo -e "❌ ${AMARILLO}Error:${NC} No se detectó el puerto. Prueba desconectar y conectar de nuevo."
    exit 1
fi

# 3. Limpieza de "Basura" en el puerto (Evita el error de memoria)
echo -e "🔧 Limpiando ruidos del puerto $PORT..."
sudo stty -F $PORT 9600 raw -echo -echoe -echok -echoctl -echoke 2>/dev/null
sudo chmod 666 $PORT

# 4. Lanzar Docker (desde la carpeta del proyecto)
echo -e "${VERDE}✅ Todo listo. Iniciando Servidores...${NC}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/infrastructure"
export SERIAL_PORT=$PORT
docker compose up "$@"