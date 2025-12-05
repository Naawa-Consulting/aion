from __future__ import annotations

import copy
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
import pandas as pd


CACHE_TTL_SECONDS = 300


@dataclass(frozen=True)
class ContributionCacheKey:
    dataset_id: str
    model_id: str
    time_column: str
    start: str
    end: str


@dataclass(frozen=True)
class AnalysisCacheKey:
    dataset_id: str
    model_id: str
    start: str
    end: str
    view: str
    extra: Tuple[Any, ...] = ()


_CONTRIBUTION_CACHE: Dict[ContributionCacheKey, Tuple[float, "ContributionResult"]] = {}
_ANALYSIS_CACHE: Dict[AnalysisCacheKey, Tuple[float, Any]] = {}


@dataclass
class ContributionResult:
    """Container for contribution calculations used across analysis endpoints."""

    frame: pd.DataFrame
    time_values: pd.Series
    per_row_contributions: pd.DataFrame
    per_variable_totals: Dict[str, float]
    intercept_value: float
    baseline_contribution: float
    total_contribution: float


def _now() -> float:
    return time.time()


def _normalize_timestamp(ts: Optional[pd.Timestamp]) -> str:
    if ts is None:
        return ""
    return ts.isoformat()


def _get_cached_contribution(key: ContributionCacheKey) -> Optional[ContributionResult]:
    entry = _CONTRIBUTION_CACHE.get(key)
    if not entry:
        return None
    ts, value = entry
    if _now() - ts > CACHE_TTL_SECONDS:
        _CONTRIBUTION_CACHE.pop(key, None)
        return None
    return value


def _set_cached_contribution(key: ContributionCacheKey, value: ContributionResult) -> None:
    _CONTRIBUTION_CACHE[key] = (_now(), value)


def get_cached_view(key: AnalysisCacheKey) -> Optional[Any]:
    entry = _ANALYSIS_CACHE.get(key)
    if not entry:
        return None
    ts, value = entry
    if _now() - ts > CACHE_TTL_SECONDS:
        _ANALYSIS_CACHE.pop(key, None)
        return None
    return copy.deepcopy(value)


def set_cached_view(key: AnalysisCacheKey, value: Any) -> None:
    _ANALYSIS_CACHE[key] = (_now(), copy.deepcopy(value))


def invalidate_cache_for_model(model_id: str) -> None:
    to_delete = [k for k in _CONTRIBUTION_CACHE if k.model_id == model_id]
    for key in to_delete:
        _CONTRIBUTION_CACHE.pop(key, None)
    to_delete = [k for k in _ANALYSIS_CACHE if k.model_id == model_id]
    for key in to_delete:
        _ANALYSIS_CACHE.pop(key, None)


def invalidate_cache_for_dataset(dataset_id: str) -> None:
    to_delete = [k for k in _CONTRIBUTION_CACHE if k.dataset_id == dataset_id]
    for key in to_delete:
        _CONTRIBUTION_CACHE.pop(key, None)
    to_delete = [k for k in _ANALYSIS_CACHE if k.dataset_id == dataset_id]
    for key in to_delete:
        _ANALYSIS_CACHE.pop(key, None)


def clear_analysis_cache() -> None:
    _CONTRIBUTION_CACHE.clear()
    _ANALYSIS_CACHE.clear()


def compute_contributions(
    *,
    dataset_id: str,
    model_id: str,
    df: pd.DataFrame,
    time_column: Optional[str],
    start: Optional[pd.Timestamp],
    end: Optional[pd.Timestamp],
    params: pd.Series,
    predictors: List[str],
) -> ContributionResult:
    if not time_column:
        raise HTTPException(
            status_code=422,
            detail="Dataset has no valid time column configured for analysis.",
        )
    if time_column not in df.columns:
        raise HTTPException(
            status_code=422,
            detail="Dataset has no valid time column configured for analysis.",
        )

    key = ContributionCacheKey(
        dataset_id=dataset_id,
        model_id=model_id,
        time_column=time_column,
        start=_normalize_timestamp(start),
        end=_normalize_timestamp(end),
    )
    cached = _get_cached_contribution(key)
    if cached is not None:
        return cached

    result = _compute_contributions_impl(
        df=df,
        time_column=time_column,
        start=start,
        end=end,
        params=params,
        predictors=predictors,
    )
    _set_cached_contribution(key, result)
    return result


def _compute_contributions_impl(
    *,
    df: pd.DataFrame,
    time_column: Optional[str],
    start: Optional[pd.Timestamp],
    end: Optional[pd.Timestamp],
    params: pd.Series,
    predictors: List[str],
) -> ContributionResult:
    """
    Single source of truth for Module 4 contribution math.

    - Validates the dataset has a usable time column.
    - Validates the model contains coefficients for every predictor + intercept.
    - Filters the frame by the requested date range.
    - Returns both per-row and aggregated contribution artifacts.
    """

    time_values = pd.to_datetime(df[time_column], errors="coerce")
    if time_values.isna().all():
        raise HTTPException(
            status_code=422,
            detail="Time column cannot be parsed as dates.",
        )
    invalid_ratio = float(time_values.isna().mean())
    if invalid_ratio > 0.1:
        raise HTTPException(
            status_code=422,
            detail="Time column cannot be parsed as dates.",
        )

    mask = ~time_values.isna()
    if start is not None:
        mask &= time_values >= start
    if end is not None:
        mask &= time_values <= end

    filtered_df = df.loc[mask].copy()
    time_values = time_values.loc[filtered_df.index]

    if filtered_df.empty:
        raise HTTPException(
            status_code=400, detail="No rows available for the selected date range"
        )

    missing_predictors = [col for col in predictors if col not in filtered_df.columns]
    if missing_predictors:
        raise HTTPException(
            status_code=422,
            detail=f"Dataset is missing predictors: {', '.join(missing_predictors)}",
        )

    coef_names = set(params.index)
    missing_coeffs = [col for col in predictors if col not in coef_names]
    if missing_coeffs:
        raise HTTPException(
            status_code=422,
            detail=f"Model is missing coefficients for predictors: {', '.join(missing_coeffs)}",
        )

    intercept_name = next(
        (name for name in ("const", "Intercept", "intercept") if name in coef_names),
        None,
    )
    if intercept_name is None:
        raise HTTPException(
            status_code=422,
            detail="Model has no intercept term; baseline contribution cannot be computed.",
        )

    intercept_value = float(params[intercept_name])

    numeric = filtered_df[predictors].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    per_row = pd.DataFrame(index=numeric.index)
    per_variable_totals: Dict[str, float] = {}

    for column in predictors:
        beta = float(params[column])
        contrib_series = numeric[column] * beta
        per_row[column] = contrib_series
        per_variable_totals[column] = float(contrib_series.sum())

    per_row["__intercept__"] = intercept_value
    baseline_contribution = intercept_value * len(per_row.index)
    total_contribution = baseline_contribution + sum(per_variable_totals.values())

    return ContributionResult(
        frame=filtered_df,
        time_values=time_values,
        per_row_contributions=per_row,
        per_variable_totals=per_variable_totals,
        intercept_value=intercept_value,
        baseline_contribution=baseline_contribution,
        total_contribution=total_contribution,
    )
