@echo off
title CHRONIT Racing System - Detener
color 0E

echo ========================================
echo    🏁 CHRONIT Racing System
echo ========================================
echo.
echo Deteniendo sistema...

cd /d "%~dp0infrastructure"
docker compose down

echo.
echo ✅ Sistema detenido correctamente
pause
