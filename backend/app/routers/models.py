from __future__ import annotations

import json
import uuid
from typing import List

import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.stattools import durbin_watson

from ..db import get_session
from ..models import Dataset, Model, ModelMetrics
from ..schemas import CorrelationResponse, CorrelationItem, CreateModelRequest, ModelOut, ModelMetricsOut


router = APIRouter()


def _load_df(ds: Dataset) -> pd.DataFrame:
    try:
        return pd.read_parquet(ds.path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {e}")


@router.get("/correlations", response_model=CorrelationResponse)
def correlations(dataset_id: str = Query(...), y: str = Query(...), session: Session = Depends(get_session)):
    ds = session.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = _load_df(ds)
    if y not in df.columns:
        raise HTTPException(status_code=400, detail="Dependent variable not in dataset")

    # use numeric only
    numeric_df = df.select_dtypes(include=[np.number])
    if y not in numeric_df.columns:
        raise HTTPException(status_code=400, detail="Dependent variable must be numeric")

    y_series = numeric_df[y]
    # drop rows with missing y
    numeric_df = numeric_df.loc[y_series.index]
    joined = numeric_df.dropna(subset=[y])
    corr_items: list[CorrelationItem] = []
    for col in joined.columns:
        if col == y:
            continue
        try:
            c = float(joined[col].corr(joined[y]))
            if not np.isfinite(c):
                continue
            corr_items.append(CorrelationItem(name=col, corr=c, dtype=str(df[col].dtype)))
        except Exception:
            continue
    corr_items.sort(key=lambda i: abs(i.corr), reverse=True)
    return CorrelationResponse(y=y, items=corr_items)


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
        vif_vals.append({"name": name, "vif": float(variance_inflation_factor(X_const.values, i))})

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


@router.post("", response_model=ModelOut)
def create_model(body: CreateModelRequest, session: Session = Depends(get_session)):
    ds = session.get(Dataset, body.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = _load_df(ds)

    if body.y_var not in df.columns:
        raise HTTPException(status_code=400, detail="y_var not found")
    for x in body.x_vars:
        if x not in df.columns:
            raise HTTPException(status_code=400, detail=f"x_var not found: {x}")

    # numeric only and drop NA rows across y and X
    cols = [body.y_var] + body.x_vars
    work = df[cols].apply(pd.to_numeric, errors='coerce').dropna()
    if work.shape[0] < len(cols) + 1:
        raise HTTPException(status_code=400, detail="Insufficient rows after cleaning for regression")

    y = work[body.y_var].to_numpy()
    X = work[body.x_vars]
    X_const = sm.add_constant(X, has_constant='add')
    model = sm.OLS(y, X_const).fit()
    y_hat = model.predict(X_const)

    metrics = _compute_metrics(y, y_hat, X)

    m = Model(
        id=str(uuid.uuid4()),
        name=body.name,
        dataset_id=body.dataset_id,
        y_var=body.y_var,
        x_vars_json=json.dumps(body.x_vars),
        is_hero=False,
    )
    session.add(m)
    session.commit()

    mm = ModelMetrics(
        model_id=m.id,
        r2=metrics["r2"],
        adj_r2=metrics["adj_r2"],
        durbin_watson=metrics["durbin_watson"],
        mae=metrics["mae"],
        rmse=metrics["rmse"],
        mape=metrics["mape"],
        vif_json=json.dumps(metrics["vif"]),
    )
    session.add(mm)
    session.commit()

    return ModelOut(
        id=m.id,
        name=m.name,
        dataset_id=m.dataset_id,
        y_var=m.y_var,
        x_vars=json.loads(m.x_vars_json),
        is_hero=m.is_hero,
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


@router.get("", response_model=List[ModelOut])
def list_models(dataset_id: str = Query(...), session: Session = Depends(get_session)):
    ms = session.exec(select(Model).where(Model.dataset_id == dataset_id).order_by(Model.created_at.desc())).all()
    out: list[ModelOut] = []
    for m in ms:
        mm = session.get(ModelMetrics, m.id)
        if not mm:
            continue
        out.append(ModelOut(
            id=m.id,
            name=m.name,
            dataset_id=m.dataset_id,
            y_var=m.y_var,
            x_vars=json.loads(m.x_vars_json),
            is_hero=m.is_hero,
            metrics=ModelMetricsOut(
                r2=mm.r2,
                adj_r2=mm.adj_r2,
                durbin_watson=mm.durbin_watson,
                mae=mm.mae,
                rmse=mm.rmse,
                mape=mm.mape,
                vif=json.loads(mm.vif_json),
            )
        ))
    return out


@router.post("/{model_id}/hero")
def mark_hero(model_id: str, session: Session = Depends(get_session)):
    m = session.get(Model, model_id)
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    # unset others for same dataset
    others = session.exec(select(Model).where((Model.dataset_id == m.dataset_id) & (Model.id != m.id))).all()
    for o in others:
        if o.is_hero:
            o.is_hero = False
            session.add(o)
    m.is_hero = True
    session.add(m)
    session.commit()
    return {"status": "ok"}

