#!/bin/bash

RUTA_PROYECTO="/home/gokart/Escritorio/Chronit/ecosystem"

echo "🔄 Reiniciando el proyecto Chronit..."

cd "$RUTA_PROYECTO" || exit

echo "🛑 Deteniendo contenedores actuales..."
docker compose down

echo "📦 Reconstruyendo imágenes..."
docker compose build --no-cache

echo "🐳 Levantando contenedores..."
docker compose up -d

echo "✅ Proyecto reiniciado correctamente."
docker ps
read -p "Presiona Enter para cerrar..."