@echo off
setlocal
cd /d "%~dp0"
echo Starting Locus local web server...

where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Starting Python HTTP server on port 8000...
    start http://localhost:8000
    python -m http.server 8000
    goto end
)

where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Starting Python (py launcher) HTTP server on port 8000...
    start http://localhost:8000
    py -m http.server 8000
    goto end
)

where npx >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Starting server with npx serve...
    start http://localhost:8000
    npx serve -l 8000 .
    goto end
)

echo.
echo ======================================================================
echo [Notice] Python or Node.js (npx) was not detected automatically.
echo To run a local server:
echo   1. If you have Python installed: run python -m http.server 8000
echo   2. Or in VS Code: use the 'Live Server' extension
echo   3. Or open PowerShell here and run a web server of your choice.
echo ======================================================================
echo.
pause

:end
