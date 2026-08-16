@echo off
title LoopsLoader native host install
cd /d "%~dp0"

echo [*] Regenerating key/host.json (keeps existing key if present)...
node tools\gen_host.js
if errorlevel 1 goto :err

echo [*] Writing registry: HKCU\Software\Google\Chrome\NativeMessagingHosts\com.loopsloader.host
powershell -NoProfile -Command "New-Item -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.loopsloader.host' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.loopsloader.host' -Name '(default)' -Value '%~dp0host.json'; Write-Output 'registry OK'"
if errorlevel 1 goto :err

echo [*] Done. Restart Chrome, then reload the extension in chrome://extensions.
pause
exit /b 0

:err
echo [!] FAILED
pause