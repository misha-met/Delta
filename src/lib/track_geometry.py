import numpy as np


def build_track_pure(example_lap, track_width=200):
    """Pure-numpy track geometry builder (no Arcade dependency).

    Keeps the geometry generation fully headless so the web server can build
    track data without any desktop UI dependencies.
    """
    drs_zones = _plot_drs_zones(example_lap)
    plot_x_ref = example_lap["X"]
    plot_y_ref = example_lap["Y"]
    plot_z_ref = example_lap["Z"] if "Z" in example_lap else None

    dx = np.gradient(plot_x_ref)
    dy = np.gradient(plot_y_ref)

    norm = np.sqrt(dx**2 + dy**2)
    norm[norm == 0] = 1.0
    dx /= norm
    dy /= norm

    nx = -dy
    ny = dx

    x_outer = plot_x_ref + nx * (track_width / 2)
    y_outer = plot_y_ref + ny * (track_width / 2)
    x_inner = plot_x_ref - nx * (track_width / 2)
    y_inner = plot_y_ref - ny * (track_width / 2)

    x_min = min(plot_x_ref.min(), x_inner.min(), x_outer.min())
    x_max = max(plot_x_ref.max(), x_inner.max(), x_outer.max())
    y_min = min(plot_y_ref.min(), y_inner.min(), y_outer.min())
    y_max = max(plot_y_ref.max(), y_inner.max(), y_outer.max())

    return (plot_x_ref, plot_y_ref, x_inner, y_inner, x_outer, y_outer,
            x_min, x_max, y_min, y_max, drs_zones, plot_z_ref)


def _plot_drs_zones(example_lap):
    x_val = example_lap["X"]
    y_val = example_lap["Y"]
    drs_zones = []
    drs_start = None

    for i, val in enumerate(example_lap["DRS"]):
        if val in [10, 12, 14]:
            if drs_start is None:
                drs_start = i
        else:
            if drs_start is not None:
                drs_end = i - 1
                zone = {
                    "start": {"x": x_val.iloc[drs_start], "y": y_val.iloc[drs_start], "index": drs_start},
                    "end": {"x": x_val.iloc[drs_end], "y": y_val.iloc[drs_end], "index": drs_end},
                }
                drs_zones.append(zone)
                drs_start = None

    if drs_start is not None:
        drs_end = len(example_lap["DRS"]) - 1
        zone = {
            "start": {"x": x_val.iloc[drs_start], "y": y_val.iloc[drs_start], "index": drs_start},
            "end": {"x": x_val.iloc[drs_end], "y": y_val.iloc[drs_end], "index": drs_end},
        }
        drs_zones.append(zone)

    return drs_zones
