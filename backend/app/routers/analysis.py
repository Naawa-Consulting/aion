from __future__ import annotations

import json
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..auth import CurrentMembership, get_current_membership
from ..db import get_session
from ..errors import api_error
from ..models import Dataset, InvestmentChannel, Model, ModelMetrics, Variable, Subgroup, Group, utcnow
from ..schemas import SummaryTableExportRequest
from ..services.analysis import (
    AnalysisCacheKey,
    compute_contributions,
    get_cached_view,
    set_cached_view,
)
from ..services.model_fit import build_design_matrix, load_transform_params, resolve_media_flags
from ..tenancy import get_scoped
from ..utils.excel import excel_response
from ..utils.datasets import load_dataset_frame


router = APIRouter()


def _parse_date(value: Optional[str]) -> Optional[pd.Timestamp]:
    if not value:
        return None
    ts = pd.to_datetime(value, errors="coerce")
    if pd.isna(ts):
        raise api_error(400, "INVALID_DATE", f"Invalid date: {value}")
    return ts


def _ts_key(ts: Optional[pd.Timestamp]) -> str:
    return ts.isoformat() if ts is not None else ""


def _apply_date_filter(
    df: pd.DataFrame,
    time_column: Optional[str],
    start: Optional[pd.Timestamp],
    end: Optional[pd.Timestamp],
) -> pd.DataFrame:
    if not time_column or (start is None and end is None):
        return df
    if time_column not in df.columns:
        return df
    ts = pd.to_datetime(df[time_column], errors="coerce")
    if ts.isna().all():
        return df
    mask = ts.notna()
    if start is not None:
        mask &= ts >= start
    if end is not None:
        mask &= ts <= end
    return df.loc[mask]


def _fit_from_model(
    session: Session,
    model_id: str,
    company_id: str,
    time_column: Optional[str] = None,
    start: Optional[pd.Timestamp] = None,
    end: Optional[pd.Timestamp] = None,
):
    """Builds the design matrix over the FULL historical series first (so media variables'
    adstock carryover is correct), then — only if a date range was requested — slices the
    already-transformed matrix down to that window for the OLS refit. Filtering the raw
    series before transforming would truncate history and break adstock carryover at the
    window boundary, so date filtering must always happen after the transform, never before."""
    m = get_scoped(session, Model, model_id, company_id)
    ds = get_scoped(session, Dataset, m.dataset_id, company_id)
    try:
        full_df = load_dataset_frame(ds)
    except ValueError as exc:
        raise api_error(400, "DATASET_LOAD_ERROR", str(exc))
    time_field = time_column or getattr(ds, "time_variable", None)
    x_vars = json.loads(m.x_vars_json)
    cols = [m.y_var] + x_vars

    media_flags = (
        resolve_media_flags(session, ds.id, company_id, x_vars) if m.apply_media_transforms else {x: False for x in x_vars}
    )
    transform_params = load_transform_params(session, m.id, company_id)
    try:
        full_work, full_X, _ = build_design_matrix(
            full_df, m.y_var, x_vars, media_flags, transform_params=transform_params
        )
    except ValueError as exc:
        raise api_error(400, "MODEL_BUILD_ERROR", str(exc))

    if time_field and (start is not None or end is not None) and time_field in full_df.columns:
        ts = pd.to_datetime(full_df.loc[full_work.index, time_field], errors="coerce")
        mask = ts.notna()
        if start is not None:
            mask &= ts >= start
        if end is not None:
            mask &= ts <= end
        work = full_work.loc[mask]
        X = full_X.loc[mask]
    else:
        work = full_work
        X = full_X

    if work.shape[0] < len(cols) + 1:
        raise api_error(400, "INSUFFICIENT_ROWS", "Insufficient rows after cleaning for analysis")
    y = work[m.y_var].to_numpy()
    Xc = sm.add_constant(X, has_constant="add")
    res = sm.OLS(y, Xc).fit()
    params = res.params  # pandas Series with const and x_vars
    df_out = _apply_date_filter(full_df, time_field, start, end) if (start is not None or end is not None) else full_df
    return m, ds, work, X, Xc, y, params, df_out


def _group_maps(session: Session, dataset_id: str, company_id: str):
    vars_ = session.exec(
        select(Variable).where(Variable.dataset_id == dataset_id, Variable.company_id == company_id)
    ).all()
    sg_ids = {v.subgroup_id for v in vars_ if v.subgroup_id}
    sgs = (
        session.exec(
            select(Subgroup).where(Subgroup.id.in_(list(sg_ids)), Subgroup.company_id == company_id)
        ).all()
        if sg_ids
        else []
    )
    g_ids = {sg.group_id for sg in sgs}
    g_ids.update({v.group_id for v in vars_ if v.group_id})
    gs = (
        session.exec(
            select(Group).where(Group.id.in_(list(g_ids)), Group.company_id == company_id)
        ).all()
        if g_ids
        else []
    )
    sg_map = {sg.id: sg for sg in sgs}
    g_map = {g.id: g for g in gs}
    var_map = {
        v.name: {"group_id": v.group_id, "subgroup_id": v.subgroup_id} for v in vars_
    }
    return var_map, sg_map, g_map


def _channel_label_map(session: Session, dataset_id: str, company_id: str) -> dict[str, str]:
    """Maps a raw Variable.name to the business-friendly name of the InvestmentChannel it's
    the proxy for, so query screens can show "Facebook Ads" instead of
    "dig_ctv_branding_impresiones". Variables with no associated channel are absent from the
    map — callers should fall back to the raw name."""
    channels = session.exec(
        select(InvestmentChannel).where(
            InvestmentChannel.dataset_id == dataset_id,
            InvestmentChannel.company_id == company_id,
            InvestmentChannel.proxy_variable.is_not(None),
        )
    ).all()
    return {c.proxy_variable: c.name for c in channels}


def _baseline_predictor_names(var_map: dict, g_map: dict, sg_map: dict) -> set[str]:
    """Variable names whose Group (directly, or via Subgroup) is flagged Group.is_baseline —
    their contribution gets folded into the intercept instead of reported as its own line."""
    names: set[str] = set()
    for name, mapping in var_map.items():
        gid = mapping.get("group_id")
        group = g_map.get(gid) if gid else None
        if group is None:
            sid = mapping.get("subgroup_id")
            sg = sg_map.get(sid) if sid else None
            if sg:
                group = g_map.get(sg.group_id)
        if group is not None and group.is_baseline:
            names.add(name)
    return names


@router.get("/{model_id}/summary")
def summary(
    model_id: str,
    include_intercept: bool = Query(True),
    as_percent: bool = Query(False),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    start_ts = _parse_date(start_date)
    end_ts = _parse_date(end_date)
    filtered_df: pd.DataFrame | None = None
    try:
        m, ds, work, X, Xc, y, params, filtered_df = _fit_from_model(
            session, model_id, membership.company_id, None, start_ts, end_ts
        )
    except HTTPException as exc:
        is_insufficient_rows = isinstance(exc.detail, dict) and exc.detail.get("code") == "INSUFFICIENT_ROWS"
        if not is_insufficient_rows or (start_ts is None and end_ts is None):
            raise
        m, ds, work, X, Xc, y, params, full_df = _fit_from_model(session, model_id, membership.company_id)
        filtered_df = _apply_date_filter(
            full_df.copy(), getattr(ds, "time_variable", None), start_ts, end_ts
        )
        if filtered_df.empty:
            raise api_error(400, "NO_ROWS_IN_RANGE", "No rows available for the selected date range")
    if filtered_df is None:
        filtered_df = work

    start_key = _ts_key(start_ts)
    end_key = _ts_key(end_ts)
    summary_cache_key = AnalysisCacheKey(
        dataset_id=ds.id,
        model_id=m.id,
        start=start_key,
        end=end_key,
        view="summary",
        extra=(include_intercept, as_percent),
    )
    cached_summary = get_cached_view(summary_cache_key)
    if cached_summary is not None:
        return cached_summary

    var_map, sg_map, g_map = _group_maps(session, ds.id, membership.company_id)
    baseline_predictors = _baseline_predictor_names(var_map, g_map, sg_map)
    channel_label_map = _channel_label_map(session, ds.id, membership.company_id)

    time_field = getattr(ds, "time_variable", None)
    contrib_result = compute_contributions(
        dataset_id=ds.id,
        model_id=m.id,
        df=filtered_df,
        design_frame=X,
        time_column=time_field,
        start=start_ts,
        end=end_ts,
        params=params,
        predictors=list(X.columns),
        baseline_predictors=baseline_predictors,
    )

    other_label = "Other"
    other_group_key = "__other__"
    other_sub_key = "__other_sub__"

    rows = []
    group_totals: Dict[str, float] = {}
    subgroup_totals: Dict[str, float] = {}
    per_var_totals = contrib_result.per_variable_totals
    total_variables = float(sum(per_var_totals.values()))
    intercept = contrib_result.baseline_contribution if include_intercept else 0.0
    total_contribution = float(total_variables + intercept)

    def percent(value: float) -> float:
        return float((value / total_contribution) * 100) if total_contribution else 0.0

    source_df = contrib_result.frame

    for name in X.columns:
        if name not in per_var_totals:
            continue
        coef = float(params.get(name, 0.0))
        series = pd.to_numeric(source_df[name], errors="coerce").fillna(0.0)
        contrib = float(per_var_totals.get(name, 0.0))
        mapping = var_map.get(name, {})
        sg_id = mapping.get("subgroup_id")
        gid = mapping.get("group_id")
        sg = sg_map.get(sg_id) if sg_id else None
        g = g_map.get(gid) if gid else (g_map.get(sg.group_id) if sg else None)

        if sg:
            subgroup_id = sg.id
            subgroup_name = sg.name
        else:
            subgroup_id = other_sub_key
            subgroup_name = other_label

        if g:
            group_id = g.id
            group_name = g.name
        elif sg and sg.group_id and sg.group_id in g_map:
            parent_group = g_map[sg.group_id]
            group_id = parent_group.id
            group_name = parent_group.name
        else:
            group_id = other_group_key
            group_name = other_label

        rows.append(
            {
                "name": name,
                "display_name": channel_label_map.get(name, name),
                "coef": coef,
                "mean": float(series.mean()) if len(series) else 0.0,
                "contribution": contrib,
                "subgroup_id": subgroup_id,
                "subgroup_name": subgroup_name,
                "group_id": group_id,
                "group_name": group_name,
            }
        )

        subgroup_totals[subgroup_id] = subgroup_totals.get(subgroup_id, 0.0) + contrib
        group_totals[group_id] = group_totals.get(group_id, 0.0) + contrib

    baseline_entry = None
    if include_intercept:
        baseline_entry = {
            "name": "baseline",
            "coef": contrib_result.intercept_value,
            "mean": float(len(source_df)),
            "contribution": intercept,
            "percent": percent(intercept),
            "group_id": "baseline",
            "group_name": "Baseline",
            "subgroup_id": "baseline",
            "subgroup_name": "Baseline",
        }
        rows.append(baseline_entry)
        group_totals["baseline"] = group_totals.get("baseline", 0.0) + intercept
        subgroup_totals["baseline"] = subgroup_totals.get("baseline", 0.0) + intercept

    # Order variables by absolute contribution so the most impactful appear first.
    if rows:
        if baseline_entry:
            non_baseline = [row for row in rows if row is not baseline_entry]
            non_baseline.sort(key=lambda row: abs(row["contribution"]), reverse=True)
            rows = non_baseline + [baseline_entry]
        else:
            rows.sort(key=lambda row: abs(row["contribution"]), reverse=True)

    for row in rows:
        row["value"] = float(row["contribution"])
        row["percent"] = percent(row["contribution"])

    group_rows = [
        {
            "group_id": gid,
            "group_name": (
                g_map[gid].name
                if gid in g_map
                else (
                    "Baseline"
                    if gid == "baseline"
                    else (other_label if gid == other_group_key else None)
                )
            ),
            "contribution": float(val),
            "percent": percent(val),
        }
        for gid, val in group_totals.items()
    ]

    non_baseline_groups = [row for row in group_rows if row["group_id"] != "baseline"]
    baseline_groups = [row for row in group_rows if row["group_id"] == "baseline"]
    non_baseline_groups.sort(key=lambda row: abs(row["contribution"]), reverse=True)
    group_rows = non_baseline_groups + baseline_groups

    subgroup_rows = [
        {
            "subgroup_id": sid,
            "subgroup_name": (
                sg_map[sid].name
                if sid in sg_map
                else (
                    "Baseline"
                    if sid == "baseline"
                    else (other_label if sid == other_sub_key else None)
                )
            ),
            "group_id": (
                sg_map[sid].group_id
                if sid in sg_map
                else (
                    "baseline"
                    if sid == "baseline"
                    else (other_group_key if sid == other_sub_key else None)
                )
            ),
            "group_name": (
                g_map.get(sg_map[sid].group_id).name
                if (sid in sg_map and sg_map[sid].group_id in g_map)
                else (
                    "Baseline"
                    if sid == "baseline"
                    else (other_label if sid == other_sub_key else None)
                )
            ),
            "contribution": float(val),
            "percent": percent(val),
        }
        for sid, val in subgroup_totals.items()
    ]

    non_baseline_subgroups = [
        row for row in subgroup_rows if row["subgroup_id"] != "baseline"
    ]
    baseline_subgroups = [
        row for row in subgroup_rows if row["subgroup_id"] == "baseline"
    ]
    non_baseline_subgroups.sort(key=lambda row: abs(row["contribution"]), reverse=True)
    subgroup_rows = non_baseline_subgroups + baseline_subgroups

    response = {
        "model": {
            "id": m.id,
            "name": m.name,
            "dataset_id": m.dataset_id,
            "y_var": m.y_var,
            "x_vars": json.loads(m.x_vars_json),
        },
        "include_intercept": include_intercept,
        "intercept": intercept,
        "total_contribution": total_contribution,
        "as_percent": as_percent,
        "variables": rows,
        "groups": group_rows,
        "subgroups": subgroup_rows,
    }
    set_cached_view(summary_cache_key, response)
    return response


@router.get("/{model_id}/stacked")
def stacked(
    model_id: str,
    time_col: str = Query(...),
    freq: str = Query("month"),  # day|week|month
    by: str = Query("group"),  # group|subgroup
    include_intercept: bool = Query(False),
    as_percent: bool = Query(False),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    start_ts = _parse_date(start_date)
    end_ts = _parse_date(end_date)
    try:
        m, ds, work, X, Xc, y, params, filtered_df = _fit_from_model(
            session, model_id, membership.company_id, time_col, start_ts, end_ts
        )
    except HTTPException as exc:
        is_insufficient_rows = isinstance(exc.detail, dict) and exc.detail.get("code") == "INSUFFICIENT_ROWS"
        if not is_insufficient_rows or (start_ts is None and end_ts is None):
            raise
        m, ds, work, X, Xc, y, params, full_df = _fit_from_model(session, model_id, membership.company_id)
        # `work`/`X` above already cover the FULL history (correct adstock carryover) from
        # the unfiltered fit — don't rebuild predictor values from `filtered_df`, just use it
        # (via design_frame=X below) to scope rows/time to the requested date range.
        filtered_df = _apply_date_filter(full_df.copy(), time_col, start_ts, end_ts)
        if filtered_df.empty:
            raise api_error(400, "NO_ROWS_IN_RANGE", "No rows available for the selected date range")
    if filtered_df is None:
        filtered_df = work

    start_key = _ts_key(start_ts)
    end_key = _ts_key(end_ts)
    stacked_cache_key = AnalysisCacheKey(
        dataset_id=ds.id,
        model_id=m.id,
        start=start_key,
        end=end_key,
        view="stacked",
        extra=(time_col, freq, by, include_intercept, as_percent),
    )
    cached_stacked = get_cached_view(stacked_cache_key)
    if cached_stacked is not None:
        return cached_stacked

    var_map, sg_map, g_map = _group_maps(session, ds.id, membership.company_id)
    baseline_predictors = _baseline_predictor_names(var_map, g_map, sg_map)

    contrib_result = compute_contributions(
        dataset_id=ds.id,
        model_id=m.id,
        df=filtered_df,
        design_frame=X,
        time_column=time_col,
        start=start_ts,
        end=end_ts,
        params=params,
        predictors=list(X.columns),
        baseline_predictors=baseline_predictors,
    )

    freq_map = {"day": "D", "week": "W", "month": "M"}
    rule = freq_map.get(freq, "M")
    periods = contrib_result.time_values.dt.to_period(rule).astype(str)

    contrib_df = contrib_result.per_row_contributions.copy()
    if not include_intercept:
        contrib_df = contrib_df.drop(columns="__intercept__", errors="ignore")
    contrib_df["__period__"] = periods.reindex(contrib_df.index).astype(str)

    other_label = "Other"
    baseline_label = "Baseline"

    predictor_columns = [col for col in contrib_df.columns if col not in {"__period__", "__intercept__"}]

    if by == "subgroup":
        # Map variable -> subgroup name or '_unassigned'
        def sg_key(var: str) -> str:
            sid = var_map.get(var, {}).get("subgroup_id")
            return sg_map[sid].name if sid and sid in sg_map else other_label
        rename_map = {var: sg_key(var) for var in predictor_columns}
    else:
        # group
        def g_key(var: str) -> str:
            gid = var_map.get(var, {}).get("group_id")
            if gid and gid in g_map:
                return g_map[gid].name
            sid = var_map.get(var, {}).get("subgroup_id")
            if sid and sid in sg_map:
                gid = sg_map[sid].group_id
                return g_map[gid].name if gid in g_map else other_label
            return other_label

        rename_map = {var: g_key(var) for var in predictor_columns}

    if include_intercept:
        rename_map["__intercept__"] = baseline_label

    value_columns = predictor_columns + (
        ["__intercept__"] if include_intercept and "__intercept__" in contrib_df.columns else []
    )

    melted = contrib_df.melt(
        id_vars=["__period__"],
        value_vars=value_columns,
        var_name="key",
        value_name="value",
    )
    # Map variable keys to group/subgroup names
    melted["key"] = melted["key"].map(lambda k: rename_map.get(k, k))
    grp = (
        melted.groupby(["__period__", "key"], dropna=False)["value"].sum().reset_index()
    )

    # Pivot to wide for easier consumption
    pivot = grp.pivot(index="__period__", columns="key", values="value").fillna(0.0)
    if as_percent:
        pivot = pivot.apply(
            lambda row: (row / row.sum()) * 100 if row.sum() else row, axis=1
        )
    pivot = pivot.sort_index()
    index = list(pivot.index.astype(str))
    series = [
        {"key": c, "values": [float(v) for v in pivot[c].tolist()]}
        for c in pivot.columns
    ]

    response = {"index": index, "series": series}
    set_cached_view(stacked_cache_key, response)
    return response


def _export_info_sheet(
    session: Session,
    company_id: str,
    dataset_id: Optional[str],
    model_name: Optional[str],
    r2: Optional[float],
    start_date: Optional[str],
    end_date: Optional[str],
) -> pd.DataFrame:
    """Provenance sheet (A09-R10): which model/dataset version/fit an export came from, so a
    downloaded file is self-explanatory without the app open next to it."""
    ds = get_scoped(session, Dataset, dataset_id, company_id) if dataset_id else None
    return pd.DataFrame(
        [
            {"Field": "Model", "Value": model_name},
            {"Field": "Dataset", "Value": ds.display_name if ds else None},
            {"Field": "Dataset version", "Value": ds.version if ds else None},
            {"Field": "R²", "Value": r2},
            {"Field": "Date range", "Value": f"{start_date or ''} – {end_date or ''}".strip(" –")},
            {"Field": "Generated", "Value": utcnow().isoformat()},
        ]
    )


@router.get("/{model_id}/export/summary.xlsx")
def export_summary(
    model_id: str,
    include_intercept: bool = Query(True),
    as_percent: bool = Query(False),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    data = summary(
        model_id, include_intercept, as_percent, start_date, end_date, membership, session
    )
    mm = session.get(ModelMetrics, model_id)
    info = _export_info_sheet(
        session,
        membership.company_id,
        data["model"].get("dataset_id"),
        data["model"].get("name"),
        float(mm.r2) if mm else None,
        start_date,
        end_date,
    )
    return excel_response(
        {
            "Info": info,
            "variables": pd.DataFrame(data["variables"]),
            "groups": pd.DataFrame(data["groups"]),
            "subgroups": pd.DataFrame(data["subgroups"]),
        },
        "summary.xlsx",
    )


@router.get("/{model_id}/executive-summary/export")
def export_executive_summary(
    model_id: str,
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    """Excel export for the Resumen Ejecutivo page — reuses summary()'s contribution numbers
    and economics_summary()'s investment/revenue/ROI totals rather than recomputing them.
    Lazy-imports economics.py to avoid a circular import (economics.py imports helpers from
    this module at module load time)."""
    from .economics import economics_summary

    data = summary(model_id, True, False, start_date, end_date, membership, session)
    econ = economics_summary(model_id, start_date, end_date, membership, session)

    m = get_scoped(session, Model, model_id, membership.company_id)
    mm = session.get(ModelMetrics, m.id)

    kpi_rows = [
        {"Metric": "Fit (R²)", "Value": float(mm.r2) if mm else None},
        {"Metric": "Total contribution", "Value": data["total_contribution"]},
    ]
    if econ["economics_configured"]:
        kpi_rows += [
            {"Metric": "Total investment", "Value": econ["totals"]["investment"]},
            {"Metric": "Total revenue", "Value": econ["totals"]["revenue"]},
            {"Metric": "ROI", "Value": econ["totals"]["roi"]},
            {"Metric": "ROAS", "Value": econ["totals"]["roas"]},
        ]

    group_rows = [
        {
            "Group": row.get("group_name") or "-",
            "Contribution": row.get("contribution"),
            "% of total": row.get("percent"),
        }
        for row in data["groups"]
    ]

    return excel_response(
        {"KPIs": pd.DataFrame(kpi_rows), "Groups": pd.DataFrame(group_rows)},
        f"executive_summary_{model_id}.xlsx",
    )


@router.post("/summary/export")
def export_summary_table_excel(
    payload: SummaryTableExportRequest,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    data = summary(
        payload.model_id,
        payload.include_intercept,
        False,
        payload.start_date,
        payload.end_date,
        membership,
        session,
    )
    model_info = data["model"]
    dataset_id = model_info.get("dataset_id")
    if payload.dataset_id and dataset_id and payload.dataset_id != dataset_id:
        raise api_error(400, "MODEL_DATASET_MISMATCH", "Model does not belong to the selected dataset")

    mode = payload.group_mode
    table_rows: List[dict] = []
    if mode == "group":
        for row in data["groups"]:
            table_rows.append(
                {
                    "Group": row.get("group_name") or "-",
                    "Contribution": float(row.get("contribution", 0.0)),
                    "% of total": float(row.get("percent", 0.0)),
                }
            )
    elif mode == "group_subgroup":
        for row in data["subgroups"]:
            table_rows.append(
                {
                    "Group": row.get("group_name") or "-",
                    "Subgroup": row.get("subgroup_name") or "-",
                    "Contribution": float(row.get("contribution", 0.0)),
                    "% of total": float(row.get("percent", 0.0)),
                }
            )
    elif mode == "variable":
        for row in data["variables"]:
            table_rows.append(
                {
                    "Group": row.get("group_name") or "-",
                    "Subgroup": row.get("subgroup_name") or "-",
                    "Variable": row.get("display_name") or row.get("name") or "-",
                    "Contribution": float(row.get("contribution", 0.0)),
                    "% of total": float(row.get("percent", 0.0)),
                }
            )
    else:
        raise api_error(400, "INVALID_GROUP_MODE", "Invalid group mode")

    df = pd.DataFrame(table_rows)
    mm = session.get(ModelMetrics, payload.model_id)
    info = _export_info_sheet(
        session,
        membership.company_id,
        dataset_id,
        model_info.get("name"),
        float(mm.r2) if mm else None,
        payload.start_date,
        payload.end_date,
    )
    filename = (
        f"summary_table_{dataset_id or 'dataset'}_{model_info.get('id')}.xlsx"
    )
    return excel_response({"Info": info, "Summary": df}, filename)


@router.get("/{model_id}/export/stacked.xlsx")
def export_stacked(
    model_id: str,
    time_col: str = Query(...),
    freq: str = Query("month"),
    by: str = Query("group"),
    include_intercept: bool = Query(False),
    as_percent: bool = Query(False),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    data = stacked(
        model_id,
        time_col,
        freq,
        by,
        include_intercept,
        as_percent,
        start_date,
        end_date,
        membership,
        session,
    )
    # Convert to a flat table for Excel
    index = data["index"]
    rows = [
        {"period": idx, **{s["key"]: s["values"][i] for s in data["series"]}}
        for i, idx in enumerate(index)
    ]
    m = get_scoped(session, Model, model_id, membership.company_id)
    mm = session.get(ModelMetrics, model_id)
    info = _export_info_sheet(
        session,
        membership.company_id,
        m.dataset_id,
        m.name,
        float(mm.r2) if mm else None,
        start_date,
        end_date,
    )
    return excel_response({"Info": info, "stacked": pd.DataFrame(rows)}, "stacked.xlsx")
