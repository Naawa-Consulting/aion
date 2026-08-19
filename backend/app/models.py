from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import SQLModel, Field, UniqueConstraint


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Company(SQLModel, table=True):
    id: str = Field(primary_key=True)  # uuid string
    name: str
    currency_code: str = Field(default="MXN", nullable=False)  # ISO 4217, e.g. "MXN", "USD"
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
    frequency: str | None = Field(default=None, nullable=True)  # "daily"|"weekly"|"monthly"; metadata only
    previous_version_id: str | None = Field(default=None, nullable=True)
    version: int = Field(default=1, nullable=False)
    dependent_variable: str | None = Field(default=None, nullable=True)  # Variable.name
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
    is_excluded: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class Group(SQLModel, table=True):
    """Shared catalog of media groups, scoped to a company (not to a single dataset)."""

    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    name: str
    apply_media_transform: bool = Field(default=False, nullable=False)
    is_baseline: bool = Field(default=False, nullable=False)
    is_seasonal: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class Subgroup(SQLModel, table=True):
    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    group_id: str = Field(index=True)
    name: str
    apply_media_transform: bool = Field(default=False, nullable=False)
    is_seasonal: bool = Field(default=False, nullable=False)
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
    apply_media_transforms: bool = Field(default=True, nullable=False)
    media_grid_json: str | None = Field(default=None, nullable=True)  # override of services/model_fit.py grid; None = defaults
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


class ModelTransform(SQLModel, table=True):
    """Fitted adstock+Hill params per media x_var of a model. Absence of rows for a
    model_id means no media transform applies (control-only or legacy pre-redesign model)."""

    __table_args__ = (UniqueConstraint("model_id", "variable_name", name="uq_model_transform_model_var"),)

    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    model_id: str = Field(index=True)
    variable_name: str
    decay: float
    hill_k: float
    hill_s: float
    lag: int = Field(default=0, nullable=False)
    best_score: float | None = Field(default=None, nullable=True)  # corr^2 of the winning grid combo
    runner_up_score: float | None = Field(default=None, nullable=True)  # corr^2 of the 2nd-best combo


class InvestmentChannel(SQLModel, table=True):
    """Real $ investment channel, decoupled from model predictor variables so total spend
    (economic layer) can include channels with no selected predictor (contribution 0, cost > 0)
    and so a channel with several correlated metrics attributes cost to only one winning metric.
    Scoped to a dataset (like Variable), not a company-wide catalog like Group/Subgroup, because
    its config references actual dataset column names."""

    __table_args__ = (
        UniqueConstraint("company_id", "dataset_id", "name", name="uq_invchannel_company_dataset_name"),
    )

    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    dataset_id: str = Field(index=True)
    name: str
    source_mode: str  # "dataset_column" | "rate_metric" | "manual"
    config_json: str  # shape depends on source_mode, see services/economics.py
    proxy_variable: str | None = Field(default=None, nullable=True)  # Variable.name; None = never modeled
    created_at: datetime = Field(default_factory=utcnow, nullable=False)


class ConversionSettings(SQLModel, table=True):
    """Dataset-scoped conversion_rate/avg_value config, replacing the old per-Model fields of
    the same name so every model fit on a dataset shares one economics config instead of each
    needing its own. Each metric has its own source_mode (manual fixed value | dataset_column |
    rate_metric), mirroring InvestmentChannel's 3 modes, since either can vary by row (e.g. an
    avg-ticket column) instead of being a single constant."""

    __table_args__ = (
        UniqueConstraint("company_id", "dataset_id", name="uq_conversion_settings_company_dataset"),
    )

    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    dataset_id: str = Field(index=True)
    conversion_rate_mode: str  # "manual" | "dataset_column" | "rate_metric"
    conversion_rate_config_json: str
    avg_value_mode: str  # "manual" | "dataset_column" | "rate_metric"
    avg_value_config_json: str
    created_at: datetime = Field(default_factory=utcnow, nullable=False)


class Scenario(SQLModel, table=True):
    id: str = Field(primary_key=True)
    company_id: str = Field(index=True, foreign_key="company.id")
    model_id: str = Field(index=True)
    dataset_id: str
    name: str
    adjustments_json: str  # time-phased plan {horizon,start_date,freq,adjustments}, see routers/predict.py::_dump_definition
    results_json: str  # cached summary result
    is_featured: bool = Field(default=False, nullable=False)  # Fase 5/P6: max 3 per model, enforced in routers/predict.py
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    last_edited_at: datetime = Field(default_factory=utcnow, nullable=False)
