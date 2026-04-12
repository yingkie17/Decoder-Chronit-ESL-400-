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
mkdir App\Python\data 2>nul
mkdir App\Python\templates 2>nul
mkdir infrastructure 2>nul

REM Crear .env
echo SERIAL_PORT=COM3 > infrastructure\.env

REM Crear start.bat
echo @echo off > start.bat
echo cd /d "%%~dp0infrastructure" >> start.bat
echo echo 🏁 Iniciando CHRONIT Racing System... >> start.bat
echo docker compose up --build >> start.bat
echo pause >> start.bat

REM Crear stop.bat
echo @echo off > stop.bat
echo cd /d "%%~dp0infrastructure" >> stop.bat
echo echo 🛑 Deteniendo CHRONIT Racing System... >> stop.bat
echo docker compose down >> stop.bat
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
