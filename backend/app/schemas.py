from __future__ import annotations

from datetime import date, datetime
from typing import Dict, List, Optional, Literal
from pydantic import BaseModel, Field


class ColumnInfo(BaseModel):
    name: str
    dtype: str


class DatasetDependencyInfo(BaseModel):
    variables: int = 0
    models: int = 0
    scenarios: int = 0


class DatasetOut(BaseModel):
    id: str
    display_name: str
    file_name: str
    n_rows: int
    total_rows: int
    n_cols: int
    sample_size: int | None = None
    time_variable: Optional[str] = None
    time_format: Optional[str] = None
    time_timezone: Optional[str] = None
    version: int = 1
    previous_version_id: Optional[str] = None
    created_at: datetime
    last_used_at: datetime
    columns: List[ColumnInfo]
    dependencies: DatasetDependencyInfo


class DatasetMeta(BaseModel):
    id: str
    name: str
    rows: int
    columns: int
    time_column: Optional[str] = None
    created_at: datetime
    last_used_at: datetime
    date_min: Optional[date] = None
    date_max: Optional[date] = None
    has_valid_dates: bool = False


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


class DatasetRenameRequest(BaseModel):
    display_name: str


class DatasetSampleSizeRequest(BaseModel):
    sample_size: Optional[int] = None


class DatasetUpdateResponse(BaseModel):
    id: str
    display_name: str
    old_version: int
    new_version: int
    replaced_columns: dict
    rows: int
    cols: int
    status: Literal["updated"] = "updated"


class DatasetVersionInfo(BaseModel):
    version: int
    created_at: datetime


class DatasetVersionsResponse(BaseModel):
    versions: List[DatasetVersionInfo]


class TimeCandidate(BaseModel):
    name: str
    dtype: str
    parseable: bool


class TimeSelection(BaseModel):
    name: Optional[str] = None
    time_format: Optional[str] = None
    time_timezone: Optional[str] = None


class TimeCandidateResponse(BaseModel):
    candidates: List[TimeCandidate]
    current: Optional[TimeSelection] = None


class TimeVariableRequest(BaseModel):
    column: Optional[str] = None
    coerce: bool = False
    time_format: Optional[str] = None
    timezone: Optional[str] = None


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
    created_at: Optional[datetime] = None


class VariableHistoryItem(BaseModel):
    id: str
    op: str
    params: dict
    created_at: datetime


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


class TransformPreviewRequest(BaseModel):
    dataset_id: str
    operation: TransformOp
    column: Optional[str] = None
    params: Dict[str, float | int | str | None] = Field(default_factory=dict)
    limit: int = Field(default=200, ge=1, le=1000)


class TransformPreviewPoint(BaseModel):
    before: Optional[float] = None
    after: Optional[float] = None


class TransformResponse(BaseModel):
    variable: VariableOut
    preview: List[TransformPreviewPoint] = []


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
    subgroup_id: Optional[str] = None
    group_id: Optional[str] = None


class RenameGroupRequest(BaseModel):
    name: str


class RenameSubgroupRequest(BaseModel):
    name: str


class CategorizeRequest(BaseModel):
    group_id: Optional[str] = None
    subgroup_id: Optional[str] = None


# Modeling
class CorrelationItem(BaseModel):
    name: str
    corr_y: Optional[float]
    corr_res: Optional[float] = None
    dtype: str
    derived: bool = False
    group_name: Optional[str] = None
    subgroup_name: Optional[str] = None


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
    role: Literal["hero", "challenger1", "challenger2", "none"] = "none"
    metrics: ModelMetricsOut


class ModelWithRole(BaseModel):
    id: str
    name: str
    dataset_id: str
    role: Optional[Literal["hero", "challenger1", "challenger2"]] = None
    r2: float
    adj_r2: float
    mae: float
    rmse: float
    mape: Optional[float] = None


class UpdateModelRequest(BaseModel):
    name: Optional[str] = None
    x_vars: Optional[list[str]] = None


class ModelRoleRequest(BaseModel):
    role: Literal["hero", "challenger1", "challenger2", "none"]


class CoefficientItem(BaseModel):
    name: str
    coef: float
    std_err: float
    t_value: float
    p_value: float
    vif: Optional[float] = None
    beta_std: Optional[float] = None


class ModelSummaryResponse(BaseModel):
    model_id: str
    intercept: CoefficientItem
    coefficients: list[CoefficientItem]


class PredictionsResponse(BaseModel):
    index: list[str]
    y_true: list[float]
    y_pred: list[float]
    residuals: list[float]


class SummaryTableExportRequest(BaseModel):
    dataset_id: str
    model_id: str
    include_intercept: bool = True
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    group_mode: Literal["group", "group_subgroup", "variable"] = "group"


class Adjustment(BaseModel):
    variable: str
    multiplier: float


class SimulationRequest(BaseModel):
    adjustments: list[Adjustment] = []


class PeriodValue(BaseModel):
    mode: Literal["multiplier", "value"] = "multiplier"
    value: float


ScenarioAdjustments = Dict[str, Dict[str, PeriodValue]]


class ScenarioBase(BaseModel):
    model_id: str
    name: str
    horizon: int = Field(gt=0, description="Number of periods to plan for")
    start_date: date
    freq: Literal["day", "week", "month"] = "month"
    adjustments: ScenarioAdjustments = Field(default_factory=dict)


class ScenarioCreate(ScenarioBase):
    pass


class ScenarioUpdate(BaseModel):
    name: Optional[str] = None
    horizon: Optional[int] = Field(default=None, gt=0)
    start_date: Optional[date] = None
    freq: Optional[Literal["day", "week", "month"]] = None
    adjustments: Optional[ScenarioAdjustments] = None


class ScenarioPreviewRequest(BaseModel):
    model_id: str
    horizon: int = Field(gt=0)
    start_date: date
    freq: Literal["day", "week", "month"] = "month"
    adjustments: ScenarioAdjustments = Field(default_factory=dict)


class ContributionSlice(BaseModel):
    id: Optional[str]
    name: Optional[str]
    value: float


class ScenarioSeriesPoint(BaseModel):
    period: str
    y_pred: float


class ScenarioSummary(BaseModel):
    periods: list[str]
    total: float
    average_per_period: float
    groups: list[ContributionSlice]
    subgroups: list[ContributionSlice]
    series: list[ScenarioSeriesPoint]


class ScenarioOut(BaseModel):
    id: str
    model_id: str
    dataset_id: Optional[str] = None
    name: str
    horizon: int
    start_date: date
    freq: Literal["day", "week", "month"]
    adjustments: ScenarioAdjustments
    summary: ScenarioSummary
    last_edited_at: datetime
    base_total: Optional[float] = None
    delta_pct_vs_base: Optional[float] = None


class ScenarioTimeseriesSlice(BaseModel):
    period: str
    y_pred: float
    by_group: list[ContributionSlice]
    by_subgroup: list[ContributionSlice]


class ScenarioTimeseriesResponse(BaseModel):
    scenario_id: str
    model_id: str
    periods: list[str]
    series: list[ScenarioTimeseriesSlice]


class ScenarioAssumptionsExportRequest(ScenarioPreviewRequest):
    mode: Literal["multipliers", "absolute"] = "multipliers"
    scenario_name: Optional[str] = None


class ScenarioProjectedExportRequest(ScenarioPreviewRequest):
    scenario_name: Optional[str] = None
    include_hero: bool = True


MembershipRole = Literal["modelador", "visualizador", "admin_compania"]


class CompanyOut(BaseModel):
    id: str
    name: str
    created_at: datetime


class CreateCompanyRequest(BaseModel):
    name: str
    admin_user_id: str


class MembershipOut(BaseModel):
    user_id: str
    company_id: str
    role: MembershipRole
    created_at: datetime


class AddMembershipRequest(BaseModel):
    user_id: str
    role: MembershipRole


class UpdateMembershipRequest(BaseModel):
    role: MembershipRole


class MyMembershipOut(BaseModel):
    company_id: str
    company_name: str
    role: MembershipRole


# Rebuild models so FastAPI/Pydantic resolve forward references with future annotations
ScenarioPreviewRequest.model_rebuild()
ScenarioAssumptionsExportRequest.model_rebuild()
ScenarioProjectedExportRequest.model_rebuild()
