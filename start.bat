@echo off
setlocal
cd /d "%~dp0"

set "PACKED_ASAR=release\win-unpacked\resources\app.asar"
set "NEED_PACK=0"

if not exist "%PACKED_ASAR%" set "NEED_PACK=1"
if exist "%PACKED_ASAR%" (
  for /f %%N in ('powershell -NoProfile -Command "$packed=(Get-Item '%PACKED_ASAR%').LastWriteTime; $latest=(Get-ChildItem 'src','package.json','electron.vite.config.ts' -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime; if ($latest -gt $packed) { '1' } else { '0' }"') do set "NEED_PACK=%%N"
)

if "%NEED_PACK%"=="1" if exist "node_modules\electron-builder\out\cli\cli.js" (
  echo [Price Compare] Updating portable application...
  call npm run pack:portable
  if errorlevel 1 (
    echo [Price Compare] Portable build failed.
    pause
    exit /b 1
  )
)

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
