@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-api-server.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo start-api-server failed with exit code %EXIT_CODE%.
  pause
)

endlocal & exit /b %EXIT_CODE%
