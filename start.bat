@echo off
setlocal
cd /d "%~dp0"

if exist "release\win-unpacked\*.exe" (
  for %%F in ("release\win-unpacked\*.exe") do (
    start "" "%%~fF"
    exit /b 0
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Price Compare] Runtime files are missing. Run npm install first.
  pause
  exit /b 1
)

if not exist "out\main\index.js" (
  echo [Price Compare] Building application files...
  call npm run build
  if errorlevel 1 (
    echo [Price Compare] Build failed.
    pause
    exit /b 1
  )
)

start "" "node_modules\electron\dist\electron.exe" "."
