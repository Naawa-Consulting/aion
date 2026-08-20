from __future__ import annotations

import io
import json
import uuid
from typing import Iterable

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, delete

from ..auth import CurrentMembership, get_current_membership, require_write_access
from ..db import get_session
from ..errors import api_error
from ..models import Dataset, Variable, VariableHistory, Subgroup, Group
from ..services.media_transform import adstock_geometric, hill_saturation
from ..tenancy import get_scoped
from ..utils.datasets import load_dataset_frame
from ..utils.storage import get_storage
from ..schemas import (
    TransformRequest,
    TransformResponse,
    TransformPreviewPoint,
    TransformPreviewRequest,
    VariableOut,
    CategorizeRequest,
    BulkCategorizeRequest,
    VariableHistoryItem,
)


router = APIRouter()


def _read_df(ds: Dataset) -> pd.DataFrame:
    try:
        return load_dataset_frame(ds)
    except ValueError as exc:
        raise api_error(400, "DATASET_LOAD_ERROR", str(exc))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed reading dataset: {e}")


def _write_df(ds: Dataset, df: pd.DataFrame) -> None:
    try:
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        get_storage().write_bytes(ds.storage_key, buf.getvalue())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed writing parquet: {e}")


def _sync_variables_with_dataset(session: Session, ds: Dataset, df: pd.DataFrame) -> list[Variable]:
    vars_ = session.exec(
        select(Variable).where(Variable.dataset_id == ds.id, Variable.company_id == ds.company_id)
    ).all()
    existing = {v.name for v in vars_}
    created = False
    for col in df.columns:
        if col not in existing:
            v = Variable(
                id=str(uuid.uuid4()),
                company_id=ds.company_id,
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


def _maps_for_variables(session: Session, vars_: Iterable[Variable], company_id: str):
    group_ids = {v.group_id for v in vars_ if v.group_id}
    subgroup_ids = {v.subgroup_id for v in vars_ if v.subgroup_id}
    groups = (
        session.exec(
            select(Group).where(Group.id.in_(list(group_ids)), Group.company_id == company_id)
        ).all()
        if group_ids
        else []
    )
    subgroups = (
        session.exec(
            select(Subgroup).where(Subgroup.id.in_(list(subgroup_ids)), Subgroup.company_id == company_id)
        ).all()
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
        is_excluded=var.is_excluded,
        display_name=var.display_name,
        unit=var.unit,
        created_at=var.created_at,
    )


@router.get("", response_model=list[VariableOut])
def list_variables(
    dataset_id: str = Query(...),
    search: str | None = Query(None),
    dtype: str | None = Query(None),
    derived: bool | None = Query(None),
    include_excluded: bool = Query(False, description="Include variables hidden via is_excluded"),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)

    df = _read_df(ds)
    vars_ = _sync_variables_with_dataset(session, ds, df)

    results = vars_
    if not include_excluded:
        results = [v for v in results if not v.is_excluded]
    if derived is not None:
        results = [v for v in results if v.is_derived == derived]
    if search:
        term = search.lower()
        results = [v for v in results if term in v.name.lower()]
    if dtype:
        dt = dtype.lower()
        results = [v for v in results if dt in v.dtype.lower()]

    g_map, sg_map = _maps_for_variables(session, vars_, membership.company_id)
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


def _time_order(df: pd.DataFrame, ds: Dataset) -> pd.Series:
    """0-based chronological rank of each row, aligned by df's index (not row position) so
    generators (trend/fourier) line up correctly even when storage order isn't already
    sorted by time. Falls back to row order when the dataset has no time_variable set."""
    time_col = getattr(ds, "time_variable", None)
    if time_col and time_col in df.columns:
        times = pd.to_datetime(df[time_col], errors="coerce")
        return times.rank(method="first").sub(1).astype(float)
    return pd.Series(np.arange(len(df), dtype=float), index=df.index)


def _record_history(session: Session, company_id: str, dataset_id: str, variable_id: str, op: str, payload: dict):
    history = VariableHistory(
        id=str(uuid.uuid4()),
        company_id=company_id,
        dataset_id=dataset_id,
        variable_id=variable_id,
        op=op,
        params_json=json.dumps(payload),
    )
    session.add(history)


@router.post("/transform", response_model=TransformResponse)
def create_transformation(
    body: TransformRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, body.dataset_id, membership.company_id)

    df = _read_df(ds)

    new_name = body.new_name.strip()
    if not new_name:
        raise api_error(400, "VARIABLE_NAME_EMPTY", "New variable name cannot be empty")
    if new_name in df.columns:
        raise api_error(400, "VARIABLE_NAME_CONFLICT", "New variable name already exists")

    op = body.op
    series = None

    if op == "lag":
        if not body.column or body.n is None:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "column and n required for lag")
        if body.column not in df.columns:
            raise api_error(400, "COLUMN_NOT_FOUND", "column not found")
        series = df[body.column].shift(int(body.n))
    elif op == "decay":
        if not body.column or body.alpha is None:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "column and alpha required for decay")
        if not (0 <= float(body.alpha) < 1):
            raise api_error(400, "INVALID_RATE_RANGE", "alpha must be in [0,1)")
        if body.column not in df.columns:
            raise api_error(400, "COLUMN_NOT_FOUND", "column not found")
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
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "column required for log")
        if body.column not in df.columns:
            raise api_error(400, "COLUMN_NOT_FOUND", "column not found")
        vals = pd.to_numeric(df[body.column], errors="coerce")
        series = pd.Series(np.where(vals > 0, np.log(vals), np.nan), index=df.index)
    elif op in {"add", "sub", "mul", "div"}:
        if not body.left or not body.right:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "left and right required for arithmetic")
        if body.left not in df.columns or body.right not in df.columns:
            raise api_error(400, "COLUMN_NOT_FOUND", "operand column not found")
        if op == "add":
            series = df[body.left] + df[body.right]
        elif op == "sub":
            series = df[body.left] - df[body.right]
        elif op == "mul":
            series = df[body.left] * df[body.right]
        else:
            series = df[body.left] / df[body.right]
    elif op == "hill":
        if not body.column or body.k is None or body.s is None:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "column, k and s required for hill")
        if body.column not in df.columns:
            raise api_error(400, "COLUMN_NOT_FOUND", "column not found")
        vals = pd.to_numeric(df[body.column], errors="coerce").fillna(0.0).to_numpy(dtype=float)
        series = pd.Series(hill_saturation(vals, float(body.k), float(body.s)), index=df.index)
    elif op == "adstock":
        if not body.column or body.decay is None:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "column and decay required for adstock")
        if not (0 <= float(body.decay) < 1):
            raise api_error(400, "INVALID_RATE_RANGE", "decay must be in [0,1)")
        if body.column not in df.columns:
            raise api_error(400, "COLUMN_NOT_FOUND", "column not found")
        lag = int(body.lag or 0)
        if lag < 0:
            raise api_error(400, "INVALID_PERIODS", "lag must be positive")
        vals = pd.to_numeric(df[body.column], errors="coerce").fillna(0.0).to_numpy(dtype=float)
        if lag > 0:
            vals = np.concatenate([np.zeros(lag), vals[:-lag]]) if lag < vals.size else np.zeros_like(vals)
        series = pd.Series(adstock_geometric(vals, float(body.decay)), index=df.index)
    elif op == "constant":
        if body.value is None:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "value required for constant")
        series = pd.Series(float(body.value), index=df.index)
    elif op == "date_dummy":
        time_col = getattr(ds, "time_variable", None)
        if not time_col or time_col not in df.columns:
            raise api_error(400, "TIME_VARIABLE_REQUIRED", "Dataset must have a time variable set")
        if not body.start_date or not body.end_date:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "start_date and end_date required for date_dummy")
        times = pd.to_datetime(df[time_col], errors="coerce")
        start = pd.to_datetime(body.start_date)
        end = pd.to_datetime(body.end_date)
        series = ((times >= start) & (times <= end)).astype(int)
    elif op == "trend":
        series = _time_order(df, ds)
    elif op == "fourier":
        if not body.period:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "period required for fourier")
        harmonic = int(body.harmonic or 1)
        trig = (body.trig or "sin").lower()
        order = _time_order(df, ds)
        angle = 2 * np.pi * harmonic * order / float(body.period)
        series = pd.Series(np.sin(angle) if trig == "sin" else np.cos(angle), index=df.index)
    else:
        raise api_error(400, "UNSUPPORTED_OPERATION", "Unsupported operation")

    df[new_name] = series
    _write_df(ds, df)

    cols = [{"name": str(c), "dtype": str(dt)} for c, dt in df.dtypes.items()]
    ds.columns_json = json.dumps(cols)
    ds.n_cols = int(df.shape[1])
    session.add(ds)

    spec = body.model_dump()
    var = Variable(
        id=str(uuid.uuid4()),
        company_id=membership.company_id,
        dataset_id=ds.id,
        name=new_name,
        dtype=str(df[new_name].dtype),
        is_derived=True,
        source_spec_json=json.dumps(spec),
    )
    session.add(var)
    _record_history(session, membership.company_id, ds.id, var.id, body.op, spec)
    session.commit()

    vars_for_maps = session.exec(
        select(Variable).where(Variable.dataset_id == ds.id, Variable.company_id == membership.company_id)
    ).all()
    g_map, sg_map = _maps_for_variables(session, vars_for_maps, membership.company_id)

    preview_source = None
    if body.column and body.column in df.columns:
        preview_source = pd.to_numeric(df[body.column], errors="coerce")
    elif body.left and body.left in df.columns:
        preview_source = pd.to_numeric(df[body.left], errors="coerce")
    preview = _transformation_preview(preview_source, df[new_name])

    return TransformResponse(variable=_variable_to_out(var, g_map, sg_map), preview=preview)


@router.patch("/{variable_id}/categorization", response_model=VariableOut)
def categorize_variable(
    variable_id: str,
    body: CategorizeRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    var = get_scoped(session, Variable, variable_id, membership.company_id)
    ds = get_scoped(session, Dataset, var.dataset_id, membership.company_id)

    # group_id/subgroup_id are only touched when the caller actually included the key in the
    # request body (even as null, to explicitly clear) — distinguished via model_fields_set, not
    # by truthiness, so a request that only sets is_excluded (e.g. from Datasets' hide toggle,
    # which has no group/subgroup context at all) never silently wipes the existing category.
    if "group_id" in body.model_fields_set or "subgroup_id" in body.model_fields_set:
        group = get_scoped(session, Group, body.group_id, membership.company_id) if body.group_id else None
        subgroup = get_scoped(session, Subgroup, body.subgroup_id, membership.company_id) if body.subgroup_id else None

        if subgroup and group and subgroup.group_id != group.id:
            raise api_error(400, "SUBGROUP_GROUP_MISMATCH", "Subgroup does not belong to selected group")
        if subgroup and not group:
            group = get_scoped(session, Group, subgroup.group_id, membership.company_id)

        var.group_id = group.id if group else None
        var.subgroup_id = subgroup.id if subgroup else None
    if body.is_excluded is not None:
        var.is_excluded = body.is_excluded
    if "display_name" in body.model_fields_set:
        var.display_name = body.display_name or None
    if "unit" in body.model_fields_set:
        var.unit = body.unit or None
    session.add(var)
    session.commit()

    vars_for_maps = session.exec(
        select(Variable).where(Variable.dataset_id == ds.id, Variable.company_id == membership.company_id)
    ).all()
    g_map, sg_map = _maps_for_variables(session, vars_for_maps, membership.company_id)
    return _variable_to_out(var, g_map, sg_map)


@router.patch("/bulk-categorize", response_model=list[VariableOut])
def bulk_categorize_variables(
    body: BulkCategorizeRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    if not body.variable_ids:
        raise api_error(400, "VARIABLE_IDS_EMPTY", "variable_ids cannot be empty")

    touches_group = "group_id" in body.model_fields_set or "subgroup_id" in body.model_fields_set
    group = get_scoped(session, Group, body.group_id, membership.company_id) if body.group_id else None
    subgroup = get_scoped(session, Subgroup, body.subgroup_id, membership.company_id) if body.subgroup_id else None
    if subgroup and group and subgroup.group_id != group.id:
        raise api_error(400, "SUBGROUP_GROUP_MISMATCH", "Subgroup does not belong to selected group")
    if subgroup and not group:
        group = get_scoped(session, Group, subgroup.group_id, membership.company_id)

    variables = [get_scoped(session, Variable, vid, membership.company_id) for vid in body.variable_ids]
    for var in variables:
        if touches_group:
            var.group_id = group.id if group else None
            var.subgroup_id = subgroup.id if subgroup else None
        if body.is_excluded is not None:
            var.is_excluded = body.is_excluded
        if "display_name" in body.model_fields_set:
            var.display_name = body.display_name or None
        if "unit" in body.model_fields_set:
            var.unit = body.unit or None
        session.add(var)
    session.commit()

    dataset_ids = {var.dataset_id for var in variables}
    g_map: dict = {}
    sg_map: dict = {}
    for ds_id in dataset_ids:
        vars_for_maps = session.exec(
            select(Variable).where(Variable.dataset_id == ds_id, Variable.company_id == membership.company_id)
        ).all()
        gm, sgm = _maps_for_variables(session, vars_for_maps, membership.company_id)
        g_map.update(gm)
        sg_map.update(sgm)
    return [_variable_to_out(var, g_map, sg_map) for var in variables]


@router.get("/{variable_id}/history", response_model=list[VariableHistoryItem])
def variable_history(
    variable_id: str,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    var = get_scoped(session, Variable, variable_id, membership.company_id)
    history = session.exec(
        select(VariableHistory)
        .where(VariableHistory.variable_id == var.id, VariableHistory.company_id == membership.company_id)
        .order_by(VariableHistory.created_at.desc())
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
def undo_variable(
    variable_id: str,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    var = get_scoped(session, Variable, variable_id, membership.company_id)
    if not var.is_derived:
        raise api_error(400, "ONLY_DERIVED_CAN_UNDO", "Only derived variables can be undone")
    ds = get_scoped(session, Dataset, var.dataset_id, membership.company_id)

    dependents = session.exec(
        select(Variable).where(
            (Variable.dataset_id == ds.id)
            & (Variable.company_id == membership.company_id)
            & (Variable.id != var.id)
            & (Variable.source_spec_json.is_not(None))
        )
    ).all()
    for dep in dependents:
        spec = json.loads(dep.source_spec_json)
        referenced = {spec.get("column"), spec.get("left"), spec.get("right")}
        if var.name in referenced:
            raise api_error(
                400,
                "VARIABLE_REFERENCED_BY_DERIVED",
                f"Variable is referenced by {dep.name}. Undo dependent transforms first.",
                referenced_by=dep.name,
            )

    df = _read_df(ds)
    if var.name not in df.columns:
        raise api_error(400, "COLUMN_NOT_FOUND", "Column not found in dataset file")

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


@router.post("/transform/preview")
def preview_transformation(
    body: TransformPreviewRequest,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, body.dataset_id, membership.company_id)
    df = _read_df(ds)

    params = body.params or {}

    op = body.operation.lower()
    column = body.column or params.get("column")
    series: pd.Series | None = None
    if op in {"lag", "decay", "log", "hill", "adstock"}:
        if not column or column not in df.columns:
            raise api_error(400, "COLUMN_NOT_FOUND", "column not found")
        series = pd.to_numeric(df[column], errors="coerce")
        if series.isna().all():
            raise api_error(400, "COLUMN_NOT_NUMERIC", "Column has no numeric values")

    result: pd.Series | None = None
    if op == "lag":
        periods = int(params.get("periods") or params.get("n") or 1)
        if periods < 0:
            raise api_error(400, "INVALID_PERIODS", "periods must be positive")
        result = series.shift(periods)
    elif op == "decay":
        alpha_value = params.get("alpha") or params.get("half_life")
        if alpha_value is None:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "alpha parameter required for decay")
        alpha = float(alpha_value)
        if not (0 <= alpha < 1):
            raise api_error(400, "INVALID_RATE_RANGE", "alpha must be in [0,1)")
        vals = series.fillna(0.0).to_numpy()
        out = np.empty_like(vals)
        if len(vals) > 0:
            out[0] = vals[0]
            for i in range(1, len(vals)):
                out[i] = vals[i] + alpha * out[i - 1]
        result = pd.Series(out, index=series.index)
    elif op == "log":
        result = pd.Series(np.log(series.replace({0: np.nan})), index=series.index)
    elif op in {"add", "sub", "mul", "div"}:
        left = params.get("left")
        right = params.get("right")
        if not left or not right or left not in df.columns or right not in df.columns:
            raise api_error(400, "COLUMN_NOT_FOUND", "left/right columns required")
        left_vals = pd.to_numeric(df[left], errors="coerce")
        right_vals = pd.to_numeric(df[right], errors="coerce")
        if op == "add":
            result = left_vals + right_vals
        elif op == "sub":
            result = left_vals - right_vals
        elif op == "mul":
            result = left_vals * right_vals
        else:
            result = left_vals / right_vals.replace({0: np.nan})
    elif op == "hill":
        k_value = params.get("k")
        s_value = params.get("s")
        if k_value is None or s_value is None:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "k and s parameters required for hill")
        vals = series.fillna(0.0).to_numpy()
        result = pd.Series(hill_saturation(vals, float(k_value), float(s_value)), index=series.index)
    elif op == "adstock":
        decay_value = params.get("decay")
        if decay_value is None:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "decay parameter required for adstock")
        decay = float(decay_value)
        if not (0 <= decay < 1):
            raise api_error(400, "INVALID_RATE_RANGE", "decay must be in [0,1)")
        lag = int(params.get("lag") or 0)
        if lag < 0:
            raise api_error(400, "INVALID_PERIODS", "lag must be positive")
        vals = series.fillna(0.0).to_numpy()
        if lag > 0:
            vals = np.concatenate([np.zeros(lag), vals[:-lag]]) if lag < vals.size else np.zeros_like(vals)
        result = pd.Series(adstock_geometric(vals, decay), index=df.index)
    elif op == "constant":
        value = params.get("value")
        if value is None:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "value required for constant")
        result = pd.Series(float(value), index=df.index)
    elif op == "date_dummy":
        time_col = getattr(ds, "time_variable", None)
        if not time_col or time_col not in df.columns:
            raise api_error(400, "TIME_VARIABLE_REQUIRED", "Dataset must have a time variable set")
        start_date = params.get("start_date")
        end_date = params.get("end_date")
        if not start_date or not end_date:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "start_date and end_date required for date_dummy")
        times = pd.to_datetime(df[time_col], errors="coerce")
        start = pd.to_datetime(start_date)
        end = pd.to_datetime(end_date)
        result = ((times >= start) & (times <= end)).astype(int)
    elif op == "trend":
        result = _time_order(df, ds)
    elif op == "fourier":
        period = params.get("period")
        if not period:
            raise api_error(400, "TRANSFORM_PARAM_REQUIRED", "period required for fourier")
        harmonic = int(params.get("harmonic") or 1)
        trig = str(params.get("trig") or "sin").lower()
        order = _time_order(df, ds)
        angle = 2 * np.pi * harmonic * order / float(period)
        result = pd.Series(np.sin(angle) if trig == "sin" else np.cos(angle), index=df.index)
    else:
        raise api_error(400, "UNSUPPORTED_OPERATION", "Unsupported operation")

    if result is None:
        raise api_error(400, "PREVIEW_COMPUTE_FAILED", "Unable to compute preview")

    dependent_col = getattr(ds, "dependent_variable", None)
    dependent_series = (
        pd.to_numeric(df[dependent_col], errors="coerce")
        if dependent_col and dependent_col in df.columns and dependent_col != column
        else None
    )

    limit = min(max(body.limit, 1), 1000)
    time_col = getattr(ds, "time_variable", None)
    frame = {"transformed": result}
    if series is not None:
        frame["original"] = series
    if dependent_series is not None:
        frame["dependent"] = dependent_series
    if time_col and time_col in df.columns:
        frame["time"] = pd.to_datetime(df[time_col], errors="coerce")
        combined = pd.DataFrame(frame).sort_values("time").head(limit)
        time_values = combined["time"].ffill().bfill().astype(str).tolist()
    else:
        combined = pd.DataFrame(frame).head(limit)
        time_values = list(range(len(combined)))
    transformed_values = combined["transformed"].tolist()
    original_values = combined["original"].tolist() if "original" in combined.columns else None
    dependent_values = combined["dependent"].tolist() if "dependent" in combined.columns else None

    transformed_series_s = pd.Series(transformed_values, dtype="float64")
    transformed_mean = transformed_series_s.dropna().mean()
    stats: dict = {"mean_transformed": 0.0 if pd.isna(transformed_mean) else float(transformed_mean)}

    original_series_s = None
    if original_values is not None:
        original_series_s = pd.Series(original_values, dtype="float64")
        original_mean = original_series_s.dropna().mean()
        stats["mean_original"] = 0.0 if pd.isna(original_mean) else float(original_mean)
        corr = original_series_s.corr(transformed_series_s)
        stats["correlation"] = 0.0 if pd.isna(corr) else float(corr)

    if dependent_values is not None:
        dependent_series_s = pd.Series(dependent_values, dtype="float64")
        corr_after = transformed_series_s.corr(dependent_series_s)
        stats["correlation_dependent_after"] = None if pd.isna(corr_after) else float(corr_after)
        corr_before = None
        if original_series_s is not None:
            corr_before_val = original_series_s.corr(dependent_series_s)
            corr_before = None if pd.isna(corr_before_val) else float(corr_before_val)
        stats["correlation_dependent_before"] = corr_before

    return {
        "time": time_values,
        "original": [None if pd.isna(x) else float(x) for x in original_values] if original_values is not None else None,
        "transformed": [None if pd.isna(x) else float(x) for x in transformed_values],
        "dependent": [None if pd.isna(x) else float(x) for x in dependent_values] if dependent_values is not None else None,
        "dependent_label": dependent_col if dependent_values is not None else None,
        "stats": stats,
    }
