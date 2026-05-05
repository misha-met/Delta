@echo off
:: Delta Pitwall — one-shot setup and launch for Windows (Command Prompt)
setlocal enabledelayedexpansion

echo.
echo ========================================
echo       Delta Pitwall  -  startup
echo ========================================
echo.

:: scripts\ lives one level inside the repo root — go up one directory
cd /d "%~dp0.."

:: ── 1. Prerequisites ──────────────────────────────────────────────────────────
echo [1/5] Checking prerequisites...

where python >nul 2>&1
if errorlevel 1 (
    echo   ERROR: python not found. Install Python 3.10+ from python.org and re-run.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo   OK  %%v

where node >nul 2>&1
if errorlevel 1 (
    echo   ERROR: node not found. Install Node.js 18+ from nodejs.org and re-run.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>^&1') do echo   OK  Node %%v

where npm >nul 2>&1
if errorlevel 1 (
    echo   ERROR: npm not found. Install Node.js 18+ from nodejs.org and re-run.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('npm --version 2^>^&1') do echo   OK  npm %%v

:: ── 2. Python virtual environment ─────────────────────────────────────────────
echo.
echo [2/5] Setting up Python virtual environment...

if not exist ".venv" (
    python -m venv .venv
    if errorlevel 1 ( echo   ERROR: Failed to create .venv & pause & exit /b 1 )
    echo   OK  Created .venv
) else (
    echo   OK  .venv already exists - skipping creation
)

call .venv\Scripts\activate.bat
echo   OK  Virtual environment activated

:: ── 3. Python dependencies ────────────────────────────────────────────────────
echo.
echo [3/5] Installing Python dependencies...

pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
if errorlevel 1 ( echo   ERROR: pip install failed & pause & exit /b 1 )
echo   OK  Python packages installed

:: ── 4. Frontend — npm install (skipped if node_modules already present) ───────
echo.
echo [4/5] Frontend dependencies...

if not exist "project\node_modules" (
    cd project
    call npm install --silent
    if errorlevel 1 ( echo   ERROR: npm install failed & pause & exit /b 1 )
    echo   OK  npm packages installed
    cd ..
) else (
    echo   OK  node_modules already present - skipping npm install
)

:: ── 5. Frontend — build (skipped if bundle already exists) ───────────────────
echo.
echo [5/5] Frontend bundle...

if not exist "project\dist\bundle.js" (
    cd project
    call npm run build
    if errorlevel 1 ( echo   ERROR: npm run build failed & pause & exit /b 1 )
    echo   OK  Frontend bundle built
    cd ..
) else (
    echo   OK  Bundle already exists - skipping build
    echo   TIP: Delete project\dist\bundle.js to force a rebuild next run.
)

:: ── 6. Launch ──────────────────────────────────────────────────────────────────
echo.
echo Starting server...
echo   Next time you only need:
echo     .venv\Scripts\activate.bat
echo     python -m src.web.pit_wall_server
echo.

python -m src.web.pit_wall_server %*
