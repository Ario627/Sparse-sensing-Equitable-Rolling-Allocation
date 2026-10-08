from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Final, Literal, Self

from pydantic import (  # type: ignore
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    field_validator,
    model_validator,
)

from app.core.types import (
    CropStage,
    LossZone,
    NodeKind,
    PolicyProfile,
    ReadingQuality,
    SensorKind,
    TopologyKind,
)
from baselines.base import BaselineMethod
from estimator.identifiability import IdentifiabilityFailure
from experiments.progress import JobStatus
from experiments.runner import SEED_CEILING
from optimizer.binding_factors import BindingFactor, DeficitLevel, ForecastLabel
from optimizer.fallback import FallbackLevel, FallbackReason
from sensing.selection import SearchStrategy
from simulator.scenarios import LossProfile
from simulator.sensors import SensorNoiseLevel
from simulator.weather import ForecastGrade, SeasonKind

MAX_REQUEST_ID_LENGTH: Final = 64
MAX_PLAN_ITEMS: Final = 2_000
MAX_PLAN_SCENARIOS: Final = 500
MAX_SENSOR_COUNT: Final = 64
MAX_RUNS_PER_POLL: Final = 1_000
MAX_EXPERIMENT_RUNS: Final = 1_000_000
MAX_PARQUET_PATH_LENGTH: Final = 500


def _upper_text(value: object) -> object:
    if isinstance(value, str):
        return value.strip().upper()
    return value


def _lower_text(value: object) -> object:
    if isinstance(value, str):
        return value.strip().lower()
    return value


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamp must be timezone-aware")
    return value.astimezone(UTC)


type UtcDatetime = Annotated[datetime, AfterValidator(_as_utc)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class VersionedResponse(StrictModel):
    schema_version: Literal[1] = 1


class EnvelopeRequest(StrictModel):
    schema_version: Literal[1]
    request_id: str = Field(min_length=1, max_length=MAX_REQUEST_ID_LENGTH)


class EnvelopeResponse(VersionedResponse):
    request_id: str = Field(min_length=1, max_length=MAX_REQUEST_ID_LENGTH)


type HealthStatus = Literal["ok", "degraded"]


class HealthResponse(VersionedResponse):
    status: HealthStatus
    version: str = Field(min_length=1)
    uptime_s: float = Field(ge=0.0)
    active_experiments: int = Field(ge=0)


class SolverErrorDetail(StrictModel):
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    details: dict[str, JsonValue] | None = None


class SolverErrorResponse(StrictModel):
    detail: str = Field(min_length=1)
    error: SolverErrorDetail


class SensingObjective(StrEnum):
    ESTIMATION = "ESTIMATION"
    INFORMATION = "INFORMATION"
    DECISION = "DECISION"


class ExperimentRunStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class IntervalPayload(StrictModel):
    lower: float
    upper: float

    @model_validator(mode="after")
    def _require_ordered_interval(self) -> Self:
        if self.upper < self.lower:
            raise ValueError("upper must be at least lower")
        return self


class ObservationEntry(StrictModel):
    sensor_id: str = Field(min_length=1)
    kind: SensorKind
    recorded_at: UtcDatetime
    value: float
    target_id: str | None = None
    quality: ReadingQuality = ReadingQuality.GOOD

    @field_validator("kind", "quality", mode="before")
    @classmethod
    def _normalize_enum(cls, value: object) -> object:
        return _upper_text(value)


class StorageStateEntry(StrictModel):
    block_id: str = Field(min_length=1)
    mean_mm: float = Field(ge=0.0)
    std_mm: float | None = Field(default=None, ge=0.0)


class PreviousState(StrictModel):
    slot_index: int = Field(default=0, ge=0)
    entries: list[StorageStateEntry] = Field(min_length=1)


class BlockStateEntry(StrictModel):
    block_id: str = Field(min_length=1)
    storage_mm: float = Field(ge=0.0)
    std_mm: float = Field(ge=0.0)
    interval: IntervalPayload


class LossEntry(StrictModel):
    zone: LossZone
    eta: float = Field(gt=0.0, le=1.0)
    interval: IntervalPayload


class IdentifiabilitySummary(StrictModel):
    passed: bool
    rank: int = Field(ge=0)
    expected_rank: int = Field(ge=0)
    condition_number: float | None = Field(default=None, ge=0.0)
    min_eigenvalue: float = Field(ge=0.0)
    failures: list[IdentifiabilityFailure] = []


class EstimateDiagnostics(StrictModel):
    slot_index: int = Field(ge=0)
    block_count: int = Field(ge=0)
    observations_used: int = Field(ge=0)
    observations_ignored: int = Field(ge=0)
    confidence_level: float = Field(gt=0.0, lt=1.0)
    nis: float | None = Field(default=None, ge=0.0)
    nis_threshold: float | None = Field(default=None, gt=0.0)
    nis_consistent: bool | None = None
    identifiability: IdentifiabilitySummary | None = None


class EstimateResponse(EnvelopeResponse):
    network_id: str = Field(min_length=1)
    state: list[BlockStateEntry] = []
    covariance: list[list[float]] = []
    loss: list[LossEntry] = []
    confidence: float = Field(ge=0.0, le=1.0)
    diagnostics: EstimateDiagnostics


class GateFault(StrictModel):
    response_delay_min: float = Field(default=0.0, ge=0.0)
    delay_jitter_min: float = Field(default=0.0, ge=0.0)
    flow_bias_sigma: float = Field(default=0.0, ge=0.0, le=1.0)
    partial_open_prob: float = Field(default=0.0, ge=0.0, le=1.0)
    partial_open_min: float = Field(default=0.6, gt=0.0, le=1.0)
    partial_open_max: float = Field(default=1.0, gt=0.0, le=1.0)
    stuck_prob: float = Field(default=0.0, ge=0.0, le=1.0)
    stuck_open_prob: float = Field(default=0.5, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _require_open_window(self) -> Self:
        if self.partial_open_max < self.partial_open_min:
            raise ValueError("partial_open_max must be at least partial_open_min")
        return self


class ScenarioSpecPayload(StrictModel):
    scenario_id: str = Field(default="nominal", min_length=1)
    topology: TopologyKind = TopologyKind.CHAIN
    n_blocks: int = Field(default=10, ge=1)
    horizon_days: int = Field(default=30, ge=1)
    season: SeasonKind = SeasonKind.DRY
    supply_nominal_lps: float = Field(default=10.0, gt=0.0)
    loss_profile: LossProfile = LossProfile.NORMAL
    sensor_noise: SensorNoiseLevel = SensorNoiseLevel.MEDIUM
    sensor_block_ids: list[str] | None = None
    failed_zones: list[LossZone] = []
    forecast_grade: ForecastGrade = ForecastGrade.MODERATE
    gate_fault: GateFault = GateFault()
    flow_velocity_m_per_s: float = Field(default=0.25, gt=0.0)

    @field_validator(
        "topology",
        "season",
        "loss_profile",
        "sensor_noise",
        "forecast_grade",
        mode="before",
    )
    @classmethod
    def _normalize_enum(cls, value: object) -> object:
        return _upper_text(value)


class SimulatePolicy(StrictModel):
    method: BaselineMethod = BaselineMethod.SERA
    sensor_blocks: list[str] | None = None

    @field_validator("method", mode="before")
    @classmethod
    def _normalize_method(cls, value: object) -> object:
        return _lower_text(value)


class SimulateRequest(EnvelopeRequest):
    scenario_config: ScenarioSpecPayload
    seed: int = Field(ge=0)
    topology: TopologyKind | None = None
    k_factor: float | None = Field(default=None, gt=0.0, le=1.0)
    slot_hours: float = Field(default=1.0, gt=0.0)
    start_time: UtcDatetime | None = None
    policy: SimulatePolicy | None = None

    @field_validator("topology", mode="before")
    @classmethod
    def _normalize_topology(cls, value: object) -> object:
        return _upper_text(value)


class SlotSupply(StrictModel):
    slot_index: int = Field(ge=0)
    slot_start: datetime
    supply_lps: float = Field(ge=0.0)
    supply_binding: bool
    binding_edge_ids: list[str] = []


class TrajectoryRow(StrictModel):
    slot_index: int = Field(ge=0)
    day_index: int = Field(ge=0)
    block_id: str = Field(min_length=1)
    gate_open: bool
    requested_gross_m3: float = Field(ge=0.0)
    released_gross_m3: float = Field(ge=0.0)
    delivered_m3: float = Field(ge=0.0)
    storage_mm: float = Field(ge=0.0)
    path_efficiency: float = Field(gt=0.0, le=1.0)


class SimulateMetrics(StrictModel):
    slots: int = Field(ge=0)
    total_delivered_m3: float = Field(ge=0.0)
    total_gross_m3: float = Field(ge=0.0)
    final_storage_min_mm: float = Field(ge=0.0)
    final_storage_mean_mm: float = Field(ge=0.0)
    final_storage_max_mm: float = Field(ge=0.0)
    supply_binding_slots: int = Field(ge=0)
    n_resolves: int | None = Field(default=None, ge=0)
    fallback_count: int | None = Field(default=None, ge=0)
    nis_violations: int | None = Field(default=None, ge=0)
    dropouts: int | None = Field(default=None, ge=0)
    mean_confidence: float | None = Field(default=None, ge=0.0, le=1.0)


class SimulateArtifacts(StrictModel):
    parquet_path: str | None = Field(default=None, min_length=1)


class SimulateResponse(EnvelopeResponse):
    scenario_id: str = Field(min_length=1)
    network_id: str = Field(min_length=1)
    slot_count: int = Field(ge=0)
    slots: list[SlotSupply] = []
    trajectory: list[TrajectoryRow] = []
    metrics: SimulateMetrics
    artifacts: SimulateArtifacts


class NetworkNode(StrictModel):
    id: str = Field(min_length=1)
    type: NodeKind
    name: str = ""
    order_idx: int | None = Field(default=None, ge=0)

    @field_validator("type", mode="before")
    @classmethod
    def _normalize_type(cls, value: object) -> object:
        return _upper_text(value)


class NetworkEdge(StrictModel):
    id: str = Field(min_length=1)
    from_node_id: str = Field(min_length=1)
    to_node_id: str = Field(min_length=1)
    capacity_lps: float = Field(gt=0.0)
    zone: LossZone = LossZone.MIDDLE
    length_m: float | None = Field(default=None, ge=0.0)

    @field_validator("zone", mode="before")
    @classmethod
    def _normalize_zone(cls, value: object) -> object:
        return _upper_text(value)


class NetworkBlock(StrictModel):
    id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)
    name: str = ""
    area_m2: float = Field(gt=0.0)
    crop_type: str = Field(default="paddy", min_length=1)
    nominal_flow_lps: float = Field(gt=0.0)
    distance_from_source_m: float | None = Field(default=None, ge=0.0)


class NetworkPayload(StrictModel):
    id: str = Field(min_length=1)
    name: str = ""
    topology: TopologyKind
    nodes: list[NetworkNode] = Field(min_length=1)
    edges: list[NetworkEdge] = Field(min_length=1)
    blocks: list[NetworkBlock] = Field(min_length=1)

    @field_validator("topology", mode="before")
    @classmethod
    def _normalize_topology(cls, value: object) -> object:
        return _upper_text(value)


class EstimateRequest(EnvelopeRequest):
    network_id: str = Field(min_length=1)
    observations: list[ObservationEntry] = []
    state_prev: PreviousState | None = None
    network: NetworkPayload | None = None
    params: dict[str, JsonValue] = {}


class LedgerEntry(StrictModel):
    block_id: str = Field(min_length=1)
    period_start: UtcDatetime
    period_end: UtcDatetime
    target_fair_m3: float = Field(ge=0.0)
    target_req_m3: float = Field(ge=0.0)
    delivered_m3: float = Field(ge=0.0)
    service_ratio: float = Field(ge=0.0)
    debt_m3: float = Field(ge=0.0)
    debt_capped: bool


class ForecastEntry(StrictModel):
    valid_from: UtcDatetime
    valid_to: UtcDatetime
    source: str = Field(min_length=1)
    rainfall_mm: float | None = Field(default=None, ge=0.0)
    et0_mm: float | None = Field(default=None, ge=0.0)
    temp_c: float | None = None


class StateEntry(StrictModel):
    block_id: str = Field(min_length=1)
    ts: UtcDatetime
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    state: JsonValue
    covariance: JsonValue
    method: str = Field(min_length=1)


class PlanHorizon(StrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    from_ts: UtcDatetime = Field(alias="from")
    to_ts: UtcDatetime = Field(alias="to")
    slot_hours: float = Field(gt=0.0)

    @model_validator(mode="after")
    def _require_ordered_window(self) -> Self:
        if self.to_ts <= self.from_ts:
            raise ValueError("horizon.to must be after horizon.from")
        return self


class PlanRequest(EnvelopeRequest):
    network_id: str = Field(min_length=1)
    network: NetworkPayload
    profile: PolicyProfile = PolicyProfile.BALANCED
    horizon: PlanHorizon
    state: list[StateEntry] | None = None
    ledger: list[LedgerEntry] = []
    forecasts: list[ForecastEntry] = []
    params: dict[str, JsonValue] = {}

    @field_validator("profile", mode="before")
    @classmethod
    def _normalize_profile(cls, value: object) -> object:
        return _upper_text(value)


class PlanItem(StrictModel):
    block_id: str = Field(min_length=1)
    slot_start: UtcDatetime
    slot_end: UtcDatetime
    gate_open: bool
    volume_del_m3: float | None = Field(default=None, ge=0.0)
    volume_gross_m3: float | None = Field(default=None, ge=0.0)
    service_ratio_est: float | None = Field(default=None, ge=0.0)
    reason: list[BindingFactor] | None = None


class PlanScenario(StrictModel):
    scenario_id: str = Field(min_length=1, max_length=64)
    probability: float = Field(ge=0.0, le=1.0)
    payload: JsonValue | None = None


class PlanObjective(StrictModel):
    service_floor_z: float = Field(ge=0.0, le=1.0)
    shortage_total_expected_m3: float = Field(ge=0.0)
    safety_slack_total_expected: float = Field(ge=0.0)
    switching_total_expected: float = Field(ge=0.0)
    gross_withdrawal_expected_m3: float = Field(ge=0.0)
    fallback_level: FallbackLevel | None = None
    fallback_reason: FallbackReason | None = None


class BlockExplanationPayload(StrictModel):
    block_id: str = Field(min_length=1)
    service_ratio: float = Field(ge=0.0)
    deficit_level: DeficitLevel
    crop_stage: CropStage
    tail_position: bool
    forecast_label: ForecastLabel
    sensor_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    window_slot_start: int | None = Field(default=None, ge=0)
    window_slot_end: int | None = Field(default=None, ge=0)
    binding_factors: list[BindingFactor] = []


class SolverStats(StrictModel):
    solver: str = Field(min_length=1, max_length=32)
    time_ms: int = Field(ge=0)
    mip_gap: float | None = Field(default=None, ge=0.0)


class PlanResponse(EnvelopeResponse):
    plan_id: str | None = Field(default=None, min_length=1, max_length=64)
    items: list[PlanItem] = Field(min_length=1, max_length=MAX_PLAN_ITEMS)
    scenarios: list[PlanScenario] = Field(default=[], max_length=MAX_PLAN_SCENARIOS)
    objective: PlanObjective
    binding_factors: list[BlockExplanationPayload] = []
    solver_stats: SolverStats


class SensingSelectRequest(EnvelopeRequest):
    network_id: str = Field(min_length=1)
    network: NetworkPayload
    candidates: list[str] = Field(min_length=1)
    k: int = Field(ge=0)
    objective: SensingObjective = SensingObjective.ESTIMATION
    loss_profile: LossProfile = LossProfile.NORMAL
    sensor_noise: SensorNoiseLevel = SensorNoiseLevel.MEDIUM
    strategy: SearchStrategy | None = None
    seed: int = Field(default=0, ge=0)
    repetitions: int = Field(default=1, ge=1)
    cvar_alpha: float | None = Field(default=None, gt=0.0, lt=1.0)

    @field_validator("objective", "loss_profile", "sensor_noise", mode="before")
    @classmethod
    def _normalize_enum(cls, value: object) -> object:
        return _upper_text(value)


class RegretEstimate(StrictModel):
    shortage_m3: float
    equity: float
    cvar_shortage_m3: float


class SensingSelectResponse(EnvelopeResponse):
    network_id: str = Field(min_length=1)
    objective: SensingObjective
    strategy: SearchStrategy
    selected: list[str] = []
    score: float
    evaluated_subsets: int = Field(ge=1)
    info_matrix: list[list[float]] = []
    regret_estimate: RegretEstimate | None = None


class ExperimentStartRequest(EnvelopeRequest):
    config_yaml: str | None = Field(default=None, min_length=1)
    config: dict[str, JsonValue] | None = None
    seed_base: int | None = Field(default=None, ge=0, lt=SEED_CEILING)
    max_runs: int | None = Field(default=None, ge=1, le=MAX_EXPERIMENT_RUNS)

    @model_validator(mode="after")
    def _require_single_source(self) -> Self:
        provided = sum(1 for value in (self.config_yaml, self.config) if value is not None)
        if provided != 1:
            raise ValueError("provide exactly one of config_yaml or config")
        return self


class ExperimentStartResponse(EnvelopeResponse):
    experiment_id: str = Field(min_length=1, max_length=64)
    status: JobStatus
    runs_total: int = Field(ge=1)
    config_hash: str = Field(min_length=8, max_length=128)


class RunMetricWithUnit(StrictModel):
    value: float
    unit: str | None = Field(default=None, min_length=1, max_length=24)


type RunMetricValue = float | RunMetricWithUnit


class ExperimentRun(StrictModel):
    run_index: int = Field(ge=0)
    scenario_id: str = Field(min_length=1, max_length=64)
    seed: int = Field(ge=0)
    method: BaselineMethod
    sensor_count: int = Field(ge=0, le=MAX_SENSOR_COUNT)
    topology: TopologyKind
    k_factor: float = Field(gt=0.0)
    status: ExperimentRunStatus
    parquet_path: str | None = Field(default=None, min_length=1, max_length=MAX_PARQUET_PATH_LENGTH)
    metrics: dict[str, RunMetricValue] = {}
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ExperimentStatusResponse(VersionedResponse):
    experiment_id: str = Field(min_length=1, max_length=64)
    status: JobStatus
    runs_done: int = Field(ge=0)
    runs_total: int = Field(ge=1)
    median_regret: float | None = Field(default=None, ge=0.0)
    worst_sr: float | None = Field(default=None, ge=0.0)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    runs: list[ExperimentRun] = Field(default=[], max_length=MAX_RUNS_PER_POLL)


class ExperimentCancelResponse(VersionedResponse):
    experiment_id: str = Field(min_length=1, max_length=64)
    status: JobStatus


class MetricAggregate(StrictModel):
    n: int = Field(ge=1)
    mean: float
    median: float
    ci: IntervalPayload


class ExperimentMetricsResponse(VersionedResponse):
    experiment_id: str = Field(min_length=1, max_length=64)
    status: JobStatus
    failures_total: int = Field(ge=0)
    aggregates: dict[str, MetricAggregate] = {}
    per_method: dict[str, dict[str, MetricAggregate]] = {}
    per_sensor_count: dict[str, dict[str, MetricAggregate]] = {}
