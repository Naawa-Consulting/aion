from __future__ import annotations

import io
import json
import re
import uuid
from pathlib import Path
from typing import List

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Query
from sqlmodel import Session, select

from ..db import DATA_ROOT, get_session
from ..models import Dataset
from ..schemas import ColumnInfo, DatasetOut, UploadResult, PreviewResponse, ColumnRenameRequest


router = APIRouter()


def _normalize_column(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"[^0-9a-zA-Z_]+", "_", name)
    name = re.sub(r"_+", "_", name)
    return name.strip("_")


def _infer_columns(df: pd.DataFrame) -> list[dict]:
    return [{"name": str(c), "dtype": str(dt)} for c, dt in df.dtypes.items()]


@router.post("/upload", response_model=UploadResult)
async def upload_datasets(
    files: List[UploadFile] = File(...),
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

        ds_id = str(uuid.uuid4())
        parquet_path = datasets_dir / f"{ds_id}.parquet"
        try:
            df.to_parquet(parquet_path, index=False)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save parquet: {e}")

        cols = _infer_columns(df)
        ds = Dataset(
            id=ds_id,
            name=f.filename or ds_id,
            path=str(parquet_path),
            n_rows=int(df.shape[0]),
            n_cols=int(df.shape[1]),
            columns_json=json.dumps(cols),
        )
        session.add(ds)
        session.commit()

        saved.append(
            DatasetOut(
                id=ds.id,
                name=ds.name,
                n_rows=ds.n_rows,
                n_cols=ds.n_cols,
                columns=[ColumnInfo(**c) for c in cols],
            )
        )

    return UploadResult(datasets=saved)


@router.get("", response_model=list[DatasetOut])
def list_datasets(session: Session = Depends(get_session)):
    ds_list = session.exec(select(Dataset).order_by(Dataset.created_at.desc())).all()
    out: list[DatasetOut] = []
    for ds in ds_list:
        cols = [ColumnInfo(**c) for c in json.loads(ds.columns_json)]
        out.append(
            DatasetOut(
                id=ds.id,
                name=ds.name,
                n_rows=ds.n_rows,
                n_cols=ds.n_cols,
                columns=cols,
            )
        )
    return out


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

    return DatasetOut(
        id=ds.id,
        name=ds.name,
        n_rows=ds.n_rows,
        n_cols=ds.n_cols,
        columns=[ColumnInfo(**c) for c in cols],
    )

