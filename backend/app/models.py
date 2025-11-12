from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


class Dataset(SQLModel, table=True):
    id: str = Field(primary_key=True)  # uuid string
    name: str
    path: str
    n_rows: int
    n_cols: int
    columns_json: str  # JSON-encoded list of {name,dtype}
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class Variable(SQLModel, table=True):
    id: str = Field(primary_key=True)
    dataset_id: str
    name: str
    dtype: str
    is_derived: bool = False
    source_spec_json: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class Group(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class Subgroup(SQLModel, table=True):
    id: str = Field(primary_key=True)
    group_id: str
    name: str
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class VariableGroup(SQLModel, table=True):
    id: str = Field(primary_key=True)
    dataset_id: str
    variable_name: str
    subgroup_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class Model(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    dataset_id: str
    y_var: str
    x_vars_json: str  # JSON array of variable names
    is_hero: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class ModelMetrics(SQLModel, table=True):
    model_id: str = Field(primary_key=True)
    r2: float
    adj_r2: float
    durbin_watson: float
    mae: float
    rmse: float
    mape: float | None = None
    vif_json: str  # JSON array of {name, vif}


class Scenario(SQLModel, table=True):
    id: str = Field(primary_key=True)
    model_id: str
    name: str
    adjustments_json: str  # JSON array of {variable, multiplier}
    results_json: str  # cached summary result
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
