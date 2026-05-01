import os
from fastapi import APIRouter, BackgroundTasks, Request
from src.web.session_manager import loading_state
from src.web.serialization import safe_jsonable
from src.web.cache_utils import WEB_CACHE_ROOT
from src.f1_data import get_race_weekends_by_year

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Web cache index — used by RacePicker to badge cached races quickly.
# ---------------------------------------------------------------------------

@router.get("/web_cache/index")
def web_cache_index():
    entries: list[dict] = []
    root = WEB_CACHE_ROOT
    if root.is_dir():
        for path in root.glob("*.arrow"):
            stem = path.stem  # e.g. "2025_8_R"
            parts = stem.split("_")
            if len(parts) != 3:
                continue
            try:
                year = int(parts[0])
                round_number = int(parts[1])
            except ValueError:
                continue
            session_type = parts[2]
            entries.append({
                "year": year,
                "round": round_number,
                "session_type": session_type,
            })
    return {"entries": entries}


# ---------------------------------------------------------------------------
# Session status
# ---------------------------------------------------------------------------

@router.get("/session/status")
def session_status():
    return safe_jsonable(loading_state())


@router.get("/debug/ws_stats")
def debug_ws_stats(request: Request):
    if os.getenv("APEX_DEBUG", "0") != "1":
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    hub = request.app.state.ws_hub
    return safe_jsonable(hub.stats())


# ---------------------------------------------------------------------------
# Seasons
# ---------------------------------------------------------------------------

@router.get("/seasons")
def seasons():
    return {"seasons": list(range(2018, 2027))}


@router.get("/seasons/{year}/rounds")
def season_rounds(year: int):
    try:
        rounds = get_race_weekends_by_year(year)
        return safe_jsonable(rounds)
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Session load (non-blocking)
# ---------------------------------------------------------------------------

@router.post("/session/load")
def session_load(
    payload: dict,
    background_tasks: BackgroundTasks,
    request: Request,
):
    year = payload.get("year", 2026)
    round_number = payload.get("round", 1)
    session_type = payload.get("session_type", "R")

    mgr = request.app.state.session_mgr

    def _load():
        try:
            mgr.load(year, round_number, session_type)
        except Exception:
            pass  # _LOAD_STATE already set to error

    background_tasks.add_task(_load)
    return {"ok": True, "status": "loading"}


# ---------------------------------------------------------------------------
# Session data (require loaded session)
# ---------------------------------------------------------------------------

def _require_loaded(request: Request) -> dict:
    loaded = request.app.state.session_mgr.current()
    if loaded is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No session loaded")
    return loaded


@router.get("/session/summary")
def session_summary(request: Request):
    loaded = _require_loaded(request)
    ev = loaded["event"]
    dm = loaded["driver_meta"]
    return safe_jsonable({
        "event": ev,
        "total_laps": loaded["total_laps"],
        "drivers": list(dm.values()),
        "circuit_rotation": loaded["circuit_rotation"],
    })


@router.get("/session/geometry")
def session_geometry(request: Request):
    loaded = _require_loaded(request)
    geo = loaded["geometry"]
    # Strip internal keys before sending to client
    public = {k: v for k, v in geo.items() if not k.startswith("_")}
    return safe_jsonable(public)


@router.get("/session/race_control")
def session_race_control(request: Request, since: float | None = None):
    loaded = _require_loaded(request)
    msgs = loaded["race_control_messages"]
    if since is not None:
        msgs = [m for m in msgs if m.get("time", 0) > since]
    return safe_jsonable(msgs)


@router.get("/session/results")
def session_results(request: Request):
    loaded = _require_loaded(request)
    frames = loaded.get("frames")
    handle = loaded.get("handle")
    if not frames and handle is None:
        return []
    if frames:
        last = frames[-1]
    else:
        last = handle.frame_at(handle.frame_count - 1)
    drivers = last.get("drivers", {})
    rows = []
    for code, d in drivers.items():
        rows.append({
            "code": code,
            "pos": d.get("position", 0),
            "gap_s": None,
            "status": "RUN",
        })
    rows.sort(key=lambda r: r["pos"])
    return safe_jsonable(rows)


@router.get("/session/gap_to_leader")
def session_gap_to_leader(request: Request):
    """Per-driver gap-to-leader by lap, for the spaghetti chart panel.

    For each lap N, gap = driver's cumulative race time at the end of lap N
    minus the leader's cumulative race time at the end of lap N. The leader is
    whichever driver has the smallest cumulative time at that lap. Drivers
    missing a lap_time_s (DNF, lapped beyond, no data) get null for that lap
    and every lap after — once a driver drops out we don't fabricate gaps.
    """
    loaded = _require_loaded(request)
    lap_data = loaded.get("lap_data") or {}
    total_laps = int(loaded.get("total_laps") or 0)
    track_statuses = loaded.get("track_statuses") or []
    total_duration_s = float(loaded.get("total_duration_s") or 0.0)

    # Build cumulative time per driver per lap. None means "no valid time
    # for this lap" — we stop accumulating after the first None to model
    # retirement / missing-data tails.
    cum: dict[str, list[float | None]] = {}
    max_lap = 0
    for code, payload in lap_data.items():
        laps = (payload or {}).get("laps") or {}
        if not laps:
            continue
        sorted_laps = sorted(laps.items(), key=lambda kv: int(kv[0]))
        last_lap = int(sorted_laps[-1][0])
        max_lap = max(max_lap, last_lap)
        series: list[float | None] = []
        running = 0.0
        dropped = False
        for lap_no, lap in sorted_laps:
            lap_no = int(lap_no)
            while len(series) < lap_no - 1:
                series.append(None)
            if dropped:
                series.append(None)
                continue
            t = lap.get("lap_time_s")
            if t is None:
                dropped = True
                series.append(None)
                continue
            running += float(t)
            series.append(round(running, 3))
        cum[code] = series

    if total_laps:
        max_lap = max(max_lap, total_laps)

    # Leader cumulative time per lap = min across drivers with a value.
    leader_cum: list[float | None] = []
    for i in range(max_lap):
        best: float | None = None
        for series in cum.values():
            if i >= len(series):
                continue
            v = series[i]
            if v is None:
                continue
            if best is None or v < best:
                best = v
        leader_cum.append(best)

    # Build per-driver gap series.
    drivers_out = []
    for code, series in cum.items():
        gaps: list[float | None] = []
        for i, v in enumerate(series):
            lc = leader_cum[i] if i < len(leader_cum) else None
            if v is None or lc is None:
                gaps.append(None)
            else:
                gaps.append(round(v - lc, 3))
        # Pit stop laps (just lap numbers — we don't need duration here)
        pit_laps = []
        laps = (lap_data.get(code) or {}).get("laps") or {}
        for lap_no, lap in laps.items():
            if lap.get("pit_in"):
                pit_laps.append(int(lap_no))
        pit_laps.sort()
        drivers_out.append({
            "code": code,
            "gaps": gaps,
            "pit_laps": pit_laps,
        })

    # SC/VSC/red lap ranges. track_statuses are time-keyed, so we map them
    # onto laps by approximating "lap fraction" against total_duration_s.
    # This is coarse but plenty for a vertical band on a spaghetti chart.
    sc_bands = []
    if total_duration_s > 0 and max_lap > 0:
        for entry in track_statuses:
            status = entry.get("status")
            if status not in ("sc", "vsc", "red", "yellow"):
                continue
            start_t = float(entry.get("start_time") or 0.0)
            end_t = float(entry.get("end_time") or total_duration_s)
            sc_bands.append({
                "status": status,
                "start_lap": round((start_t / total_duration_s) * max_lap, 3),
                "end_lap": round((end_t / total_duration_s) * max_lap, 3),
            })

    return safe_jsonable({
        "total_laps": max_lap,
        "drivers": drivers_out,
        "sc_bands": sc_bands,
    })


@router.get("/session/lap_telemetry/{code}/{lap}")
def session_lap_telemetry(code: str, lap: int, request: Request):
    """Return the full telemetry trace for (driver, lap) as parallel arrays,
    using cache-backed lap slices when available. Frontend uses this instead of
    rebuilding a sparse trace from live WebSocket frames."""
    from src.web.playback import _brake_intensity_pct
    DECEL_FULL = 50.0  # m/s² ≈ 5g, matches playback.standings_from_frame

    loaded = _require_loaded(request)
    frames = loaded.get("frames")
    handle = loaded.get("handle")
    if not frames and handle is None:
        return {"fraction": [], "speed": [], "throttle": [], "brake": [], "gear": [], "rpm": [], "drs": []}
    if handle is not None and hasattr(handle, "lap_trace"):
        return handle.lap_trace(code, lap, decel_full=DECEL_FULL)

    fraction, speed, throttle, brake, gear, rpm, drs = [], [], [], [], [], [], []
    prev_d = None
    prev_t = None
    if frames:
        iterator = iter(frames)
    else:
        iterator = handle.frames_iter(0, handle.frame_count)
    for f in iterator:
        d = f.get("drivers", {}).get(code)
        if not d or int(round(d.get("lap", 0))) != lap:
            prev_d = None  # reset brake diff across gaps
            prev_t = None
            continue
        frac = float(d.get("rel_dist", 0.0))
        frac = max(0.0, min(1.0, frac))
        t = float(f.get("t", 0.0))
        if prev_d is not None and prev_t is not None:
            dt = max(1e-6, t - prev_t)
            b_pct = _brake_intensity_pct(code, d, {code: prev_d}, dt, DECEL_FULL)
        else:
            b_pct = 100.0 if bool(d.get("brake", 0.0)) else 0.0

        fraction.append(round(frac, 5))
        speed.append(round(float(d.get("speed", 0.0)), 2))
        throttle.append(round(float(d.get("throttle", 0.0)), 2))
        brake.append(round(b_pct, 2))
        gear.append(int(d.get("gear", 0)))
        rpm.append(round(float(d.get("rpm", 0.0)), 1))
        drs.append(int(d.get("drs", 0)))
        prev_d = d
        prev_t = t

    return {
        "code": code,
        "lap": lap,
        "fraction": fraction,
        "speed": speed,
        "throttle": throttle,
        "brake": brake,
        "gear": gear,
        "rpm": rpm,
        "drs": drs,
    }


# ---------------------------------------------------------------------------
# Playback controls
# ---------------------------------------------------------------------------

@router.post("/playback/play")
def playback_play(request: Request):
    pb = request.app.state.playback
    pb.toggle_pause(value=False)
    return {"ok": True}


@router.post("/playback/pause")
def playback_pause(request: Request):
    pb = request.app.state.playback
    pb.toggle_pause(value=True)
    return {"ok": True}


@router.post("/playback/seek")
def playback_seek(payload: dict, request: Request):
    pb = request.app.state.playback
    t = payload.get("t", 0.0)
    pb.seek(float(t))
    return {"ok": True}


@router.post("/playback/speed")
def playback_speed(payload: dict, request: Request):
    pb = request.app.state.playback
    s = payload.get("speed", 1.0)
    pb.set_speed(float(s))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Registration helper
# ---------------------------------------------------------------------------

def register_http(app):
    app.include_router(router)
