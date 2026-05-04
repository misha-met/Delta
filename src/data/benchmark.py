from __future__ import annotations

import asyncio
import argparse
import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

try:
    import psutil
except Exception:  # pragma: no cover - runtime fallback
    psutil = None

from src.data import perf_metrics
from src.f1_data import FPS
from src.web.playback import MIN_PUSH_INTERVAL, Playback
from src.web.session_manager import SessionManager
from src.web.cache_utils import web_cache_arrow_path


def _git_sha() -> str:
    try:
        out = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        return out
    except Exception:
        return "unknown"


@dataclass
class _SimHub:
    messages: int = 0
    payload_bytes: int = 0

    async def broadcast(self, payload: dict):
        data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        self.messages += 1
        self.payload_bytes += len(data)


class _LoadedSession:
    def __init__(self, loaded: dict):
        self._loaded = loaded

    def current(self) -> dict:
        return self._loaded


async def _simulate_playback_window(loaded: dict, speed: float, duration_s: float) -> tuple[float, float]:
    hub = _SimHub()
    pb = Playback(_LoadedSession(loaded), hub)  # type: ignore[arg-type]
    pb.playback_speed = float(speed)
    pb.paused = False
    pb._sync_loaded_state(loaded)
    pb._snapshot_pending = False
    pb._last_push = 0.0
    pb._last_broadcast_t_s = 0.0
    pb.frame_index = 0.0

    total_ticks = int(duration_s * FPS)
    sim_now = 0.0
    for _ in range(total_ticks):
        dt = 1.0 / FPS
        sim_now += dt
        if not pb.paused:
            pb.frame_index = min(
                pb.frame_index + dt * FPS * pb.playback_speed,
                pb._n_frames() - 1,
            )
        if sim_now - pb._last_push >= MIN_PUSH_INTERVAL:
            await pb._push_now(loop_time=sim_now)

    msgs_per_s = hub.messages / duration_s if duration_s > 0 else 0.0
    bytes_per_s = hub.payload_bytes / duration_s if duration_s > 0 else 0.0
    return msgs_per_s, bytes_per_s


def _cache_path_from_loaded(loaded: dict) -> Path:
    handle = loaded.get("handle")
    if handle is not None:
        return Path(handle.arrow_path)
    return web_cache_arrow_path(
        int(loaded.get("year", 0)),
        int(loaded.get("round", 0)),
        str(loaded.get("session_type", "R")),
    )


def run_benchmark(year: int, round_number: int, session_type: str, duration_s: float) -> dict:
    perf_metrics.clear()
    manager = SessionManager(cache_dir=Path("cache/fastf1"))

    load_started = time.perf_counter()
    loaded = manager.load(year, round_number, session_type)
    cache_load_s = time.perf_counter() - load_started

    rss_mb = 0
    if psutil is not None:
        rss_mb = int(psutil.Process().memory_info().rss / (1024 * 1024))

    cache_file_mb = 0.0
    cache_path = _cache_path_from_loaded(loaded)
    if cache_path.exists():
        cache_file_mb = round(cache_path.stat().st_size / (1024 * 1024), 3)

    perf_metrics.clear("standings_from_frame")
    msgs_per_s_1x, bytes_per_s_1x = asyncio.run(
        _simulate_playback_window(loaded, speed=1.0, duration_s=duration_s)
    )
    standings_p95 = perf_metrics.metric_summary("standings_from_frame")["p95_us"]

    cpu_pct_4x = 0.0
    if psutil is not None:
        proc = psutil.Process()
        c0 = proc.cpu_times()
        cpu_start = float(c0.user + c0.system)
        w0 = time.perf_counter()
        asyncio.run(_simulate_playback_window(loaded, speed=4.0, duration_s=duration_s))
        wall = max(1e-6, time.perf_counter() - w0)
        c1 = proc.cpu_times()
        cpu_end = float(c1.user + c1.system)
        cpu_pct_4x = ((cpu_end - cpu_start) / wall) * 100.0
    else:
        asyncio.run(_simulate_playback_window(loaded, speed=4.0, duration_s=duration_s))

    return {
        "race": loaded.get("event", {}).get("event_name", "unknown"),
        "git_sha": _git_sha(),
        "captured_at": perf_metrics.now_utc_iso(),
        "cache_load_s": round(cache_load_s, 4),
        "rss_after_load_mb": int(rss_mb),
        "cache_file_mb": cache_file_mb,
        "ws_msgs_per_s_1x": round(msgs_per_s_1x, 4),
        "ws_bytes_per_s_1x": int(bytes_per_s_1x),
        "standings_p95_us": round(float(standings_p95), 3),
        "server_cpu_pct_4x": round(float(cpu_pct_4x), 3),
    }


def main():
    parser = argparse.ArgumentParser(description="Benchmark cache load + playback hot path.")
    parser.add_argument("--year", type=int, default=2025)
    parser.add_argument("--round", dest="round_number", type=int, default=5)
    parser.add_argument("--session", dest="session_type", default="R")
    parser.add_argument("--duration", type=float, default=60.0)
    parser.add_argument("--output", type=Path, default=Path("docs/perf/baseline.json"))
    args = parser.parse_args()

    result = run_benchmark(args.year, args.round_number, args.session_type, args.duration)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
