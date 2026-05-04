import asyncio
import time
from bisect import bisect_right

from src.data import perf_metrics
from src.f1_data import FPS
from src.web.ws_hub import WSHub
from src.web.flags import FlagBisectByTime, FLAG_MAP

PUSH_HZ = 60
MIN_PUSH_INTERVAL = 1.0 / PUSH_HZ
INACTIVE_TELEMETRY_GRACE_S = 0.5


def _normalise_result_status(status: str | None) -> str:
    return " ".join(str(status or "").strip().lower().split())


def _is_dns_status(status: str | None) -> bool:
    norm = _normalise_result_status(status)
    return "did not start" in norm or norm == "dns"


def _is_finished_status(status: str | None) -> bool:
    norm = _normalise_result_status(status)
    if not norm:
        return False
    if norm == "finished":
        return True
    if norm.startswith("+") and "lap" in norm:
        return True
    if "classified" in norm and "not classified" not in norm:
        return True
    return False


def _is_incident_status(status: str | None) -> bool:
    norm = _normalise_result_status(status)
    return any(word in norm for word in ("accident", "collision", "contact", "crash", "damage"))


def _status_badge_for_driver(
    result_info: dict | None,
    telemetry_window: dict | None,
    stop_window: dict | None,
    frame_t: float,
    total_duration_s: float,
) -> tuple[str | None, str | None]:
    status_text = (result_info or {}).get("status", "")
    norm = _normalise_result_status(status_text)

    if _is_dns_status(norm):
        return "DNS", status_text or "Did not start"

    if stop_window and frame_t >= float(stop_window.get("start_time", total_duration_s + 1)):
        if _is_incident_status(norm):
            return "ACC", status_text or "Accident"
        if not _is_finished_status(norm):
            return "RET", status_text or "Retired"

    if telemetry_window:
        end_time = telemetry_window.get("end_time")
        if end_time is not None and frame_t > float(end_time) + INACTIVE_TELEMETRY_GRACE_S:
            if _is_incident_status(norm):
                return "ACC", status_text or "Accident"
            if not _is_finished_status(norm):
                if norm:
                    return "RET", status_text
                if frame_t < total_duration_s - 5.0:
                    return "RET", "Retired"

    return None, None


class Playback:
    def __init__(self, session_mgr, ws_hub: WSHub):
        self.session_mgr = session_mgr
        self.ws_hub = ws_hub
        self.frame_index: float = 0.0
        self.playback_speed: float = 1.0
        self.paused: bool = True  # start paused until session is ready
        self._task: asyncio.Task | None = None
        self._last_push = 0.0
        self._last_broadcast_t_s: float = 0.0
        self._flag_bisect: FlagBisectByTime | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loaded_signature: tuple | None = None
        self._snapshot_pending = False
        self._frame_cache: dict[int, dict | None] = {}
        self._standings_cache_key: tuple | None = None
        self._standings_cache: list | None = None
        self._standings_cache_hits = 0
        self._standings_cache_misses = 0
        self._standings_cache_last_log = time.time()
        self._last_standings_frame_idx: int | None = None
        self._last_standings_by_code: dict[str, int] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self):
        if self._task:
            return
        self._loop = asyncio.get_event_loop()
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    # ------------------------------------------------------------------
    # Controls
    # ------------------------------------------------------------------

    def _schedule_push(self):
        """Schedule _push_now on the event loop — safe from any thread."""
        if self._loop is not None and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self._push_now(), self._loop)
        else:
            asyncio.create_task(self._push_now())

    def set_speed(self, s: float):
        self.playback_speed = max(0.1, min(256.0, float(s)))
        self._schedule_push()

    def toggle_pause(self, value: bool | None = None):
        new_paused = (not self.paused) if value is None else bool(value)
        if new_paused != self.paused:
            self._invalidate_standings_cache()
        self.paused = new_paused
        self._schedule_push()

    def seek(self, t_fraction: float):
        n = self._n_frames()
        self.frame_index = max(0.0, min(float(t_fraction), 1.0)) * (n - 1)
        self._invalidate_standings_cache()
        self._schedule_push()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _n_frames(self) -> int:
        loaded = self.session_mgr.current()
        if not loaded:
            return 1
        if loaded.get("handle") is not None:
            return int(loaded["handle"].frame_count)
        return len(loaded["frames"])

    def _session_signature(self, loaded: dict | None) -> tuple | None:
        if loaded is None:
            return None
        if loaded.get("handle") is not None:
            frame_count = int(loaded["handle"].frame_count)
        else:
            frame_count = len(loaded.get("frames") or [])
        event = loaded.get("event", {})
        return (
            event.get("year"),
            event.get("round"),
            loaded.get("session_type"),
            loaded.get("total_laps"),
            frame_count,
        )

    def _invalidate_standings_cache(self):
        self._standings_cache_key = None
        self._standings_cache = None
        self._last_standings_frame_idx = None
        self._last_standings_by_code = {}

    def _sync_loaded_state(self, loaded: dict):
        sig = self._session_signature(loaded)
        if sig == self._loaded_signature:
            return
        self._loaded_signature = sig
        self._flag_bisect = FlagBisectByTime(loaded["track_statuses"])
        self.frame_index = 0.0
        self._last_broadcast_t_s = 0.0
        self._frame_cache.clear()
        self._invalidate_standings_cache()
        self._snapshot_pending = True

    def _frame_at(self, loaded: dict, frame_index: int) -> dict | None:
        if frame_index in self._frame_cache:
            frame = self._frame_cache.pop(frame_index)
            self._frame_cache[frame_index] = frame
            return frame

        frame = None
        if loaded.get("handle") is not None:
            frame = loaded["handle"].frame_at(frame_index)
        else:
            frames = loaded.get("frames") or []
            if 0 <= frame_index < len(frames):
                frame = frames[frame_index]

        self._frame_cache[frame_index] = frame
        if len(self._frame_cache) > 2:
            self._frame_cache.pop(next(iter(self._frame_cache)))
        return frame

    def _standings_for_frame(
        self,
        frame_idx: int,
        frame: dict,
        loaded: dict,
        geo: dict,
        prev_frame: dict | None,
    ) -> list:
        sign = -1 if self.playback_speed < 0 else 1
        frame_count_signature = self._n_frames()
        key = (int(frame_idx), sign, frame_count_signature)
        if key == self._standings_cache_key and self._standings_cache is not None:
            self._standings_cache_hits += 1
            self._maybe_log_standings_cache_stats()
            return self._standings_cache

        prev_pos_hint = None
        if (
            self._last_standings_frame_idx is not None
            and abs(int(frame_idx) - int(self._last_standings_frame_idx)) == 1
            and self._last_standings_by_code
        ):
            prev_pos_hint = dict(self._last_standings_by_code)

        standings = standings_from_frame(
            frame,
            loaded,
            geo,
            prev_frame,
            prev_pos_hint=prev_pos_hint,
        )
        self._last_standings_frame_idx = int(frame_idx)
        self._last_standings_by_code = {
            str(s.get("code")): int(s.get("pos", 99))
            for s in standings
            if s.get("code") is not None
        }
        self._standings_cache_key = key
        self._standings_cache = standings
        self._standings_cache_misses += 1
        self._maybe_log_standings_cache_stats()
        return standings

    def _maybe_log_standings_cache_stats(self):
        now = time.time()
        if now - self._standings_cache_last_log < 3600:
            return
        total = self._standings_cache_hits + self._standings_cache_misses
        if total > 0:
            hit_rate = (self._standings_cache_hits / total) * 100.0
            perf_metrics.log(
                "standings_cache "
                f"hits={self._standings_cache_hits} misses={self._standings_cache_misses} hit_rate={hit_rate:.2f}%"
            )
        self._standings_cache_last_log = now

    async def _run(self):
        loop = asyncio.get_event_loop()
        prev = loop.time()
        while True:
            await asyncio.sleep(1 / FPS)
            now = loop.time()
            dt = now - prev
            prev = now

            from src.web.session_manager import loading_state
            ls = loading_state()
            loaded = self.session_mgr.current()
            if loaded is None or ls["status"] == "loading":
                # No session yet, or a new session is actively loading — push
                # loading state so the frontend overlay appears even when an old
                # session is still current() during the transition.
                if now - self._last_push >= 1.0:
                    await self.ws_hub.broadcast({"type": "loading", **ls})
                    self._last_push = now
                continue

            self._sync_loaded_state(loaded)

            if self._snapshot_pending:
                self.paused = False
                # Send snapshot to all clients
                snap = build_snapshot(loaded, self)
                await self.ws_hub.broadcast(snap)
                self._snapshot_pending = False
                self._last_push = now
                continue

            if not self.paused:
                self.frame_index = min(
                    self.frame_index + dt * FPS * self.playback_speed,
                    self._n_frames() - 1,
                )

            if now - self._last_push >= MIN_PUSH_INTERVAL:
                await self._push_now(loop_time=now)

    async def _push_now(self, loop_time: float | None = None):
        payload = self._build_frame_payload()
        if payload is not None:
            await self.ws_hub.broadcast(payload)
        self._last_push = loop_time or asyncio.get_event_loop().time()
        if payload:
            self._last_broadcast_t_s = payload.get("t_seconds", self._last_broadcast_t_s)

    def _build_frame_payload(self) -> dict | None:
        loaded = self.session_mgr.current()
        if loaded is None:
            return None
        self._sync_loaded_state(loaded)

        total_frames = self._n_frames()
        if total_frames <= 0:
            return None

        fi = int(self.frame_index)
        fi = min(fi, total_frames - 1)
        frame = self._frame_at(loaded, fi)
        if frame is None:
            return None

        # Clock string
        t = frame.get("t", 0)
        hours = int(t // 3600)
        minutes = int((t % 3600) // 60)
        seconds = int(t % 60)
        clock = f"{hours:02}:{minutes:02}:{seconds:02}"

        # Flag state
        flag_state = "green"
        if self._flag_bisect is not None:
            flag_state = self._flag_bisect.at(t)

        # Track status raw code
        track_status = "1"
        track_statuses = loaded.get("track_statuses", [])
        track_starts = loaded.get("track_status_start_times") or []
        if track_starts:
            idx = bisect_right(track_starts, t) - 1
            if idx >= 0:
                entry = track_statuses[idx]
                if entry.get("end_time") is None or t <= entry["end_time"]:
                    track_status = entry["status"]
        else:
            for entry in track_statuses:
                if t >= entry["start_time"] and (
                    entry.get("end_time") is None or t <= entry["end_time"]
                ):
                    track_status = entry["status"]

        # Safety car
        sc = frame.get("safety_car")

        # Weather
        weather = frame.get("weather", {})

        # New race control events since last broadcast
        new_rc = []
        for msg in loaded["race_control_messages"]:
            if msg["time"] > self._last_broadcast_t_s and msg["time"] <= t:
                new_rc.append(msg)

        # Standings
        geo = loaded["geometry"]
        prev_frame = self._frame_at(loaded, fi - 1) if fi > 0 else None
        standings = self._standings_for_frame(fi, frame, loaded, geo, prev_frame)

        return {
            "type": "frame",
            "frame_index": fi,
            "total_frames": total_frames,
            "t": round(t, 3),
            "t_seconds": round(t, 3),
            "lap": frame.get("lap", 1),
            "total_laps": loaded["total_laps"],
            "clock": clock,
            "track_status": track_status,
            "flag_state": flag_state,
            "playback_speed": self.playback_speed,
            "is_paused": self.paused,
            "weather": weather,
            "safety_car": sc,
            "standings": standings,
            "new_rc_events": new_rc,
        }


# ---------------------------------------------------------------------------
# Public helpers (used by pit_wall_server.py too)
# ---------------------------------------------------------------------------

def build_snapshot(loaded: dict, playback: "Playback") -> dict:
    """Full snapshot sent on WS connect or after session load."""
    geo = loaded["geometry"]
    public_geo = {k: v for k, v in geo.items() if not k.startswith("_")}

    fi = int(getattr(playback, "frame_index", 0) or 0)
    total_frames = 0
    if isinstance(playback, Playback):
        total_frames = playback._n_frames()
    if total_frames <= 0:
        if loaded.get("handle") is not None:
            total_frames = int(loaded["handle"].frame_count)
        else:
            total_frames = len(loaded.get("frames") or [])

    fi = min(fi, total_frames - 1) if total_frames else 0
    if isinstance(playback, Playback):
        frame = playback._frame_at(loaded, fi) if total_frames else None
        prev_frame = playback._frame_at(loaded, fi - 1) if total_frames and fi > 0 else None
    else:
        frame = None
        prev_frame = None
        if total_frames:
            if loaded.get("handle") is not None:
                frame = loaded["handle"].frame_at(fi)
                prev_frame = loaded["handle"].frame_at(fi - 1) if fi > 0 else None
            else:
                frames = loaded.get("frames") or []
                frame = frames[fi] if 0 <= fi < len(frames) else None
                prev_frame = frames[fi - 1] if fi > 0 and (fi - 1) < len(frames) else None

    standings = []
    if isinstance(playback, Playback) and frame:
        standings = playback._standings_for_frame(fi, frame, loaded, geo, prev_frame)

    flag_state = "green"
    if frame:
        flag_state = FlagBisectByTime(loaded["track_statuses"]).at(frame["t"])

    lap_data = loaded.get("lap_data", {})
    total_duration_s = loaded.get("total_duration_s")
    if total_duration_s is None:
        if loaded.get("frames"):
            total_duration_s = loaded["frames"][-1]["t"]
        elif loaded.get("handle") is not None and total_frames:
            total_duration_s = loaded["handle"].frame_at(total_frames - 1).get("t", 0)
        else:
            total_duration_s = 0
    return {
        "type": "snapshot",
        "frame_index": fi,
        "total_frames": total_frames,
        "event": loaded["event"],
        "driver_colors": loaded.get("driver_colors_hex", {}),
        "driver_meta": loaded["driver_meta"],
        "geometry": public_geo,
        "total_laps": loaded["total_laps"],
        "max_tyre_life": loaded["max_tyre_life"],
        "circuit_rotation": loaded["circuit_rotation"],
        "race_control_history": loaded["race_control_messages"],
        "standings": standings,
        "flag_state": flag_state,
        "playback": {
            "speed": float(getattr(playback, "playback_speed", 1.0) or 1.0),
            "is_paused": bool(getattr(playback, "paused", False)),
        },
        "session_best": loaded.get("session_best", {}),
        "fastest_qual_lap_s": loaded.get("fastest_qual_lap_s"),
        "stints": {code: lap_data[code]["stints"] for code in lap_data if "stints" in lap_data[code]},
        "pit_stops": {code: lap_data[code]["pit_stops"] for code in lap_data if "pit_stops" in lap_data[code]},
        "track_statuses": [
            {
                "status": FLAG_MAP.get(e["status"], e["status"]),
                "start_time": e["start_time"],
                "end_time": e["end_time"],
            }
            for e in loaded["track_statuses"]
        ],
        "total_duration_s": total_duration_s,
    }


def _brake_intensity_pct(code: str, d: dict, prev_drivers: dict, dt: float, decel_full: float) -> float:
    brake_on = bool(d.get("brake", 0.0))
    if not brake_on:
        return 0.0
    prev = prev_drivers.get(code)
    if not prev or dt <= 0:
        return 100.0  # brake pressed but no delta available — show full
    v0 = float(prev.get("speed", 0.0)) / 3.6  # kph -> m/s
    v1 = float(d.get("speed", 0.0)) / 3.6
    decel = (v0 - v1) / dt
    if decel <= 0:
        return 15.0  # brake applied but not decelerating (e.g. trail braking mid-corner)
    return max(0.0, min(100.0, (decel / decel_full) * 100.0))


def standings_from_frame(
    frame: dict,
    loaded: dict,
    geo: dict,
    prev_frame: dict | None = None,
    prev_pos_hint: dict[str, int] | None = None,
) -> list:
    """Build a standings list from a single frame dict."""
    started = time.perf_counter()
    drivers = frame.get("drivers", {})
    if not drivers:
        perf_metrics.record_sample("standings_from_frame", time.perf_counter() - started)
        return []

    # FastF1's Brake channel is boolean (on/off), not analog pressure. Synthesize
    # an intensity 0-100 from deceleration between frames, gated by the brake
    # flag. ~8 m/s² deceleration maps to 100% (approximate F1 peak braking).
    prev_drivers = prev_frame.get("drivers", {}) if prev_frame else {}
    dt = 1.0 / FPS
    if prev_frame is not None:
        dt_actual = frame.get("t", 0.0) - prev_frame.get("t", 0.0)
        if dt_actual > 0:
            dt = dt_actual
    DECEL_FULL = 50.0  # m/s² ≈ 5g, F1 peak braking, maps to 100%

    lap_data = loaded.get("lap_data", {})
    lap_aggregates = loaded.get("lap_aggregates", {})
    driver_meta = loaded.get("driver_meta", {})
    driver_results = loaded.get("driver_results", {})
    telemetry_ranges = loaded.get("telemetry_ranges", {})
    driver_stop_windows = loaded.get("driver_stop_windows", {})
    total_duration_s = float(loaded.get("total_duration_s") or frame.get("t", 0.0))
    if total_duration_s <= 0.0 and loaded.get("frames"):
        total_duration_s = float(loaded["frames"][-1]["t"])
    all_codes = list(driver_meta.keys())
    out_badges = {"RET", "ACC", "DNS"}

    badge_cache = {}
    for code in all_codes:
        result_info = driver_results.get(code, {})
        telemetry_window = telemetry_ranges.get(code)
        stop_window = driver_stop_windows.get(code)
        badge_cache[code] = _status_badge_for_driver(
            result_info, telemetry_window, stop_window, float(frame.get("t", 0.0)), total_duration_s
        )

    grid_rank_by_code = {}
    for code in all_codes:
        raw = (driver_results.get(code) or {}).get("grid_position")
        try:
            gp = int(raw) if raw is not None else 10_000
        except (TypeError, ValueError):
            gp = 10_000
        if gp <= 0:
            gp = 10_000
        grid_rank_by_code[code] = gp

    track_length_m = float(
        geo.get("_ref_total_length")
        or geo.get("total_length_m")
        or 0.0
    )
    position_quantum_m = 0.3
    max_position_step = 2

    driver_progress = {}
    for code, d in drivers.items():
        try:
            lap_no = int(d.get("lap", 1))
        except (TypeError, ValueError):
            lap_no = 1
        lap_no = max(1, lap_no)

        rel_dist = d.get("rel_dist", 0.0)
        try:
            rel = float(rel_dist)
        except (TypeError, ValueError):
            rel = 0.0
        if rel != rel:
            rel = 0.0
        rel = max(0.0, min(1.0, rel))

        if track_length_m > 0.0:
            progress_m = (lap_no - 1) * track_length_m + rel * track_length_m
        else:
            try:
                progress_m = float(d.get("dist", 0.0))
            except (TypeError, ValueError):
                progress_m = 0.0
            if progress_m != progress_m or progress_m < 0.0:
                progress_m = 0.0
        driver_progress[code] = progress_m

    rankable_codes = [
        code
        for code in driver_progress.keys()
        if str((badge_cache.get(code) or (None, None))[0] or "").upper() not in out_badges
    ]
    if not rankable_codes:
        rankable_codes = list(driver_progress.keys())

    if prev_pos_hint is None:
        prev_pos_hint = {}

    frame_t = float(frame.get("t", 0.0))
    max_progress_m = max((driver_progress[c] for c in rankable_codes), default=0.0)
    launch_seed_lock = (not prev_pos_hint) and frame_t <= 1.0 and max_progress_m <= 20.0

    if launch_seed_lock:
        target_sorted_codes = sorted(
            rankable_codes,
            key=lambda c: (
                grid_rank_by_code.get(c, 10_000),
                c,
            ),
        )
    else:
        progress_bucket = {
            code: int(driver_progress[code] / position_quantum_m)
            for code in rankable_codes
        }

        target_sorted_codes = sorted(
            rankable_codes,
            key=lambda c: (
                -progress_bucket[c],
                prev_pos_hint.get(c, 10_000),
                grid_rank_by_code.get(c, 10_000),
                -driver_progress[c],
                c,
            ),
        )

    sorted_codes = target_sorted_codes

    # Adjacent-frame continuity guard: allow only small per-frame rank movement
    # to suppress impossible leaderboard jumps from telemetry jitter.
    if prev_pos_hint and len(target_sorted_codes) > 1:
        target_pos_by_code = {code: i + 1 for i, code in enumerate(target_sorted_codes)}
        prev_order = sorted(
            target_sorted_codes,
            key=lambda c: (
                prev_pos_hint.get(c, 10_000),
                grid_rank_by_code.get(c, 10_000),
                c,
            ),
        )

        n_codes = len(target_sorted_codes)
        clamped_entries = []
        for code in prev_order:
            target_pos = target_pos_by_code[code]
            prev_pos = int(prev_pos_hint.get(code, target_pos))
            prev_pos = max(1, min(n_codes, prev_pos))
            lo = max(1, prev_pos - max_position_step)
            hi = min(n_codes, prev_pos + max_position_step)
            clamped_pos = max(lo, min(hi, target_pos))
            clamped_entries.append((code, clamped_pos, target_pos, prev_pos))

        clamped_entries.sort(
            key=lambda item: (
                item[1],
                item[2],
                item[3],
                grid_rank_by_code.get(item[0], 10_000),
                item[0],
            )
        )
        sorted_codes = [item[0] for item in clamped_entries]
    pos_by_code = {code: i + 1 for i, code in enumerate(sorted_codes)}

    standings = []
    for code in all_codes:
        badge, badge_reason = badge_cache.get(code, (None, None))

        if code not in drivers:
            standings.append({
                "pos": 99,
                "code": code,
                "gap_s": None,
                "interval_s": None,
                "last_lap_s": None,
                "best_lap_s": None,
                "last_s1_s": None,
                "last_s2_s": None,
                "last_s3_s": None,
                "personal_best_lap_s": None,
                "personal_best_s1_s": None,
                "personal_best_s2_s": None,
                "personal_best_s3_s": None,
                "compound_int": 0,
                "tyre_age_laps": 0,
                "status": "OUT",
                "in_pit": False,
                "in_drs": False,
                "x": None,
                "y": None,
                "lap": 1,
                "rel_dist": 0.0,
                "fraction": 0.0,
                "speed_kph": 0.0,
                "gear": 0,
                "drs_raw": 0,
                "throttle_pct": 0.0,
                "brake_pct": 0.0,
                "rpm": 0.0,
                "stint": 1,
                "label_status": badge,
                "status_reason": badge_reason,
            })
            continue

        pos = pos_by_code.get(code, 99)
        d = drivers[code]
        progress_m = driver_progress[code]
        badge_norm = str(badge or "").upper()
        is_out_badge = badge_norm in out_badges
        gap_s = None
        interval_s = None
        if (not is_out_badge) and pos > 1 and sorted_codes:
            leader_progress = driver_progress[sorted_codes[0]]
            gap_dist = abs(leader_progress - progress_m)
            gap_s = round(gap_dist / 10.0 / 55.56, 3)
            ahead_progress = driver_progress[sorted_codes[pos - 2]]
            int_dist = abs(ahead_progress - progress_m)
            interval_s = round(int_dist / 10.0 / 55.56, 3)

        driver_laps_data = lap_data.get(code, {}).get("laps", {})
        lap_agg = lap_aggregates.get(code, {})
        current_lap = d.get("lap", 1)
        prev_lap_no = current_lap - 1
        last_lap_s = None
        best_lap_s = lap_agg.get("best_lap_s")
        last_s1_s = None
        last_s2_s = None
        last_s3_s = None
        if prev_lap_no in driver_laps_data:
            prev_lap = driver_laps_data[prev_lap_no]
            last_lap_s = round(prev_lap["lap_time_s"], 3) if prev_lap.get("lap_time_s") is not None else None
            last_s1_s = round(prev_lap["s1_s"], 3) if prev_lap.get("s1_s") is not None else None
            last_s2_s = round(prev_lap["s2_s"], 3) if prev_lap.get("s2_s") is not None else None
            last_s3_s = round(prev_lap["s3_s"], 3) if prev_lap.get("s3_s") is not None else None

        personal_best_lap_s = lap_agg.get("personal_best_lap_s")
        personal_best_s1_s = lap_agg.get("personal_best_s1_s")
        personal_best_s2_s = lap_agg.get("personal_best_s2_s")
        personal_best_s3_s = lap_agg.get("personal_best_s3_s")

        drs_raw = d.get("drs", 0)
        in_drs = drs_raw in (10, 12, 14)

        rel_dist = float(d.get("rel_dist", 0.0))
        fraction = max(0.0, min(1.0, rel_dist))

        # Live branch: fallback based on lap-level PitInTime/PitOutTime and lap fraction (frame does not set in_pit)
        # Lap 1 carries an implicit pit_out flag for everyone (formation lap),
        # so a naive trigger lights the limiter on the grid at race start.
        # Suppress the pit_out trigger on lap 1 unless the driver actually
        # started from the pit lane (FastF1 reports GridPosition as NaN/None
        # for pit-lane starts; valid grid slots are 1..N).
        current_lap_info = driver_laps_data.get(current_lap)
        in_pit = False
        if current_lap_info:
            grid_pos = (driver_results.get(code) or {}).get("grid_position")
            started_from_pit = grid_pos is None or (isinstance(grid_pos, int) and grid_pos <= 0)
            allow_pit_out = current_lap_info.get("pit_out") and (current_lap > 1 or started_from_pit)
            if (current_lap_info.get("pit_in") and fraction > 0.96) or (allow_pit_out and fraction < 0.04):
                in_pit = True

        if is_out_badge:
            status = "OUT"
            in_pit = False
        else:
            status = "PIT" if in_pit else "RUN"

        standings.append({
            "pos": pos,
            "code": code,
            "gap_s": gap_s,
            "interval_s": interval_s,
            "last_lap_s": last_lap_s,
            "best_lap_s": best_lap_s,
            "last_s1_s": last_s1_s,
            "last_s2_s": last_s2_s,
            "last_s3_s": last_s3_s,
            "personal_best_lap_s": personal_best_lap_s,
            "personal_best_s1_s": personal_best_s1_s,
            "personal_best_s2_s": personal_best_s2_s,
            "personal_best_s3_s": personal_best_s3_s,
            "compound_int": int(d.get("tyre", 0)),
            "tyre_age_laps": int(d.get("tyre_life", 0)),
            "status": status,
            "in_pit": in_pit,
            "in_drs": in_drs,
            "x": float(d.get("x", 0.0)),
            "y": float(d.get("y", 0.0)),
            "lap": int(d.get("lap", 1)),
            "rel_dist": rel_dist,
            "fraction": round(fraction, 6),
            "speed_kph": float(d.get("speed", 0.0)),
            "gear": int(d.get("gear", 0)),
            "drs_raw": drs_raw,
            "throttle_pct": float(d.get("throttle", 0.0)),
            "brake_pct": _brake_intensity_pct(code, d, prev_drivers, dt, DECEL_FULL),
            "rpm": float(d.get("rpm", 0.0)),
            "stint": current_lap_info.get("stint", 1) if current_lap_info else 1,
            "label_status": badge,
            "status_reason": badge_reason,
        })

    standings.sort(key=lambda s: s.get("pos", 99))
    perf_metrics.record_sample("standings_from_frame", time.perf_counter() - started)
    return standings
