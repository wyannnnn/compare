@echo off
setlocal
cd /d "%~dp0"

if /i "%~1"=="ui" goto ui
if /i "%~1"=="electron" goto electron
if /i "%~1"=="basic" goto basic

echo.
echo [Bijiaka] Test menu
echo.
echo   1. UI e2e test          npm run test:e2e
echo   2. Real Electron e2e    npm run test:e2e:electron
echo   3. Basic checks         typecheck + unit + UI e2e
echo.
echo Tip: you can also run:
echo   "%~nx0" ui
echo   "%~nx0" electron
echo   "%~nx0" basic
echo.
set /p choice=Choose 1, 2 or 3: 

if "%choice%"=="1" goto ui
if "%choice%"=="2" goto electron
if "%choice%"=="3" goto basic

echo.
echo Unknown choice.
set "exitCode=1"
goto done

:ui
echo.
echo [Bijiaka] Running UI e2e...
call npm run test:e2e
set "exitCode=%ERRORLEVEL%"
goto done

:electron
echo.
echo [Bijiaka] Running real Electron e2e...
set "BIJIAKA_RUN_ELECTRON_E2E=1"
call npm run test:e2e:electron
set "exitCode=%ERRORLEVEL%"
set "BIJIAKA_RUN_ELECTRON_E2E="
goto done

:basic
echo.
echo [Bijiaka] Running typecheck...
call npm run typecheck
if errorlevel 1 (
  set "exitCode=%ERRORLEVEL%"
  goto done
)

echo.
echo [Bijiaka] Running unit tests...
call npm test -- --run
if errorlevel 1 (
  set "exitCode=%ERRORLEVEL%"
  goto done
)

echo.
echo [Bijiaka] Running UI e2e...
call npm run test:e2e
set "exitCode=%ERRORLEVEL%"
goto done

:done
echo.
if "%exitCode%"=="0" (
  echo [Bijiaka] Done.
) else (
  echo [Bijiaka] Failed with exit code %exitCode%.
)
pause
exit /b %exitCode%
