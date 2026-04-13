@echo off
title CHRONIT Racing System - Instalador
color 0A

echo ========================================
echo    🏁 CHRONIT Racing System v3.0
echo ========================================
echo.
echo Verificando requisitos...

REM Verificar Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ❌ Docker no esta instalado
    echo.
    echo 📥 Instalando Docker automaticamente...
    echo.
    echo Descargando Docker Desktop...
    powershell -Command "Invoke-WebRequest -Uri 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe' -OutFile '%TEMP%\DockerDesktopInstaller.exe'"
    echo.
    echo Instalando Docker...
    start /wait %TEMP%\DockerDesktopInstaller.exe install --quiet
    del %TEMP%\DockerDesktopInstaller.exe
    echo.
    echo ✅ Docker instalado correctamente
    echo.
    echo ⚠️ Por favor, reinicia tu computadora y ejecuta este programa nuevamente.
    pause
    exit /b 1
)

echo ✅ Docker encontrado

REM Crear estructura de carpetas
if not exist "%USERPROFILE%\CHRONIT" mkdir "%USERPROFILE%\CHRONIT"
if not exist "%USERPROFILE%\CHRONIT\data" mkdir "%USERPROFILE%\CHRONIT\data"

REM Copiar archivos
xcopy /E /I /Y "%~dp0..\src" "%USERPROFILE%\CHRONIT\src"
xcopy /E /I /Y "%~dp0..\infrastructure" "%USERPROFILE%\CHRONIT\infrastructure"
copy "%~dp0..\Dockerfile" "%USERPROFILE%\CHRONIT\" 2>nul

echo.
echo ✅ CHRONIT instalado en: %USERPROFILE%\CHRONIT
echo.
echo Creando accesos directos...

REM Crear accesos directos en el escritorio
echo @echo off > "%USERPROFILE%\Desktop\CHRONIT-Iniciar.bat"
echo cd /d "%USERPROFILE%\CHRONIT\infrastructure" >> "%USERPROFILE%\Desktop\CHRONIT-Iniciar.bat"
echo docker compose up --build >> "%USERPROFILE%\Desktop\CHRONIT-Iniciar.bat"
echo pause >> "%USERPROFILE%\Desktop\CHRONIT-Iniciar.bat"

echo @echo off > "%USERPROFILE%\Desktop\CHRONIT-Apagar.bat"
echo cd /d "%USERPROFILE%\Desktop\CHRONIT-Iniciar.bat" >> "%USERPROFILE%\Desktop\CHRONIT-Apagar.bat"
echo docker compose down >> "%USERPROFILE%\Desktop\CHRONIT-Apagar.bat"
echo pause >> "%USERPROFILE%\Desktop\CHRONIT-Apagar.bat"

echo @echo off > "%USERPROFILE%\Desktop\CHRONIT-Reset.bat"
echo cd /d "%USERPROFILE%\CHRONIT\infrastructure" >> "%USERPROFILE%\Desktop\CHRONIT-Reset.bat"
echo docker compose restart >> "%USERPROFILE%\Desktop\CHRONIT-Reset.bat"
echo pause >> "%USERPROFILE%\Desktop\CHRONIT-Reset.bat"

echo.
echo ========================================
echo    ✅ INSTALACION COMPLETADA
echo ========================================
echo.
echo 📁 Accesos directos creados en el escritorio:
echo    🏁 CHRONIT-Iniciar.bat - Iniciar el sistema
echo    🛑 CHRONIT-Apagar.bat - Detener el sistema
echo    🔄 CHRONIT-Reset.bat - Reiniciar el sistema
echo.
echo 🌐 Accede a la web: http://localhost:5000
echo.
pause
