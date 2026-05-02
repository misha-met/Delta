FLAG_MAP = {"1": "green", "2": "yellow", "4": "sc", "5": "red", "6": "vsc", "7": "vsc"}


class FlagBisectByTime:
    """Bisect by race time (seconds) into track_statuses list from get_race_telemetry."""

    def __init__(self, track_statuses_list: list):
        # track_statuses_list is [{"status": "1", "start_time": float, "end_time": float|None}, ...]
        self._entries = sorted(track_statuses_list, key=lambda e: e["start_time"])

    def at(self, t_seconds: float) -> str:
        active = "1"  # default green
        for entry in self._entries:
            if t_seconds >= entry["start_time"] and (
                entry.get("end_time") is None or t_seconds <= entry["end_time"]
            ):
                active = entry["status"]
        return FLAG_MAP.get(active, "green")
