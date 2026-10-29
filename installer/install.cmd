@echo off
setlocal
title DSH Inbox Installer
echo ==========================================
echo  DSH Inbox (dsh-inbox) installer
echo ==========================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] Done. Fully quit and restart DSH to apply.
) else (
  echo [FAILED] See the messages above. Details are in the delivery document.
)
echo.
pause
exit /b %RC%