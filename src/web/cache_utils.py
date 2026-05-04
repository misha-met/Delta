from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

WEB_CACHE_SCHEMA_VERSION = 3
WEB_CACHE_PROFILE = "web-replay"
WEB_CACHE_ROOT = Path("computed_data") / "web" / "v1"

_WEB_REQUIRED_META_FIELDS = (
    "fps",
    "frame_count",
    "total_laps",
    "driver_colors",
    "telemetry_ranges",
    "max_tyre_life",
    "track_statuses",
    "race_control_messages",
    "weather_per_minute",
    "safety_car_events",
    "lap_trace_index",
    "event",
    "driver_meta",
    "driver_results",
    "geometry",
    "circuit_rotation",
    "lap_data",
    "lap_aggregates",
    "session_best",
    "fastest_qual_lap_s",
    "driver_stop_windows",
    "total_duration_s",
)


def normalise_session_type(session_type: str) -> str:
    value = str(session_type or "R").strip().upper()
    return value or "R"


def web_cache_key(year: int, round_number: int, session_type: str) -> dict[str, int | str]:
    return {
        "year": int(year),
        "round": int(round_number),
        "session_type": normalise_session_type(session_type),
    }


def web_cache_arrow_path(
    year: int,
    round_number: int,
    session_type: str,
    computed_root: Path | str = Path("computed_data"),
) -> Path:
    key = web_cache_key(year, round_number, session_type)
    root = Path(computed_root)
    return root / "web" / "v1" / f"{key['year']}_{key['round']}_{key['session_type']}.arrow"


def web_cache_meta_path(arrow_path: Path | str) -> Path:
    arrow = Path(arrow_path)
    if arrow.suffix == ".arrow":
        return arrow.with_suffix(".meta.json")
    return arrow.parent / f"{arrow.name}.meta.json"


def public_geometry_payload(geometry: dict | None) -> dict:
    return {k: v for k, v in (geometry or {}).items() if not str(k).startswith("_")}


def _build_reference(xs: list[float], ys: list[float], interp_points: int = 4000):
    x_arr = np.asarray(xs, dtype=np.float64)
    y_arr = np.asarray(ys, dtype=np.float64)

    if x_arr.size == 0 or y_arr.size == 0:
        x_arr = np.asarray([0.0], dtype=np.float64)
        y_arr = np.asarray([0.0], dtype=np.float64)
    if x_arr.size == 1 or y_arr.size == 1:
        cumdist = np.asarray([0.0], dtype=np.float64)
        return x_arr, y_arr, cumdist, 0.0

    points = max(int(interp_points), int(x_arr.size))
    t_old = np.linspace(0.0, 1.0, x_arr.size)
    t_new = np.linspace(0.0, 1.0, points)
    ref_xs = np.interp(t_new, t_old, x_arr)
    ref_ys = np.interp(t_new, t_old, y_arr)
    diffs = np.sqrt(np.diff(ref_xs) ** 2 + np.diff(ref_ys) ** 2)
    cumdist = np.concatenate(([0.0], np.cumsum(diffs)))
    total = float(cumdist[-1]) if cumdist.size else 0.0
    return ref_xs, ref_ys, cumdist, total


def hydrate_runtime_geometry(geometry: dict | None) -> dict:
    geo = dict(geometry or {})
    centerline = geo.get("centerline") or {}
    ref_xs, ref_ys, ref_cumdist, ref_total_length = _build_reference(
        centerline.get("x") or [],
        centerline.get("y") or [],
    )
    tree_points = np.column_stack((ref_xs, ref_ys))
    if tree_points.size == 0:
        tree_points = np.asarray([[0.0, 0.0]], dtype=np.float64)
    geo["_ref_xs"] = ref_xs
    geo["_ref_ys"] = ref_ys
    geo["_ref_cumdist"] = ref_cumdist
    geo["_ref_total_length"] = float(ref_total_length)
    geo["_track_tree"] = cKDTree(tree_points)
    if geo.get("total_length_m") is None:
        geo["total_length_m"] = float(ref_total_length)
    return geo


def validate_web_cache_meta(meta: dict, year: int, round_number: int, session_type: str) -> tuple[bool, str]:
    if not isinstance(meta, dict):
        return False, "meta_not_dict"

    profile = str(meta.get("cache_profile", "")).strip()
    if profile != WEB_CACHE_PROFILE:
        return False, f"profile_mismatch:{profile or 'missing'}"

    try:
        schema = int(meta.get("schema_version", 0) or 0)
    except Exception:
        schema = 0
    if schema < WEB_CACHE_SCHEMA_VERSION:
        return False, f"schema_too_old:{schema}"

    expected_key = web_cache_key(year, round_number, session_type)
    actual_key = meta.get("cache_key")
    if actual_key != expected_key:
        return False, f"cache_key_mismatch:{actual_key!r}"

    for field in _WEB_REQUIRED_META_FIELDS:
        if field not in meta:
            return False, f"missing_field:{field}"

    return True, "ok"
