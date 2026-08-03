from __future__ import annotations

import json
import uuid
from typing import List, Optional

import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, delete
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.stattools import durbin_watson

from ..auth import CurrentMembership, get_current_membership, require_write_access
from ..db import get_session
from ..models import Dataset, Model, ModelMetrics, Scenario, Variable, Group, Subgroup
from ..services.analysis import invalidate_cache_for_model
from ..tenancy import get_scoped
from ..utils.datasets import load_dataset_frame
from ..schemas import (
    CorrelationResponse,
    CorrelationItem,
    CreateModelRequest,
    UpdateModelRequest,
    ModelOut,
    ModelMetricsOut,
    ModelRoleRequest,
    ModelSummaryResponse,
    CoefficientItem,
    PredictionsResponse,
)


router = APIRouter()
ROLE_CHOICES = {"hero", "challenger1", "challenger2", "none"}


def _load_df(ds: Dataset) -> pd.DataFrame:
    try:
        return load_dataset_frame(ds)
    except Exception as e:
        if isinstance(e, ValueError):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {e}")


# Correlations endpoint already handles residual correlations (via optional model_id)
# and injects Module 2 group/subgroup metadata for each variable.
@router.get("/correlations", response_model=CorrelationResponse)
def correlations(
    dataset_id: str = Query(...),
    y: str = Query(...),
    model_id: Optional[str] = Query(default=None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)
    df = _load_df(ds)
    if y not in df.columns:
        raise HTTPException(status_code=400, detail="Dependent variable not in dataset")

    vars_data = session.exec(
        select(Variable).where(Variable.dataset_id == dataset_id, Variable.company_id == membership.company_id)
    ).all()
    group_ids = {v.group_id for v in vars_data if v.group_id}
    subgroup_ids = {v.subgroup_id for v in vars_data if v.subgroup_id}
    group_map = (
        {
            g.id: g.name
            for g in session.exec(
                select(Group).where(Group.id.in_(list(group_ids)), Group.company_id == membership.company_id)
            ).all()
        }
        if group_ids
        else {}
    )
    subgroup_map = (
        {
            sg.id: sg
            for sg in session.exec(
                select(Subgroup).where(
                    Subgroup.id.in_(list(subgroup_ids)), Subgroup.company_id == membership.company_id
                )
            ).all()
        }
        if subgroup_ids
        else {}
    )
    var_group_meta: dict[str, dict[str, Optional[str]]] = {}
    for var in vars_data:
        sg = subgroup_map.get(var.subgroup_id) if var.subgroup_id else None
        group_name = group_map.get(var.group_id)
        if not group_name and sg:
            group_name = group_map.get(sg.group_id)
        var_group_meta[var.name] = {
            "group": group_name,
            "subgroup": sg.name if sg else None,
        }

    numeric_df = df.select_dtypes(include=[np.number])
    if y not in numeric_df.columns:
        raise HTTPException(status_code=400, detail="Dependent variable must be numeric")

    derived_lookup = {var.name: var.is_derived for var in vars_data}

    residual_series: Optional[pd.Series] = None
    if model_id:
        model = get_scoped(session, Model, model_id, membership.company_id)
        if model.dataset_id != dataset_id:
            raise HTTPException(status_code=400, detail="Model does not belong to this dataset")
        if model.y_var != y:
            raise HTTPException(status_code=400, detail="Model target does not match requested y")
        x_vars = json.loads(model.x_vars_json)
        work, y_arr, X = _prepare_training_frame(df, model.y_var, x_vars)
        X_const = sm.add_constant(X, has_constant="add")
        result = sm.OLS(y_arr, X_const).fit()
        y_series = pd.Series(y_arr, index=work.index)
        residual_series = pd.Series(y_arr - result.predict(X_const), index=work.index)
        numeric_df = numeric_df.loc[work.index]
    else:
        y_series = numeric_df[y].dropna()
        numeric_df = numeric_df.loc[y_series.index]

    def safe_corr(a: pd.Series, b: pd.Series) -> Optional[float]:
        joined = pd.concat([a, b], axis=1).dropna()
        if joined.shape[0] < 2:
            return None
        val = joined.iloc[:, 0].corr(joined.iloc[:, 1])
        if pd.isna(val):
            return None
        return float(val)

    corr_items: list[CorrelationItem] = []
    for col in numeric_df.columns:
        if col == y:
            continue
        series = pd.to_numeric(numeric_df[col], errors="coerce")
        corr_y = safe_corr(series, y_series)
        corr_res = safe_corr(series, residual_series) if residual_series is not None else None
        corr_items.append(
            CorrelationItem(
                name=col,
                corr_y=corr_y,
                corr_res=corr_res,
                dtype=str(df[col].dtype),
                derived=derived_lookup.get(col, False),
                group_name=var_group_meta.get(col, {}).get("group"),
                subgroup_name=var_group_meta.get(col, {}).get("subgroup"),
            )
        )

    corr_items.sort(key=lambda i: abs(i.corr_y or 0.0), reverse=True)
    return CorrelationResponse(y=y, items=corr_items)


def _prepare_training_frame(df: pd.DataFrame, y_var: str, x_vars: list[str]):
    if y_var not in df.columns:
        raise HTTPException(status_code=400, detail="y_var not found")
    if not x_vars:
        raise HTTPException(status_code=400, detail="At least one x_var is required")
    for x in x_vars:
        if x not in df.columns:
            raise HTTPException(status_code=400, detail=f"x_var not found: {x}")
    cols = [y_var] + x_vars
    work = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if work.shape[0] < len(cols) + 1:
        raise HTTPException(status_code=400, detail="Insufficient rows after cleaning for regression")
    y = work[y_var].to_numpy()
    X = work[x_vars]
    return work, y, X


def _compute_metrics(y: np.ndarray, y_hat: np.ndarray, X: pd.DataFrame) -> dict:
    n = len(y)
    p = X.shape[1]
    resid = y - y_hat
    ss_res = float(np.sum(resid ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    adj_r2 = 1 - (1 - r2) * (n - 1) / (n - p - 1) if n > p + 1 else r2
    mae = float(np.mean(np.abs(resid)))
    rmse = float(np.sqrt(np.mean(resid ** 2)))
    with np.errstate(divide='ignore', invalid='ignore'):
        ape = np.abs(resid / y)
        ape = ape[np.isfinite(ape)]
    mape = float(np.mean(ape) * 100.0) if ape.size > 0 else None

    X_const = sm.add_constant(X, has_constant='add')
    vif_vals = []
    for i, name in enumerate(X_const.columns):
        if name == 'const':
            continue
        try:
            value = float(variance_inflation_factor(X_const.values, i))
            if not np.isfinite(value):
                value = None
        except Exception:
            value = None
        vif_vals.append({"name": name, "vif": value})

    dw = float(durbin_watson(resid))
    return {
        "r2": r2,
        "adj_r2": adj_r2,
        "mae": mae,
        "rmse": rmse,
        "mape": mape,
        "vif": vif_vals,
        "durbin_watson": dw,
    }


def _model_to_out(m: Model, mm: ModelMetrics) -> ModelOut:
    return ModelOut(
        id=m.id,
        name=m.name,
        dataset_id=m.dataset_id,
        y_var=m.y_var,
        x_vars=json.loads(m.x_vars_json),
        is_hero=m.role == "hero",
        role=m.role or "none",
        metrics=ModelMetricsOut(
            r2=mm.r2,
            adj_r2=mm.adj_r2,
            durbin_watson=mm.durbin_watson,
            mae=mm.mae,
            rmse=mm.rmse,
            mape=mm.mape,
            vif=json.loads(mm.vif_json),
        ),
    )


def _fit_and_store_metrics(session: Session, model: Model, df: pd.DataFrame, x_vars: list[str]):
    work, y, X = _prepare_training_frame(df, model.y_var, x_vars)
    X_const = sm.add_constant(X, has_constant="add")
    result = sm.OLS(y, X_const).fit()
    y_hat = result.predict(X_const)
    metrics = _compute_metrics(y, y_hat, X)

    mm = session.get(ModelMetrics, model.id)
    if not mm:
        mm = ModelMetrics(
            model_id=model.id, company_id=model.company_id,
            r2=0, adj_r2=0, durbin_watson=0, mae=0, rmse=0, mape=None, vif_json="[]",
        )
    mm.r2 = metrics["r2"]
    mm.adj_r2 = metrics["adj_r2"]
    mm.durbin_watson = metrics["durbin_watson"]
    mm.mae = metrics["mae"]
    mm.rmse = metrics["rmse"]
    mm.mape = metrics["mape"]
    mm.vif_json = json.dumps(metrics["vif"])
    session.add(mm)
    return work, y, X, X_const, result


def _generate_unique_name(session: Session, dataset_id: str, company_id: str, base_name: str) -> str:
    existing = {
        m.name
        for m in session.exec(
            select(Model).where(Model.dataset_id == dataset_id, Model.company_id == company_id)
        ).all()
    }
    if base_name not in existing:
        return base_name
    suffix = 2
    while f"{base_name} ({suffix})" in existing:
        suffix += 1
    return f"{base_name} ({suffix})"


def _stepwise_selection(
    X: pd.DataFrame,
    y: pd.Series,
    initial: list[str],
    threshold_in: float = 0.05,
    threshold_out: float = 0.05,
    max_iter: int = 100,
) -> list[str]:
    included = [col for col in initial if col in X.columns]
    for _ in range(max_iter):
        changed = False
        excluded = [col for col in X.columns if col not in included]
        new_pvals: dict[str, float] = {}
        for col in excluded:
            cols = included + [col]
            X_const = sm.add_constant(X[cols], has_constant="add")
            try:
                result = sm.OLS(y, X_const).fit()
                new_pvals[col] = result.pvalues.get(col, 1.0)
            except Exception:
                continue
        if new_pvals:
            best_col, best_p = min(new_pvals.items(), key=lambda item: item[1])
            if best_p < threshold_in:
                included.append(best_col)
                changed = True
        if included:
            X_const = sm.add_constant(X[included], has_constant="add")
            try:
                result = sm.OLS(y, X_const).fit()
                pvalues = result.pvalues.drop("const", errors="ignore")
                if not pvalues.empty:
                    worst_p = pvalues.max()
                    if worst_p > threshold_out:
                        worst_feature = pvalues.idxmax()
                        included.remove(worst_feature)
                        changed = True
            except Exception:
                pass
        if not changed:
            break
    # Final cleanup: keep only predictors with p < 0.05 in final fit
    if included:
        try:
            X_const = sm.add_constant(X[included], has_constant="add")
            result = sm.OLS(y, X_const).fit()
            pvalues = result.pvalues.drop("const", errors="ignore")
            included = [var for var in included if pvalues.get(var, 1.0) < 0.05]
        except Exception:
            pass
    return included


@router.post("", response_model=ModelOut)
def create_model(
    body: CreateModelRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, body.dataset_id, membership.company_id)
    df = _load_df(ds)
    m = Model(
        id=str(uuid.uuid4()),
        company_id=membership.company_id,
        name=body.name,
        dataset_id=body.dataset_id,
        y_var=body.y_var,
        x_vars_json=json.dumps(body.x_vars),
        is_hero=False,
        role="none",
    )
    session.add(m)
    session.commit()

    _fit_and_store_metrics(session, m, df, body.x_vars)
    session.commit()

    mm = session.get(ModelMetrics, m.id)
    invalidate_cache_for_model(m.id)
    return _model_to_out(m, mm)


@router.get("", response_model=List[ModelOut])
def list_models(
    dataset_id: str = Query(...),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ms = session.exec(
        select(Model)
        .where(Model.dataset_id == dataset_id, Model.company_id == membership.company_id)
        .order_by(Model.created_at.desc())
    ).all()
    out: list[ModelOut] = []
    for m in ms:
        mm = session.get(ModelMetrics, m.id)
        if not mm:
            continue
        out.append(_model_to_out(m, mm))
    return out


@router.patch("/{model_id}", response_model=ModelOut)
def update_model(
    model_id: str,
    body: UpdateModelRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    m = get_scoped(session, Model, model_id, membership.company_id)
    ds = get_scoped(session, Dataset, m.dataset_id, membership.company_id)
    df = _load_df(ds)

    if body.name:
        m.name = body.name
    if body.x_vars is not None:
        m.x_vars_json = json.dumps(body.x_vars)
        _fit_and_store_metrics(session, m, df, body.x_vars)
    session.add(m)
    session.commit()

    mm = session.get(ModelMetrics, m.id)
    if not mm:
        raise HTTPException(status_code=500, detail="Metrics missing")
    invalidate_cache_for_model(m.id)
    return _model_to_out(m, mm)


@router.post("/{model_id}/duplicate", response_model=ModelOut)
def duplicate_model(
    model_id: str,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    original = get_scoped(session, Model, model_id, membership.company_id)
    metrics = session.get(ModelMetrics, original.id)
    if not metrics:
        raise HTTPException(status_code=400, detail="Original model metrics missing")
    new_name = _generate_unique_name(session, original.dataset_id, membership.company_id, f"{original.name} - copy")
    new_model = Model(
        id=str(uuid.uuid4()),
        company_id=membership.company_id,
        name=new_name,
        dataset_id=original.dataset_id,
        y_var=original.y_var,
        x_vars_json=original.x_vars_json,
        is_hero=False,
        role="none",
    )
    session.add(new_model)
    session.commit()
    new_metrics = ModelMetrics(
        model_id=new_model.id,
        company_id=membership.company_id,
        r2=metrics.r2,
        adj_r2=metrics.adj_r2,
        durbin_watson=metrics.durbin_watson,
        mae=metrics.mae,
        rmse=metrics.rmse,
        mape=metrics.mape,
        vif_json=metrics.vif_json,
    )
    session.add(new_metrics)
    session.commit()
    invalidate_cache_for_model(new_model.id)
    return _model_to_out(new_model, new_metrics)


@router.post("/{model_id}/best_stepwise", response_model=ModelOut)
def create_best_stepwise_model(
    model_id: str,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    original = get_scoped(session, Model, model_id, membership.company_id)
    ds = get_scoped(session, Dataset, original.dataset_id, membership.company_id)
    df = _load_df(ds)
    original_x = json.loads(original.x_vars_json)
    work, y_arr, X = _prepare_training_frame(df, original.y_var, original_x)
    y_series = pd.Series(y_arr, index=work.index)
    selected_predictors = _stepwise_selection(X, y_series, original_x)
    if not selected_predictors:
        selected_predictors = original_x
    new_name = _generate_unique_name(session, original.dataset_id, membership.company_id, f"{original.name} - Best")
    new_model = Model(
        id=str(uuid.uuid4()),
        company_id=membership.company_id,
        name=new_name,
        dataset_id=original.dataset_id,
        y_var=original.y_var,
        x_vars_json=json.dumps(selected_predictors),
        is_hero=False,
        role="none",
    )
    session.add(new_model)
    session.commit()
    _fit_and_store_metrics(session, new_model, df, selected_predictors)
    session.commit()
    metrics = session.get(ModelMetrics, new_model.id)
    if not metrics:
        raise HTTPException(status_code=500, detail="Failed to compute metrics for new model")
    invalidate_cache_for_model(new_model.id)
    return _model_to_out(new_model, metrics)


@router.delete("/{model_id}")
def delete_model(
    model_id: str,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    m = get_scoped(session, Model, model_id, membership.company_id)
    session.exec(delete(Scenario).where(Scenario.model_id == model_id, Scenario.company_id == membership.company_id))
    session.exec(delete(ModelMetrics).where(ModelMetrics.model_id == model_id, ModelMetrics.company_id == membership.company_id))
    session.delete(m)
    session.commit()
    invalidate_cache_for_model(model_id)
    return {"status": "deleted"}


def _apply_role(session: Session, model: Model, role: str, company_id: str):
    if role not in ROLE_CHOICES:
        raise HTTPException(status_code=400, detail="Invalid role")
    # Clear hero/challenger slots
    dataset_models = session.exec(
        select(Model).where(Model.dataset_id == model.dataset_id, Model.company_id == company_id)
    ).all()
    if role == "hero":
        for other in dataset_models:
            if other.role == "hero":
                other.role = "none"
                other.is_hero = False
                session.add(other)
        model.role = "hero"
        model.is_hero = True
    elif role in {"challenger1", "challenger2"}:
        for other in dataset_models:
            if other.role == role:
                other.role = "none"
                other.is_hero = False
                session.add(other)
        model.role = role
        model.is_hero = False
    else:
        model.role = "none"
        model.is_hero = False
    session.add(model)


@router.post("/{model_id}/role")
def set_role(
    model_id: str,
    body: ModelRoleRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    m = get_scoped(session, Model, model_id, membership.company_id)
    _apply_role(session, m, body.role, membership.company_id)
    session.commit()
    return {"status": "ok"}


@router.post("/{model_id}/hero")
def mark_hero(
    model_id: str,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    m = get_scoped(session, Model, model_id, membership.company_id)
    _apply_role(session, m, "hero", membership.company_id)
    session.commit()
    return {"status": "ok"}


@router.get("/{model_id}/summary", response_model=ModelSummaryResponse)
def model_summary(
    model_id: str,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    m = get_scoped(session, Model, model_id, membership.company_id)
    ds = get_scoped(session, Dataset, m.dataset_id, membership.company_id)
    df = _load_df(ds)
    x_vars = json.loads(m.x_vars_json)
    work, y, X = _prepare_training_frame(df, m.y_var, x_vars)
    X_const = sm.add_constant(X, has_constant="add")
    result = sm.OLS(y, X_const).fit()
    metrics = _compute_metrics(y, result.predict(X_const), X)
    vif_lookup = {}
    for item in metrics["vif"]:
        value = item.get("vif")
        if isinstance(value, (int, float)) and not np.isfinite(value):
            value = None
        vif_lookup[item["name"]] = value
    x_std = X.std(ddof=0)
    y_std = y.std(ddof=0)
    y_std_valid = y_std is not None and np.isfinite(y_std) and y_std != 0

    # Std betas: expose standardized coefficients for frontend summary
    def _beta_std(var: str) -> Optional[float]:
        if not y_std_valid:
            return None
        x_sigma = x_std.get(var)
        if x_sigma is None or not np.isfinite(x_sigma) or x_sigma == 0:
            return None
        return float(result.params[var] * (x_sigma / y_std))

    const_coef = float(result.params.get("const", 0.0))
    intercept = CoefficientItem(
        name="intercept",
        coef=const_coef,
        std_err=float(result.bse.get("const", 0.0)),
        t_value=float(result.tvalues.get("const", 0.0)),
        p_value=float(result.pvalues.get("const", 1.0)),
        vif=None,
        beta_std=None,
    )

    coefficients = []
    for var in x_vars:
        vif_value = vif_lookup.get(var)
        if isinstance(vif_value, (int, float)) and not np.isfinite(vif_value):
            vif_value = None
        coefficients.append(
            CoefficientItem(
                name=var,
                coef=float(result.params.get(var, 0.0)),
                std_err=float(result.bse.get(var, 0.0)),
                t_value=float(result.tvalues.get(var, 0.0)),
                p_value=float(result.pvalues.get(var, 1.0)),
                vif=vif_value,
                beta_std=_beta_std(var),
            )
        )

    return ModelSummaryResponse(model_id=m.id, intercept=intercept, coefficients=coefficients)


def _infer_time_column(df: pd.DataFrame) -> Optional[str]:
    dt_cols = df.select_dtypes(include=["datetime64[ns]", "datetime64[ns, UTC]"]).columns.tolist()
    if dt_cols:
        return dt_cols[0]
    for col in df.columns:
        if pd.api.types.is_string_dtype(df[col]):
            parsed = pd.to_datetime(df[col], errors="coerce")
            if not parsed.isna().all():
                return col
    return None


@router.get("/{model_id}/predictions", response_model=PredictionsResponse)
def model_predictions(
    model_id: str,
    granularity: str = Query("auto", regex="^(auto|weekly|monthly)$"),
    time_col: Optional[str] = Query(None),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    m = get_scoped(session, Model, model_id, membership.company_id)
    ds = get_scoped(session, Dataset, m.dataset_id, membership.company_id)
    df = _load_df(ds)
    x_vars = json.loads(m.x_vars_json)
    work, y, X = _prepare_training_frame(df, m.y_var, x_vars)
    X_const = sm.add_constant(X, has_constant="add")
    result = sm.OLS(y, X_const).fit()
    y_hat = result.predict(X_const)
    residuals = y - y_hat

    preferred_time_col = time_col or getattr(ds, "time_variable", None)

    def _parse_time_series(column: Optional[str]) -> Optional[pd.Series]:
        if not column:
            return None
        ts_series = pd.to_datetime(df.loc[work.index, column], errors="coerce")
        if ts_series.isna().all():
            return None
        return ts_series

    time_series = _parse_time_series(preferred_time_col)
    time_column_used = preferred_time_col if time_series is not None else None
    if time_series is None:
        inferred_col = _infer_time_column(df)
        inferred_series = _parse_time_series(inferred_col)
        if inferred_series is not None:
            time_series = inferred_series
            time_column_used = inferred_col

    if granularity == "auto":
        if time_series is not None:
            index = [
                ts_val.isoformat() if not pd.isna(ts_val) else str(idx_val)
                for ts_val, idx_val in zip(time_series, work.index)
            ]
        else:
            index = [str(idx) for idx in work.index]
        return PredictionsResponse(index=index, y_true=y.tolist(), y_pred=y_hat.tolist(), residuals=residuals.tolist())

    if time_series is None or not time_column_used:
        raise HTTPException(status_code=400, detail="No datetime column available; provide time_col")
    ts = time_series

    series = pd.DataFrame(
        {
            "time": ts,
            "y_true": y,
            "y_pred": y_hat,
            "residual": residuals,
        }
    ).dropna(subset=["time"])
    freq = "W" if granularity == "weekly" else "M"
    grouped = series.groupby(series["time"].dt.to_period(freq)).mean(numeric_only=True)
    index = grouped.index.astype(str).tolist()
    return PredictionsResponse(
        index=index,
        y_true=grouped["y_true"].tolist(),
        y_pred=grouped["y_pred"].tolist(),
        residuals=grouped["residual"].tolist(),
    )
