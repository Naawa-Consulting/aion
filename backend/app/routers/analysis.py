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
from ..utils.datasets import load_dataset_frame


router = APIRouter()


def _parse_date(value: Optional[str]) -> Optional[pd.Timestamp]:
    if not value:
        return None
    ts = pd.to_datetime(value, errors="coerce")
    if pd.isna(ts):
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}")
    return ts


def _apply_date_filter(df: pd.DataFrame, time_column: Optional[str], start: Optional[pd.Timestamp], end: Optional[pd.Timestamp]) -> pd.DataFrame:
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


def _fit_from_model(session: Session, model_id: str, time_column: Optional[str] = None, start: Optional[pd.Timestamp] = None, end: Optional[pd.Timestamp] = None):
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
    work = df[cols].apply(pd.to_numeric, errors='coerce').dropna()
    if work.shape[0] < len(cols) + 1:
        raise HTTPException(status_code=400, detail="Insufficient rows after cleaning for analysis")
    y = work[m.y_var].to_numpy()
    X = work[x_vars]
    Xc = sm.add_constant(X, has_constant='add')
    res = sm.OLS(y, Xc).fit()
    params = res.params  # pandas Series with const and x_vars
    return m, ds, work, X, Xc, y, params, df


def _group_maps(session: Session, dataset_id: str):
    vars_ = session.exec(select(Variable).where(Variable.dataset_id == dataset_id)).all()
    sg_ids = {v.subgroup_id for v in vars_ if v.subgroup_id}
    sgs = session.exec(select(Subgroup).where(Subgroup.id.in_(list(sg_ids)))).all() if sg_ids else []
    g_ids = {sg.group_id for sg in sgs}
    g_ids.update({v.group_id for v in vars_ if v.group_id})
    gs = session.exec(select(Group).where(Group.id.in_(list(g_ids)))).all() if g_ids else []
    sg_map = {sg.id: sg for sg in sgs}
    g_map = {g.id: g for g in gs}
    var_map = {v.name: {"group_id": v.group_id, "subgroup_id": v.subgroup_id} for v in vars_}
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
        m, ds, work, X, Xc, y, params, filtered_df = _fit_from_model(session, model_id, None, start_ts, end_ts)
    except HTTPException as exc:
        if (
            exc.detail != "Insufficient rows after cleaning for analysis"
            or (start_ts is None and end_ts is None)
        ):
            raise
        m, ds, work, X, Xc, y, params, full_df = _fit_from_model(session, model_id)
        filtered_df = _apply_date_filter(full_df.copy(), getattr(ds, "time_variable", None), start_ts, end_ts)
        if filtered_df.empty:
            raise HTTPException(status_code=400, detail="No rows available for the selected date range")
    var_map, sg_map, g_map = _group_maps(session, ds.id)

    if filtered_df is None:
        filtered_df = work

    rows = []
    group_totals: Dict[str, float] = {}
    subgroup_totals: Dict[str, float] = {}
    contributions: Dict[str, float] = {}
    source_df = filtered_df
    total_variables = 0.0
    for name in X.columns:
        coef = float(params.get(name, 0.0))
        if name not in source_df.columns:
            continue
        series = pd.to_numeric(source_df[name], errors="coerce").fillna(0.0)
        contrib = float((series * coef).sum())
        contributions[name] = contrib
        total_variables += contrib
        mapping = var_map.get(name, {})
        sg_id = mapping.get("subgroup_id")
        gid = mapping.get("group_id")
        sg = sg_map.get(sg_id) if sg_id else None
        g = g_map.get(gid) if gid else (g_map.get(sg.group_id) if sg else None)
        rows.append({
            "name": name,
            "coef": coef,
            "mean": float(series.mean()) if len(series) else 0.0,
            "contribution": contrib,
            "subgroup_id": sg.id if sg else None,
            "subgroup_name": sg.name if sg else None,
            "group_id": g.id if g else None,
            "group_name": g.name if g else None,
        })
        if sg:
            subgroup_totals[sg.id] = subgroup_totals.get(sg.id, 0.0) + contrib
            grp_id = g.id if g else sg.group_id
            if grp_id:
                group_totals[grp_id] = group_totals.get(grp_id, 0.0) + contrib
        elif g:
            group_totals[g.id] = group_totals.get(g.id, 0.0) + contrib

    intercept_beta = float(params.get('const', 0.0))
    n_rows = len(source_df)
    intercept = intercept_beta * n_rows if include_intercept else 0.0
    total_contribution = float(total_variables + intercept)

    def percent(value: float) -> float:
        return float((value / total_contribution) * 100) if total_contribution else 0.0

    baseline_entry = None
    if include_intercept:
        baseline_entry = {
            "name": "baseline",
            "coef": intercept_beta,
            "mean": float(n_rows),
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

    for row in rows:
        row["value"] = float(row["contribution"])
        row["percent"] = percent(row["contribution"])

    group_rows = [{
        "group_id": gid,
        "group_name": g_map[gid].name if gid in g_map else ("Baseline" if gid == "baseline" else None),
        "contribution": float(val),
        "percent": percent(val),
    } for gid, val in group_totals.items()]

    subgroup_rows = [{
        "subgroup_id": sid,
        "subgroup_name": sg_map[sid].name if sid in sg_map else ("Baseline" if sid == "baseline" else None),
        "group_id": sg_map[sid].group_id if sid in sg_map else ("baseline" if sid == "baseline" else None),
        "group_name": g_map.get(sg_map[sid].group_id).name if (sid in sg_map and sg_map[sid].group_id in g_map) else ("Baseline" if sid == "baseline" else None),
        "contribution": float(val),
        "percent": percent(val),
    } for sid, val in subgroup_totals.items()]

    return {
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


@router.get("/{model_id}/stacked")
def stacked(
    model_id: str,
    time_col: str = Query(...),
    freq: str = Query("month"),  # day|week|month
    by: str = Query("group"),     # group|subgroup
    include_intercept: bool = Query(False),
    as_percent: bool = Query(False),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
):
    start_ts = _parse_date(start_date)
    end_ts = _parse_date(end_date)
    try:
        m, ds, work, X, Xc, y, params, filtered_df = _fit_from_model(session, model_id, time_col, start_ts, end_ts)
    except HTTPException as exc:
        if (
            exc.detail != "Insufficient rows after cleaning for analysis"
            or (start_ts is None and end_ts is None)
        ):
            raise
        m, ds, work, X, Xc, y, params, full_df = _fit_from_model(session, model_id)
        filtered_df = _apply_date_filter(full_df.copy(), time_col, start_ts, end_ts)
        if filtered_df.empty:
            raise HTTPException(status_code=400, detail="No rows available for the selected date range")
        numeric = filtered_df[[m.y_var] + list(X.columns)].apply(pd.to_numeric, errors="coerce").dropna()
        if numeric.empty:
            raise HTTPException(status_code=400, detail="No complete rows available for the selected date range")
        work = numeric
    var_map, sg_map, g_map = _group_maps(session, ds.id)

    if time_col not in work.columns:
        if time_col in filtered_df.columns:
            original = filtered_df[[time_col]]
        else:
            try:
                original = load_dataset_frame(ds, columns=[time_col])
            except Exception as exc:  # pragma: no cover
                raise HTTPException(status_code=400, detail=f"time_col error: {exc}") from exc
            if time_col not in original.columns:
                raise HTTPException(status_code=400, detail="time_col not found in dataset")
        work = work.join(original, how='left')

    if time_col not in work.columns:
        raise HTTPException(status_code=400, detail="time_col not found in dataset")

    ts = pd.to_datetime(work[time_col], errors='coerce')
    if ts.isna().all():
        raise HTTPException(status_code=400, detail="time_col could not be parsed to datetime")

    freq_map = {"day": "D", "week": "W", "month": "M"}
    rule = freq_map.get(freq, "M")
    periods = ts.dt.to_period(rule).astype(str)

    # Contributions per variable per row
    contrib_df = pd.DataFrame(index=work.index)
    for name in X.columns:
        coef = float(params.get(name, 0.0))
        contrib_df[name] = coef * pd.to_numeric(work[name], errors='coerce')

    if include_intercept:
        contrib_df['__intercept__'] = float(params.get('const', 0.0))

    contrib_df["__period__"] = periods

    other_label = "Other"
    baseline_label = "Baseline"

    if by == "subgroup":
        # Map variable -> subgroup name or '_unassigned'
        def sg_key(var: str) -> str:
            sid = var_map.get(var, {}).get("subgroup_id")
            return sg_map[sid].name if sid and sid in sg_map else other_label
        rename_map = {var: sg_key(var) for var in X.columns}
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
        rename_map = {var: g_key(var) for var in X.columns}

    if include_intercept:
        rename_map["__intercept__"] = baseline_label

    melted = contrib_df.melt(id_vars=["__period__"], value_vars=list(X.columns) + (["__intercept__"] if include_intercept else []), var_name="key", value_name="value")
    # Map variable keys to group/subgroup names
    melted["key"] = melted["key"].map(lambda k: rename_map.get(k, k))
    grp = melted.groupby(["__period__", "key"], dropna=False)["value"].sum().reset_index()

    # Pivot to wide for easier consumption
    pivot = grp.pivot(index="__period__", columns="key", values="value").fillna(0.0)
    if as_percent:
        pivot = pivot.apply(lambda row: (row / row.sum()) * 100 if row.sum() else row, axis=1)
    pivot = pivot.sort_index()
    index = list(pivot.index.astype(str))
    series = [{"key": c, "values": [float(v) for v in pivot[c].tolist()]} for c in pivot.columns]

    return {"index": index, "series": series}


@router.get("/{model_id}/export/summary.xlsx")
def export_summary(
    model_id: str,
    include_intercept: bool = Query(True),
    as_percent: bool = Query(False),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
):
    data = summary(model_id, include_intercept, as_percent, start_date, end_date, session)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame(data["variables"]).to_excel(writer, index=False, sheet_name="variables")
        pd.DataFrame(data["groups"]).to_excel(writer, index=False, sheet_name="groups")
        pd.DataFrame(data["subgroups"]).to_excel(writer, index=False, sheet_name="subgroups")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=summary.xlsx"})


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
    data = stacked(model_id, time_col, freq, by, include_intercept, as_percent, start_date, end_date, session)
    buf = io.BytesIO()
    # Convert to a flat table for Excel
    index = data["index"]
    rows = [{"period": idx, **{s["key"]: s["values"][i] for s in data["series"]}} for i, idx in enumerate(index)]
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, sheet_name="stacked")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=stacked.xlsx"})
