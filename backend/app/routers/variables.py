from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, delete

from ..db import get_session
from ..models import Dataset, Variable, VariableHistory, Subgroup, Group
from ..schemas import (
    TransformRequest,
    TransformResponse,
    TransformPreviewPoint,
    VariableOut,
    CategorizeRequest,
    VariableHistoryItem,
)


router = APIRouter()


def _read_df(ds: Dataset) -> pd.DataFrame:
    p = Path(ds.path)
    if not p.exists():
        raise HTTPException(status_code=500, detail="Dataset file missing")
    try:
        return pd.read_parquet(p)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed reading parquet: {e}")


def _write_df(ds: Dataset, df: pd.DataFrame) -> None:
    p = Path(ds.path)
    try:
        df.to_parquet(p, index=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed writing parquet: {e}")


def _sync_variables_with_dataset(session: Session, ds: Dataset, df: pd.DataFrame) -> list[Variable]:
    vars_ = session.exec(select(Variable).where(Variable.dataset_id == ds.id)).all()
    existing = {v.name for v in vars_}
    created = False
    for col in df.columns:
        if col not in existing:
            v = Variable(
                id=str(uuid.uuid4()),
                dataset_id=ds.id,
                name=str(col),
                dtype=str(df[col].dtype),
                is_derived=False,
            )
            session.add(v)
            vars_.append(v)
            created = True
    if created:
        session.commit()
    return vars_


def _maps_for_variables(session: Session, vars_: Iterable[Variable]):
    group_ids = {v.group_id for v in vars_ if v.group_id}
    subgroup_ids = {v.subgroup_id for v in vars_ if v.subgroup_id}
    groups = (
        session.exec(select(Group).where(Group.id.in_(list(group_ids)))).all()
        if group_ids
        else []
    )
    subgroups = (
        session.exec(select(Subgroup).where(Subgroup.id.in_(list(subgroup_ids)))).all()
        if subgroup_ids
        else []
    )
    g_map = {g.id: g for g in groups}
    sg_map = {sg.id: sg for sg in subgroups}
    return g_map, sg_map


def _variable_to_out(var: Variable, g_map: dict, sg_map: dict) -> VariableOut:
    sg = sg_map.get(var.subgroup_id) if var.subgroup_id else None
    g = g_map.get(var.group_id) if var.group_id else (g_map.get(sg.group_id) if sg else None)
    return VariableOut(
        id=var.id,
        dataset_id=var.dataset_id,
        name=var.name,
        dtype=var.dtype,
        is_derived=var.is_derived,
        subgroup_id=sg.id if sg else None,
        subgroup_name=sg.name if sg else None,
        group_id=g.id if g else None,
        group_name=g.name if g else None,
        created_at=var.created_at,
    )


@router.get("", response_model=list[VariableOut])
def list_variables(
    dataset_id: str = Query(...),
    search: str | None = Query(None),
    dtype: str | None = Query(None),
    derived: bool | None = Query(None),
    session: Session = Depends(get_session),
):
    ds = session.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = _read_df(ds)
    vars_ = _sync_variables_with_dataset(session, ds, df)

    results = vars_
    if derived is not None:
        results = [v for v in results if v.is_derived == derived]
    if search:
        term = search.lower()
        results = [v for v in results if term in v.name.lower()]
    if dtype:
        dt = dtype.lower()
        results = [v for v in results if dt in v.dtype.lower()]

    g_map, sg_map = _maps_for_variables(session, vars_)
    return [_variable_to_out(v, g_map, sg_map) for v in results]


def _transformation_preview(before: pd.Series | None, after: pd.Series, limit: int = 20):
    preview: list[TransformPreviewPoint] = []
    for idx in range(min(limit, len(after))):
        preview.append(
            TransformPreviewPoint(
                before=None if before is None else _safe_float(before.iloc[idx]),
                after=_safe_float(after.iloc[idx]),
            )
        )
    return preview


def _safe_float(value):
    try:
        if value is None or (isinstance(value, float) and np.isnan(value)):
            return None
        return float(value)
    except Exception:
        return None


def _record_history(session: Session, dataset_id: str, variable_id: str, op: str, payload: dict):
    history = VariableHistory(
        id=str(uuid.uuid4()),
        dataset_id=dataset_id,
        variable_id=variable_id,
        op=op,
        params_json=json.dumps(payload),
    )
    session.add(history)


@router.post("/transform", response_model=TransformResponse)
def create_transformation(body: TransformRequest, session: Session = Depends(get_session)):
    ds = session.get(Dataset, body.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = _read_df(ds)

    new_name = body.new_name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="New variable name cannot be empty")
    if new_name in df.columns:
        raise HTTPException(status_code=400, detail="New variable name already exists")

    op = body.op
    series = None

    if op == "lag":
        if not body.column or body.n is None:
            raise HTTPException(status_code=400, detail="column and n required for lag")
        if body.column not in df.columns:
            raise HTTPException(status_code=400, detail="column not found")
        series = df[body.column].shift(int(body.n))
    elif op == "decay":
        if not body.column or body.alpha is None:
            raise HTTPException(status_code=400, detail="column and alpha required for decay")
        if not (0 <= float(body.alpha) < 1):
            raise HTTPException(status_code=400, detail="alpha must be in [0,1)")
        if body.column not in df.columns:
            raise HTTPException(status_code=400, detail="column not found")
        alpha = float(body.alpha)
        vals = pd.to_numeric(df[body.column], errors="coerce").fillna(0.0).to_numpy(dtype=float)
        out = np.empty_like(vals)
        if len(vals) > 0:
            out[0] = vals[0]
            for i in range(1, len(vals)):
                out[i] = vals[i] + alpha * out[i - 1]
        series = pd.Series(out, index=df.index)
    elif op == "log":
        if not body.column:
            raise HTTPException(status_code=400, detail="column required for log")
        if body.column not in df.columns:
            raise HTTPException(status_code=400, detail="column not found")
        vals = pd.to_numeric(df[body.column], errors="coerce")
        series = pd.Series(np.where(vals > 0, np.log(vals), np.nan), index=df.index)
    elif op in {"add", "sub", "mul", "div"}:
        if not body.left or not body.right:
            raise HTTPException(status_code=400, detail="left and right required for arithmetic")
        if body.left not in df.columns or body.right not in df.columns:
            raise HTTPException(status_code=400, detail="operand column not found")
        if op == "add":
            series = df[body.left] + df[body.right]
        elif op == "sub":
            series = df[body.left] - df[body.right]
        elif op == "mul":
            series = df[body.left] * df[body.right]
        else:
            series = df[body.left] / df[body.right]
    else:
        raise HTTPException(status_code=400, detail="Unsupported operation")

    df[new_name] = series
    _write_df(ds, df)

    cols = [{"name": str(c), "dtype": str(dt)} for c, dt in df.dtypes.items()]
    ds.columns_json = json.dumps(cols)
    ds.n_cols = int(df.shape[1])
    session.add(ds)

    spec = body.model_dump()
    var = Variable(
        id=str(uuid.uuid4()),
        dataset_id=ds.id,
        name=new_name,
        dtype=str(df[new_name].dtype),
        is_derived=True,
        source_spec_json=json.dumps(spec),
    )
    session.add(var)
    _record_history(session, ds.id, var.id, body.op, spec)
    session.commit()

    vars_for_maps = session.exec(select(Variable).where(Variable.dataset_id == ds.id)).all()
    g_map, sg_map = _maps_for_variables(session, vars_for_maps)

    preview_source = None
    if body.column and body.column in df.columns:
        preview_source = pd.to_numeric(df[body.column], errors="coerce")
    elif body.left and body.left in df.columns:
        preview_source = pd.to_numeric(df[body.left], errors="coerce")
    preview = _transformation_preview(preview_source, df[new_name])

    return TransformResponse(variable=_variable_to_out(var, g_map, sg_map), preview=preview)


@router.patch("/{variable_id}/categorization", response_model=VariableOut)
def categorize_variable(variable_id: str, body: CategorizeRequest, session: Session = Depends(get_session)):
    var = session.get(Variable, variable_id)
    if not var:
        raise HTTPException(status_code=404, detail="Variable not found")
    ds = session.get(Dataset, var.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    group = session.get(Group, body.group_id) if body.group_id else None
    subgroup = session.get(Subgroup, body.subgroup_id) if body.subgroup_id else None

    if subgroup and group and subgroup.group_id != group.id:
        raise HTTPException(status_code=400, detail="Subgroup does not belong to selected group")
    if subgroup and not group:
        group = session.get(Group, subgroup.group_id)
    if body.group_id and not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if body.subgroup_id and not subgroup:
        raise HTTPException(status_code=404, detail="Subgroup not found")

    var.group_id = group.id if group else None
    var.subgroup_id = subgroup.id if subgroup else None
    session.add(var)
    session.commit()

    vars_for_maps = session.exec(select(Variable).where(Variable.dataset_id == ds.id)).all()
    g_map, sg_map = _maps_for_variables(session, vars_for_maps)
    return _variable_to_out(var, g_map, sg_map)


@router.get("/{variable_id}/history", response_model=list[VariableHistoryItem])
def variable_history(variable_id: str, session: Session = Depends(get_session)):
    var = session.get(Variable, variable_id)
    if not var:
        raise HTTPException(status_code=404, detail="Variable not found")
    history = session.exec(
        select(VariableHistory).where(VariableHistory.variable_id == variable_id).order_by(VariableHistory.created_at.desc())
    ).all()
    return [
        VariableHistoryItem(
            id=h.id,
            op=h.op,
            params=json.loads(h.params_json),
            created_at=h.created_at,
        )
        for h in history
    ]


@router.post("/{variable_id}/undo")
def undo_variable(variable_id: str, session: Session = Depends(get_session)):
    var = session.get(Variable, variable_id)
    if not var:
        raise HTTPException(status_code=404, detail="Variable not found")
    if not var.is_derived:
        raise HTTPException(status_code=400, detail="Only derived variables can be undone")
    ds = session.get(Dataset, var.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dependents = session.exec(
        select(Variable).where(
            (Variable.dataset_id == ds.id)
            & (Variable.id != var.id)
            & (Variable.source_spec_json.is_not(None))
        )
    ).all()
    for dep in dependents:
        spec = json.loads(dep.source_spec_json)
        referenced = {spec.get("column"), spec.get("left"), spec.get("right")}
        if var.name in referenced:
            raise HTTPException(status_code=400, detail=f"Variable is referenced by {dep.name}. Undo dependent transforms first.")

    df = _read_df(ds)
    if var.name not in df.columns:
        raise HTTPException(status_code=400, detail="Column not found in dataset file")

    df = df.drop(columns=[var.name])
    _write_df(ds, df)
    cols = [{"name": str(c), "dtype": str(dt)} for c, dt in df.dtypes.items()]
    ds.columns_json = json.dumps(cols)
    ds.n_cols = int(df.shape[1])
    session.add(ds)

    session.exec(delete(VariableHistory).where(VariableHistory.variable_id == var.id))
    session.delete(var)
    session.commit()
    return {"status": "reverted"}
