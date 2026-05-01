#!/usr/bin/env bash
# Delta Pitwall — one-shot setup and launch for macOS / Linux

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

step()  { echo -e "\n${CYAN}▶ $1${RESET}"; }
ok()    { echo -e "  ${GREEN}✔ $1${RESET}"; }
warn()  { echo -e "  ${YELLOW}⚠ $1${RESET}"; }
die()   { echo -e "\n${RED}✖ $1${RESET}\n"; exit 1; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║       Delta Pitwall  — startup       ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
step "Checking prerequisites"

command -v python3 >/dev/null 2>&1 || die "python3 not found. Install Python 3.10+ and re-run."
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
ok "Python $PY_VER"

command -v node >/dev/null 2>&1 || die "node not found. Install Node.js 18+ and re-run."
ok "Node $(node --version)"

command -v npm >/dev/null 2>&1 || die "npm not found. Install Node.js 18+ and re-run."
ok "npm $(npm --version)"

# ── 2. Python virtual environment ────────────────────────────────────────────
step "Setting up Python virtual environment"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    ok "Created .venv"
else
    ok ".venv already exists — skipping creation"
fi

source .venv/bin/activate
ok "Virtual environment activated"

# ── 3. Python dependencies ───────────────────────────────────────────────────
step "Installing Python dependencies"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
ok "Python packages installed"

# ── 4. Frontend — npm install ────────────────────────────────────────────────
step "Installing frontend dependencies (npm install)"
cd "$ROOT/project"
npm install --silent
ok "npm packages installed"

# ── 5. Frontend — build ───────────────────────────────────────────────────────
step "Building frontend bundle"
npm run build
ok "Frontend bundle built"
cd "$ROOT"

# ── 6. Launch ─────────────────────────────────────────────────────────────────
PORT=8000
step "Starting Delta Pitwall server"
echo ""
echo -e "${BOLD}  ┌─────────────────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}  │   Open in your browser:                             │${RESET}"
echo -e "${BOLD}  │                                                     │${RESET}"
echo -e "${BOLD}  │   ${GREEN}http://localhost:${PORT}/app/Pit%20Wall.html${BOLD}        │${RESET}"
echo -e "${BOLD}  │                                                     │${RESET}"
echo -e "${BOLD}  │   Press Ctrl+C to stop.                             │${RESET}"
echo -e "${BOLD}  └─────────────────────────────────────────────────────┘${RESET}"
echo ""

python -m src.web.pit_wall_server "$@"
