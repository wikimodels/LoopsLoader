@echo off
title LoopsLoader autostart installer
cd /d "%~dp0"

echo [*] Registering scheduled task "LoopsLoaderServer" (run at logon, hidden)...

schtasks /Create /F /TN "LoopsLoaderServer" ^
  /TR "powershell -NoProfile -WindowStyle Hidden -Command \"Start-Process -WindowStyle Hidden '%ProgramFiles%\nodejs\node.exe' -ArgumentList 'server.js' -WorkingDirectory 'D:\GitHub\LoopsLoader'\"" ^
  /SC ONLOGON /RL LIMITED /F

if errorlevel 1 (
  echo [!] schtasks failed, trying registry Run key fallback...
  reg add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v LoopsLoaderServer /t REG_SZ /d "powershell -NoProfile -WindowStyle Hidden -Command \"Start-Process -WindowStyle Hidden '%ProgramFiles%\nodejs\node.exe' -ArgumentList 'server.js' -WorkingDirectory 'D:\GitHub\LoopsLoader'\"" /f
  if errorlevel 1 (
    echo [!] FAILED both ways
    pause
    exit /b 1
  )
)

echo [*] Starting server right now...
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden '%ProgramFiles%\nodejs\node.exe' -ArgumentList 'server.js' -WorkingDirectory 'D:\GitHub\LoopsLoader'"

timeout /t 2 /nobreak >nul
curl -s http://127.0.0.1:8977/api/loops | findstr /c:"loops" >nul
if errorlevel 1 (
  echo [!] Server check FAILED - see logs above
) else (
  echo [OK] Server is UP on http://127.0.0.1:8977 and will auto-start at every logon
)
pause
