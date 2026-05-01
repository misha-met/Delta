from __future__ import annotations

import os
import sys
import threading
import time
from collections import defaultdict, deque
from contextlib import contextmanager

import numpy as np

_MAX_SAMPLES_PER_METRIC = 50_000
_SAMPLES: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=_MAX_SAMPLES_PER_METRIC))
_COUNTERS: dict[str, int] = defaultdict(int)
_LOCK = threading.Lock()


def timing_enabled() -> bool:
    return os.getenv("DELTA_TIMING", os.getenv("APEX_TIMING", "0")) == "1"


def now_utc_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def log(message: str) -> None:
    if not timing_enabled():
        return
    sys.stderr.write(f"[DELTA_TIMING] {message}\n")
    sys.stderr.flush()


@contextmanager
def timed(label: str):
    started = time.perf_counter()
    try:
        yield
    finally:
        elapsed_s = time.perf_counter() - started
        log(f"{label}={elapsed_s * 1000.0:.3f}ms")


def record_sample(metric: str, seconds: float) -> None:
    with _LOCK:
        _SAMPLES[metric].append(float(seconds))
        _COUNTERS[f"{metric}:count"] += 1


def bump_counter(metric: str, amount: int = 1) -> None:
    with _LOCK:
        _COUNTERS[metric] += int(amount)


def counter(metric: str) -> int:
    with _LOCK:
        return int(_COUNTERS.get(metric, 0))


def metric_summary(metric: str) -> dict:
    with _LOCK:
        data = list(_SAMPLES.get(metric, ()))
    if not data:
        return {"count": 0, "p50_us": 0.0, "p95_us": 0.0, "max_us": 0.0}
    arr = np.asarray(data, dtype=np.float64) * 1_000_000.0
    return {
        "count": int(arr.size),
        "p50_us": float(np.percentile(arr, 50)),
        "p95_us": float(np.percentile(arr, 95)),
        "max_us": float(np.max(arr)),
    }


def clear(metric: str | None = None) -> None:
    with _LOCK:
        if metric is None:
            _SAMPLES.clear()
            _COUNTERS.clear()
            return
        _SAMPLES.pop(metric, None)
        keys = [k for k in _COUNTERS.keys() if k == metric or k.startswith(f"{metric}:")]
        for key in keys:
            _COUNTERS.pop(key, None)
