from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import SQLModel, Field, UniqueConstraint


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Company(SQLModel, table=True):
    id: str = Field(primary_key=True)  # uuid string
    name: str
    created_at: datetime = Field(default_factory=utcnow, nullable=False)


class Membership(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "company_id", name="uq_membership_user_company"),)

    id: str = Field(primary_key=True)
    user_id: str = Field(index=True)  # supabase auth.users.id (uuid) — no cross-schema FK
    company_id: str = Field(index=True, foreign_key="company.id")
    role: str  # "modelador" | "visualizador" | "admin_compania"
    created_at: datetime = Field(default_factory=utcnow, nullable=False)


class Dataset(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("company_id", "file_name", "checksum", name="uq_dataset_company_file_checksum"),)

    id: str = Field(primary_key=True)  # uuid string
    company_id: str = Field(index=True, foreign_key="company.id")
    name: str  # legacy name kept for backward compatibility
    display_name: str
    file_name: str
    storage_key: str  # object key in Supabase Storage, e.g. {company_id}/{dataset_id}/v{n}.parquet
    checksum: str
    n_rows: int
    n_cols: int
    columns_json: str  # JSON-encoded list of {name,dtype}
    sample_size: int | None = Field(default=None, nullable=True)
    time_variable: str | None = Field(default=None, nullable=True)
    time_format: str | None = Field(default=None, nullable=True)
    time_timezone: str | None = Field(default=None, nullable=True)
    previous_version_id: str | None = Field(default=None, nullable=True)
    version: int = Field(default=1, nullable=False)
    created_at: datetime = Field(default_factory=utcnow, nullable=False)
    last_used_at: datetime = Field(default_factory=utcnow, nullable=False)


class Variable(SQLModel, table=True):
    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    dataset_id: str = Field(index=True)
    name: str
    dtype: str
    is_derived: bool = False
    source_spec_json: Optional[str] = None
    group_id: Optional[str] = None
    subgroup_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class Group(SQLModel, table=True):
    """Shared catalog of media groups, scoped to a company (not to a single dataset)."""

    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    name: str
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class Subgroup(SQLModel, table=True):
    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    group_id: str = Field(index=True)
    name: str
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class VariableHistory(SQLModel, table=True):
    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    dataset_id: str = Field(index=True)
    variable_id: str = Field(index=True)
    op: str
    params_json: str
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class Model(SQLModel, table=True):
    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    name: str
    dataset_id: str = Field(index=True)
    y_var: str
    x_vars_json: str  # JSON array of variable names
    is_hero: bool = False  # legacy flag
    role: str = Field(default="none")  # hero|challenger1|challenger2|none
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class ModelMetrics(SQLModel, table=True):
    model_id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    r2: float
    adj_r2: float
    durbin_watson: float
    mae: float
    rmse: float
    mape: float | None = None
    vif_json: str  # JSON array of {name, vif}


class Scenario(SQLModel, table=True):
    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    model_id: str = Field(index=True)
    dataset_id: str
    name: str
    adjustments_json: str  # JSON array of {variable, multiplier}
    results_json: str  # cached summary result
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    last_edited_at: datetime = Field(default_factory=utcnow, nullable=False)
