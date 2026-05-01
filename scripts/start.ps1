# Delta Pitwall — one-shot setup and launch for Windows (PowerShell)

$ErrorActionPreference = "Stop"

function Step  { param($msg) Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Ok    { param($msg) Write-Host "   OK  $msg" -ForegroundColor Green }
function Warn  { param($msg) Write-Host "   !!  $msg" -ForegroundColor Yellow }
function Die   { param($msg) Write-Host "`nERROR  $msg`n" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "========================================" -ForegroundColor White
Write-Host "      Delta Pitwall  -  startup         " -ForegroundColor White
Write-Host "========================================" -ForegroundColor White

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
Step "Checking prerequisites"

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { Die "python not found. Install Python 3.10+ (python.org) and re-run." }
$pyVer = & python --version 2>&1
Ok $pyVer

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die "node not found. Install Node.js 18+ (nodejs.org) and re-run." }
Ok "Node $( & node --version )"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Die "npm not found. Install Node.js 18+ (nodejs.org) and re-run." }
Ok "npm $( & npm --version )"

# ── 2. Python virtual environment ─────────────────────────────────────────────
Step "Setting up Python virtual environment"

$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptsDir
Set-Location $root

if (-not (Test-Path ".venv")) {
    & python -m venv .venv
    Ok "Created .venv"
} else {
    Ok ".venv already exists - skipping creation"
}

& .\.venv\Scripts\Activate.ps1
Ok "Virtual environment activated"

# ── 3. Python dependencies ────────────────────────────────────────────────────
Step "Installing Python dependencies"
& pip install --quiet --upgrade pip
& pip install --quiet -r requirements.txt
Ok "Python packages installed"

# ── 4. Frontend — npm install ──────────────────────────────────────────────────
Step "Installing frontend dependencies (npm install)"
Set-Location "$root\project"
& npm install --silent
Ok "npm packages installed"

# ── 5. Frontend — build ────────────────────────────────────────────────────────
Step "Building frontend bundle"
& npm run build
Ok "Frontend bundle built"
Set-Location $root

# ── 6. Launch ──────────────────────────────────────────────────────────────────
$port = 8000
Step "Starting Delta Pitwall server"
Write-Host ""
Write-Host "  +-----------------------------------------------------+" -ForegroundColor White
Write-Host "  |  Open in your browser:                              |" -ForegroundColor White
Write-Host "  |                                                     |" -ForegroundColor White
Write-Host "  |  http://localhost:$port/app/Pit%20Wall.html        |" -ForegroundColor Green
Write-Host "  |                                                     |" -ForegroundColor White
Write-Host "  |  Press Ctrl+C to stop.                              |" -ForegroundColor White
Write-Host "  +-----------------------------------------------------+" -ForegroundColor White
Write-Host ""

& python -m src.web.pit_wall_server @args
