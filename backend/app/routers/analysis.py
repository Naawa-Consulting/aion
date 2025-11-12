from __future__ import annotations

import io
import json
from typing import Dict, List

import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..db import get_session
from ..models import Dataset, Model, ModelMetrics, VariableGroup, Subgroup, Group


router = APIRouter()


def _fit_from_model(session: Session, model_id: str):
    m = session.get(Model, model_id)
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    ds = session.get(Dataset, m.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = pd.read_parquet(ds.path)
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
    return m, ds, work, X, Xc, y, params


def _group_maps(session: Session, dataset_id: str):
    vgs = session.exec(select(VariableGroup).where(VariableGroup.dataset_id == dataset_id)).all()
    sg_ids = list({vg.subgroup_id for vg in vgs})
    sgs = session.exec(select(Subgroup).where(Subgroup.id.in_(sg_ids))) .all() if sg_ids else []
    g_ids = list({sg.group_id for sg in sgs})
    gs = session.exec(select(Group).where(Group.id.in_(g_ids))).all() if g_ids else []
    sg_map = {sg.id: sg for sg in sgs}
    g_map = {g.id: g for g in gs}
    var_to_sg = {vg.variable_name: vg.subgroup_id for vg in vgs}
    return var_to_sg, sg_map, g_map


@router.get("/{model_id}/summary")
def summary(model_id: str, include_intercept: bool = Query(True), session: Session = Depends(get_session)):
    m, ds, work, X, Xc, y, params = _fit_from_model(session, model_id)
    var_to_sg, sg_map, g_map = _group_maps(session, ds.id)

    rows = []
    group_totals: Dict[str, float] = {}
    subgroup_totals: Dict[str, float] = {}

    for name in X.columns:
        coef = float(params.get(name, 0.0))
        mean_val = float(X[name].mean())
        contrib = coef * mean_val
        sg_id = var_to_sg.get(name)
        sg = sg_map.get(sg_id) if sg_id else None
        g = g_map.get(sg.group_id) if sg else None
        rows.append({
            "name": name,
            "coef": coef,
            "mean": mean_val,
            "contribution": contrib,
            "subgroup_id": sg.id if sg else None,
            "subgroup_name": sg.name if sg else None,
            "group_id": g.id if g else None,
            "group_name": g.name if g else None,
        })
        if sg:
            subgroup_totals[sg.id] = subgroup_totals.get(sg.id, 0.0) + contrib
            group_totals[g.id] = group_totals.get(g.id, 0.0) + contrib

    intercept = float(params.get('const', 0.0)) if include_intercept else 0.0
    total_contribution = float(sum(r["contribution"] for r in rows) + intercept)

    group_rows = [{
        "group_id": gid,
        "group_name": g_map[gid].name if gid in g_map else None,
        "contribution": float(val),
    } for gid, val in group_totals.items()]

    subgroup_rows = [{
        "subgroup_id": sid,
        "subgroup_name": sg_map[sid].name if sid in sg_map else None,
        "group_id": sg_map[sid].group_id if sid in sg_map else None,
        "group_name": g_map.get(sg_map[sid].group_id).name if (sid in sg_map and sg_map[sid].group_id in g_map) else None,
        "contribution": float(val),
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
    session: Session = Depends(get_session),
):
    m, ds, work, X, Xc, y, params = _fit_from_model(session, model_id)
    var_to_sg, sg_map, g_map = _group_maps(session, ds.id)

    if time_col not in work.columns and time_col in pd.read_parquet(ds.path).columns:
        # If time col was dropped due to NA in numeric filtering, join from original df
        original = pd.read_parquet(ds.path)[[time_col]]
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

    if by == "subgroup":
        # Map variable -> subgroup name or '_unassigned'
        def sg_key(var: str) -> str:
            sid = var_to_sg.get(var)
            return sg_map[sid].name if sid and sid in sg_map else "_unassigned_"
        rename_map = {var: sg_key(var) for var in X.columns}
    else:
        # group
        def g_key(var: str) -> str:
            sid = var_to_sg.get(var)
            if sid and sid in sg_map:
                gid = sg_map[sid].group_id
                return g_map[gid].name if gid in g_map else "_unassigned_"
            return "_unassigned_"
        rename_map = {var: g_key(var) for var in X.columns}

    melted = contrib_df.melt(id_vars=["__period__"], value_vars=list(X.columns) + (["__intercept__"] if include_intercept else []), var_name="key", value_name="value")
    # Map variable keys to group/subgroup names
    melted["key"] = melted["key"].map(lambda k: rename_map.get(k, k))
    grp = melted.groupby(["__period__", "key"], dropna=False)["value"].sum().reset_index()

    # Pivot to wide for easier consumption
    pivot = grp.pivot(index="__period__", columns="key", values="value").fillna(0.0)
    pivot = pivot.sort_index()
    index = list(pivot.index.astype(str))
    series = [{"key": c, "values": [float(v) for v in pivot[c].tolist()]} for c in pivot.columns]

    return {"index": index, "series": series}


@router.get("/{model_id}/export/summary.xlsx")
def export_summary(model_id: str, include_intercept: bool = Query(True), session: Session = Depends(get_session)):
    data = summary(model_id, include_intercept, session)
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
    session: Session = Depends(get_session),
):
    data = stacked(model_id, time_col, freq, by, include_intercept, session)
    buf = io.BytesIO()
    # Convert to a flat table for Excel
    index = data["index"]
    rows = [{"period": idx, **{s["key"]: s["values"][i] for s in data["series"]}} for i, idx in enumerate(index)]
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, sheet_name="stacked")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=stacked.xlsx"})

