@echo off
rem Menjalankan Nara (server dev Amica) memakai Node portabel jika ada.
setlocal
set "NODE_DIR=%USERPROFILE%\Documents\node-v22.23.5-win-x64"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"
where node >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js tidak ditemukan. Pasang Node portabel atau sesuaikan NODE_DIR di file ini.
  pause
  exit /b 1
)
cd /d "%~dp0"
if not exist ".env.local" copy ".env.example" ".env.local" >nul
if not exist "node_modules" call npm.cmd ci
echo Server berjalan. Buka http://localhost:3000 setelah muncul tulisan Ready. Tekan Ctrl+C untuk berhenti.
call npm.cmd run dev
pause
