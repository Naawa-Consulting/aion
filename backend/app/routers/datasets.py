from __future__ import annotations

import io
import json
import re
import uuid
import hashlib
from pathlib import Path
from datetime import datetime
from typing import List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Query
from sqlalchemy import func
from sqlmodel import Session, select, delete

from ..db import DATA_ROOT, get_session
from ..models import Dataset, Variable, Model, ModelMetrics, Scenario
from ..schemas import (
    ColumnInfo,
    DatasetOut,
    DatasetDependencyInfo,
    DatasetRenameRequest,
    UploadResult,
    PreviewResponse,
    ColumnRenameRequest,
)


router = APIRouter()


def _normalize_column(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"[^0-9a-zA-Z_]+", "_", name)
    name = re.sub(r"_+", "_", name)
    return name.strip("_")


def _infer_columns(df: pd.DataFrame) -> list[dict]:
    return [{"name": str(c), "dtype": str(dt)} for c, dt in df.dtypes.items()]


def _dependency_counts(session: Session, dataset_id: str) -> DatasetDependencyInfo:
    var_count = session.exec(
        select(func.count())
        .select_from(Variable)
        .where(Variable.dataset_id == dataset_id, Variable.is_derived == True)
    ).one()
    model_rows = session.exec(select(Model.id).where(Model.dataset_id == dataset_id)).all()
    model_ids = [
        row[0] if isinstance(row, tuple) else row
        for row in model_rows
    ]
    model_count = len(model_ids)
    scenario_count = 0
    if model_ids:
        scenario_count = session.exec(
            select(func.count())
            .select_from(Scenario)
            .where(Scenario.model_id.in_(model_ids))
        ).one()
    var_total = var_count[0] if isinstance(var_count, tuple) else var_count or 0
    scenario_total = (
        scenario_count[0] if isinstance(scenario_count, tuple) else scenario_count or 0
    )
    return DatasetDependencyInfo(
        variables=int(var_total),
        models=int(model_count),
        scenarios=int(scenario_total),
    )


def _dataset_out(session: Session, ds: Dataset) -> DatasetOut:
    cols = [ColumnInfo(**c) for c in json.loads(ds.columns_json)]
    deps = _dependency_counts(session, ds.id)
    return DatasetOut(
        id=ds.id,
        display_name=getattr(ds, "display_name", ds.name),
        file_name=getattr(ds, "file_name", ds.name),
        n_rows=ds.n_rows,
        n_cols=ds.n_cols,
        created_at=ds.created_at,
        last_used_at=getattr(ds, "last_used_at", ds.created_at),
        columns=cols,
        dependencies=deps,
    )


@router.post("/upload", response_model=UploadResult)
async def upload_datasets(
    files: List[UploadFile] = File(...),
    force: bool = Query(False, description="Allow duplicate uploads based on checksum"),
    session: Session = Depends(get_session),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    saved: list[DatasetOut] = []
    datasets_dir = Path(DATA_ROOT) / "datasets"
    datasets_dir.mkdir(parents=True, exist_ok=True)

    for f in files:
        content = await f.read()
        buf = io.BytesIO(content)

        try:
            if f.filename and f.filename.lower().endswith(".csv"):
                df = pd.read_csv(buf)
            elif f.filename and (f.filename.lower().endswith(".xlsx") or f.filename.lower().endswith(".xls")):
                df = pd.read_excel(buf)
            else:
                raise ValueError("Unsupported file type. Use .csv or .xlsx")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse {f.filename}: {e}")

        # standardize column names
        df.columns = [_normalize_column(str(c)) for c in df.columns]
        checksum = hashlib.md5(content).hexdigest()
        file_name = f.filename or ds_id

        duplicate = session.exec(
            select(Dataset).where(Dataset.file_name == file_name, Dataset.checksum == checksum)
        ).first()
        if duplicate and not force:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Dataset already uploaded",
                    "dataset_id": duplicate.id,
                    "display_name": getattr(duplicate, "display_name", duplicate.name),
                },
            )

        ds_id = str(uuid.uuid4())
        parquet_path = datasets_dir / f"{ds_id}.parquet"
        try:
            df.to_parquet(parquet_path, index=False)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save parquet: {e}")

        cols = _infer_columns(df)
        now = datetime.utcnow()
        ds = Dataset(
            id=ds_id,
            name=file_name,
            display_name=file_name,
            file_name=file_name,
            checksum=checksum,
            path=str(parquet_path),
            n_rows=int(df.shape[0]),
            n_cols=int(df.shape[1]),
            columns_json=json.dumps(cols),
            created_at=now,
            last_used_at=now,
        )
        session.add(ds)
        session.commit()

        saved.append(_dataset_out(session, ds))

    return UploadResult(datasets=saved)


@router.get("", response_model=list[DatasetOut])
def list_datasets(session: Session = Depends(get_session)):
    ds_list = session.exec(select(Dataset).order_by(Dataset.created_at.desc())).all()
    return [_dataset_out(session, ds) for ds in ds_list]


@router.get("/{dataset_id}/preview", response_model=PreviewResponse)
def preview_dataset(dataset_id: str, rows: int = Query(20, ge=1, le=1000), session: Session = Depends(get_session)):
    ds = session.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    path = Path(ds.path)
    if not path.exists():
        raise HTTPException(status_code=500, detail="Dataset file missing")

    try:
        df = pd.read_parquet(path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read parquet: {e}")

    head = df.head(rows)
    rows_out = head.to_dict(orient="records")
    ds.last_used_at = datetime.utcnow()
    session.add(ds)
    session.commit()
    return PreviewResponse(columns=list(head.columns), rows=rows_out)


@router.patch("/{dataset_id}/columns", response_model=DatasetOut)
def rename_columns(dataset_id: str, body: ColumnRenameRequest, session: Session = Depends(get_session)):
    ds = session.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    path = Path(ds.path)
    if not path.exists():
        raise HTTPException(status_code=500, detail="Dataset file missing")

    try:
        df = pd.read_parquet(path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read parquet: {e}")

    rename_map = {r.from_name: _normalize_column(r.to_name) for r in body.renames}
    df = df.rename(columns=rename_map)

    try:
        df.to_parquet(path, index=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write parquet: {e}")

    cols = _infer_columns(df)
    ds.columns_json = json.dumps(cols)
    ds.n_cols = int(df.shape[1])
    session.add(ds)
    session.commit()

    return _dataset_out(session, ds)


@router.patch("/{dataset_id}/rename", response_model=DatasetOut)
def rename_dataset(dataset_id: str, body: DatasetRenameRequest, session: Session = Depends(get_session)):
    ds = session.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    new_name = body.display_name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Display name cannot be empty")
    ds.display_name = new_name
    session.add(ds)
    session.commit()
    return _dataset_out(session, ds)


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: str, cascade: bool = Query(True, description="Delete dependent transforms/models"), session: Session = Depends(get_session)):
    ds = session.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    deps = _dependency_counts(session, ds.id)
    has_deps = any([deps.variables, deps.models, deps.scenarios])
    if has_deps and not cascade:
        raise HTTPException(status_code=400, detail={"message": "Dataset has dependencies", "dependencies": deps.dict()})

    if cascade:
        session.exec(delete(Variable).where(Variable.dataset_id == ds.id))
        model_ids = session.exec(select(Model.id).where(Model.dataset_id == ds.id)).all()
        if model_ids:
            session.exec(delete(Scenario).where(Scenario.model_id.in_(model_ids)))
            session.exec(delete(ModelMetrics).where(ModelMetrics.model_id.in_(model_ids)))
            session.exec(delete(Model).where(Model.id.in_(model_ids)))

    path = Path(ds.path)
    if path.exists():
        try:
            path.unlink()
        except Exception:
            pass

    session.delete(ds)
    session.commit()
    return {"status": "deleted", "id": ds.id}
