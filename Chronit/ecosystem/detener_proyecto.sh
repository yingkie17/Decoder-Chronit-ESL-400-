#!/bin/bash

RUTA_PROYECTO="/home/gokart/Escritorio/AmbientePruebas/Chronit/ecosystem/"

echo "🛑 Deteniendo el proyecto Chronit..."

cd "$RUTA_PROYECTO" || { 
    echo "❌ Error: No encuentro la carpeta del proyecto."
    read -p "Presiona Enter para salir..."
    exit 1
}

echo "🧹 Deteniendo y eliminando contenedores..."
docker compose stop &&
docker compose down

echo "✅ Proyecto detenido. Todos los contenedores fueron eliminados."
read -p "Presiona Enter para cerrar esta ventana..."