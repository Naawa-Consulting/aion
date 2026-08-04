"""Shared design-matrix construction for OLS model fitting.

Single source of truth for turning (dataset, y_var, x_vars) into a fittable design matrix,
used by routers/models.py (create/update/stepwise/summary/predictions) and
routers/analysis.py (_fit_from_model). Media-flagged variables (per Group/Subgroup
`apply_media_transform`) get adstock + Hill saturation applied automatically, fitted via a
per-channel grid search (fixed *before* any variable selection, never re-sampled jointly with
the linear coefficients — see BITACORA for why). Control variables pass through raw.
"""
from __future__ import annotations

import itertools
import uuid
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
import statsmodels.api as sm
from sqlmodel import Session, select, delete

from ..models import Group, Model, ModelTransform, Subgroup, Variable
from .media_transform import apply_media_transform

DECAYS = (0.0, 0.2, 0.4, 0.6, 0.8)
SHAPES = (1.0, 2.0, 3.0)
LAGS = (0, 1, 2, 3, 4)
K_QUANTILES = (0.25, 0.5, 0.75)


@dataclass(frozen=True)
class MediaTransformParams:
    decay: float
    hill_k: float
    hill_s: float
    lag: int


def _partial_corr_sq(a: np.ndarray, b: np.ndarray) -> float:
    if np.std(a) == 0 or np.std(b) == 0:
        return -np.inf
    corr = np.corrcoef(a, b)[0, 1]
    if not np.isfinite(corr):
        return -np.inf
    return float(corr**2)


def search_media_hparams(x: np.ndarray, y_resid: np.ndarray) -> MediaTransformParams:
    """Per-channel grid search maximizing corr^2 between the transformed channel and the
    (control-residualized) target. Cheap: ~225 combinations, no repeated OLS refits."""
    x = np.asarray(x, dtype=float)
    y_resid = np.asarray(y_resid, dtype=float)
    nonzero = x[x > 0]
    if nonzero.size == 0:
        return MediaTransformParams(decay=0.0, hill_k=1.0, hill_s=1.0, lag=0)
    k_candidates = sorted({float(np.quantile(nonzero, q)) for q in K_QUANTILES})
    if not k_candidates:
        k_candidates = [float(np.mean(nonzero))]

    best_score = -np.inf
    best = MediaTransformParams(decay=0.0, hill_k=k_candidates[0], hill_s=1.0, lag=0)
    for decay, s, lag, k in itertools.product(DECAYS, SHAPES, LAGS, k_candidates):
        transformed = apply_media_transform(x, decay, k, s, lag)
        if not np.all(np.isfinite(transformed)) or np.std(transformed) == 0:
            continue
        score = _partial_corr_sq(transformed, y_resid)
        if score > best_score:
            best_score = score
            best = MediaTransformParams(decay=decay, hill_k=k, hill_s=s, lag=lag)
    return best


def build_design_matrix(
    df: pd.DataFrame,
    y_var: str,
    x_vars: list[str],
    media_flags: dict[str, bool],
    transform_params: Optional[dict[str, MediaTransformParams]] = None,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, MediaTransformParams]]:
    """Returns (work, X, used_params).

    `work` = numeric-cleaned raw frame (y_var + all x_vars, listwise-deleted), `X` = the
    design matrix actually used for OLS: media x_vars replaced by their adstock+Hill
    transform, control x_vars passed through raw. Both share the same index.

    If `transform_params` already has an entry for a media variable, it's reused as-is (no
    grid search) — this keeps refits (analysis/predict/summary) reproducible and cheap.
    Missing entries are grid-searched fresh (this is the only place the search runs).
    """
    if y_var not in df.columns:
        raise ValueError("y_var not found")
    if not x_vars:
        raise ValueError("At least one x_var is required")
    for x in x_vars:
        if x not in df.columns:
            raise ValueError(f"x_var not found: {x}")

    cols = [y_var] + x_vars
    work = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if work.shape[0] < len(cols) + 1:
        raise ValueError("Insufficient rows after cleaning for regression")

    media_vars = [x for x in x_vars if media_flags.get(x)]
    control_vars = [x for x in x_vars if not media_flags.get(x)]

    used_params: dict[str, MediaTransformParams] = dict(transform_params or {})

    y_resid = work[y_var].to_numpy(dtype=float)
    if control_vars:
        Xc = sm.add_constant(work[control_vars], has_constant="add")
        try:
            res = sm.OLS(y_resid, Xc).fit()
            y_resid = y_resid - res.predict(Xc)
        except Exception:
            pass  # fall back to raw y as the residualization target

    X = pd.DataFrame(index=work.index)
    for name in x_vars:
        if name in media_vars:
            raw = work[name].to_numpy(dtype=float)
            params = used_params.get(name)
            if params is None:
                params = search_media_hparams(raw, y_resid)
                used_params[name] = params
            X[name] = apply_media_transform(raw, params.decay, params.hill_k, params.hill_s, params.lag)
        else:
            used_params.pop(name, None)
            X[name] = work[name]

    return work, X, used_params


def resolve_media_flags(
    session: Session, dataset_id: str, company_id: str, x_vars: list[str]
) -> dict[str, bool]:
    """A variable is 'media' (adstock+Hill applies) if its Subgroup, or failing that its
    Group, has `apply_media_transform=True`. Unassigned variables are treated as control."""
    if not x_vars:
        return {}
    vars_ = session.exec(
        select(Variable).where(
            Variable.dataset_id == dataset_id,
            Variable.company_id == company_id,
            Variable.name.in_(x_vars),
        )
    ).all()
    var_by_name = {v.name: v for v in vars_}
    group_ids = {v.group_id for v in vars_ if v.group_id}
    subgroup_ids = {v.subgroup_id for v in vars_ if v.subgroup_id}
    groups = (
        {g.id: g for g in session.exec(select(Group).where(Group.id.in_(list(group_ids)), Group.company_id == company_id)).all()}
        if group_ids
        else {}
    )
    subgroups = (
        {sg.id: sg for sg in session.exec(select(Subgroup).where(Subgroup.id.in_(list(subgroup_ids)), Subgroup.company_id == company_id)).all()}
        if subgroup_ids
        else {}
    )
    flags: dict[str, bool] = {}
    for name in x_vars:
        v = var_by_name.get(name)
        if v is None:
            flags[name] = False
            continue
        sg = subgroups.get(v.subgroup_id) if v.subgroup_id else None
        if sg is not None:
            flags[name] = bool(sg.apply_media_transform)
            continue
        g = groups.get(v.group_id) if v.group_id else None
        flags[name] = bool(g.apply_media_transform) if g else False
    return flags


def load_transform_params(session: Session, model_id: str, company_id: str) -> dict[str, MediaTransformParams]:
    rows = session.exec(
        select(ModelTransform).where(ModelTransform.model_id == model_id, ModelTransform.company_id == company_id)
    ).all()
    return {
        r.variable_name: MediaTransformParams(decay=r.decay, hill_k=r.hill_k, hill_s=r.hill_s, lag=r.lag)
        for r in rows
    }


def store_transform_params(session: Session, model: Model, params: dict[str, MediaTransformParams]) -> None:
    session.exec(delete(ModelTransform).where(ModelTransform.model_id == model.id, ModelTransform.company_id == model.company_id))
    for name, p in params.items():
        session.add(
            ModelTransform(
                id=str(uuid.uuid4()),
                company_id=model.company_id,
                model_id=model.id,
                variable_name=name,
                decay=p.decay,
                hill_k=p.hill_k,
                hill_s=p.hill_s,
                lag=p.lag,
            )
        )
