@echo off
setlocal
title DSH Inbox Uninstaller
echo ==========================================
echo  DSH Inbox (dsh-inbox) uninstaller
echo ==========================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] Uninstalled. Fully quit and restart DSH.
) else (
  echo [FAILED] See the messages above.
)
echo.
pause
exit /b %RC%