import math
from datetime import datetime, date
import numpy as np
import pandas as pd

_PRIMITIVES = (str, int, float, bool, type(None))


def safe_jsonable(obj):
    """Recursively convert obj to a JSON-safe structure.

    Handles NumPy scalars/arrays, Pandas Timestamps/Timedeltas/Series,
    NaN/Inf floats, and nested dicts/lists.
    """
    if isinstance(obj, _PRIMITIVES):
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return None
        return obj
    if isinstance(obj, dict):
        return {str(k): safe_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [safe_jsonable(v) for v in obj]
    # NumPy
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return [safe_jsonable(v) for v in obj.tolist()]
    # Pandas
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if isinstance(obj, pd.Timedelta):
        return obj.total_seconds()
    if isinstance(obj, pd.Series):
        return [safe_jsonable(v) for v in obj.tolist()]
    # datetime
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    # Last-ditch
    return str(obj)
