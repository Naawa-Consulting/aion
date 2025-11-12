from __future__ import annotations

from typing import List, Optional, Literal
from pydantic import BaseModel


class ColumnInfo(BaseModel):
    name: str
    dtype: str


class DatasetOut(BaseModel):
    id: str
    name: str
    n_rows: int
    n_cols: int
    columns: List[ColumnInfo]


class UploadResult(BaseModel):
    datasets: list[DatasetOut]


class PreviewResponse(BaseModel):
    columns: List[str]
    rows: List[dict]


class ColumnRename(BaseModel):
    from_name: str
    to_name: str


class ColumnRenameRequest(BaseModel):
    renames: List[ColumnRename]


class VariableOut(BaseModel):
    id: str
    dataset_id: str
    name: str
    dtype: str
    is_derived: bool
    subgroup_id: Optional[str] = None
    subgroup_name: Optional[str] = None
    group_id: Optional[str] = None
    group_name: Optional[str] = None


TransformOp = Literal["lag", "decay", "log", "add", "sub", "mul", "div"]


class TransformRequest(BaseModel):
    dataset_id: str
    op: TransformOp
    new_name: str
    column: Optional[str] = None      # for lag/decay/log
    n: Optional[int] = None           # for lag
    alpha: Optional[float] = None     # for decay (0<alpha<=1)
    left: Optional[str] = None        # for arithmetic
    right: Optional[str] = None       # for arithmetic


class GroupOut(BaseModel):
    id: str
    name: str
    subgroups: List["SubgroupOut"]


class SubgroupOut(BaseModel):
    id: str
    name: str
    group_id: str


GroupOut.model_rebuild()


class CreateGroupRequest(BaseModel):
    name: str


class CreateSubgroupRequest(BaseModel):
    group_id: str
    name: str


class AssignVariableRequest(BaseModel):
    dataset_id: str
    variable_name: str
    subgroup_id: str


# Modeling
class CorrelationItem(BaseModel):
    name: str
    corr: float
    dtype: str


class CorrelationResponse(BaseModel):
    y: str
    items: list[CorrelationItem]


class CreateModelRequest(BaseModel):
    dataset_id: str
    name: str
    y_var: str
    x_vars: list[str]


class ModelMetricsOut(BaseModel):
    r2: float
    adj_r2: float
    vif: list[dict]
    durbin_watson: float
    mae: float
    rmse: float
    mape: float | None = None


class ModelOut(BaseModel):
    id: str
    name: str
    dataset_id: str
    y_var: str
    x_vars: list[str]
    is_hero: bool
    metrics: ModelMetricsOut


class Adjustment(BaseModel):
    variable: str
    multiplier: float


class SimulationRequest(BaseModel):
    adjustments: list[Adjustment] = []


class ScenarioRequest(BaseModel):
    name: str
    adjustments: list[Adjustment] = []


class ScenarioOut(BaseModel):
    id: str
    model_id: str
    name: str
    adjustments: list[Adjustment]
    results: dict
