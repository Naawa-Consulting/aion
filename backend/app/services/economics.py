from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import pandas as pd

from ..models import InvestmentChannel, Model
from .analysis import ContributionResult


def parse_channel_config(channel: InvestmentChannel) -> Dict[str, Any]:
    try:
        return json.loads(channel.config_json)
    except (TypeError, ValueError):
        return {}


def _manual_investment_series(
    entries: List[dict], filtered_df: pd.DataFrame, time_column: str
) -> pd.Series:
    """Prorates each {amount, start_date, end_date} entry uniformly by calendar day, then
    buckets it into whichever row's period the day falls in (row period = [this row's
    timestamp, next row's timestamp), same day-count proration method used by the MX-HDI
    reference project to go from a monthly media plan to weekly rows)."""
    result = pd.Series(0.0, index=filtered_df.index)
    if not entries or time_column not in filtered_df.columns:
        return result

    ts = pd.to_datetime(filtered_df[time_column], errors="coerce").dropna().sort_values()
    if ts.empty:
        return result

    order = list(ts.index)
    boundaries = list(ts.tolist())
    gap = boundaries[-1] - boundaries[-2] if len(boundaries) > 1 else pd.Timedelta(days=1)
    row_starts = boundaries
    row_ends = boundaries[1:] + [boundaries[-1] + gap]

    for entry in entries:
        try:
            amount = float(entry["amount"])
            start = pd.Timestamp(entry["start_date"])
            end = pd.Timestamp(entry["end_date"]) + pd.Timedelta(days=1)  # exclusive
        except (KeyError, ValueError, TypeError):
            continue
        total_days = (end - start).days
        if total_days <= 0 or amount == 0:
            continue
        daily_rate = amount / total_days
        for idx, row_start, row_end in zip(order, row_starts, row_ends):
            overlap_start = max(start, row_start)
            overlap_end = min(end, row_end)
            overlap_days = (overlap_end - overlap_start).days
            if overlap_days > 0:
                result.loc[idx] += daily_rate * overlap_days
    return result


def channel_investment_series(
    channel: InvestmentChannel,
    config: Dict[str, Any],
    filtered_df: pd.DataFrame,
    time_column: Optional[str],
) -> tuple[pd.Series, bool]:
    """Returns (investment_series, misconfigured). A channel degrades to an all-zero series
    with misconfigured=True (rather than raising) when its config references a column that no
    longer exists — e.g. after a dataset column rename — so one bad channel never 500s the
    whole economics endpoint."""
    try:
        mode = channel.source_mode
        if mode == "dataset_column":
            col = config.get("cost_column")
            if not col or col not in filtered_df.columns:
                raise KeyError(col)
            series = pd.to_numeric(filtered_df[col], errors="coerce").fillna(0.0)
            return series, False
        if mode == "rate_metric":
            rate = config.get("rate_value")
            col = config.get("metric_column")
            if rate is None or not col or col not in filtered_df.columns:
                raise KeyError(col)
            series = pd.to_numeric(filtered_df[col], errors="coerce").fillna(0.0) * float(rate)
            return series, False
        if mode == "manual":
            if not time_column:
                raise ValueError("manual investment requires a configured time column")
            entries = config.get("entries") or []
            return _manual_investment_series(entries, filtered_df, time_column), False
        raise ValueError(f"Unknown source_mode: {mode}")
    except Exception:
        return pd.Series(0.0, index=filtered_df.index), True


def compute_channel_economics(
    *,
    model: Model,
    filtered_df: pd.DataFrame,
    contrib_result: ContributionResult,
    channels: List[InvestmentChannel],
    time_column: Optional[str],
) -> List[Dict[str, Any]]:
    """Per-channel investment/contribution/revenue series, independent of API response shape
    (summary vs. stacked aggregate these differently) — see routers/economics.py."""
    x_vars = set(json.loads(model.x_vars_json))
    economics_configured = model.conversion_rate is not None and model.avg_value is not None

    out: List[Dict[str, Any]] = []
    for channel in channels:
        config = parse_channel_config(channel)
        investment_series, misconfigured = channel_investment_series(
            channel, config, filtered_df, time_column
        )
        proxy = channel.proxy_variable
        proxy_in_current_model = bool(proxy) and proxy in x_vars
        is_modeled = proxy_in_current_model

        contribution_series: Optional[pd.Series] = None
        revenue_series: Optional[pd.Series] = None
        if is_modeled and proxy in contrib_result.per_row_contributions.columns:
            contribution_series = (
                contrib_result.per_row_contributions[proxy]
                .reindex(investment_series.index)
                .fillna(0.0)
            )
            if economics_configured:
                revenue_series = contribution_series * model.conversion_rate * model.avg_value

        out.append(
            {
                "channel": channel,
                "is_modeled": is_modeled,
                "proxy_in_current_model": proxy_in_current_model,
                "misconfigured": misconfigured,
                "investment_series": investment_series,
                "contribution_series": contribution_series,
                "revenue_series": revenue_series,
            }
        )
    return out
