from __future__ import annotations

import argparse
from pathlib import Path

from src.data.race_store import RaceHandle, migrate_pickle_file_to_arrow


def _arrow_name_from_pickle(pickle_path: Path) -> Path:
    name = pickle_path.name
    if name.endswith("_race_telemetry.pkl"):
        stem = name[: -len("_race_telemetry.pkl")]
        return pickle_path.with_name(f"{stem}_R.arrow")
    if name.endswith("_sprint_telemetry.pkl"):
        stem = name[: -len("_sprint_telemetry.pkl")]
        return pickle_path.with_name(f"{stem}_S.arrow")
    stem = pickle_path.stem
    return pickle_path.with_name(f"{stem}.arrow")


def _resolve_pickle_paths(race: str, computed_dir: Path) -> list[Path]:
    candidate = Path(race)
    if candidate.exists():
        return [candidate]
    patterns = [
        f"{race}*_race_telemetry.pkl",
        f"{race}*_sprint_telemetry.pkl",
    ]
    paths = []
    for pattern in patterns:
        paths.extend(sorted(computed_dir.glob(pattern)))
    return paths


def main():
    parser = argparse.ArgumentParser(description="Migrate cached telemetry pickle(s) to Arrow + meta sidecars.")
    parser.add_argument("--race", required=True, help="Race cache prefix or direct .pkl path.")
    parser.add_argument("--computed-dir", type=Path, default=Path("computed_data"))
    parser.add_argument("--delete-legacy", action="store_true", help="Delete the legacy pickle after successful validation.")
    args = parser.parse_args()

    paths = _resolve_pickle_paths(args.race, args.computed_dir)
    if not paths:
        raise SystemExit(f"No matching cache pickle found for --race '{args.race}'")

    for pkl in paths:
        arrow = _arrow_name_from_pickle(pkl)
        out = migrate_pickle_file_to_arrow(pkl, arrow)
        # Validate by opening and touching the first frame.
        handle = RaceHandle(out)
        _ = handle.frame_at(0)
        print(f"Migrated: {pkl} -> {out}")
        if args.delete_legacy:
            pkl.unlink(missing_ok=True)
            print(f"Deleted legacy pickle: {pkl}")


if __name__ == "__main__":
    main()
