from __future__ import annotations

import io
import json
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..db import get_session
from ..models import Dataset, Model, ModelMetrics, Variable, Subgroup, Group
from ..schemas import SummaryTableExportRequest
from ..services.analysis import (
    AnalysisCacheKey,
    compute_contributions,
    get_cached_view,
    set_cached_view,
)
from ..utils.datasets import load_dataset_frame


router = APIRouter()


def _parse_date(value: Optional[str]) -> Optional[pd.Timestamp]:
    if not value:
        return None
    ts = pd.to_datetime(value, errors="coerce")
    if pd.isna(ts):
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}")
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
    time_column: Optional[str] = None,
    start: Optional[pd.Timestamp] = None,
    end: Optional[pd.Timestamp] = None,
):
    m = session.get(Model, model_id)
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    ds = session.get(Dataset, m.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    try:
        df = load_dataset_frame(ds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    time_field = time_column or getattr(ds, "time_variable", None)
    df = _apply_date_filter(df, time_field, start, end)
    x_vars = json.loads(m.x_vars_json)
    cols = [m.y_var] + x_vars
    work = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if work.shape[0] < len(cols) + 1:
        raise HTTPException(
            status_code=400, detail="Insufficient rows after cleaning for analysis"
        )
    y = work[m.y_var].to_numpy()
    X = work[x_vars]
    Xc = sm.add_constant(X, has_constant="add")
    res = sm.OLS(y, Xc).fit()
    params = res.params  # pandas Series with const and x_vars
    return m, ds, work, X, Xc, y, params, df


def _group_maps(session: Session, dataset_id: str):
    vars_ = session.exec(
        select(Variable).where(Variable.dataset_id == dataset_id)
    ).all()
    sg_ids = {v.subgroup_id for v in vars_ if v.subgroup_id}
    sgs = (
        session.exec(select(Subgroup).where(Subgroup.id.in_(list(sg_ids)))).all()
        if sg_ids
        else []
    )
    g_ids = {sg.group_id for sg in sgs}
    g_ids.update({v.group_id for v in vars_ if v.group_id})
    gs = (
        session.exec(select(Group).where(Group.id.in_(list(g_ids)))).all()
        if g_ids
        else []
    )
    sg_map = {sg.id: sg for sg in sgs}
    g_map = {g.id: g for g in gs}
    var_map = {
        v.name: {"group_id": v.group_id, "subgroup_id": v.subgroup_id} for v in vars_
    }
    return var_map, sg_map, g_map


@router.get("/{model_id}/summary")
def summary(
    model_id: str,
    include_intercept: bool = Query(True),
    as_percent: bool = Query(False),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
):
    start_ts = _parse_date(start_date)
    end_ts = _parse_date(end_date)
    filtered_df: pd.DataFrame | None = None
    try:
        m, ds, work, X, Xc, y, params, filtered_df = _fit_from_model(
            session, model_id, None, start_ts, end_ts
        )
    except HTTPException as exc:
        if exc.detail != "Insufficient rows after cleaning for analysis" or (
            start_ts is None and end_ts is None
        ):
            raise
        m, ds, work, X, Xc, y, params, full_df = _fit_from_model(session, model_id)
        filtered_df = _apply_date_filter(
            full_df.copy(), getattr(ds, "time_variable", None), start_ts, end_ts
        )
        if filtered_df.empty:
            raise HTTPException(
                status_code=400, detail="No rows available for the selected date range"
            )
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

    time_field = getattr(ds, "time_variable", None)
    contrib_result = compute_contributions(
        dataset_id=ds.id,
        model_id=m.id,
        df=filtered_df,
        time_column=time_field,
        start=start_ts,
        end=end_ts,
        params=params,
        predictors=list(X.columns),
    )

    var_map, sg_map, g_map = _group_maps(session, ds.id)
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

    def _subtotal_entry(key: str, label: str, amount: float) -> dict[str, object]:
        return {
            "row_type": "subtotal",
            "key": key,
            "label": label,
            "group_id": f"subtotal-{key}",
            "group_name": label,
            "subgroup_id": None,
            "subgroup_name": None,
            "name": None,
            "contribution": float(amount),
            "percent": percent(amount),
        }

    marketing_total = sum(
        row["contribution"]
        for row in rows
        if isinstance(row.get("group_name"), str)
        and row["group_name"].strip().lower() == "marketing"
    )
    other_total = sum(
        row["contribution"]
        for row in rows
        if row.get("group_name") == other_label
    )
    baseline_total = float(intercept)

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

    subtotals = [
        _subtotal_entry("marketing", "∑ Marketing", marketing_total),
        _subtotal_entry("baseline", "∑ Baseline", baseline_total),
        _subtotal_entry("other", "∑ Other", other_total),
    ]

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
        "subtotals": subtotals,
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
    session: Session = Depends(get_session),
):
    start_ts = _parse_date(start_date)
    end_ts = _parse_date(end_date)
    try:
        m, ds, work, X, Xc, y, params, filtered_df = _fit_from_model(
            session, model_id, time_col, start_ts, end_ts
        )
    except HTTPException as exc:
        if exc.detail != "Insufficient rows after cleaning for analysis" or (
            start_ts is None and end_ts is None
        ):
            raise
        m, ds, work, X, Xc, y, params, full_df = _fit_from_model(session, model_id)
        filtered_df = _apply_date_filter(full_df.copy(), time_col, start_ts, end_ts)
        if filtered_df.empty:
            raise HTTPException(
                status_code=400, detail="No rows available for the selected date range"
            )
        numeric = (
            filtered_df[[m.y_var] + list(X.columns)]
            .apply(pd.to_numeric, errors="coerce")
            .dropna()
        )
        if numeric.empty:
            raise HTTPException(
                status_code=400,
                detail="No complete rows available for the selected date range",
        ) 
        work = numeric
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

    contrib_result = compute_contributions(
        dataset_id=ds.id,
        model_id=m.id,
        df=filtered_df,
        time_column=time_col,
        start=start_ts,
        end=end_ts,
        params=params,
        predictors=list(X.columns),
    )

    var_map, sg_map, g_map = _group_maps(session, ds.id)

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


@router.get("/{model_id}/export/summary.xlsx")
def export_summary(
    model_id: str,
    include_intercept: bool = Query(True),
    as_percent: bool = Query(False),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
):
    data = summary(
        model_id, include_intercept, as_percent, start_date, end_date, session
    )
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame(data["variables"]).to_excel(
            writer, index=False, sheet_name="variables"
        )
        pd.DataFrame(data["groups"]).to_excel(writer, index=False, sheet_name="groups")
        pd.DataFrame(data["subgroups"]).to_excel(
            writer, index=False, sheet_name="subgroups"
        )
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=summary.xlsx"},
    )


@router.post("/summary/export")
def export_summary_table_excel(
    payload: SummaryTableExportRequest,
    session: Session = Depends(get_session),
):
    data = summary(
        payload.model_id,
        payload.include_intercept,
        False,
        payload.start_date,
        payload.end_date,
        session,
    )
    model_info = data["model"]
    dataset_id = model_info.get("dataset_id")
    if payload.dataset_id and dataset_id and payload.dataset_id != dataset_id:
        raise HTTPException(
            status_code=400, detail="Model does not belong to the selected dataset"
        )

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
                    "Variable": row.get("name") or "-",
                    "Contribution": float(row.get("contribution", 0.0)),
                    "% of total": float(row.get("percent", 0.0)),
                }
            )
    else:
        raise HTTPException(status_code=400, detail="Invalid group mode")

    df = pd.DataFrame(table_rows)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Summary")
    buf.seek(0)
    filename = (
        f"summary_table_{dataset_id or 'dataset'}_{model_info.get('id')}.xlsx"
    )
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
        session,
    )
    buf = io.BytesIO()
    # Convert to a flat table for Excel
    index = data["index"]
    rows = [
        {"period": idx, **{s["key"]: s["values"][i] for s in data["series"]}}
        for i, idx in enumerate(index)
    ]
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, sheet_name="stacked")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=stacked.xlsx"},
    )
