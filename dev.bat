@echo off
REM ServerKit Local Development Helper for Windows
REM Usage: dev.bat [command]

if "%1"=="" goto help
if "%1"=="up" goto up
if "%1"=="down" goto down
if "%1"=="logs" goto logs
if "%1"=="shell" goto shell
if "%1"=="reset" goto reset
if "%1"=="help" goto help
goto help

:up
echo Starting ServerKit development environment...
docker compose -f docker-compose.dev.yml up --build -d
echo.
echo ServerKit is starting up:
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:5000
echo.
echo Run 'dev.bat logs' to see logs
goto end

:down
echo Stopping ServerKit development environment...
docker compose -f docker-compose.dev.yml down
goto end

:logs
docker compose -f docker-compose.dev.yml logs -f
goto end

:shell
echo Opening shell in backend container...
docker exec -it serverkit-backend-dev /bin/bash
goto end

:reset
echo Resetting development environment (removing volumes)...
docker compose -f docker-compose.dev.yml down -v
echo Done. Run 'dev.bat up' to start fresh.
goto end

:help
echo.
echo ServerKit Development Helper
echo ============================
echo.
echo Usage: dev.bat [command]
echo.
echo Commands:
echo   up      Start development environment
echo   down    Stop development environment
echo   logs    View logs (Ctrl+C to exit)
echo   shell   Open bash shell in backend container
echo   reset   Stop and remove all data (fresh start)
echo   help    Show this help message
echo.
echo Note: System management features (PHP, firewall, etc.)
echo       won't work in Docker mode. Use WSL for full testing.
echo.
goto end

:end
