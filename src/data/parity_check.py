from __future__ import annotations

import argparse
import pickle
from pathlib import Path

import numpy as np

from src.data.migrate_cache import _arrow_name_from_pickle
from src.data.race_store import RaceHandle

_FLOAT_FIELDS = ("x", "y", "dist", "rel_dist", "speed", "throttle", "brake", "rpm", "tyre_life")
_INT_FIELDS = ("lap", "gear", "drs", "tyre")


def _resolve_paths(race_arg: str, computed_dir: Path) -> tuple[Path, Path]:
    p = Path(race_arg)
    if p.exists():
        if p.suffix == ".pkl":
            return p, _arrow_name_from_pickle(p)
        if p.suffix == ".arrow":
            arrow = p
            tag = "_R.arrow" if arrow.name.endswith("_R.arrow") else "_S.arrow"
            suffix = "_race_telemetry.pkl" if tag == "_R.arrow" else "_sprint_telemetry.pkl"
            stem = arrow.name[: -len(tag)]
            return arrow.with_name(f"{stem}{suffix}"), arrow
    candidates = sorted(computed_dir.glob(f"{race_arg}*_telemetry.pkl"))
    if not candidates:
        raise FileNotFoundError(f"No pickle cache found for '{race_arg}'")
    pkl = candidates[0]
    return pkl, _arrow_name_from_pickle(pkl)


def _assert_close(a: float, b: float, tol: float, label: str):
    if not np.isfinite(a) or not np.isfinite(b):
        if np.isnan(a) and np.isnan(b):
            return
        raise AssertionError(f"{label}: non-finite values {a} vs {b}")
    if abs(a - b) > tol:
        raise AssertionError(f"{label}: {a} vs {b} (tol={tol})")


def run_parity_check(pickle_path: Path, arrow_path: Path, samples: int = 200):
    with pickle_path.open("rb") as f:
        payload = pickle.load(f)
    frames = payload.get("frames") or []
    if not frames:
        raise AssertionError("Pickle cache has no frames")

    handle = RaceHandle(arrow_path)
    if handle.frame_count != len(frames):
        raise AssertionError(f"Frame count mismatch: pickle={len(frames)} arrow={handle.frame_count}")

    idxs = np.linspace(0, len(frames) - 1, num=min(samples, len(frames)), dtype=int)
    for idx in idxs:
        lhs = frames[int(idx)]
        rhs = handle.frame_at(int(idx))
        _assert_close(float(lhs.get("t", 0.0)), float(rhs.get("t", 0.0)), 1e-3, f"frame[{idx}].t")
        if int(lhs.get("lap", 1)) != int(rhs.get("lap", 1)):
            raise AssertionError(f"frame[{idx}].lap mismatch: {lhs.get('lap')} vs {rhs.get('lap')}")

        l_drivers = lhs.get("drivers", {})
        r_drivers = rhs.get("drivers", {})
        if set(l_drivers.keys()) != set(r_drivers.keys()):
            raise AssertionError(f"frame[{idx}] driver set mismatch")
        for code in l_drivers.keys():
            ld = l_drivers[code]
            rd = r_drivers[code]
            for name in _FLOAT_FIELDS:
                if name == "brake":
                    lb = int(float(ld.get("brake", 0.0)) > 0.0)
                    rb = int(float(rd.get("brake", 0.0)) > 0.0)
                    if lb != rb:
                        raise AssertionError(f"frame[{idx}].{code}.brake mismatch: {lb} vs {rb}")
                    continue
                _assert_close(float(ld.get(name, 0.0)), float(rd.get(name, 0.0)), 1e-3, f"frame[{idx}].{code}.{name}")
            for name in _INT_FIELDS:
                li = int(round(ld.get(name, 0)))
                ri = int(round(rd.get(name, 0)))
                if li != ri:
                    raise AssertionError(f"frame[{idx}].{code}.{name} mismatch: {li} vs {ri}")

            # Explicit requirement: drs_raw/code preserved exactly
            if int(round(ld.get("drs", 0))) != int(round(rd.get("drs", 0))):
                raise AssertionError(f"frame[{idx}].{code}.drs mismatch")


def main():
    parser = argparse.ArgumentParser(description="Parity-check Arrow cache against legacy pickle cache.")
    parser.add_argument("race", help="Race cache prefix or explicit cache path.")
    parser.add_argument("--computed-dir", type=Path, default=Path("computed_data"))
    parser.add_argument("--samples", type=int, default=200)
    args = parser.parse_args()

    pkl, arrow = _resolve_paths(args.race, args.computed_dir)
    if not arrow.exists():
        raise SystemExit(f"Arrow cache not found: {arrow}")

    run_parity_check(pkl, arrow, samples=args.samples)
    print(f"Parity OK ({args.samples} samples): {pkl.name} == {arrow.name}")


if __name__ == "__main__":
    main()
