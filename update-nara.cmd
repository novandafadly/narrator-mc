@echo off
rem Memperbarui kode Nara dari GitHub (branch main) tanpa menyentuh .env.local dan node_modules.
setlocal
set "NODE_DIR=%USERPROFILE%\Documents\node-v22.23.5-win-x64"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0"
set "WORK=%TEMP%\nara-update"
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%"
echo Mengunduh versi terbaru...
powershell -NoProfile -Command "Invoke-WebRequest https://github.com/novandafadly/narrator-mc/archive/refs/heads/main.zip -OutFile %WORK%\main.zip; Expand-Archive %WORK%\main.zip -DestinationPath %WORK% -Force"
if errorlevel 1 ( echo Gagal mengunduh. & pause & exit /b 1 )
copy /y package-lock.json "%WORK%\lock.before" >nul
robocopy "%WORK%\narrator-mc-main" "%~dp0." /E /XD node_modules .next /XF .env.local update-nara.cmd /NFL /NDL /NJH /NJS /NP
if errorlevel 8 ( echo Gagal menyalin file. & pause & exit /b 1 )
fc /b package-lock.json "%WORK%\lock.before" >nul
if errorlevel 1 ( echo Dependensi berubah, menjalankan npm ci... & call npm.cmd ci )
echo Selesai. Jalankan start-nara.cmd.
pause
