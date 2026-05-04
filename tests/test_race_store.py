from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np

from src.data.race_store import RaceHandle, build_lap_trace_index, write_race


def test_write_race_roundtrip_preserves_drs_raw():
    with TemporaryDirectory() as td:
        out = Path(td) / "mini_R.arrow"
        driver_arrays = {
            "AAA": {
                "t_idx": np.array([0, 1, 2], dtype=np.uint32),
                "x": np.array([1.0, 2.0, 3.0], dtype=np.float32),
                "y": np.array([4.0, 5.0, 6.0], dtype=np.float32),
                "dist": np.array([10.0, 20.0, 30.0], dtype=np.float32),
                "rel_dist": np.array([0.1, 0.2, 0.3], dtype=np.float32),
                "lap": np.array([1, 1, 1], dtype=np.int16),
                "speed": np.array([150.0, 151.0, 152.0], dtype=np.float32),
                "gear": np.array([6, 7, 8], dtype=np.int8),
                "drs": np.array([0, 10, 14], dtype=np.int8),
                "throttle": np.array([80.0, 81.0, 82.0], dtype=np.float32),
                "brake": np.array([0, 1, 0], dtype=np.int8),
                "rpm": np.array([11000.0, 11500.0, 11800.0], dtype=np.float32),
                "tyre": np.array([2, 2, 2], dtype=np.int8),
                "tyre_life": np.array([3.0, 3.1, 3.2], dtype=np.float32),
            }
        }
        meta = {
            "schema_version": 1,
            "fps": 60,
            "frame_count": 3,
            "total_laps": 1,
            "driver_codes": ["AAA"],
            "driver_colors": {"AAA": [255, 0, 0]},
            "track_statuses": [],
            "race_control_messages": [],
            "weather_per_minute": [],
            "safety_car_events": [],
            "telemetry_ranges": {},
            "max_tyre_life": {},
        }
        write_race(out, driver_arrays, meta)

        handle = RaceHandle(out)
        frame0 = handle.frame_at(0)
        frame1 = handle.frame_at(1)
        frame2 = handle.frame_at(2)

        assert frame0["drivers"]["AAA"]["drs"] == 0
        assert frame1["drivers"]["AAA"]["drs"] == 10
        assert frame2["drivers"]["AAA"]["drs"] == 14
        assert frame0["drivers"]["AAA"]["position"] == 1


def test_build_lap_trace_index_respects_telemetry_ranges():
    driver_arrays = {
        "AAA": {
            "t_idx": np.array([0, 1, 2, 3, 4, 5], dtype=np.uint32),
            "x": np.zeros(6, dtype=np.float32),
            "y": np.zeros(6, dtype=np.float32),
            "dist": np.array([0, 10, 20, 30, 40, 50], dtype=np.float32),
            "rel_dist": np.array([0.0, 0.2, 0.8, 0.1, 0.9, 1.0], dtype=np.float32),
            "lap": np.array([1, 1, 1, 2, 2, 2], dtype=np.int16),
            "speed": np.array([100, 110, 120, 130, 125, 115], dtype=np.float32),
            "gear": np.array([6, 6, 7, 7, 8, 8], dtype=np.int8),
            "drs": np.array([0, 10, 12, 8, 14, 14], dtype=np.int8),
            "throttle": np.array([70, 80, 90, 60, 50, 40], dtype=np.float32),
            "brake": np.array([0, 1, 0, 0, 1, 0], dtype=np.int8),
            "rpm": np.array([10000, 10500, 11000, 10800, 10200, 9800], dtype=np.float32),
            "tyre": np.array([2, 2, 2, 2, 2, 2], dtype=np.int8),
            "tyre_life": np.array([1, 1, 1, 2, 2, 2], dtype=np.float32),
        }
    }
    telemetry_ranges = {
        "AAA": {
            "start_time": 1.0 / 60.0,
            "end_time": 4.0 / 60.0,
            "max_lap": 2,
        }
    }

    index = build_lap_trace_index(driver_arrays, telemetry_ranges=telemetry_ranges, fps=60)

    assert index == {
        "AAA": {
            "1": {"start_idx": 1, "end_idx": 2},
            "2": {"start_idx": 3, "end_idx": 4},
        }
    }


def test_race_handle_lap_trace_uses_cached_lap_bounds():
    with TemporaryDirectory() as td:
        out = Path(td) / "mini_R.arrow"
        driver_arrays = {
            "AAA": {
                "t_idx": np.array([0, 1, 2, 3, 4, 5], dtype=np.uint32),
                "x": np.zeros(6, dtype=np.float32),
                "y": np.zeros(6, dtype=np.float32),
                "dist": np.array([0, 10, 20, 30, 40, 50], dtype=np.float32),
                "rel_dist": np.array([0.0, 0.2, 0.8, 0.1, 0.9, 1.0], dtype=np.float32),
                "lap": np.array([1, 1, 1, 2, 2, 2], dtype=np.int16),
                "speed": np.array([100, 110, 120, 130, 125, 115], dtype=np.float32),
                "gear": np.array([6, 6, 7, 7, 8, 8], dtype=np.int8),
                "drs": np.array([0, 10, 12, 8, 14, 14], dtype=np.int8),
                "throttle": np.array([70, 80, 90, 60, 50, 40], dtype=np.float32),
                "brake": np.array([0, 1, 0, 0, 1, 0], dtype=np.int8),
                "rpm": np.array([10000, 10500, 11000, 10800, 10200, 9800], dtype=np.float32),
                "tyre": np.array([2, 2, 2, 2, 2, 2], dtype=np.int8),
                "tyre_life": np.array([1, 1, 1, 2, 2, 2], dtype=np.float32),
            }
        }
        telemetry_ranges = {
            "AAA": {
                "start_time": 1.0 / 60.0,
                "end_time": 4.0 / 60.0,
                "max_lap": 2,
            }
        }
        meta = {
            "schema_version": 2,
            "fps": 60,
            "frame_count": 6,
            "total_laps": 2,
            "driver_codes": ["AAA"],
            "driver_colors": {"AAA": [255, 0, 0]},
            "track_statuses": [],
            "race_control_messages": [],
            "weather_per_minute": [],
            "safety_car_events": [],
            "telemetry_ranges": telemetry_ranges,
            "max_tyre_life": {"AAA": 2},
            "lap_trace_index": build_lap_trace_index(
                driver_arrays,
                telemetry_ranges=telemetry_ranges,
                fps=60,
            ),
        }
        write_race(out, driver_arrays, meta)

        handle = RaceHandle(out)
        lap1 = handle.lap_trace("AAA", 1)
        lap2 = handle.lap_trace("AAA", 2)

        assert lap1["fraction"] == [0.2, 0.8]
        assert lap1["speed"] == [110.0, 120.0]
        assert lap1["brake"] == [100.0, 0.0]
        assert lap1["drs"] == [10, 12]

        assert lap2["fraction"] == [0.1, 0.9]
        assert lap2["gear"] == [7, 8]
        assert lap2["rpm"] == [10800.0, 10200.0]
        assert lap2["brake"] == [0.0, 100.0]


def test_race_handle_lap_trace_falls_back_when_index_missing():
    with TemporaryDirectory() as td:
        out = Path(td) / "legacy_R.arrow"
        driver_arrays = {
            "AAA": {
                "t_idx": np.array([0, 1, 2, 3, 4, 5], dtype=np.uint32),
                "x": np.zeros(6, dtype=np.float32),
                "y": np.zeros(6, dtype=np.float32),
                "dist": np.array([0, 10, 20, 30, 40, 50], dtype=np.float32),
                "rel_dist": np.array([0.0, 0.2, 0.8, 0.1, 0.9, 1.0], dtype=np.float32),
                "lap": np.array([1, 1, 1, 2, 2, 2], dtype=np.int16),
                "speed": np.array([100, 110, 120, 130, 125, 115], dtype=np.float32),
                "gear": np.array([6, 6, 7, 7, 8, 8], dtype=np.int8),
                "drs": np.array([0, 10, 12, 8, 14, 14], dtype=np.int8),
                "throttle": np.array([70, 80, 90, 60, 50, 40], dtype=np.float32),
                "brake": np.array([0, 1, 0, 0, 1, 0], dtype=np.int8),
                "rpm": np.array([10000, 10500, 11000, 10800, 10200, 9800], dtype=np.float32),
                "tyre": np.array([2, 2, 2, 2, 2, 2], dtype=np.int8),
                "tyre_life": np.array([1, 1, 1, 2, 2, 2], dtype=np.float32),
            }
        }
        meta = {
            "schema_version": 2,
            "fps": 60,
            "frame_count": 6,
            "total_laps": 2,
            "driver_codes": ["AAA"],
            "driver_colors": {"AAA": [255, 0, 0]},
            "track_statuses": [],
            "race_control_messages": [],
            "weather_per_minute": [],
            "safety_car_events": [],
            "telemetry_ranges": {
                "AAA": {
                    "start_time": 1.0 / 60.0,
                    "end_time": 4.0 / 60.0,
                    "max_lap": 2,
                }
            },
            "max_tyre_life": {"AAA": 2},
        }
        write_race(out, driver_arrays, meta)

        handle = RaceHandle(out)
        lap1 = handle.lap_trace("AAA", 1)

        assert lap1["fraction"] == [0.2, 0.8]
        assert lap1["speed"] == [110.0, 120.0]
