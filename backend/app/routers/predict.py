import calendar
import io
import json
import uuid
from collections import defaultdict
import re
from datetime import date, timedelta
from typing import Dict

import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Body
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..auth import CurrentMembership, get_current_membership, require_write_access
from ..db import get_session
from ..models import Scenario, Model, utcnow
from ..routers.analysis import _fit_from_model, _group_maps
from ..routers.economics import _load_channels, _load_conversion_settings
from ..services.economics import parse_channel_config, resolve_channel_dollar_rate, resolve_conversion_scalars
from ..services.media_transform import apply_media_transform
from ..services.model_fit import load_transform_params
from ..tenancy import get_scoped
from ..utils.excel import excel_response
from ..schemas import (
    Adjustment,
    SimulationRequest,
    ScenarioCreate,
    ScenarioUpdate,
    ScenarioPreviewRequest,
    ScenarioAssumptionsExportRequest,
    ScenarioProjectedExportRequest,
    ScenarioOut,
    ScenarioSummary,
    ScenarioSeriesPoint,
    ScenarioTimeseriesResponse,
    ScenarioTimeseriesSlice,
    ScenarioChannelEconomics,
    ScenarioEconomics,
    ContributionSlice,
    PeriodValue,
)


router = APIRouter()


def _compute_contributions(session: Session, model_id: str, company_id: str, adjustments: dict[str, float]):
    m, ds, work, X, Xc, y, params, _ = _fit_from_model(session, model_id, company_id)
    var_map, sg_map, g_map = _group_maps(session, ds.id, company_id)
    transform_params = load_transform_params(session, m.id, company_id)

    contrib_rows = []
    group_totals: Dict[str, float] = {}
    subgroup_totals: Dict[str, float] = {}

    UNASSIGNED = "_unassigned_"

    for name in X.columns:
        coef = float(params.get(name, 0.0))
        mult = float(adjustments.get(name, 1.0))
        # Raw historical mean, not the transformed X — the frontend grid seeds its editable
        # cells from `baseline_mean` and expects/sends values in the variable's natural scale,
        # never the already-adstocked/saturated one (matches `_compute_plan`/`_scenario_matrix`
        # below, which already do this correctly).
        mean = float(pd.to_numeric(work[name], errors="coerce").fillna(0.0).mean())
        media_params = transform_params.get(name)
        if media_params is not None:
            # Adjust the RAW spend series (never the already-adstocked/saturated one), then
            # re-run the transform over the whole adjusted series before averaging —
            # matches how a flat "what if spend were X% different" reads for a media channel.
            raw_adjusted = pd.to_numeric(work[name], errors="coerce").fillna(0.0).to_numpy(dtype=float) * mult
            transformed_adjusted = apply_media_transform(
                raw_adjusted, media_params.decay, media_params.hill_k, media_params.hill_s, media_params.lag
            )
            adjusted_mean = float(np.mean(transformed_adjusted)) if transformed_adjusted.size else 0.0
        else:
            adjusted_mean = float((pd.to_numeric(X[name], errors="coerce").fillna(0.0) * mult).mean())
        contribution = coef * adjusted_mean
        mapping = var_map.get(name, {})
        sg_id = mapping.get("subgroup_id")
        gid = mapping.get("group_id")
        sg = sg_map.get(sg_id) if sg_id else None
        g = g_map.get(gid) if gid else (g_map.get(sg.group_id) if sg else None)
        contrib_rows.append({
            "name": name,
            "coef": coef,
            "baseline_mean": mean,
            "multiplier": mult,
            "adjusted_mean": adjusted_mean,
            "contribution": contribution,
            "group_id": g.id if g else None,
            "group_name": g.name if g else None,
            "subgroup_id": sg.id if sg else None,
            "subgroup_name": sg.name if sg else None,
        })
        if sg:
            subgroup_totals[sg.id] = subgroup_totals.get(sg.id, 0.0) + contribution
            grp_id = g.id if g else sg.group_id
            if grp_id:
                group_totals[grp_id] = group_totals.get(grp_id, 0.0) + contribution
            else:
                group_totals[UNASSIGNED] = group_totals.get(UNASSIGNED, 0.0) + contribution
        elif g:
            group_totals[g.id] = group_totals.get(g.id, 0.0) + contribution
        else:
            subgroup_totals[UNASSIGNED] = subgroup_totals.get(UNASSIGNED, 0.0) + contribution
            group_totals[UNASSIGNED] = group_totals.get(UNASSIGNED, 0.0) + contribution

    intercept = float(params.get('const', 0.0))
    total = float(sum(r["contribution"] for r in contrib_rows) + intercept)

    group_rows = []
    for gid, val in group_totals.items():
        if gid == UNASSIGNED:
            group_rows.append({"group_id": None, "group_name": "Unassigned", "contribution": float(val)})
        else:
            group_rows.append({
                "group_id": gid,
                "group_name": g_map[gid].name if gid in g_map else None,
                "contribution": float(val),
            })

    subgroup_rows = []
    for sid, val in subgroup_totals.items():
        if sid == UNASSIGNED:
            subgroup_rows.append({"subgroup_id": None, "subgroup_name": "Unassigned", "group_id": None, "group_name": None, "contribution": float(val)})
        else:
            subgroup_rows.append({
                "subgroup_id": sid,
                "subgroup_name": sg_map[sid].name if sid in sg_map else None,
                "group_id": sg_map[sid].group_id if sid in sg_map else None,
                "group_name": g_map.get(sg_map[sid].group_id).name if (sid in sg_map and sg_map[sid].group_id in g_map) else None,
                "contribution": float(val),
            })

    return {
        "model": {
            "id": m.id,
            "name": m.name,
            "dataset_id": m.dataset_id,
            "y_var": m.y_var,
            "x_vars": json.loads(m.x_vars_json),
        },
        "intercept": intercept,
        "total": total,
        "variables": contrib_rows,
        "groups": group_rows,
        "subgroups": subgroup_rows,
    }


OTHER_KEY = "__other__"
BASELINE_KEY = "__baseline__"


def _add_months(value: date, months: int) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _period_sequence(start_date: date, horizon: int, freq: str) -> list[date]:
    if horizon <= 0:
        return []
    periods: list[date] = []
    current = start_date
    for _ in range(horizon):
        periods.append(current)
        if freq == "day":
            current = current + timedelta(days=1)
        elif freq == "week":
            current = current + timedelta(weeks=1)
        else:
            current = _add_months(current, 1)
    return periods


def _label_for_period(period: date, freq: str) -> str:
    if freq == "day":
        return period.isoformat()
    if freq == "week":
        iso = period.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    return period.strftime("%Y-%m")


def _calendar_key(value: date, freq: str):
    """Groups a date by its position within a year, so a future period's default can be drawn
    from the same calendar position in history (e.g. "this future row is March" defaults from
    historical Marches) instead of a single flat all-time mean."""
    if freq == "day":
        return (value.month, value.day)
    if freq == "week":
        return value.isocalendar().week
    return value.month


def _calendar_bucketed_means(
    work: pd.DataFrame, hist_dates: "pd.Series | None", columns: list[str], freq: str
) -> dict[str, dict]:
    """Per-column historical mean bucketed by `_calendar_key`. Applied uniformly to every
    variable (media and control) — there's no per-variable "is this seasonal" flag today, and a
    non-seasonal variable's bucketed mean just converges close to its flat mean anyway, so this
    never makes things worse. Callers must fall back to the flat mean when a bucket is missing
    (short history, or a horizon that outruns a year of data)."""
    if hist_dates is None:
        return {}
    valid = hist_dates.notna()
    if not valid.any():
        return {}
    keys = hist_dates[valid].apply(lambda d: _calendar_key(d.date() if hasattr(d, "date") else d, freq))
    buckets: dict[str, dict] = {}
    for name in columns:
        series = pd.to_numeric(work[name], errors="coerce").fillna(0.0)
        grouped = series[valid].groupby(keys).mean()
        buckets[name] = {k: float(v) for k, v in grouped.items()}
    return buckets


def _dump_definition(horizon: int, start_date: date, freq: str, adjustments: dict[str, dict[str, PeriodValue]]) -> str:
    payload = {
        "horizon": horizon,
        "start_date": start_date.isoformat(),
        "freq": freq,
        "adjustments": {
            period: {var: (value.model_dump() if isinstance(value, PeriodValue) else value) for var, value in vars_.items()}
            for period, vars_ in adjustments.items()
        },
    }
    return json.dumps(payload)


def _load_adjustments(data: dict | None) -> dict[str, dict[str, PeriodValue]]:
    if not isinstance(data, dict):
        return {}
    output: dict[str, dict[str, PeriodValue]] = {}
    for period, mapping in data.items():
        if not isinstance(mapping, dict):
            continue
        period_map: dict[str, PeriodValue] = {}
        for var, payload in mapping.items():
            if isinstance(payload, dict):
                try:
                    period_map[var] = PeriodValue(**payload)
                    continue
                except Exception:
                    pass
            try:
                period_map[var] = PeriodValue(mode="multiplier", value=float(payload))
            except Exception:
                continue
        if period_map:
            output[period] = period_map
    return output


def _load_definition(record: Scenario) -> ScenarioCreate:
    raw = None
    if record.adjustments_json:
        try:
            raw = json.loads(record.adjustments_json)
        except json.JSONDecodeError:
            raw = None
    start_date = date.today()
    freq = "month"
    horizon = 1
    adjustments: dict[str, dict[str, PeriodValue]] = {}

    if isinstance(raw, dict) and "horizon" in raw:
        horizon = int(raw.get("horizon", 1) or 1)
        freq = raw.get("freq", "month") or "month"
        start_val = raw.get("start_date")
        if isinstance(start_val, str):
            try:
                start_date = date.fromisoformat(start_val)
            except ValueError:
                start_date = date.today()
        adjustments = _load_adjustments(raw.get("adjustments"))
    elif isinstance(raw, list):
        # legacy structure: list of {variable, multiplier}
        period_key = start_date.isoformat()
        legacy: dict[str, PeriodValue] = {}
        for entry in raw:
            variable = entry.get("variable")
            if not variable:
                continue
            try:
                mult = float(entry.get("multiplier", 1.0))
            except Exception:
                mult = 1.0
            legacy[variable] = PeriodValue(mode="multiplier", value=mult)
        if legacy:
            adjustments[period_key] = legacy

    return ScenarioCreate(
        model_id=record.model_id,
        name=record.name,
        horizon=horizon,
        start_date=start_date,
        freq=freq,
        adjustments=adjustments,
    )


def _load_summary(record: Scenario) -> ScenarioSummary | None:
    if not record.results_json:
        return None
    try:
        payload = json.loads(record.results_json)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    try:
        return ScenarioSummary(
            periods=payload.get("periods", []),
            total=float(payload.get("total", 0.0)),
            average_per_period=float(payload.get("average_per_period", 0.0)),
            groups=[ContributionSlice(**row) for row in payload.get("groups", [])],
            subgroups=[ContributionSlice(**row) for row in payload.get("subgroups", [])],
            series=[ScenarioSeriesPoint(**row) for row in payload.get("series", [])],
        )
    except Exception:
        return None


def _serialize_group_totals(raw: defaultdict[str, float], g_map: dict) -> list[ContributionSlice]:
    slices: list[ContributionSlice] = []
    for key, val in raw.items():
        if abs(val) < 1e-9:
            continue
        if key == BASELINE_KEY:
            slices.append(ContributionSlice(id="baseline", name="Baseline", value=float(val)))
        elif key == OTHER_KEY or key is None:
            slices.append(ContributionSlice(id=None, name="Other", value=float(val)))
        else:
            g = g_map.get(key)
            name = g.name if g else "Other"
            slices.append(ContributionSlice(id=key, name=name, value=float(val)))
    slices.sort(key=lambda item: item.value, reverse=True)
    return slices


def _serialize_subgroup_totals(raw: defaultdict[str, float], sg_map: dict, g_map: dict) -> list[ContributionSlice]:
    slices: list[ContributionSlice] = []
    for key, val in raw.items():
        if abs(val) < 1e-9:
            continue
        if key == BASELINE_KEY:
            slices.append(ContributionSlice(id="baseline", name="Baseline", value=float(val)))
        elif key == OTHER_KEY or key is None:
            slices.append(ContributionSlice(id=None, name="Other", value=float(val)))
        else:
            sg = sg_map.get(key)
            name = sg.name if sg else "Other"
            slices.append(ContributionSlice(id=key, name=name, value=float(val)))
    slices.sort(key=lambda item: item.value, reverse=True)
    return slices


def _accumulate_contribution(
    group_totals: defaultdict[str, float],
    subgroup_totals: defaultdict[str, float],
    var_name: str,
    contribution: float,
    var_map: dict,
    sg_map: dict,
    g_map: dict,
):
    mapping = var_map.get(var_name, {})
    sg_id = mapping.get("subgroup_id")
    gid = mapping.get("group_id")
    if sg_id and sg_id in sg_map:
        subgroup_totals[sg_id] += contribution
        gid = gid or sg_map[sg_id].group_id
        if gid:
            group_totals[gid] += contribution
        else:
            group_totals[OTHER_KEY] += contribution
    elif gid and gid in g_map:
        group_totals[gid] += contribution
    else:
        subgroup_totals[OTHER_KEY] += contribution
        group_totals[OTHER_KEY] += contribution


def _compute_plan(
    session: Session,
    model_id: str,
    company_id: str,
    *,
    horizon: int,
    start_date: date,
    freq: str,
    adjustments: dict[str, dict[str, PeriodValue]],
):
    m, ds, work, X, Xc, y, params, raw_df = _fit_from_model(session, model_id, company_id)
    var_map, sg_map, g_map = _group_maps(session, ds.id, company_id)
    transform_params = load_transform_params(session, m.id, company_id)

    baseline_means: dict[str, float] = {}
    coef_map: dict[str, float] = {}
    for name in X.columns:
        series = pd.to_numeric(X[name], errors="coerce").fillna(0.0)
        baseline_means[name] = float(series.mean())
        coef_map[name] = float(params.get(name, 0.0))

    time_field = getattr(ds, "time_variable", None)
    hist_dates = (
        pd.to_datetime(raw_df.loc[work.index, time_field], errors="coerce")
        if time_field and time_field in raw_df.columns
        else None
    )
    calendar_buckets = _calendar_bucketed_means(work, hist_dates, list(X.columns), freq)

    intercept = float(params.get("const", 0.0))
    period_dates = _period_sequence(start_date, horizon, freq)
    labels = [_label_for_period(p, freq) for p in period_dates]
    period_calendar_keys = [_calendar_key(p, freq) for p in period_dates]

    # Media variables: build the projected RAW spend series per period, then run the
    # adstock+Hill transform ONCE over history+future concatenated — this is what makes
    # carryover across the history/future boundary correct, instead of re-deriving each
    # period's decay state from scratch. Control variables keep the existing
    # mean*multiplier-or-absolute-value math untouched.
    media_future_transformed: dict[str, np.ndarray] = {}
    media_future_raw: dict[str, np.ndarray] = {}
    for name in X.columns:
        tparams = transform_params.get(name)
        if tparams is None:
            continue
        raw_history = pd.to_numeric(work[name], errors="coerce").fillna(0.0).to_numpy(dtype=float)
        raw_mean = float(raw_history.mean()) if raw_history.size else 0.0
        bucketed = calendar_buckets.get(name, {})
        future_raw = []
        for period_index, label in enumerate(labels):
            seasonal_mean = bucketed.get(period_calendar_keys[period_index], raw_mean)
            adj = adjustments.get(label, {}).get(name)
            if isinstance(adj, PeriodValue):
                value = seasonal_mean * adj.value if adj.mode == "multiplier" else adj.value
            else:
                value = seasonal_mean
            future_raw.append(value)
        combined = np.concatenate([raw_history, np.asarray(future_raw, dtype=float)])
        transformed = apply_media_transform(combined, tparams.decay, tparams.hill_k, tparams.hill_s, tparams.lag)
        media_future_transformed[name] = transformed[-len(future_raw):] if future_raw else np.array([])
        media_future_raw[name] = np.asarray(future_raw, dtype=float)

    aggregate_groups: defaultdict[str, float] = defaultdict(float)
    aggregate_subgroups: defaultdict[str, float] = defaultdict(float)
    series_points: list[ScenarioTimeseriesSlice] = []
    # Per-variable raw (model-units) and contribution series across the horizon, captured
    # alongside the group/subgroup aggregation below (which discards this detail) — needed to
    # derive per-channel ROI/ROAS for the scenario without recomputing the projection.
    variable_raw_series: defaultdict[str, list[float]] = defaultdict(list)
    variable_contribution_series: defaultdict[str, list[float]] = defaultdict(list)

    for period_index, label in enumerate(labels):
        group_totals: defaultdict[str, float] = defaultdict(float)
        subgroup_totals: defaultdict[str, float] = defaultdict(float)
        total = 0.0
        period_adjustments = adjustments.get(label, {})
        for name in X.columns:
            if name in media_future_transformed:
                value = float(media_future_transformed[name][period_index])
                raw_value = float(media_future_raw[name][period_index])
            else:
                bucketed = calendar_buckets.get(name, {})
                baseline_val = bucketed.get(period_calendar_keys[period_index], baseline_means[name])
                adj = period_adjustments.get(name)
                if isinstance(adj, PeriodValue):
                    value = baseline_val * adj.value if adj.mode == "multiplier" else adj.value
                else:
                    value = baseline_val
                raw_value = value
            contribution = coef_map[name] * value
            total += contribution
            variable_raw_series[name].append(raw_value)
            variable_contribution_series[name].append(contribution)
            _accumulate_contribution(group_totals, subgroup_totals, name, contribution, var_map, sg_map, g_map)

        total += intercept
        group_totals[BASELINE_KEY] += intercept
        subgroup_totals[BASELINE_KEY] += intercept
        for key, val in group_totals.items():
            aggregate_groups[key] += val
        for key, val in subgroup_totals.items():
            aggregate_subgroups[key] += val

        series_points.append(
            ScenarioTimeseriesSlice(
                period=label,
                y_pred=float(total),
                by_group=_serialize_group_totals(group_totals, g_map),
                by_subgroup=_serialize_subgroup_totals(subgroup_totals, sg_map, g_map),
            )
        )

    total_value = sum(point.y_pred for point in series_points)
    economics = _compute_scenario_economics(
        session, ds.id, company_id, work, X.columns, variable_raw_series, variable_contribution_series
    )
    summary = ScenarioSummary(
        periods=labels,
        total=total_value,
        average_per_period=total_value / horizon if horizon else 0.0,
        groups=_serialize_group_totals(aggregate_groups, g_map),
        subgroups=_serialize_subgroup_totals(aggregate_subgroups, sg_map, g_map),
        series=[ScenarioSeriesPoint(period=point.period, y_pred=point.y_pred) for point in series_points],
        economics=economics,
    )
    return summary, series_points


def _compute_scenario_economics(
    session: Session,
    dataset_id: str,
    company_id: str,
    filtered_df: pd.DataFrame,
    x_vars,
    variable_raw_series: dict[str, list[float]],
    variable_contribution_series: dict[str, list[float]],
) -> ScenarioEconomics | None:
    """Per-channel ROI/ROAS for the projected scenario, reusing the same InvestmentChannel/
    ConversionSettings catalog as Analysis/Economics — see services/economics.py. Channels
    whose cost can't be tied to their proxy_variable in dollars (resolve_channel_dollar_rate
    returns None) are silently omitted here rather than shown with a misleading number; this is
    a lighter-weight KPI breakdown than the full Economics module, not a replacement for it."""
    channels = _load_channels(session, company_id, dataset_id)
    if not channels:
        return None
    conversion_settings = _load_conversion_settings(session, company_id, dataset_id)
    conversion_rate, avg_value, configured = resolve_conversion_scalars(conversion_settings, filtered_df)

    rows: list[ScenarioChannelEconomics] = []
    total_investment = 0.0
    total_revenue: float | None = 0.0 if configured else None
    x_var_set = set(x_vars)
    for channel in channels:
        proxy = channel.proxy_variable
        if not proxy or proxy not in x_var_set or proxy not in variable_raw_series:
            continue
        dollar_rate = resolve_channel_dollar_rate(channel, parse_channel_config(channel))
        if dollar_rate is None:
            continue
        investment = sum(variable_raw_series[proxy]) * dollar_rate
        contribution = sum(variable_contribution_series[proxy])
        revenue = contribution * conversion_rate * avg_value if configured else None
        roi = (revenue - investment) / investment if (revenue is not None and investment) else None
        roas = (revenue / investment) if (revenue is not None and investment) else None
        total_investment += investment
        if configured:
            total_revenue = (total_revenue or 0.0) + revenue
        rows.append(
            ScenarioChannelEconomics(
                channel_id=channel.id,
                name=channel.name,
                proxy_variable=proxy,
                investment=investment,
                contribution=contribution,
                revenue=revenue,
                roi=roi,
                roas=roas,
            )
        )

    if not rows:
        return None
    roi_total = (total_revenue - total_investment) / total_investment if (total_revenue is not None and total_investment) else None
    roas_total = (total_revenue / total_investment) if (total_revenue is not None and total_investment) else None
    return ScenarioEconomics(
        channels=rows,
        total_investment=total_investment,
        total_revenue=total_revenue,
        roi_total=roi_total,
        roas_total=roas_total,
        economics_configured=configured,
    )


def _scenario_matrix(
    session: Session,
    model_id: str,
    company_id: str,
    *,
    horizon: int,
    start_date: date,
    freq: str,
    adjustments: dict[str, dict[str, PeriodValue]],
):
    _, ds, work, X, _, _, _, raw_df = _fit_from_model(session, model_id, company_id)
    baseline_means: dict[str, float] = {}
    for name in X.columns:
        # Raw historical mean, not the transformed X — assumptions/multipliers are defined
        # against raw spend, never against the already-adstocked/saturated value.
        baseline_means[name] = float(pd.to_numeric(work[name], errors="coerce").fillna(0.0).mean())

    time_field = getattr(ds, "time_variable", None)
    hist_dates = (
        pd.to_datetime(raw_df.loc[work.index, time_field], errors="coerce")
        if time_field and time_field in raw_df.columns
        else None
    )
    calendar_buckets = _calendar_bucketed_means(work, hist_dates, list(X.columns), freq)

    period_dates = _period_sequence(start_date, horizon, freq)
    labels = [_label_for_period(period, freq) for period in period_dates]
    period_calendar_keys = [_calendar_key(p, freq) for p in period_dates]
    rows: list[dict] = []
    for name in X.columns:
        mean = baseline_means[name]
        bucketed = calendar_buckets.get(name, {})
        values: dict[str, float] = {}
        multipliers: dict[str, float] = {}
        for period_index, label in enumerate(labels):
            seasonal_mean = bucketed.get(period_calendar_keys[period_index], mean)
            adj = adjustments.get(label, {}).get(name)
            if isinstance(adj, PeriodValue):
                if adj.mode == "multiplier":
                    multiplier = float(adj.value)
                    value = seasonal_mean * multiplier
                else:
                    value = float(adj.value)
                    multiplier = (value / seasonal_mean) if seasonal_mean else 0.0
            else:
                multiplier = 1.0
                value = seasonal_mean
            values[label] = float(value)
            multipliers[label] = float(multiplier)
        rows.append({"variable": name, "mean": float(mean), "values": values, "multipliers": multipliers})
    return labels, rows


def _safe_filename_part(value: str | None, fallback: str = "scenario") -> str:
    if not value:
        slug = fallback
    else:
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
        slug = slug.strip("-_") or fallback
    return slug.lower()


def _dataframe_response(df: pd.DataFrame, sheet_name: str, filename: str) -> StreamingResponse:
    return excel_response({sheet_name: df}, filename)


def _scenario_out_from_record(record: Scenario, session: Session, company_id: str, summary: ScenarioSummary | None = None) -> ScenarioOut:
    definition = _load_definition(record)
    summary_data = summary or _load_summary(record)
    if summary_data is None:
        summary_data, _ = _compute_plan(
            session,
            record.model_id,
            company_id,
            horizon=definition.horizon,
            start_date=definition.start_date,
            freq=definition.freq,
            adjustments=definition.adjustments,
        )
        record.results_json = json.dumps(summary_data.model_dump())
        session.add(record)
        session.commit()
    dataset_id = record.dataset_id
    base_total = None
    delta_pct = None
    try:
        base_summary, _ = _compute_plan(
            session,
            record.model_id,
            company_id,
            horizon=definition.horizon,
            start_date=definition.start_date,
            freq=definition.freq,
            adjustments={},
        )
        base_total = float(base_summary.total)
        if base_total > 0:
            delta_pct = ((summary_data.total - base_total) / base_total) * 100
        elif base_total == 0:
            delta_pct = 0.0 if summary_data.total == 0 else None
    except Exception:
        base_total = None
        delta_pct = None
    return ScenarioOut(
        id=record.id,
        model_id=record.model_id,
        dataset_id=dataset_id,
        name=record.name,
        horizon=definition.horizon,
        start_date=definition.start_date,
        freq=definition.freq,
        adjustments=definition.adjustments,
        summary=summary_data,
        last_edited_at=record.last_edited_at or record.created_at,
        base_total=base_total,
        delta_pct_vs_base=delta_pct,
    )


def _require_model(session: Session, model_id: str, company_id: str) -> Model:
    return get_scoped(session, Model, model_id, company_id)


def _ensure_scenario_capacity(session: Session, model_id: str, company_id: str, limit: int = 5):
    existing = session.exec(
        select(Scenario.id).where(Scenario.model_id == model_id, Scenario.company_id == company_id)
    ).all()
    if len(existing) >= limit:
        raise HTTPException(status_code=400, detail=f"Maximum {limit} scenarios per model")


@router.post("/{model_id}/simulate")
def simulate(
    model_id: str,
    body: SimulationRequest,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    adjustments = {adj.variable: adj.multiplier for adj in body.adjustments}
    result = _compute_contributions(session, model_id, membership.company_id, adjustments)
    return result


@router.post("/scenarios/preview", response_model=ScenarioSummary)
def preview_scenario(
    body: ScenarioPreviewRequest,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    _require_model(session, body.model_id, membership.company_id)
    summary, _ = _compute_plan(
        session,
        body.model_id,
        membership.company_id,
        horizon=body.horizon,
        start_date=body.start_date,
        freq=body.freq,
        adjustments=body.adjustments,
    )
    return summary


@router.post("/scenarios/assumptions/export")
def export_scenario_assumptions(
    body: ScenarioAssumptionsExportRequest = Body(...),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    _require_model(session, body.model_id, membership.company_id)
    labels, rows = _scenario_matrix(
        session,
        body.model_id,
        membership.company_id,
        horizon=body.horizon,
        start_date=body.start_date,
        freq=body.freq,
        adjustments=body.adjustments,
    )
    export_rows: list[dict[str, float | str]] = []
    mode_key = "multipliers" if body.mode == "multipliers" else "values"
    for row in rows:
        record: dict[str, float | str] = {
            "Variable": row["variable"],
            "Mean": row["mean"],
        }
        source = row[mode_key]
        for label in labels:
            record[label] = source.get(label, 0.0)
        export_rows.append(record)

    columns = ["Variable", "Mean", *labels]
    df = pd.DataFrame(export_rows, columns=columns)
    filename = f"{_safe_filename_part(body.scenario_name)}-assumptions-{utcnow().strftime('%Y%m%d-%H%M%S')}.xlsx"
    return _dataframe_response(df, "Assumptions", filename)


@router.post("/scenarios/projected/export")
def export_projected_totals(
    body: ScenarioProjectedExportRequest = Body(...),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    _require_model(session, body.model_id, membership.company_id)
    summary, _ = _compute_plan(
        session,
        body.model_id,
        membership.company_id,
        horizon=body.horizon,
        start_date=body.start_date,
        freq=body.freq,
        adjustments=body.adjustments,
    )
    hero_map: dict[str, float] = {}
    if body.include_hero:
        hero_summary, _ = _compute_plan(
            session,
            body.model_id,
            membership.company_id,
            horizon=body.horizon,
            start_date=body.start_date,
            freq=body.freq,
            adjustments={},
        )
        hero_map = {point.period: point.y_pred for point in hero_summary.series}
    scenario_map = {point.period: point.y_pred for point in summary.series}
    rows: list[dict[str, float | str | None]] = []
    for label in summary.periods:
        hero_value = hero_map.get(label)
        scenario_value = scenario_map.get(label)
        delta = scenario_value - hero_value if (hero_value is not None and scenario_value is not None) else None
        pct = (delta / hero_value * 100) if (hero_value not in (None, 0) and delta is not None) else None
        rows.append(
            {
                "Period": label,
                "Base Scenario": hero_value,
                "Scenario": scenario_value,
                "Delta": delta,
                "% Delta": pct,
            }
        )
    df = pd.DataFrame(rows, columns=["Period", "Base Scenario", "Scenario", "Delta", "% Delta"])
    filename = f"{_safe_filename_part(body.scenario_name)}-projected-{utcnow().strftime('%Y%m%d-%H%M%S')}.xlsx"
    return _dataframe_response(df, "Projected totals", filename)


@router.post("/scenarios", response_model=ScenarioOut)
def create_scenario(
    body: ScenarioCreate,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    model = _require_model(session, body.model_id, membership.company_id)
    _ensure_scenario_capacity(session, body.model_id, membership.company_id)
    summary, _ = _compute_plan(
        session,
        body.model_id,
        membership.company_id,
        horizon=body.horizon,
        start_date=body.start_date,
        freq=body.freq,
        adjustments=body.adjustments,
    )
    record = Scenario(
        id=str(uuid.uuid4()),
        company_id=membership.company_id,
        model_id=body.model_id,
        dataset_id=model.dataset_id,
        name=body.name,
        adjustments_json=_dump_definition(body.horizon, body.start_date, body.freq, body.adjustments),
        results_json=json.dumps(summary.model_dump()),
        last_edited_at=utcnow(),
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return _scenario_out_from_record(record, session, membership.company_id, summary)


@router.get("/scenarios", response_model=list[ScenarioOut])
def list_scenarios(
    model_id: str = Query(...),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    _require_model(session, model_id, membership.company_id)
    records = session.exec(
        select(Scenario)
        .where(Scenario.model_id == model_id, Scenario.company_id == membership.company_id)
        .order_by(Scenario.last_edited_at.desc())
    ).all()
    return [_scenario_out_from_record(record, session, membership.company_id) for record in records]


@router.get("/scenarios/{scenario_id}", response_model=ScenarioOut)
def get_scenario(
    scenario_id: str,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    record = get_scoped(session, Scenario, scenario_id, membership.company_id)
    return _scenario_out_from_record(record, session, membership.company_id)


@router.patch("/scenarios/{scenario_id}", response_model=ScenarioOut)
def update_scenario(
    scenario_id: str,
    body: ScenarioUpdate,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    record = get_scoped(session, Scenario, scenario_id, membership.company_id)
    definition = _load_definition(record)
    name = body.name or record.name
    horizon = body.horizon or definition.horizon
    start_date = body.start_date or definition.start_date
    freq = body.freq or definition.freq
    adjustments = body.adjustments or definition.adjustments

    summary, _ = _compute_plan(
        session,
        record.model_id,
        membership.company_id,
        horizon=horizon,
        start_date=start_date,
        freq=freq,
        adjustments=adjustments,
    )
    record.name = name
    record.adjustments_json = _dump_definition(horizon, start_date, freq, adjustments)
    record.results_json = json.dumps(summary.model_dump())
    record.last_edited_at = utcnow()
    session.add(record)
    session.commit()
    session.refresh(record)
    return _scenario_out_from_record(record, session, membership.company_id, summary)


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(
    scenario_id: str,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    record = get_scoped(session, Scenario, scenario_id, membership.company_id)
    session.delete(record)
    session.commit()
    return {"status": "ok"}


@router.get("/scenarios/{scenario_id}/timeseries", response_model=ScenarioTimeseriesResponse)
def scenario_timeseries(
    scenario_id: str,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    record = get_scoped(session, Scenario, scenario_id, membership.company_id)
    definition = _load_definition(record)
    summary, series = _compute_plan(
        session,
        record.model_id,
        membership.company_id,
        horizon=definition.horizon,
        start_date=definition.start_date,
        freq=definition.freq,
        adjustments=definition.adjustments,
    )
    record.results_json = json.dumps(summary.model_dump())
    session.add(record)
    session.commit()
    return ScenarioTimeseriesResponse(
        scenario_id=scenario_id,
        model_id=record.model_id,
        periods=summary.periods,
        series=series,
    )


@router.post("/scenarios/{scenario_id}/import", response_model=ScenarioOut)
async def import_scenario_plan(
    scenario_id: str,
    file: UploadFile = File(...),
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    record = get_scoped(session, Scenario, scenario_id, membership.company_id)
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse CSV: {exc}") from exc
    df.columns = [str(col).strip().lower() for col in df.columns]
    required_cols = {"period", "variable", "mode", "value"}
    missing = required_cols - set(df.columns)
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")

    definition = _load_definition(record)
    adjustments = {period: dict(vars_) for period, vars_ in definition.adjustments.items()}
    for _, row in df.iterrows():
        period = str(row.get("period") or "").strip()
        variable = str(row.get("variable") or "").strip()
        if not period or not variable:
            continue
        mode = str(row.get("mode") or "multiplier").strip().lower()
        if mode not in {"multiplier", "value"}:
            mode = "multiplier"
        try:
            value = float(row.get("value"))
        except (TypeError, ValueError):
            continue
        adjustments.setdefault(period, {})[variable] = PeriodValue(mode=mode, value=value)

    summary, _ = _compute_plan(
        session,
        record.model_id,
        membership.company_id,
        horizon=definition.horizon,
        start_date=definition.start_date,
        freq=definition.freq,
        adjustments=adjustments,
    )
    record.adjustments_json = _dump_definition(definition.horizon, definition.start_date, definition.freq, adjustments)
    record.results_json = json.dumps(summary.model_dump())
    session.add(record)
    session.commit()
    session.refresh(record)
    return _scenario_out_from_record(record, session, membership.company_id, summary)


@router.get("/scenarios/{scenario_id}/export")
def export_scenario_plan(
    scenario_id: str,
    format: str = Query("csv", regex="^(csv|xlsx)$"),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    record = get_scoped(session, Scenario, scenario_id, membership.company_id)
    definition = _load_definition(record)
    rows: list[dict] = []
    for period, mapping in definition.adjustments.items():
        for variable, value in mapping.items():
            rows.append(
                {
                    "period": period,
                    "variable": variable,
                    "mode": value.mode if isinstance(value, PeriodValue) else "multiplier",
                    "value": value.value if isinstance(value, PeriodValue) else float(value),
                }
            )
    if not rows:
        rows.append({"period": definition.start_date.isoformat(), "variable": "", "mode": "multiplier", "value": 1.0})
    df = pd.DataFrame(rows)

    filename = f"scenario-{scenario_id}.{format}"
    if format == "xlsx":
        return excel_response({"Scenario": df}, filename)

    csv_buffer = io.StringIO()
    df.to_csv(csv_buffer, index=False)
    csv_buffer.seek(0)
    return StreamingResponse(
        io.BytesIO(csv_buffer.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
