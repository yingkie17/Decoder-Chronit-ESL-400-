@echo off
echo =========================================
echo 🏁 CHRONIT RACING SYSTEM v6.0
echo =========================================
echo.

REM Verificar Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker no esta instalado
    echo.
    echo 📥 Descargar Docker Desktop de:
    echo    https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

echo ✅ Docker encontrado
echo.

REM Crear estructura
echo 📁 Creando directorios...
mkdir src 2>nul
mkdir src\templates 2>nul
mkdir infrastructure 2>nul
mkdir scripts 2>nul
mkdir docs 2>nul
mkdir docs\instrucciones 2>nul
mkdir tests 2>nul
mkdir data 2>nul

REM Variables de entorno en la raíz del proyecto
if not exist .env (
    echo SERIAL_PORT=COM3 > .env
)

REM Crear start.bat
echo @echo off > start.bat
echo cd /d "%%~dp0infrastructure" >> start.bat
echo echo 🏁 Iniciando CHRONIT Racing System... >> start.bat
echo docker compose --env-file "%%~dp0.env" up --build >> start.bat
echo pause >> start.bat

REM Crear stop.bat
echo @echo off > stop.bat
echo cd /d "%%~dp0infrastructure" >> stop.bat
echo echo 🛑 Deteniendo CHRONIT Racing System... >> stop.bat
echo docker compose --env-file "%%~dp0.env" down >> stop.bat
echo pause >> stop.bat

echo.
echo =========================================
echo ✅ INSTALACION COMPLETADA
echo =========================================
echo.
echo 🚀 Ejecutar: start.bat
echo 🌐 Web UI: http://localhost:5000
echo.
pause
