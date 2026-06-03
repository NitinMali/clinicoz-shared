@echo off
echo ==============================
echo  Clinicoz E2E Testing Engine
echo ==============================
echo.
echo Pulling latest version...
docker compose pull
echo.
echo Starting services...
docker compose up -d
echo.
echo Waiting for startup...
timeout /t 5 /nobreak >nul
echo.
echo ✓ Ready! Opening dashboard...
start http://localhost:3005
echo.
echo To stop: double-click stop.bat
pause
