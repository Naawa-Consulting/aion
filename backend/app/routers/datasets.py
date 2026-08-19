from __future__ import annotations

import io
import json
import re
import uuid
import hashlib
from datetime import date, datetime, timezone
from typing import List, Literal, Optional

import pandas as pd
from pandas.api.types import is_datetime64_any_dtype
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Query
from sqlalchemy import func
from sqlmodel import Session, select, delete

from ..auth import CurrentMembership, get_current_membership, require_write_access
from ..db import get_session
from ..errors import api_error
from ..models import ConversionSettings, Dataset, Variable, Model, ModelMetrics, Scenario, InvestmentChannel
from ..services.analysis import invalidate_cache_for_dataset
from ..tenancy import get_scoped
from ..utils.storage import StorageNotFoundError, get_storage
from ..schemas import (
    ColumnInfo,
    DatasetOut,
    DatasetDependencyInfo,
    DatasetRenameRequest,
    DatasetSampleSizeRequest,
    UploadResult,
    PreviewResponse,
    ColumnRenameRequest,
    TimeCandidateResponse,
    TimeCandidate,
    TimeSelection,
    TimeVariableRequest,
    DependentVariableRequest,
    DatasetUpdateResponse,
    DatasetVersionsResponse,
    DatasetVersionInfo,
    DatasetMeta,
    ModelWithRole,
)


TIME_NAME_PATTERN = re.compile(r"(date|fecha|time|week|month|year|period|semana)", re.IGNORECASE)
MAX_TIME_SAMPLE = 2000


router = APIRouter()


def _normalize_column(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"[^0-9a-zA-Z_]+", "_", name)
    name = re.sub(r"_+", "_", name)
    return name.strip("_")


def _infer_columns(df: pd.DataFrame) -> list[dict]:
    return [{"name": str(c), "dtype": str(dt)} for c, dt in df.dtypes.items()]


def _infer_frequency(parsed: pd.Series) -> Optional[str]:
    """D1: modal delta between consecutive sorted timestamps, bucketed to the closest of
    daily/weekly/monthly. `parsed` must already be a datetime series (post `pd.to_datetime`).
    Returns None with fewer than 2 distinct valid timestamps."""
    valid = parsed.dropna().sort_values()
    if len(valid) < 2:
        return None
    deltas = valid.diff().dropna().dt.days
    deltas = deltas[deltas > 0]
    if deltas.empty:
        return None
    modal_days = deltas.mode().iloc[0]
    if modal_days <= 3:
        return "daily"
    if modal_days <= 10:
        return "weekly"
    return "monthly"


def _dependency_counts(session: Session, dataset_id: str, company_id: str) -> DatasetDependencyInfo:
    var_count = session.exec(
        select(func.count())
        .select_from(Variable)
        .where(
            Variable.dataset_id == dataset_id,
            Variable.company_id == company_id,
            Variable.is_derived == True,
        )
    ).one()
    model_rows = session.exec(
        select(Model.id).where(Model.dataset_id == dataset_id, Model.company_id == company_id)
    ).all()
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
            .where(Scenario.model_id.in_(model_ids), Scenario.company_id == company_id)
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


def _version_key(company_id: str, dataset_id: str, version: int) -> str:
    return f"{company_id}/{dataset_id}/v{version}.parquet"


def _read_uploaded_file(filename: str | None, content: bytes) -> pd.DataFrame:
    buf = io.BytesIO(content)
    try:
        if filename and filename.lower().endswith(".csv"):
            df = pd.read_csv(buf)
        elif filename and filename.lower().endswith((".xlsx", ".xls")):
            df = pd.read_excel(buf)
        elif filename and filename.lower().endswith(".parquet"):
            df = pd.read_parquet(buf)
        else:
            raise ValueError("Unsupported file type. Use .csv, .xlsx, or .parquet")
    except Exception as exc:
        raise api_error(400, "FILE_PARSE_ERROR", f"Failed to parse {filename}: {exc}")
    df.columns = [_normalize_column(str(c)) for c in df.columns]
    return df


def _read_dataset_bytes(storage_key: str) -> bytes:
    try:
        return get_storage().read_bytes(storage_key)
    except StorageNotFoundError:
        raise HTTPException(status_code=500, detail="Dataset file missing")


def _dataset_out(session: Session, ds: Dataset) -> DatasetOut:
    cols = [ColumnInfo(**c) for c in json.loads(ds.columns_json)]
    deps = _dependency_counts(session, ds.id, ds.company_id)
    column_names = {col.name for col in cols}
    if ds.time_variable and ds.time_variable not in column_names:
        ds.time_variable = None
        ds.time_format = None
        ds.time_timezone = None
        session.add(ds)
        session.commit()
    return DatasetOut(
        id=ds.id,
        display_name=getattr(ds, "display_name", ds.name),
        file_name=getattr(ds, "file_name", ds.name),
        n_rows=ds.n_rows,
        total_rows=ds.n_rows,
        n_cols=ds.n_cols,
        sample_size=ds.sample_size,
        time_variable=ds.time_variable,
        time_format=ds.time_format,
        time_timezone=ds.time_timezone,
        frequency=ds.frequency,
        version=ds.version or 1,
        previous_version_id=ds.previous_version_id,
        dependent_variable=ds.dependent_variable,
        created_at=_ensure_utc_datetime(ds.created_at),
        last_used_at=_ensure_utc_datetime(getattr(ds, "last_used_at", ds.created_at)),
        columns=cols,
        dependencies=deps,
    )


def _dataset_time_range(ds: Dataset) -> tuple[date | None, date | None, bool]:
    if not ds.time_variable:
        return None, None, False
    try:
        raw = get_storage().read_bytes(ds.storage_key)
        series = pd.read_parquet(io.BytesIO(raw), columns=[ds.time_variable])[ds.time_variable]
    except Exception:
        return None, None, False
    if ds.sample_size:
        series = series.head(int(ds.sample_size))
    parsed = pd.to_datetime(series, format=ds.time_format, errors="coerce")
    if ds.time_timezone:
        try:
            parsed = parsed.dt.tz_localize(ds.time_timezone, nonexistent="NaT", ambiguous="NaT")
        except (TypeError, ValueError):
            try:
                parsed = parsed.dt.tz_convert(ds.time_timezone)
            except Exception:
                pass
    parsed = parsed.dropna()
    if parsed.empty:
        return None, None, False
    min_dt = parsed.min()
    max_dt = parsed.max()
    if hasattr(min_dt, "to_pydatetime"):
        min_dt = min_dt.to_pydatetime()
    if hasattr(max_dt, "to_pydatetime"):
        max_dt = max_dt.to_pydatetime()
    return min_dt.date(), max_dt.date(), True


@router.post("/upload", response_model=UploadResult)
async def upload_datasets(
    files: List[UploadFile] = File(...),
    force: bool = Query(False, description="Allow duplicate uploads based on checksum"),
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    if not files:
        raise api_error(400, "NO_FILES_UPLOADED", "No files uploaded")

    saved: list[DatasetOut] = []

    for f in files:
        ds_id = str(uuid.uuid4())
        content = await f.read()
        df = _read_uploaded_file(f.filename, content)
        checksum = hashlib.md5(content).hexdigest()
        file_name = f.filename or f"dataset-{ds_id}"

        duplicate = session.exec(
            select(Dataset).where(
                Dataset.company_id == membership.company_id,
                Dataset.file_name == file_name,
                Dataset.checksum == checksum,
            )
        ).first()
        if duplicate and not force:
            raise api_error(
                409,
                "DUPLICATE_DATASET_UPLOAD",
                "Dataset already uploaded",
                dataset_id=duplicate.id,
                display_name=getattr(duplicate, "display_name", duplicate.name),
            )

        storage_key = _version_key(membership.company_id, ds_id, 1)
        try:
            buf = io.BytesIO()
            df.to_parquet(buf, index=False)
            get_storage().write_bytes(storage_key, buf.getvalue())
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save parquet: {e}")

        cols = _infer_columns(df)
        now = datetime.now(timezone.utc)
        ds = Dataset(
            id=ds_id,
            company_id=membership.company_id,
            name=file_name,
            display_name=file_name,
            file_name=file_name,
            checksum=checksum,
            storage_key=storage_key,
            n_rows=int(df.shape[0]),
            n_cols=int(df.shape[1]),
            columns_json=json.dumps(cols),
            created_at=now,
            last_used_at=now,
            version=1,
            previous_version_id=None,
        )
        session.add(ds)
        session.commit()

        saved.append(_dataset_out(session, ds))

    return UploadResult(datasets=saved)


@router.get("", response_model=list[DatasetOut])
def list_datasets(
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ds_list = session.exec(
        select(Dataset)
        .where(Dataset.company_id == membership.company_id)
        .order_by(Dataset.created_at.desc())
    ).all()
    return [_dataset_out(session, ds) for ds in ds_list]


@router.get("/{dataset_id}/preview", response_model=PreviewResponse)
def preview_dataset(
    dataset_id: str,
    rows: int = Query(20, ge=1, le=1000),
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)

    raw = _read_dataset_bytes(ds.storage_key)
    try:
        df = pd.read_parquet(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read parquet: {e}")

    head = df.head(rows)
    rows_out = head.to_dict(orient="records")
    ds.last_used_at = datetime.now(timezone.utc)
    session.add(ds)
    session.commit()
    return PreviewResponse(columns=list(head.columns), rows=rows_out)


@router.patch("/{dataset_id}/columns", response_model=DatasetOut)
def rename_columns(
    dataset_id: str,
    body: ColumnRenameRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)

    raw = _read_dataset_bytes(ds.storage_key)
    try:
        df = pd.read_parquet(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read parquet: {e}")

    rename_map = {r.from_name: _normalize_column(r.to_name) for r in body.renames}
    df = df.rename(columns=rename_map)

    try:
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        get_storage().write_bytes(ds.storage_key, buf.getvalue())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write parquet: {e}")

    cols = _infer_columns(df)
    ds.columns_json = json.dumps(cols)
    ds.n_cols = int(df.shape[1])
    session.add(ds)
    session.commit()

    invalidate_cache_for_dataset(dataset_id)
    return _dataset_out(session, ds)


@router.patch("/{dataset_id}/rename", response_model=DatasetOut)
def rename_dataset(
    dataset_id: str,
    body: DatasetRenameRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)
    new_name = body.display_name.strip()
    if not new_name:
        raise api_error(400, "DISPLAY_NAME_EMPTY", "Display name cannot be empty")
    ds.display_name = new_name
    session.add(ds)
    session.commit()
    invalidate_cache_for_dataset(dataset_id)
    return _dataset_out(session, ds)


@router.patch("/{dataset_id}/sample_size", response_model=DatasetOut)
def update_sample_size(
    dataset_id: str,
    body: DatasetSampleSizeRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)

    target = body.sample_size
    if target is not None:
        if target <= 0:
            raise api_error(400, "SAMPLE_SIZE_NOT_POSITIVE", "sample_size must be positive")
        if target > ds.n_rows:
            raise api_error(400, "SAMPLE_SIZE_EXCEEDS_ROWS", "sample_size cannot exceed total rows")
        min_allowed = min(10, ds.n_rows)
        if ds.n_rows >= min_allowed and target < min_allowed:
            raise api_error(400, "SAMPLE_SIZE_TOO_SMALL", f"sample_size must be at least {min_allowed}", min_allowed=min_allowed)

    ds.sample_size = target
    ds.last_used_at = datetime.now(timezone.utc)
    session.add(ds)
    session.commit()
    session.refresh(ds)
    invalidate_cache_for_dataset(dataset_id)
    return _dataset_out(session, ds)


@router.get("/{dataset_id}/time_candidates", response_model=TimeCandidateResponse)
def time_candidates(
    dataset_id: str,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)
    raw = _read_dataset_bytes(ds.storage_key)
    try:
        df = pd.read_parquet(io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {exc}")
    candidates = _detect_time_candidates(df)
    current = None
    if ds.time_variable:
        current = TimeSelection(
            name=ds.time_variable,
            time_format=ds.time_format,
            time_timezone=ds.time_timezone,
            frequency=ds.frequency,
        )
    return TimeCandidateResponse(candidates=candidates, current=current)


@router.patch("/{dataset_id}/time_variable", response_model=DatasetOut)
def update_time_variable(
    dataset_id: str,
    body: TimeVariableRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)

    column = body.column
    if not column:
        ds.time_variable = None
        ds.time_format = None
        ds.time_timezone = None
        ds.frequency = None
        session.add(ds)
        session.commit()
        session.refresh(ds)
        return _dataset_out(session, ds)

    raw = _read_dataset_bytes(ds.storage_key)
    try:
        df = pd.read_parquet(io.BytesIO(raw), columns=[column])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {exc}")

    if column not in df.columns:
        raise api_error(400, "COLUMN_NOT_FOUND", "Column not found")

    series = df[column]
    requires_parse = body.coerce or body.time_format or not is_datetime64_any_dtype(series)
    if requires_parse:
        _validate_time_parse(series, body.time_format, body.timezone)

    ds.time_variable = column
    ds.time_format = body.time_format
    ds.time_timezone = body.timezone
    if body.frequency:
        ds.frequency = body.frequency
    else:
        utc = bool(body.timezone and body.timezone.upper() == "UTC")
        parsed = pd.to_datetime(series, format=body.time_format, errors="coerce", utc=utc)
        ds.frequency = _infer_frequency(parsed)
    ds.last_used_at = datetime.now(timezone.utc)
    session.add(ds)
    session.commit()
    session.refresh(ds)
    invalidate_cache_for_dataset(dataset_id)
    return _dataset_out(session, ds)


@router.patch("/{dataset_id}/dependent_variable", response_model=DatasetOut)
def update_dependent_variable(
    dataset_id: str,
    body: DependentVariableRequest,
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)

    column = body.column
    if column:
        column_names = {c["name"] for c in json.loads(ds.columns_json)}
        if column not in column_names:
            raise api_error(400, "COLUMN_NOT_FOUND", "Column not found")

    ds.dependent_variable = column
    ds.last_used_at = datetime.now(timezone.utc)
    session.add(ds)
    session.commit()
    session.refresh(ds)
    invalidate_cache_for_dataset(dataset_id)
    return _dataset_out(session, ds)


@router.post("/{dataset_id}/update", response_model=DatasetUpdateResponse)
async def update_dataset_file(
    dataset_id: str,
    replace_strategy: Literal["strict", "force"] = Form("strict"),
    file: UploadFile = File(...),
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)
    content = await file.read()
    if not content:
        raise api_error(400, "EMPTY_FILE", "Empty file")
    df_new = _read_uploaded_file(file.filename, content)
    new_cols = _infer_columns(df_new)
    old_cols = json.loads(ds.columns_json)
    differences = _schema_differences(old_cols, new_cols)
    if replace_strategy == "strict" and (
        differences["added"] or differences["removed"] or differences["dtype_mismatch"]
    ):
        raise api_error(400, "SCHEMA_MISMATCH", "Schema mismatch", differences=differences)

    old_version = ds.version or 1
    new_version = old_version + 1
    archive_key = _version_key(ds.company_id, ds.id, old_version)
    storage = get_storage()
    if storage.exists(ds.storage_key):
        if ds.storage_key != archive_key:
            try:
                storage.move(ds.storage_key, archive_key)
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to archive previous version: {exc}")
    elif not storage.exists(archive_key):
        raise HTTPException(status_code=500, detail="Previous dataset file missing")

    new_key = _version_key(ds.company_id, ds.id, new_version)
    try:
        buf = io.BytesIO()
        df_new.to_parquet(buf, index=False)
        storage.write_bytes(new_key, buf.getvalue())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write new dataset: {exc}")

    ds.storage_key = new_key
    ds.n_rows = int(df_new.shape[0])
    ds.n_cols = int(df_new.shape[1])
    ds.columns_json = json.dumps(new_cols)
    ds.version = new_version
    ds.previous_version_id = archive_key
    ds.checksum = hashlib.md5(content).hexdigest()
    ds.last_used_at = datetime.now(timezone.utc)
    session.add(ds)
    session.commit()
    session.refresh(ds)

    invalidate_cache_for_dataset(dataset_id)
    return DatasetUpdateResponse(
        id=ds.id,
        display_name=ds.display_name,
        old_version=old_version,
        new_version=new_version,
        replaced_columns=differences,
        rows=ds.n_rows,
        cols=ds.n_cols,
    )


@router.get("/{dataset_id}/versions", response_model=DatasetVersionsResponse)
def get_dataset_versions(
    dataset_id: str,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)
    versions: list[DatasetVersionInfo] = []
    max_version = ds.version or 1
    storage = get_storage()
    for version in range(1, max_version + 1):
        key = _version_key(ds.company_id, ds.id, version)
        info = storage.stat(key)
        if not info:
            continue
        created_raw = info.get("updated_at") or info.get("created_at")
        created_at = pd.to_datetime(created_raw).to_pydatetime() if created_raw else datetime.now(timezone.utc)
        versions.append(DatasetVersionInfo(version=version, created_at=created_at))
    return DatasetVersionsResponse(versions=versions)


@router.get("/{dataset_id}/meta", response_model=DatasetMeta)
def get_dataset_meta(
    dataset_id: str,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)
    date_min, date_max, has_valid_dates = _dataset_time_range(ds)
    return DatasetMeta(
        id=ds.id,
        name=getattr(ds, "display_name", ds.name),
        rows=ds.n_rows,
        columns=ds.n_cols,
        time_column=ds.time_variable,
        created_at=ds.created_at,
        last_used_at=ds.last_used_at,
        date_min=date_min,
        date_max=date_max,
        has_valid_dates=has_valid_dates,
        version=ds.version,
    )


@router.get("/{dataset_id}/summary")
def dataset_summary(
    dataset_id: str,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)
    raw = _read_dataset_bytes(ds.storage_key)
    try:
        df = pd.read_parquet(io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {exc}")

    columns = []
    total_rows = len(df)
    for name in df.columns:
        series = df[name]
        dtype = str(series.dtype)
        missing_pct = float(series.isna().mean() * 100) if total_rows else 0.0
        unique = int(series.nunique(dropna=True))
        samples = [
            str(val)
            for val in series.dropna().head(3).tolist()
        ]
        min_value = max_value = None
        if pd.api.types.is_numeric_dtype(series):
            min_value = None if series.dropna().empty else float(series.min())
            max_value = None if series.dropna().empty else float(series.max())
        columns.append({
            "name": name,
            "dtype": dtype,
            "missing_pct": round(missing_pct, 2),
            "unique": unique,
            "min": min_value,
            "max": max_value,
            "samples": samples,
        })

    file_ext_source = ds.file_name or ""
    file_ext = file_ext_source.rsplit(".", 1)[-1] if "." in file_ext_source else ""
    return {
        "name": ds.display_name,
        "version": ds.version,
        "created": _isoformat(ds.created_at),
        "last_used": _isoformat(ds.last_used_at),
        "file_type": file_ext or "parquet",
        "n_rows": ds.n_rows,
        "sample_size": ds.sample_size,
        "n_columns": ds.n_cols,
        "columns": columns,
    }


@router.get("/{dataset_id}/models-with-roles", response_model=List[ModelWithRole])
def models_with_roles(
    dataset_id: str,
    membership: CurrentMembership = Depends(get_current_membership),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)
    models = session.exec(
        select(Model)
        .where(Model.dataset_id == dataset_id, Model.company_id == membership.company_id)
        .order_by(Model.created_at.desc())
    ).all()
    allowed_roles = {"hero", "challenger1", "challenger2"}
    items: list[ModelWithRole] = []
    for model in models:
        metrics = session.get(ModelMetrics, model.id)
        if not metrics:
            continue
        role = model.role if model.role in allowed_roles else None
        items.append(
            ModelWithRole(
                id=model.id,
                name=model.name,
                dataset_id=model.dataset_id,
                role=role,
                r2=metrics.r2,
                adj_r2=metrics.adj_r2,
                mae=metrics.mae,
                rmse=metrics.rmse,
                mape=metrics.mape,
            )
        )
    return items


@router.delete("/{dataset_id}")
def delete_dataset(
    dataset_id: str,
    cascade: bool = Query(True, description="Delete dependent transforms/models"),
    membership: CurrentMembership = Depends(require_write_access),
    session: Session = Depends(get_session),
):
    ds = get_scoped(session, Dataset, dataset_id, membership.company_id)

    deps = _dependency_counts(session, ds.id, ds.company_id)
    has_deps = any([deps.variables, deps.models, deps.scenarios])
    if has_deps and not cascade:
        raise api_error(400, "DATASET_HAS_DEPENDENCIES", "Dataset has dependencies", dependencies=deps.dict())

    if cascade:
        session.exec(delete(Variable).where(Variable.dataset_id == ds.id, Variable.company_id == ds.company_id))
        model_ids = session.exec(
            select(Model.id).where(Model.dataset_id == ds.id, Model.company_id == ds.company_id)
        ).all()
        if model_ids:
            session.exec(delete(Scenario).where(Scenario.model_id.in_(model_ids)))
            session.exec(delete(ModelMetrics).where(ModelMetrics.model_id.in_(model_ids)))
            session.exec(delete(Model).where(Model.id.in_(model_ids)))

    # Investment channels and conversion settings have no dependents of their own and aren't
    # counted in `deps` above (they never block a non-cascade delete), so they're always
    # cleaned up here to avoid orphaning them once the dataset they reference is gone.
    session.exec(
        delete(InvestmentChannel).where(
            InvestmentChannel.dataset_id == ds.id, InvestmentChannel.company_id == ds.company_id
        )
    )
    session.exec(
        delete(ConversionSettings).where(
            ConversionSettings.dataset_id == ds.id, ConversionSettings.company_id == ds.company_id
        )
    )

    storage = get_storage()
    for version in range(1, (ds.version or 1) + 1):
        try:
            storage.delete(_version_key(ds.company_id, ds.id, version))
        except Exception:
            pass

    session.delete(ds)
    session.commit()
    invalidate_cache_for_dataset(dataset_id)
    return {"status": "deleted", "id": ds.id}


def _detect_time_candidates(df: pd.DataFrame) -> list[TimeCandidate]:
    sample = df.head(MAX_TIME_SAMPLE)
    candidates: list[TimeCandidate] = []
    for column in sample.columns:
        series = sample[column]
        dtype = str(series.dtype)
        name_match = bool(TIME_NAME_PATTERN.search(column))
        parseable = False
        if is_datetime64_any_dtype(series):
            parseable = True
        elif series.dtype == object or name_match:
            parseable = _is_parseable(series)
        if parseable or name_match:
            candidates.append(TimeCandidate(name=column, dtype=dtype, parseable=parseable))
    candidates.sort(key=lambda item: (not item.parseable, item.name.lower()))
    return candidates


def _is_parseable(series: pd.Series) -> bool:
    sample = series.dropna().astype(str).head(MAX_TIME_SAMPLE)
    if sample.empty:
        return False
    parsed = pd.to_datetime(sample, errors="coerce")
    return bool(parsed.notna().mean() >= 0.9)


def _validate_time_parse(series: pd.Series, fmt: Optional[str], timezone: Optional[str]) -> None:
    sample = series.dropna()
    if sample.empty:
        return
    utc = bool(timezone and timezone.upper() == "UTC")
    parsed = pd.to_datetime(sample, format=fmt, errors="coerce", utc=utc)
    mask = parsed.isna()
    if not mask.any():
        return
    invalid = sample[mask]
    valid_ratio = 1 - (len(invalid) / len(sample))
    if valid_ratio >= 0.9:
        return
    samples = [{"index": int(idx), "value": str(value)} for idx, value in invalid.head(5).items()]
    raise api_error(400, "UNPARSEABLE_TIME_VALUES", "Unparseable time values", samples=samples)


def _schema_differences(old_cols: list[dict], new_cols: list[dict]) -> dict:
    old_map = {col["name"]: col["dtype"] for col in old_cols}
    new_map = {col["name"]: col["dtype"] for col in new_cols}
    old_names = set(old_map.keys())
    new_names = set(new_map.keys())
    added = sorted(new_names - old_names)
    removed = sorted(old_names - new_names)
    dtype_mismatch = sorted(
        name
        for name in old_names & new_names
        if _dtype_category(old_map.get(name)) != _dtype_category(new_map.get(name))
    )
    return {
        "added": added,
        "removed": removed,
        "dtype_mismatch": dtype_mismatch,
    }


def _dtype_category(dtype: Optional[str]) -> str:
    if not dtype:
        return "other"
    dtype = dtype.lower()
    numeric_tokens = ("int", "float", "double", "long", "decimal")
    datetime_tokens = ("datetime", "date", "timestamp")
    if any(token in dtype for token in numeric_tokens):
        return "number"
    if any(token in dtype for token in datetime_tokens):
        return "datetime"
    if "bool" in dtype:
        return "bool"
    return "string"


def _isoformat(dt: datetime | None) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _ensure_utc_datetime(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
