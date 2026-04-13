@echo off
title CHRONIT Racing System
color 0A

echo ========================================
echo    🏁 CHRONIT Racing System v3.0
echo ========================================
echo.
echo Iniciando sistema...

REM Ir a la carpeta de infrastructure
cd /d "%~dp0infrastructure"

REM Verificar Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ❌ Docker no esta instalado
    echo.
    echo 📥 Por favor, instala Docker Desktop desde:
    echo https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

REM Verificar puerto COM automáticamente
echo.
echo 🔍 Detectando decoder...

for /f "tokens=3" %%a in ('reg query HKLM\HARDWARE\DEVICEMAP\SERIALCOMM 2^>nul') do (
    set "SERIAL_PORT=%%a"
    goto :found
)

:found
if defined SERIAL_PORT (
    echo ✅ Puerto detectado: %SERIAL_PORT%
    echo SERIAL_PORT=%SERIAL_PORT% > .env
) else (
    echo ⚠️ No se detecto el decoder
    echo Conecta el decoder ESL-400 e instala los drivers
    echo.
    echo Presiona cualquier tecla para continuar igualmente...
    pause >nul
)

REM Iniciar Docker
echo.
echo 🚀 Iniciando CHRONIT Racing System...
echo.
echo 📊 Accede a la web: http://localhost:5000
echo.
echo ⏸️  Presiona Ctrl+C para detener
echo.

docker compose up --build

pause
