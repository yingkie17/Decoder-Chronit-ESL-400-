#!/bin/bash
# CHRONIT Racing System - Instalador para Linux

echo "========================================"
echo "   🏁 CHRONIT Racing System v3.0"
echo "========================================"
echo ""

# Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker no está instalado"
    echo ""
    echo "📥 Instalando Docker automáticamente..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker $USER
    echo ""
    echo "✅ Docker instalado"
    echo "⚠️ Por favor, cierra sesión y vuelve a entrar, luego ejecuta este script nuevamente."
    exit 1
fi

echo "✅ Docker encontrado"

# Crear directorio en HOME
INSTALL_DIR="$HOME/CHRONIT"
mkdir -p "$INSTALL_DIR/data"

# Copiar archivos
cp -r ../src "$INSTALL_DIR/"
cp -r ../infrastructure "$INSTALL_DIR/"
cp ../Dockerfile "$INSTALL_DIR/" 2>/dev/null

echo "✅ Archivos copiados a: $INSTALL_DIR"

# Crear scripts de inicio
cat > "$HOME/Desktop/CHRONIT-Iniciar.sh" << 'DESKTOP_SCRIPT'
#!/bin/bash
cd "$HOME/CHRONIT/infrastructure"
docker compose up --build
read -p "Presiona Enter para cerrar"
DESKTOP_SCRIPT

cat > "$HOME/Desktop/CHRONIT-Apagar.sh" << 'DESKTOP_SCRIPT'
#!/bin/bash
cd "$HOME/CHRONIT/infrastructure"
docker compose down
read -p "Presiona Enter para cerrar"
DESKTOP_SCRIPT

cat > "$HOME/Desktop/CHRONIT-Reset.sh" << 'DESKTOP_SCRIPT'
#!/bin/bash
cd "$HOME/CHRONIT/infrastructure"
docker compose restart
read -p "Presiona Enter para cerrar"
DESKTOP_SCRIPT

chmod +x "$HOME/Desktop/CHRONIT-Iniciar.sh"
chmod +x "$HOME/Desktop/CHRONIT-Apagar.sh"
chmod +x "$HOME/Desktop/CHRONIT-Reset.sh"

echo ""
echo "========================================"
echo "   ✅ INSTALACION COMPLETADA"
echo "========================================"
echo ""
echo "📁 Accesos directos creados en el escritorio:"
echo "   🏁 CHRONIT-Iniciar.sh - Iniciar el sistema"
echo "   🛑 CHRONIT-Apagar.sh - Detener el sistema"
echo "   🔄 CHRONIT-Reset.sh - Reiniciar el sistema"
echo ""
echo "🌐 Accede a la web: http://localhost:5000"
echo ""
read -p "Presiona Enter para salir"
