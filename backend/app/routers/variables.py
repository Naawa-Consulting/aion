from __future__ import annotations

import json
import uuid
from pathlib import Path

import pandas as pd
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..db import get_session
from ..models import Dataset, Variable, VariableGroup, Subgroup, Group
from ..schemas import TransformRequest, VariableOut


router = APIRouter()


def _read_df(ds: Dataset) -> pd.DataFrame:
    p = Path(ds.path)
    if not p.exists():
        raise HTTPException(status_code=500, detail="Dataset file missing")
    try:
        return pd.read_parquet(p)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed reading parquet: {e}")


def _write_df(ds: Dataset, df: pd.DataFrame):
    p = Path(ds.path)
    try:
        df.to_parquet(p, index=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed writing parquet: {e}")


@router.get("", response_model=list[VariableOut])
def list_variables(dataset_id: str = Query(...), session: Session = Depends(get_session)):
    ds = session.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Ensure base variables are recorded
    df = _read_df(ds)
    vars_ = session.exec(select(Variable).where(Variable.dataset_id == dataset_id)).all()
    existing_names = {v.name for v in vars_}
    for col in df.columns:
        if col not in existing_names:
            v = Variable(id=str(uuid.uuid4()), dataset_id=dataset_id, name=str(col), dtype=str(df[col].dtype), is_derived=False)
            session.add(v)
            vars_.append(v)
    session.commit()
    # Build mapping for group assignments
    vg_list = session.exec(select(VariableGroup).where(VariableGroup.dataset_id == dataset_id)).all()
    subgroup_ids = {vg.subgroup_id for vg in vg_list}
    subgroups = []
    groups = []
    if subgroup_ids:
        subgroups = session.exec(select(Subgroup).where(Subgroup.id.in_(list(subgroup_ids)))).all()
        group_ids = {sg.group_id for sg in subgroups}
        if group_ids:
            groups = session.exec(select(Group).where(Group.id.in_(list(group_ids)))).all()
    sg_map = {sg.id: sg for sg in subgroups}
    g_map = {g.id: g for g in groups}
    assign_map = {(vg.variable_name): vg.subgroup_id for vg in vg_list}

    out: list[VariableOut] = []
    for v in vars_:
        sg_id = assign_map.get(v.name)
        sg = sg_map.get(sg_id) if sg_id else None
        g = g_map.get(sg.group_id) if sg else None
        out.append(
            VariableOut(
                id=v.id,
                dataset_id=v.dataset_id,
                name=v.name,
                dtype=v.dtype,
                is_derived=v.is_derived,
                subgroup_id=sg.id if sg else None,
                subgroup_name=sg.name if sg else None,
                group_id=g.id if g else None,
                group_name=g.name if g else None,
            )
        )
    return out


@router.post("/transform", response_model=VariableOut)
def create_transformation(body: TransformRequest, session: Session = Depends(get_session)):
    ds = session.get(Dataset, body.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = _read_df(ds)

    new_name = body.new_name
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
        # y_i = x_i + alpha * y_{i-1}, with y_0 = x_0
        alpha = float(body.alpha)
        vals = pd.to_numeric(df[body.column], errors='coerce').fillna(0.0).to_numpy(dtype=float)
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
        # Avoid log of non-positive by NaN, coerce to numeric
        vals = pd.to_numeric(df[body.column], errors='coerce')
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
        else:  # div
            series = df[body.left] / df[body.right]
    else:
        raise HTTPException(status_code=400, detail="Unsupported operation")

    df[new_name] = series
    _write_df(ds, df)

    # Update dataset metadata
    cols = [{"name": str(c), "dtype": str(dt)} for c, dt in df.dtypes.items()]
    ds.columns_json = json.dumps(cols)
    ds.n_cols = int(df.shape[1])
    session.add(ds)

    var = Variable(
        id=str(uuid.uuid4()),
        dataset_id=ds.id,
        name=new_name,
        dtype=str(df[new_name].dtype),
        is_derived=True,
        source_spec_json=json.dumps(body.model_dump()),
    )
    session.add(var)
    session.commit()

    return VariableOut(
        id=var.id,
        dataset_id=var.dataset_id,
        name=var.name,
        dtype=var.dtype,
        is_derived=True,
        subgroup_id=None,
        subgroup_name=None,
        group_id=None,
        group_name=None,
    )
