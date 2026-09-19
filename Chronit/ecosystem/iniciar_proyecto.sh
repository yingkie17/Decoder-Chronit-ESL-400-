#!/bin/bash

# Ruta FIJA de tu proyecto
RUTA_PROYECTO="/home/gokart/Escritorio/AmbientePruebas/Chronit/ecosystem/"

echo "🚀 Iniciando el proyecto Chronit en: $RUTA_PROYECTO"

# Verificar que la carpeta existe
if [ ! -d "$RUTA_PROYECTO" ]; then
    echo "❌ Error: No encuentro la carpeta del proyecto."
    echo "   Asegúrate de que existe: $RUTA_PROYECTO"
    read -p "Presiona Enter para salir..."
    exit 1
fi

# Moverse a la carpeta
cd "$RUTA_PROYECTO" || exit


echo "🐳 Levantando contenedores en segundo plano..."
docker compose up

echo "✅ Contenedores activos:"
docker ps

echo ""
echo "🎉 Proyecto iniciado correctamente."
echo "   Para ver los logs: docker compose logs -f"
echo "   Para detener: haz doble clic en 'detener_proyecto.sh'"
read -p "Presiona Enter para cerrar esta ventana..."