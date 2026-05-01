<div align="center">

![Delta Pitwall Main](docs/screenshots/slide1-readme.png)

</div>

## What It Is

Delta Pitwall turns FastF1 session data into something that feels closer to a race-engineer desk than a stats page. Load a race, scrub through it, pin drivers, compare telemetry, inspect stint strategy, watch gaps evolve, and jump between wide circuit views and in-cockpit replay from the browser.

The stack is a React frontend, a FastAPI + Uvicorn backend, and a cache-first data pipeline that writes deterministic Arrow snapshots — so cached races load instantly without re-fetching from FastF1.

## Prerequisites

- Python 3.9+ — download and install from [python.org/downloads](https://www.python.org/downloads/)
- Node.js 18+ — download and install from [nodejs.org/en/download](https://nodejs.org/en/download/)

## Feature Tour

### Full Pit Wall Console

- 10 dockable panels arranged across a three-rail desktop layout
- panels can collapse, maximize, hide, and pop out into their own window
- layout and view preferences persist in `localStorage`
- top bar, timeline, and panel chrome give the app more of a replay console feel than a simple dashboard

### 3D Circuit Replay

- Three.js circuit scene with weather-aware styling and GLB car and safety-car models
- orbit, chase, POV, top-down, and legacy IsoTrack views
- floating labels, selection highlights, safety-car overlays, and an optional mini-map
- a central replay view designed to feel live even when scrubbing through cached race data

![3D circuit replay](docs/screenshots/webglslide-readme.png)

### Cockpit POV

- first-person mode from the pinned driver's car
- live steering-wheel HUD with speed, gear, throttle, brake, DRS, tyre, lap, and flag information
- built for the "inside the cockpit" moments that sell the replay immediately on GitHub
- includes a tuning panel for HUD placement and emissive settings when you need to refine the look

![Cockpit POV](docs/screenshots/cockpitslide-readme.png)

### Classification and Driver Focus

- engineering-style timing tower with sector status, gaps, intervals, and lap colouring
- primary and compare driver cards with speed, gear, throttle, brake, RPM, DRS, and tyre state
- click a driver to pin them, `Shift + Click` to compare against a second driver
- strong red/cyan selection language so the important comparison is obvious at a glance

### Telemetry Compare

- lap overlays for speed, throttle, brake, gear, and RPM
- live playhead so the traces move with replay progress instead of feeling static
- sector times panel for quick split comparison
- useful for showing where one driver gains, brakes later, or gets traction down earlier

![Telemetry compare](docs/screenshots/traceslide-readme.png)

### Strategy, Gaps, and the Spaghetti View

- stint bars for the top 10 with compound colouring, pit-stop ticks, and current-lap marker
- gap-to-leader bars for a fast read of race spread
- gap-history spaghetti chart for the full race story over time
- race-control feed layered into the same console for flags, safety car, DRS, and other key events

![Strategy, gaps, and gap history](docs/screenshots/gapsslide-readme.png)

### Replay Timeline and Session Control

- play, pause, seek, and speed controls driven by a server-authoritative replay state
- top bar with flag state, lap counter, race clock, air temperature, track temperature, and humidity
- timeline overlays for laps, sectors, and safety-car periods
- hotkeys for fast replay control and camera switching

### RacePicker and Warm Starts

- built-in RacePicker flow for season, round, and session selection
- cached races are surfaced quickly through the web-cache index
- warm cache loads skip a full FastF1 rebuild and jump straight into replay hydration
- loading states make the data pipeline visible instead of feeling like a blank wait screen

![RacePicker](docs/screenshots/racepickerslide-readme.png)

## Panel Map

| Panel | What it shows |
|---|---|
| `CLASSIFICATION` | Live race order, gaps, intervals, sector state, and lap colouring |
| `CIRCUIT VIEW` | 3D track replay, chase/POV/top modes, labels, and overlays |
| `STRATEGY` | Tyre stints, pit windows, and lap marker |
| `COMPARE TRACES` | Speed, throttle, brake, gear, and RPM overlays |
| `SECTOR TIMES` | Split-by-split comparison for selected drivers |
| `RACE CONTROL` | Time-filtered race-control messages |
| `PRIMARY DRIVER` | Detailed telemetry card for the pinned driver |
| `COMPARE DRIVER` | Side-by-side telemetry card for the comparison driver |
| `GAP VISUALIZATION` | Live gap-to-leader bars |
| `GAP HISTORY` | Race-long spaghetti chart with pit markers and status overlays |

## Quick Start

> **First time only.** Run one script — it handles everything: checks prerequisites, creates a virtual environment, installs all Python and Node dependencies, builds the frontend bundle, and starts the server. On every run after the first it skips steps that are already done.

**macOS / Linux**

```bash
bash scripts/start.sh
```

**Windows — PowerShell**

```powershell
.\scripts\start.ps1
```

**Windows — Command Prompt**

```bat
scripts\start.bat
```

When the server is ready the URL is printed in the terminal.

Any CLI flags are passed straight through to the server:

```bash
bash scripts/start.sh --year 2025 --round 12 --session-type R
```

If you start without `--year` and `--round` the app opens into `RacePicker`.

## Subsequent Runs

Once the venv and bundle exist you don't need the script. Just activate and run:

**macOS / Linux**

```bash
source .venv/bin/activate
python -m src.web.pit_wall_server
```

**Windows — PowerShell**

```powershell
.\.venv\Scripts\Activate.ps1
python -m src.web.pit_wall_server
```

**Windows — Command Prompt**

```bat
.venv\Scripts\activate.bat
python -m src.web.pit_wall_server
```

## Manual Setup

If you prefer to run the first-time setup step by step:

```bash
# 1. Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\Activate.ps1    # Windows PowerShell
# .venv\Scripts\activate.bat    # Windows CMD

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Install and build the frontend
cd project
npm install
npm run build
cd ..

# 4. Start the server
python -m src.web.pit_wall_server
```

Jump straight into a known race:

```bash
python -m src.web.pit_wall_server --year 2025 --round 12 --session-type R
```

### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--year` | unset | Championship year |
| `--round` | unset | Round number |
| `--session-type` | `R` | Session code such as `R`, `Q`, or `SQ` |
| `--host` | `127.0.0.1` | Bind address |
| `--port` | `8000` | Bind port |
| `--cache-dir` | `cache/fastf1` | FastF1 HTTP cache directory |

## Development

Frontend watch mode:

```bash
cd project
npm run watch
```

Backend and pipeline tests:

```bash
python -m pytest tests
```

Frontend tests:

```bash
cd project
npm test
```

Useful hotkeys:

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `Left` / `Right` | Seek backward / forward |
| `Up` / `Down` | Increase / decrease playback speed |
| `1` `2` `3` `4` | Set `0.5x`, `1x`, `2x`, `4x` |
| `D` | Return to default WebGL view |
| `F` | Toggle chase view |
| `M` | Toggle top-down view |
| `L` | Toggle labels |
| `C` | Toggle camera controls |
| `H` | Toggle POV HUD |
| `N` | Toggle mini-map |
| `R` | Restart replay from the beginning |

## Architecture

```mermaid
flowchart TB
    subgraph PY["Python process - src.web.pit_wall_server"]
        SM["SessionManager<br/>cache-first loader"]
        PB["Playback<br/>25 Hz tick"]
        WS["WS Hub<br/>/ws/telemetry"]
        HTTP["FastAPI REST<br/>/api/*"]
        STATIC["Static mount<br/>/app -> project/"]
        SM --> PB --> WS
        SM --> HTTP
        STATIC --> HTTP
    end

    subgraph CACHE["Deterministic web cache"]
        ARROW["computed_data/web/v1/{year}_{round}_{session}.arrow"]
        META[".meta.json<br/>schema/profile/cache-key validation"]
    end

    subgraph FF1["FastF1 cold path"]
        F1API["Telemetry - Weather - Messages"]
    end

    subgraph BROWSER["Browser"]
        APP["React root - App.jsx"]
        TRACK["Track3D / IsoTrack"]
        PICKER["RacePicker"]
        LIVE["window.LIVE.useLive()"]
        APP --> TRACK
        APP --> LIVE
        PICKER --> APP
    end

    SM <--> CACHE
    SM -. cold cache only .-> FF1
    HTTP <-->|REST| BROWSER
    WS <-->|snapshot + frame stream| LIVE
```

### Cache-First Session Lifecycle

`SessionManager.load(year, round, session_type)` takes one of two paths:

1. Warm cache: validate `computed_data/web/v1/*.arrow` plus `.meta.json`, open the Arrow handle, and hydrate runtime state directly.
2. Cold build: load the FastF1 session, build the deterministic dataset, write Arrow + metadata, then reopen from cache.

That gives the UI a predictable loading flow:

`Checking web cache` -> `Building web cache` -> `Hydrating replay state` -> `Ready`

## API Summary

### REST Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/seasons` | Available seasons |
| `GET` | `/api/seasons/{year}/rounds` | Round list for RacePicker |
| `GET` | `/api/web_cache/index` | Cache badge data for RacePicker |
| `POST` | `/api/session/load` | Begin non-blocking session load |
| `GET` | `/api/session/status` | Loading state |
| `GET` | `/api/session/summary` | Event, drivers, laps, rotation |
| `GET` | `/api/session/geometry` | Public track geometry payload |
| `GET` | `/api/session/race_control` | Race-control messages |
| `GET` | `/api/session/results` | Final-ish classification view |
| `GET` | `/api/session/gap_to_leader` | Gap-history chart data |
| `GET` | `/api/session/lap_telemetry/{code}/{lap}` | Lap trace data for compare panels |
| `POST` | `/api/playback/play` | Resume playback |
| `POST` | `/api/playback/pause` | Pause playback |
| `POST` | `/api/playback/seek` | Seek by normalized race fraction |
| `POST` | `/api/playback/speed` | Set playback speed |

### WebSocket

| Path | Purpose |
|---|---|
| `/ws/telemetry` | Snapshot on connect, then live replay frame updates |

## Project Layout

```text
.
|- assets/
|  `- models/                 # Source GLB models tracked in git
|- project/
|  |- Pit Wall.html           # Static shell served at /app/
|  |- build.mjs               # esbuild bundler + asset copy
|  |- src/                    # React app and Three.js view code
|  `- tests/                  # Frontend tests
|- src/
|  |- data/                   # Arrow cache and storage helpers
|  |- lib/                    # Shared utility code
|  |- web/                    # FastAPI app, playback, routes, WS hub
|  `- f1_data.py              # FastF1 session loading and dataset building
|- tests/                     # Backend and pipeline tests
|- computed_data/             # Runtime-generated replay caches
`- README.md
```

## Notes

- `project/assets/` is generated by the frontend build and intentionally ignored.
- `project/dist/` is generated output and intentionally ignored.
- Cached replay data under `computed_data/` and HTTP cache data under `cache/` are runtime artifacts, not source.
- To force a web cache rebuild, remove the relevant Arrow files or set `DELTA_FORCE_WEB_CACHE_REBUILD=1` when starting the server.

## Asset Credits

Source code in this repository is MIT-licensed. Third-party 3D assets are licensed separately:

- `F1 2022 Generic` by [TheoDevF1](https://sketchfab.com/TheoDevF12), used under [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). Source: [sketchfab.com](https://sketchfab.com/3d-models/f1-2022-generic-9b2fc584679e468ca3a7cb98a75857d2)
- `2019 Mercedes-Benz AMG GTR Safety Car` by [OUTPISTON](https://sketchfab.com/outpiston), used under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Source: [sketchfab.com](https://sketchfab.com/3d-models/2019-mercedes-benz-amg-gtr-safety-car-5bfaf6b31d084dde80dae723b52998bc)

## Attribution

This project builds on [Tom Shaw's f1-race-replay](https://github.com/IAmTomShaw/f1-race-replay). The current version extends it with a browser-based pit wall console, a deterministic Arrow cache pipeline, and a 3D WebGL replay experience.
