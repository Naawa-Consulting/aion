from __future__ import annotations

import io

import pandas as pd
from pandas.api.types import is_datetime64_any_dtype

from ..models import Dataset
from .storage import get_storage


def load_dataset_frame(ds: Dataset, columns: list[str] | None = None) -> pd.DataFrame:
    """Read a dataset from Supabase Storage, trim to the configured sample, and apply time settings."""
    raw = get_storage().read_bytes(ds.storage_key)
    df = pd.read_parquet(io.BytesIO(raw), columns=columns)
    sample = getattr(ds, "sample_size", None)
    if sample and sample > 0:
        df = df.head(sample)
    return _apply_time_settings(df, ds)


def _apply_time_settings(df: pd.DataFrame, ds: Dataset) -> pd.DataFrame:
    time_col = getattr(ds, "time_variable", None)
    if not time_col or time_col not in df.columns:
        return df

    series = df[time_col]
    fmt = getattr(ds, "time_format", None) or None
    timezone = getattr(ds, "time_timezone", None)
    needs_parse = not is_datetime64_any_dtype(series)

    if needs_parse or fmt or timezone:
        utc = bool(timezone and timezone.upper() == "UTC")
        try:
            parsed = pd.to_datetime(series, format=fmt, errors="raise", utc=utc)
        except Exception as exc:  # pragma: no cover - propagated to caller
            raise ValueError(f"Failed to parse time column '{time_col}': {exc}") from exc
        series = parsed
        if timezone and timezone.upper() != "UTC":
            tz = timezone
            if series.dt.tz is None:
                series = series.dt.tz_localize(tz, nonexistent="NaT", ambiguous="NaT")
            else:
                series = series.dt.tz_convert(tz)
    df = df.copy()
    df[time_col] = series
    df = df.sort_values(time_col).reset_index(drop=True)
    return df
