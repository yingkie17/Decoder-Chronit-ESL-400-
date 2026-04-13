@echo off
title CHRONIT Racing System - Reiniciar
color 0E

echo ========================================
echo    🏁 CHRONIT Racing System
echo ========================================
echo.
echo Reiniciando sistema...

cd /d "%~dp0infrastructure"
docker compose restart

echo.
echo ✅ Sistema reiniciado
echo 📊 Web: http://localhost:5000
pause
