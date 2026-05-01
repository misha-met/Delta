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

$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptsDir
Set-Location $root

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

# ── 4. Frontend — npm install (skipped if node_modules already present) ───────
Step "Frontend dependencies"
if (-not (Test-Path "$root\project\node_modules")) {
    Set-Location "$root\project"
    & npm install --silent
    Ok "npm packages installed"
    Set-Location $root
} else {
    Ok "node_modules already present - skipping npm install"
}

# ── 5. Frontend — build (skipped if bundle exists and sources are older) ──────
Step "Frontend bundle"
$bundle = "$root\project\dist\bundle.js"
$needsBuild = $true
if (Test-Path $bundle) {
    $bundleTime = (Get-Item $bundle).LastWriteTime
    $srcNewer = Get-ChildItem "$root\project\src" -Recurse |
        Where-Object { $_.LastWriteTime -gt $bundleTime } |
        Select-Object -First 1
    $buildMjsNewer = (Test-Path "$root\project\build.mjs") -and
        ((Get-Item "$root\project\build.mjs").LastWriteTime -gt $bundleTime)
    $needsBuild = ($null -ne $srcNewer) -or $buildMjsNewer
}

if ($needsBuild) {
    Set-Location "$root\project"
    & npm run build
    Ok "Frontend bundle built"
    Set-Location $root
} else {
    Ok "Bundle is up to date - skipping build"
}

# ── 6. Launch ──────────────────────────────────────────────────────────────────
Step "Starting server"
Write-Host "   Next time you only need:" -ForegroundColor Yellow
Write-Host "     .\.venv\Scripts\Activate.ps1" -ForegroundColor Yellow
Write-Host "     python -m src.web.pit_wall_server" -ForegroundColor Yellow
Write-Host ""

& python -m src.web.pit_wall_server @args
