from __future__ import annotations

import json
import uuid
from typing import Dict

import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..db import get_session
from ..models import Scenario, Model, Dataset, VariableGroup, Subgroup, Group
from ..routers.analysis import _fit_from_model, _group_maps
from ..schemas import ScenarioRequest, ScenarioOut, Adjustment, SimulationRequest


router = APIRouter()


def _compute_contributions(session: Session, model_id: str, adjustments: dict[str, float]):
    m, ds, work, X, Xc, y, params = _fit_from_model(session, model_id)
    var_to_sg, sg_map, g_map = _group_maps(session, ds.id)

    X_adj = X.copy()
    for col in X.columns:
        mult = float(adjustments.get(col, 1.0))
        X_adj[col] = pd.to_numeric(X[col], errors='coerce').fillna(0.0) * mult

    contrib_rows = []
    group_totals: Dict[str, float] = {}
    subgroup_totals: Dict[str, float] = {}

    UNASSIGNED = "_unassigned_"

    for name in X.columns:
        coef = float(params.get(name, 0.0))
        mean = float(X[name].mean())
        adjusted_mean = float(X_adj[name].mean())
        contribution = coef * adjusted_mean
        mult = float(adjustments.get(name, 1.0))
        sg_id = var_to_sg.get(name)
        sg = sg_map.get(sg_id) if sg_id else None
        g = g_map.get(sg.group_id) if sg else None
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
            if g:
                group_totals[g.id] = group_totals.get(g.id, 0.0) + contribution
            else:
                group_totals[UNASSIGNED] = group_totals.get(UNASSIGNED, 0.0) + contribution
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


def _stacked_for_scenario(session: Session, model_id: str, adjustments: dict[str, float], time_col: str, freq: str, by: str):
    from ..routers.analysis import stacked as stacked_fn

    # stacked_fn expects scenario adjustments to already be applied; so temporarily adjust dataset? Instead reuse helper.
    # We'll compute contributions manually similar to stacked but with adjustments.
    m, ds, work, X, Xc, y, params = _fit_from_model(session, model_id)
    var_to_sg, sg_map, g_map = _group_maps(session, ds.id)

    if time_col not in work.columns and time_col in pd.read_parquet(ds.path).columns:
        work = work.join(pd.read_parquet(ds.path)[[time_col]], how='left')
    if time_col not in work.columns:
        raise HTTPException(status_code=400, detail="time_col not found")

    ts = pd.to_datetime(work[time_col], errors='coerce')
    if ts.isna().all():
        raise HTTPException(status_code=400, detail="time_col could not be parsed")
    freq_map = {"day": "D", "week": "W", "month": "M"}
    rule = freq_map.get(freq, "M")
    periods = ts.dt.to_period(rule).astype(str)

    contrib_df = pd.DataFrame(index=work.index)
    for name in X.columns:
        coef = float(params.get(name, 0.0))
        mult = float(adjustments.get(name, 1.0))
        contrib_df[name] = coef * pd.to_numeric(work[name], errors='coerce').fillna(0.0) * mult
    contrib_df["__period__"] = periods

    if by == "subgroup":
        def key_fn(var: str):
            sid = var_to_sg.get(var)
            return sg_map[sid].name if sid and sid in sg_map else "_unassigned_"
    else:
        def key_fn(var: str):
            sid = var_to_sg.get(var)
            if sid and sid in sg_map:
                gid = sg_map[sid].group_id
                return g_map[gid].name if gid in g_map else "_unassigned_"
            return "_unassigned_"

    melted = contrib_df.melt(id_vars=["__period__"], var_name="var", value_name="value")
    melted["key"] = melted["var"].map(key_fn)
    grp = melted.groupby(["__period__", "key"], dropna=False)["value"].sum().reset_index()
    pivot = grp.pivot(index="__period__", columns="key", values="value").fillna(0.0)
    pivot = pivot.sort_index()
    index = list(pivot.index.astype(str))
    series = [{"key": c, "values": [float(v) for v in pivot[c].tolist()]} for c in pivot.columns]
    return {"index": index, "series": series}


@router.post("/{model_id}/simulate")
def simulate(model_id: str, body: SimulationRequest, session: Session = Depends(get_session)):
    adjustments = {adj.variable: adj.multiplier for adj in body.adjustments}
    result = _compute_contributions(session, model_id, adjustments)
    return result


@router.get("/{model_id}/scenarios", response_model=list[ScenarioOut])
def list_scenarios(model_id: str, session: Session = Depends(get_session)):
    scs = session.exec(select(Scenario).where(Scenario.model_id == model_id).order_by(Scenario.created_at)).all()
    out: list[ScenarioOut] = []
    for sc in scs:
        out.append(ScenarioOut(
            id=sc.id,
            model_id=sc.model_id,
            name=sc.name,
            adjustments=[Adjustment(**a) for a in json.loads(sc.adjustments_json)],
            results=json.loads(sc.results_json),
        ))
    return out


@router.post("/{model_id}/scenarios", response_model=ScenarioOut)
def create_scenario(model_id: str, body: ScenarioRequest, session: Session = Depends(get_session)):
    model = session.get(Model, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    existing = session.exec(select(Scenario).where(Scenario.model_id == model_id)).all()
    if len(existing) >= 3:
        raise HTTPException(status_code=400, detail="Maximum 3 scenarios per model")
    adjustment_dicts = [adj.model_dump() for adj in body.adjustments]
    adjustments = {item["variable"]: item["multiplier"] for item in adjustment_dicts}
    result = _compute_contributions(session, model_id, adjustments)
    sc = Scenario(
        id=str(uuid.uuid4()),
        model_id=model_id,
        name=body.name,
        adjustments_json=json.dumps(adjustment_dicts),
        results_json=json.dumps(result),
    )
    session.add(sc)
    session.commit()
    return ScenarioOut(
        id=sc.id,
        model_id=sc.model_id,
        name=sc.name,
        adjustments=body.adjustments,
        results=result,
    )


@router.delete("/{model_id}/scenarios/{scenario_id}")
def delete_scenario(model_id: str, scenario_id: str, session: Session = Depends(get_session)):
    sc = session.get(Scenario, scenario_id)
    if not sc or sc.model_id != model_id:
        raise HTTPException(status_code=404, detail="Scenario not found")
    session.delete(sc)
    session.commit()
    return {"status": "ok"}


@router.get("/{model_id}/scenarios/{scenario_id}/stacked")
def scenario_stacked(model_id: str, scenario_id: str, time_col: str = Query(...), freq: str = Query("month"), by: str = Query("group"), session: Session = Depends(get_session)):
    sc = session.get(Scenario, scenario_id)
    if not sc or sc.model_id != model_id:
        raise HTTPException(status_code=404, detail="Scenario not found")
    adjustments = {adj["variable"]: adj["multiplier"] for adj in json.loads(sc.adjustments_json)}
    data = _stacked_for_scenario(session, model_id, adjustments, time_col, freq, by)
    return data
