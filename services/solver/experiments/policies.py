from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Final, cast

import numpy as np  # type: ignore

from app.core.rng import generator_for
from app.core.types import (
    DomainInvariantError,
    Interval,
    LossZone,
    PolicyProfile,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
    require_unit_open_closed,
)
from app.core.units import (
    combined_path_efficiency,
    flow_hours_to_volume_m3,
    volume_m3_to_storage_mm,
)
from app.demand.crop_water import HOURS_PER_DAY, demand_targets, slot_mm_from_daily_rate
from app.demand.kp01 import (
    KP01_PERC_DEFAULT_MM_PER_DAY,
    effective_rainfall_paddy_mm,
    is_critical_stage,
    kc_for_stage,
    water_layer_replacement_mm_per_day,
)
from app.ledger.service_debt import ServiceLedgerState, advance_ledger
from baselines.base import BaselineMethod, BaselineStrategy
from baselines.oracle import OracleStrategy
from baselines.registry import DEFAULT_REGISTRY, BaselineRegistry
from estimator.confidence import (
    DEFAULT_LEVEL,
    check_innovation,
    confidence_score,
    eta_interval,
    gaussian_interval,
)
from estimator.ekf import GaussianState, ekf_predict, ekf_update
from estimator.loss import (
    JointControl,
    JointEstimateView,
    JointStorageLossModel,
    LossGroupSpec,
    build_joint_model,
    initial_joint_state,
    joint_process_covariance,
    path_efficiency_from_z,
    prepare_measurement,
)
from estimator.observations import LevelReadingLike, build_measurement_batch
from optimizer.fallback import (
    FallbackContext,
    FallbackLevel,
    FallbackPolicy,
    FallbackReason,
    LastFeasiblePlan,
    select_fallback,
)
from optimizer.model import PlanningBlockSpec, PlanningProblem, PlanningScenario
from optimizer.objectives import LexicographicRequest
from optimizer.params import CVAR_ALPHA_DEFAULT, GAMMA_DEFAULT, SHORTAGE_LAMBDA_DEFAULT
from optimizer.rolling import (
    RollingOutcome,
    RollingRequest,
    last_feasible_snapshot,
    rolling_solve,
)
from optimizer.stochastic import RiskMode, ScenarioConfig, require_cvar_support
from simulator.crop import stage_for_day
from simulator.engine import SlotContext
from simulator.network import NetworkIndex
from simulator.sensors import SensorKind, SensorSample
from simulator.weather import ForecastDay

ZONE_EFFICIENCY_DESIGN: Final[Mapping[LossZone, float]] = MappingProxyType(
    {LossZone.HEAD: 0.95, LossZone.MIDDLE: 0.90, LossZone.TAIL: 0.85}
)
NIS_LEVEL: Final = 0.95
EFFICIENCY_CEILING: Final = 0.99
SENSOR_ID_PREFIX: Final = "lvl-"


class BaselinePolicyMode(StrEnum):
    OBSERVED = "OBSERVED"
    STATELESS = "STATELESS"
    ORACLE = "ORACLE"


def slots_per_day_for(slot_hours: float) -> int:
    duration = require_positive(slot_hours, "slot_hours")
    ratio = HOURS_PER_DAY / duration
    rounded = round(ratio)
    if rounded < 1 or not math.isclose(ratio, rounded, rel_tol=1e-9):
        raise DomainInvariantError("slot_hours must divide 24 hours into whole slots")
    return rounded


def _require_slot(slot: int, slot_count: int, name: str) -> int:
    if isinstance(slot, bool) or not isinstance(slot, int) or not 0 <= slot < slot_count:
        raise DomainInvariantError(f"{name} must lie in [0, {slot_count})")
    return slot


def _clamp_efficiency(value: float, floor: float) -> float:
    return min(max(value, floor), EFFICIENCY_CEILING)


def _require_rotation_groups(
    groups: tuple[tuple[str, ...], ...] | None,
) -> None:
    if groups is None:
        return
    if not groups:
        raise DomainInvariantError("fallback_rotation_groups must not be empty")
    for group in groups:
        if not group:
            raise DomainInvariantError("fallback rotation groups must not be empty")
        for block_id in group:
            require_identifier(block_id, "rotation block_id")
        require_unique(group, "rotation block_id")


@dataclass(frozen=True, slots=True)
class PolicyConfig:
    profile: PolicyProfile = PolicyProfile.BALANCED
    stage_time_limit_s: float = 6.0
    shortage_lambda: float = SHORTAGE_LAMBDA_DEFAULT
    horizon_slots: int = 6
    commit_slots: int = 1
    debt_service_fraction: float = 0.0
    supply_lps: float = 10.0
    gamma: float = GAMMA_DEFAULT
    debt_cap_days: float = 10.0
    min_storage_mm: float = 10.0
    max_storage_mm: float = 100.0
    percolation_mm_per_day: float = KP01_PERC_DEFAULT_MM_PER_DAY
    wlr_mm_per_day: float = water_layer_replacement_mm_per_day()
    assumed_efficiency_by_zone: Mapping[LossZone, float] = ZONE_EFFICIENCY_DESIGN
    planning_efficiency_floor: float = 0.30
    prior_storage_mm: float = 50.0
    prior_storage_sigma_mm: float = 15.0
    prior_eta: float = 0.90
    prior_eta_sigma_logit: float = 0.50
    process_storage_sigma_mm: float = 1.0
    process_drift_sigma_logit: float = 0.02
    dropout_inflation_mm2: float = 4.0
    measurement_sigma_mm: float = 3.0
    confidence_tolerance_mm: float = 5.0
    scenario_config: ScenarioConfig = field(default_factory=ScenarioConfig)
    risk_mode: RiskMode = RiskMode.STOCHASTIC
    cvar_alpha: float | None = CVAR_ALPHA_DEFAULT
    minimum_confidence: float | None = None
    fallback_short_horizon_slots: int = 3
    fallback_rotation_groups: tuple[tuple[str, ...], ...] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.profile, PolicyProfile):
            raise DomainInvariantError("profile must be a PolicyProfile")
        if not isinstance(self.scenario_config, ScenarioConfig):
            raise DomainInvariantError("scenario_config must be a ScenarioConfig")
        if not isinstance(self.risk_mode, RiskMode):
            raise DomainInvariantError("risk_mode must be a RiskMode")
        if (
            isinstance(self.horizon_slots, bool)
            or not isinstance(self.horizon_slots, int)
            or self.horizon_slots < 1
        ):
            raise DomainInvariantError("horizon_slots must be a positive integer")
        if (
            isinstance(self.commit_slots, bool)
            or not isinstance(self.commit_slots, int)
            or not 1 <= self.commit_slots <= self.horizon_slots
        ):
            raise DomainInvariantError("commit_slots must lie in [1, horizon_slots]")
        if not 0.0 <= self.debt_service_fraction <= 1.0:
            raise DomainInvariantError("debt_service_fraction must lie in [0, 1]")
        require_positive(self.stage_time_limit_s, "stage_time_limit_s")
        require_non_negative(self.shortage_lambda, "shortage_lambda")
        require_positive(self.supply_lps, "supply_lps")
        require_unit_open_closed(self.gamma, "gamma")
        require_positive(self.debt_cap_days, "debt_cap_days")
        require_non_negative(self.min_storage_mm, "min_storage_mm")
        require_positive(self.max_storage_mm, "max_storage_mm")
        if self.max_storage_mm <= self.min_storage_mm:
            raise DomainInvariantError("max_storage_mm must exceed min_storage_mm")
        require_non_negative(self.percolation_mm_per_day, "percolation_mm_per_day")
        require_non_negative(self.wlr_mm_per_day, "wlr_mm_per_day")
        for zone in LossZone:
            if zone not in self.assumed_efficiency_by_zone:
                raise DomainInvariantError(f"assumed efficiency missing for zone {zone.value}")
            require_unit_open_closed(
                self.assumed_efficiency_by_zone[zone], f"assumed_efficiency[{zone.value}]"
            )
        floor = require_unit_open_closed(
            self.planning_efficiency_floor, "planning_efficiency_floor"
        )
        if not floor < EFFICIENCY_CEILING:
            raise DomainInvariantError("planning_efficiency_floor must stay below one")
        require_non_negative(self.prior_storage_mm, "prior_storage_mm")
        if self.prior_storage_mm > self.max_storage_mm:
            raise DomainInvariantError("prior_storage_mm must not exceed max_storage_mm")
        require_positive(self.prior_storage_sigma_mm, "prior_storage_sigma_mm")
        require_unit_open_closed(self.prior_eta, "prior_eta")
        require_positive(self.prior_eta_sigma_logit, "prior_eta_sigma_logit")
        require_positive(self.process_storage_sigma_mm, "process_storage_sigma_mm")
        require_non_negative(self.process_drift_sigma_logit, "process_drift_sigma_logit")
        require_non_negative(self.dropout_inflation_mm2, "dropout_inflation_mm2")
        require_positive(self.measurement_sigma_mm, "measurement_sigma_mm")
        require_positive(self.confidence_tolerance_mm, "confidence_tolerance_mm")
        if self.cvar_alpha is not None:
            if not 0.0 < self.cvar_alpha < 1.0:
                raise DomainInvariantError("cvar_alpha must lie in (0, 1)")
            require_cvar_support(self.scenario_config.n_scenarios, self.cvar_alpha)
        if self.minimum_confidence is not None and not 0.0 <= self.minimum_confidence <= 1.0:
            raise DomainInvariantError("minimum_confidence must lie in [0, 1]")
        if (
            isinstance(self.fallback_short_horizon_slots, bool)
            or not isinstance(self.fallback_short_horizon_slots, int)
            or self.fallback_short_horizon_slots < 1
        ):
            raise DomainInvariantError("fallback_short_horizon_slots must be a positive integer")
        _require_rotation_groups(self.fallback_rotation_groups)


@dataclass(frozen=True, slots=True)
class TargetWindow:
    etc_mm: tuple[tuple[float, ...], ...]
    perc_mm: tuple[tuple[float, ...], ...]
    wlr_mm: tuple[tuple[float, ...], ...]
    rain_effective_mm: tuple[tuple[float, ...], ...]
    target_fair_m3: tuple[tuple[float, ...], ...]

    def __post_init__(self) -> None:
        lengths = {
            len(self.etc_mm),
            len(self.perc_mm),
            len(self.wlr_mm),
            len(self.rain_effective_mm),
            len(self.target_fair_m3),
        }
        if len(lengths) != 1:
            raise DomainInvariantError("window matrices must share one block count")
        slot_counts = {
            len(self.etc_mm[0]),
            len(self.perc_mm[0]),
            len(self.wlr_mm[0]),
            len(self.rain_effective_mm[0]),
            len(self.target_fair_m3[0]),
        }
        if len(slot_counts) != 1:
            raise DomainInvariantError("window matrices must share one slot count")
        if not self.etc_mm or next(iter(slot_counts)) < 1:
            raise DomainInvariantError("window must span at least one block and one slot")

    @property
    def slot_count(self) -> int:
        return len(self.etc_mm[0])


@dataclass(frozen=True, slots=True)
class TargetTable:
    block_ids: tuple[str, ...]
    slot_hours: float
    slots_per_day: int
    required_m3: tuple[tuple[float, ...], ...]
    fair_m3: tuple[tuple[float, ...], ...]
    etc_mm: tuple[tuple[float, ...], ...]
    perc_mm: tuple[tuple[float, ...], ...]
    wlr_mm: tuple[tuple[float, ...], ...]
    rain_effective_mm: tuple[tuple[float, ...], ...]
    path_efficiency: Mapping[str, float]

    def __post_init__(self) -> None:
        if not self.block_ids:
            raise DomainInvariantError("block_ids must not be empty")
        require_unique(self.block_ids, "block_id")
        require_positive(self.slot_hours, "slot_hours")
        if (
            isinstance(self.slots_per_day, bool)
            or not isinstance(self.slots_per_day, int)
            or self.slots_per_day < 1
        ):
            raise DomainInvariantError("slots_per_day must be a positive integer")
        block_count = len(self.block_ids)
        for name in (
            "required_m3",
            "fair_m3",
            "etc_mm",
            "perc_mm",
            "wlr_mm",
            "rain_effective_mm",
        ):
            matrix = getattr(self, name)
            if len(matrix) != block_count:
                raise DomainInvariantError(f"{name} must carry one row per block")
            slot_count = len(matrix[0])
            if slot_count < 1 or slot_count % self.slots_per_day != 0:
                raise DomainInvariantError(f"{name} must span a whole number of days")
            if any(len(row) != slot_count for row in matrix):
                raise DomainInvariantError(f"{name} rows must share one slot count")
        if set(self.path_efficiency) != set(self.block_ids):
            raise DomainInvariantError("path_efficiency must cover every block")

    @classmethod
    def build(
        cls,
        network: NetworkIndex,
        forecast: Sequence[ForecastDay],
        config: PolicyConfig,
        *,
        slot_hours: float,
    ) -> TargetTable:
        if not isinstance(config, PolicyConfig):
            raise DomainInvariantError("config must be a PolicyConfig")
        per_day = slots_per_day_for(slot_hours)
        days = tuple(forecast)
        if not days:
            raise DomainInvariantError("forecast must not be empty")
        for position, day in enumerate(days):
            if day.day_index != position:
                raise DomainInvariantError("forecast days must be indexed contiguously from zero")
        block_ids = network.block_ids
        efficiency = {
            block_id: combined_path_efficiency(
                config.assumed_efficiency_by_zone[network.edge_by_id[edge_id].zone]
                for edge_id in network.path_edges[block_id]
            )
            for block_id in block_ids
        }
        required: dict[str, list[float]] = {block_id: [] for block_id in block_ids}
        fair: dict[str, list[float]] = {block_id: [] for block_id in block_ids}
        etc_rows: dict[str, list[float]] = {block_id: [] for block_id in block_ids}
        perc_rows: dict[str, list[float]] = {block_id: [] for block_id in block_ids}
        wlr_rows: dict[str, list[float]] = {block_id: [] for block_id in block_ids}
        rain_rows: dict[str, list[float]] = {block_id: [] for block_id in block_ids}
        for day in days:
            stage = stage_for_day(day.day_index)
            critical = is_critical_stage(stage)
            etc_per_day = kc_for_stage(stage) * day.et0_mm_per_day
            rain_per_slot = (
                effective_rainfall_paddy_mm(day.rainfall_mm) * slot_hours / HOURS_PER_DAY
            )
            etc_per_slot = slot_mm_from_daily_rate(etc_per_day, slot_hours)
            perc_per_slot = slot_mm_from_daily_rate(config.percolation_mm_per_day, slot_hours)
            wlr_per_slot = slot_mm_from_daily_rate(config.wlr_mm_per_day, slot_hours)
            for _ in range(per_day):
                for block_id in block_ids:
                    block = network.block_by_id[block_id]
                    targets = demand_targets(
                        etc_mm_per_day=etc_per_day,
                        perc_mm_per_day=config.percolation_mm_per_day,
                        wlr_mm_per_day=config.wlr_mm_per_day,
                        effective_rain_slot_mm=rain_per_slot,
                        hours=slot_hours,
                        area_m2=block.area_m2,
                        nominal_flow_lps=block.nominal_flow_lps,
                        path_efficiency=efficiency[block_id],
                        critical_stage=critical,
                    )
                    required[block_id].append(targets.target_req_m3)
                    fair[block_id].append(targets.target_fair_m3)
                    etc_rows[block_id].append(etc_per_slot)
                    perc_rows[block_id].append(perc_per_slot)
                    wlr_rows[block_id].append(wlr_per_slot)
                    rain_rows[block_id].append(rain_per_slot)
        return cls(
            block_ids=block_ids,
            slot_hours=slot_hours,
            slots_per_day=per_day,
            required_m3=tuple(tuple(required[block_id]) for block_id in block_ids),
            fair_m3=tuple(tuple(fair[block_id]) for block_id in block_ids),
            etc_mm=tuple(tuple(etc_rows[block_id]) for block_id in block_ids),
            perc_mm=tuple(tuple(perc_rows[block_id]) for block_id in block_ids),
            wlr_mm=tuple(tuple(wlr_rows[block_id]) for block_id in block_ids),
            rain_effective_mm=tuple(tuple(rain_rows[block_id]) for block_id in block_ids),
            path_efficiency=MappingProxyType(dict(efficiency)),
        )

    @property
    def slot_count(self) -> int:
        return len(self.required_m3[0])

    @property
    def day_count(self) -> int:
        return self.slot_count // self.slots_per_day

    def position_of(self, block_id: str) -> int:
        try:
            return self.block_ids.index(block_id)
        except ValueError as error:
            raise DomainInvariantError(f"unknown block: {block_id!r}") from error

    def required_of(self, block_id: str, slot: int) -> float:
        position = self.position_of(block_id)
        index = _require_slot(slot, self.slot_count, "slot")
        return self.required_m3[position][index]

    def fair_of(self, block_id: str, slot: int) -> float:
        position = self.position_of(block_id)
        index = _require_slot(slot, self.slot_count, "slot")
        return self.fair_m3[position][index]

    def mean_daily_fair_m3(self, block_id: str) -> float:
        position = self.position_of(block_id)
        return math.fsum(self.fair_m3[position]) / self.day_count

    def window(self, start_slot: int, horizon: int) -> TargetWindow:
        start = _require_slot(start_slot, self.slot_count, "start_slot")
        if (
            isinstance(horizon, bool)
            or not isinstance(horizon, int)
            or horizon < 1
            or start + horizon > self.slot_count
        ):
            raise DomainInvariantError("horizon must fit inside the remaining slots")
        stop = start + horizon

        def slice_matrix(matrix: tuple[tuple[float, ...], ...]) -> tuple[tuple[float, ...], ...]:
            return tuple(row[start:stop] for row in matrix)

        return TargetWindow(
            etc_mm=slice_matrix(self.etc_mm),
            perc_mm=slice_matrix(self.perc_mm),
            wlr_mm=slice_matrix(self.wlr_mm),
            rain_effective_mm=slice_matrix(self.rain_effective_mm),
            target_fair_m3=slice_matrix(self.fair_m3),
        )


@dataclass(frozen=True, slots=True)
class SignalSnapshot:
    slot_index: int
    storage_mm: Mapping[str, float]
    storage_intervals: Mapping[str, Interval]
    path_efficiency: Mapping[str, float]
    eta_by_group: Mapping[str, float]
    eta_intervals: Mapping[str, Interval]
    ledger: Mapping[str, ServiceLedgerState]
    confidence: float
    observed_blocks: tuple[str, ...]

    def __post_init__(self) -> None:
        if (
            isinstance(self.slot_index, bool)
            or not isinstance(self.slot_index, int)
            or self.slot_index < 0
        ):
            raise DomainInvariantError("slot_index must be a non-negative integer")
        if not self.storage_mm:
            raise DomainInvariantError("storage_mm must not be empty")
        if set(self.path_efficiency) != set(self.storage_mm):
            raise DomainInvariantError("path_efficiency must cover every observed block")
        if set(self.ledger) != set(self.storage_mm):
            raise DomainInvariantError("ledger must cover every observed block")
        if not 0.0 <= self.confidence <= 1.0:
            raise DomainInvariantError("confidence must lie in [0, 1]")


@dataclass(frozen=True, slots=True)
class PolicyTelemetry:
    n_resolves: int
    solve_seconds_total: float
    fallback_count: int
    fallback_by_level: Mapping[FallbackLevel, int]
    review_required_count: int
    nis_violations: int
    dropouts: int
    mip_gap: float | None

    def __post_init__(self) -> None:
        for name in (
            "n_resolves",
            "fallback_count",
            "review_required_count",
            "nis_violations",
            "dropouts",
        ):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise DomainInvariantError(f"{name} must be a non-negative integer")
        require_non_negative(self.solve_seconds_total, "solve_seconds_total")
        if self.mip_gap is not None:
            require_non_negative(self.mip_gap, "mip_gap")


@dataclass(slots=True, eq=False)
class ObservedSignals:
    config: PolicyConfig
    network: NetworkIndex
    target_table: TargetTable
    sensor_block_of: Mapping[str, str]
    full_sensing: bool
    model: JointStorageLossModel
    state: GaussianState
    ledger: dict[str, ServiceLedgerState]
    last_command_gross_m3: dict[str, float]
    nis_violations: int = 0
    dropouts: int = 0

    @classmethod
    def build(
        cls,
        config: PolicyConfig,
        network: NetworkIndex,
        target_table: TargetTable,
        sensor_block_ids: Sequence[str],
        *,
        full_sensing: bool = False,
    ) -> ObservedSignals:
        if not isinstance(config, PolicyConfig):
            raise DomainInvariantError("config must be a PolicyConfig")
        instrumented = tuple(sorted(sensor_block_ids))
        require_unique(instrumented, "sensor block")
        unknown = sorted(set(instrumented) - set(network.block_ids))
        if unknown:
            raise DomainInvariantError(f"sensor blocks are not in the network: {unknown}")
        measured = network.block_ids if full_sensing else instrumented
        zones = tuple(
            dict.fromkeys(network.edge_by_id[edge_id].zone for edge_id in network.edge_order)
        )
        group_spec = LossGroupSpec.per_zone(zones)
        edge_zone = {edge_id: network.edge_by_id[edge_id].zone for edge_id in network.edge_order}
        model = build_joint_model(
            network.path_edges,
            edge_zone,
            block_ids=network.block_ids,
            measured_block_ids=measured,
            group_spec=group_spec,
            s_max_mm=config.max_storage_mm,
        )
        state = initial_joint_state(
            model,
            initial_storage_mm=config.prior_storage_mm,
            storage_sigma_mm=config.prior_storage_sigma_mm,
            initial_eta=config.prior_eta,
            eta_sigma_logit=config.prior_eta_sigma_logit,
        )
        return cls(
            config=config,
            network=network,
            target_table=target_table,
            sensor_block_of={f"{SENSOR_ID_PREFIX}{block_id}": block_id for block_id in measured},
            full_sensing=full_sensing,
            model=model,
            state=state,
            ledger={block_id: ServiceLedgerState.initial() for block_id in network.block_ids},
            last_command_gross_m3=dict.fromkeys(network.block_ids, 0.0),
        )

    def update(self, context: SlotContext) -> SignalSnapshot:
        predicted = ekf_predict(
            self.model,
            self.state,
            self._control_vector(context.slot_index),
            joint_process_covariance(
                self.model,
                storage_sigma_mm=self.config.process_storage_sigma_mm,
                drift_sigma_logit=self.config.process_drift_sigma_logit,
            ),
        )
        batch = build_measurement_batch(
            cast(Sequence[LevelReadingLike], self._readings(context)),
            self.sensor_block_of,
            assumed_sigma_mm=self.config.measurement_sigma_mm,
        )
        prepared = prepare_measurement(self.model, batch)
        if prepared is None:
            self.dropouts += 1
            self.state = _inflate_dropped(
                predicted, self.config.dropout_inflation_mm2, self.model.n_blocks
            )
            observed: tuple[str, ...] = ()
        else:
            updated, innovation = ekf_update(
                prepared.model,
                predicted,
                prepared.values_mm,
                np.diag(prepared.variances_mm2),
            )
            if not check_innovation(innovation, NIS_LEVEL).is_consistent:
                self.nis_violations += 1
            self.state = updated
            observed = prepared.model.measured_block_ids
        return self._snapshot(context.slot_index, observed)

    def account(self, snapshot: SignalSnapshot, opens: Mapping[str, bool]) -> None:
        hours = self.target_table.slot_hours
        commanded: dict[str, float] = {}
        for block_id in self.model.block_ids:
            if block_id not in opens:
                raise DomainInvariantError(f"opens is missing block {block_id!r}")
            block = self.network.block_by_id[block_id]
            commanded[block_id] = (
                flow_hours_to_volume_m3(block.nominal_flow_lps, hours) if opens[block_id] else 0.0
            )
        total = math.fsum(commanded.values())
        capacity = flow_hours_to_volume_m3(self.config.supply_lps, hours)
        scale = 1.0 if total <= capacity else capacity / total
        for block_id in self.model.block_ids:
            accounted = commanded[block_id] * scale
            self.last_command_gross_m3[block_id] = accounted
            efficiency = _clamp_efficiency(
                snapshot.path_efficiency[block_id], self.config.planning_efficiency_floor
            )
            self.ledger[block_id] = advance_ledger(
                self.ledger[block_id],
                delivered_m3=accounted * efficiency,
                target_fair_m3=self.target_table.fair_of(block_id, snapshot.slot_index),
                gamma=self.config.gamma,
                d_max_m3=self.config.debt_cap_days * self.target_table.mean_daily_fair_m3(block_id),
            )

    def _control_vector(self, slot: int) -> np.ndarray:
        gross_base: list[float] = []
        etc: list[float] = []
        for position, block_id in enumerate(self.model.block_ids):
            area = self.network.block_by_id[block_id].area_m2
            gross_base.append(volume_m3_to_storage_mm(self.last_command_gross_m3[block_id], area))
            etc.append(self.target_table.etc_mm[position][slot])
        control = JointControl(
            gross_base_mm=tuple(gross_base),
            etc_mm=tuple(etc),
            effective_rain_mm=self.target_table.rain_effective_mm[0][slot],
            percolation_mm=self.target_table.perc_mm[0][slot],
            wlr_mm=self.target_table.wlr_mm[0][slot],
        )
        return control.as_vector()

    def _readings(self, context: SlotContext) -> tuple[SensorSample, ...]:
        return tuple(
            sample
            for sample in context.observations
            if sample.kind is SensorKind.WATER_LEVEL and sample.sensor_id in self.sensor_block_of
        )

    def _snapshot(self, slot: int, observed: tuple[str, ...]) -> SignalSnapshot:
        view = JointEstimateView.from_state(self.model, self.state)
        covariance = np.asarray(self.state.covariance, dtype=float)
        z_vector = np.asarray(self.state.mean[self.model.n_blocks :], dtype=float)
        eta_intervals: dict[str, Interval] = {}
        for offset, group_id in enumerate(self.model.group_ids):
            position = self.model.n_blocks + offset
            z_std = math.sqrt(max(float(covariance[position, position]), 0.0))
            eta_intervals[group_id] = eta_interval(view.z_by_group[group_id], z_std, DEFAULT_LEVEL)
        path_efficiency = {
            block_id: path_efficiency_from_z(z_vector, self.model.counts[position])
            for position, block_id in enumerate(self.model.block_ids)
        }
        confidence = min(
            confidence_score(view.storage_std_mm[block_id], self.config.confidence_tolerance_mm)
            for block_id in self.model.block_ids
        )
        return SignalSnapshot(
            slot_index=slot,
            storage_mm=MappingProxyType(dict(view.storage_mm)),
            storage_intervals=MappingProxyType(
                {
                    block_id: gaussian_interval(
                        view.storage_mm[block_id], view.storage_std_mm[block_id], DEFAULT_LEVEL
                    )
                    for block_id in self.model.block_ids
                }
            ),
            path_efficiency=MappingProxyType(path_efficiency),
            eta_by_group=MappingProxyType(dict(view.eta_by_group)),
            eta_intervals=MappingProxyType(eta_intervals),
            ledger=MappingProxyType(dict(self.ledger)),
            confidence=confidence,
            observed_blocks=observed,
        )


def _inflate_dropped(state: GaussianState, inflation_mm2: float, block_count: int) -> GaussianState:
    covariance = np.array(state.covariance, dtype=float)
    covariance[:block_count, :block_count] += np.eye(block_count) * inflation_mm2
    return GaussianState(mean=state.mean, covariance=covariance)


@dataclass(slots=True, eq=False, kw_only=True)
class PolicyCore:
    config: PolicyConfig
    network: NetworkIndex
    target_table: TargetTable
    signals: ObservedSignals
    rng: np.random.Generator
    _step: int = 0
    _previous_open: dict[str, bool] = field(default_factory=dict)
    _solve_seconds_total: float = 0.0
    _n_resolves: int = 0
    _fallback_counts: dict[FallbackLevel, int] = field(default_factory=dict)
    _review_required_count: int = 0
    _mip_gap: float | None = None
    _snapshots: list[SignalSnapshot] = field(default_factory=list)
    _last_feasible: LastFeasiblePlan | None = None

    def decide(self, context: SlotContext) -> Mapping[str, bool]:
        resolved = self._resolve(context)
        missing = sorted(set(self.network.block_ids) - set(resolved))
        unknown = sorted(set(resolved) - set(self.network.block_ids))
        if missing or unknown:
            raise DomainInvariantError(
                f"policy decision does not cover the network: missing={missing}, unknown={unknown}"
            )
        coerced = {block_id: bool(resolved[block_id]) for block_id in self.network.block_ids}
        self._previous_open = coerced
        self._step = context.slot_index + 1
        return coerced

    def telemetry(self) -> PolicyTelemetry:
        counts = {level: self._fallback_counts.get(level, 0) for level in FallbackLevel}
        return PolicyTelemetry(
            n_resolves=self._n_resolves,
            solve_seconds_total=self._solve_seconds_total,
            fallback_count=sum(counts.values()),
            fallback_by_level=MappingProxyType(counts),
            review_required_count=self._review_required_count,
            nis_violations=self.signals.nis_violations,
            dropouts=self.signals.dropouts,
            mip_gap=self._mip_gap,
        )

    def history(self) -> tuple[SignalSnapshot, ...]:
        return tuple(self._snapshots)

    def _resolve(self, context: SlotContext) -> Mapping[str, bool]:
        raise NotImplementedError

    def _previous_open_of(self, context: SlotContext) -> dict[str, bool]:
        tracked = set(self._previous_open) == set(self.network.block_ids)
        if context.slot_index == 0 or context.slot_index != self._step or not tracked:
            return dict.fromkeys(self.network.block_ids, False)
        return dict(self._previous_open)

    def _record_plan(self, outcome: RollingOutcome, step_index: int) -> None:
        if outcome.used_fallback and outcome.fallback is not None:
            level = outcome.fallback.level
            self._fallback_counts[level] = self._fallback_counts.get(level, 0) + 1
            if outcome.fallback.review_required:
                self._review_required_count += 1
            return
        self._last_feasible = last_feasible_snapshot(outcome, step_index)

    def _record_gap(self, gap: float | None) -> None:
        if gap is None:
            return
        self._mip_gap = gap if self._mip_gap is None else max(self._mip_gap, gap)

    def _planning_problem(self, context: SlotContext, snapshot: SignalSnapshot) -> PlanningProblem:
        remaining = self.target_table.slot_count - context.slot_index
        horizon = min(self.config.horizon_slots, remaining)
        if horizon < 1:
            raise DomainInvariantError("policy was called beyond the scenario horizon")
        window = self.target_table.window(context.slot_index, horizon)
        previous = self._previous_open_of(context)
        blocks = tuple(
            PlanningBlockSpec(
                block_id=block_id,
                area_m2=self.network.block_by_id[block_id].area_m2,
                nominal_flow_lps=self.network.block_by_id[block_id].nominal_flow_lps,
                path_efficiency=_clamp_efficiency(
                    snapshot.path_efficiency[block_id], self.config.planning_efficiency_floor
                ),
                min_storage_mm=self.config.min_storage_mm,
                max_storage_mm=self.config.max_storage_mm,
                initial_storage_mm=max(
                    0.0, min(snapshot.storage_mm[block_id], self.config.max_storage_mm)
                ),
                ledger_delivered_m3=snapshot.ledger[block_id].delivered_ewma_m3,
                ledger_target_m3=snapshot.ledger[block_id].target_ewma_m3,
                debt_m3=snapshot.ledger[block_id].debt_m3,
            )
            for block_id in self.network.block_ids
        )
        scenario = PlanningScenario(
            scenario_id="central",
            probability=1.0,
            supply_lps=(self.config.supply_lps,) * window.slot_count,
            etc_mm=window.etc_mm,
            perc_mm=window.perc_mm,
            wlr_mm=window.wlr_mm,
            rain_effective_mm=window.rain_effective_mm,
            target_fair_m3=window.target_fair_m3,
        )
        return PlanningProblem(
            blocks=blocks,
            scenarios=(scenario,),
            slot_hours=self.target_table.slot_hours,
            edge_capacity_lps={
                edge.edge_id: edge.capacity_lps for edge in self.network.network.edges
            },
            edge_downstream_blocks=self.network.downstream,
            previous_gate_open=tuple(previous[block_id] for block_id in self.network.block_ids),
            commit_slots=min(self.config.commit_slots, window.slot_count),
            debt_service_fraction=self.config.debt_service_fraction,
        )

    def _design_snapshot(self) -> SignalSnapshot:
        block_ids = self.network.block_ids
        return SignalSnapshot(
            slot_index=0,
            storage_mm=MappingProxyType(dict.fromkeys(block_ids, self.config.prior_storage_mm)),
            storage_intervals=MappingProxyType({}),
            path_efficiency=MappingProxyType(dict(self.target_table.path_efficiency)),
            eta_by_group=MappingProxyType({}),
            eta_intervals=MappingProxyType({}),
            ledger=MappingProxyType(
                {block_id: ServiceLedgerState.initial() for block_id in block_ids}
            ),
            confidence=1.0,
            observed_blocks=(),
        )


def _lexicographic_request(config: PolicyConfig) -> LexicographicRequest:
    return LexicographicRequest(
        profile=config.profile,
        stage_time_limit_s=config.stage_time_limit_s,
        shortage_lambda=config.shortage_lambda,
    )


def _fallback_policy(config: PolicyConfig) -> FallbackPolicy:
    return FallbackPolicy(
        short_horizon_slots=config.fallback_short_horizon_slots,
        rotation_schedule=config.fallback_rotation_groups,
    )


@dataclass(slots=True, eq=False, kw_only=True)
class SeraPolicy(PolicyCore):
    def _resolve(self, context: SlotContext) -> Mapping[str, bool]:
        snapshot = self.signals.update(context)
        self._snapshots.append(snapshot)
        problem = self._planning_problem(context, snapshot)
        request = RollingRequest(
            lexicographic=_lexicographic_request(self.config),
            scenario_config=self.config.scenario_config,
            risk_mode=self.config.risk_mode,
            cvar_alpha=self.config.cvar_alpha,
            minimum_confidence=self.config.minimum_confidence,
        )
        fallback_context = FallbackContext(
            step_index=context.slot_index,
            reason=FallbackReason.MANUAL,
            policy=_fallback_policy(self.config),
            last_feasible=self._last_feasible,
            confidence=snapshot.confidence,
        )
        outcome = rolling_solve(problem, request, self.rng, fallback_context=fallback_context)
        self._n_resolves += 1
        self._solve_seconds_total += outcome.total_solve_seconds
        self._record_plan(outcome, context.slot_index)
        execution = outcome.execution_by_block()
        opens = {block_id: execution[block_id][0] for block_id in self.network.block_ids}
        self.signals.account(snapshot, opens)
        return opens


@dataclass(slots=True, eq=False, kw_only=True)
class BaselinePolicy(PolicyCore):
    method: BaselineMethod
    mode: BaselinePolicyMode
    strategy: BaselineStrategy | None = None
    oracle: OracleStrategy | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.method, BaselineMethod):
            raise DomainInvariantError("method must be a BaselineMethod")
        if not isinstance(self.mode, BaselinePolicyMode):
            raise DomainInvariantError("mode must be a BaselinePolicyMode")
        if self.mode is BaselinePolicyMode.ORACLE:
            if self.method is not BaselineMethod.ORACLE:
                raise DomainInvariantError("oracle mode requires the oracle method")
            if self.oracle is None or self.strategy is not None:
                raise DomainInvariantError("oracle mode requires an oracle strategy")
            return
        if self.oracle is not None or self.strategy is None:
            raise DomainInvariantError("baseline modes require a registered strategy")
        if self.mode is BaselinePolicyMode.OBSERVED and self.method is not BaselineMethod.GREEDY:
            raise DomainInvariantError("observed mode is reserved for the greedy method")
        if self.mode is BaselinePolicyMode.STATELESS and self.method not in (
            BaselineMethod.PROPORTIONAL,
            BaselineMethod.ROTATION,
        ):
            raise DomainInvariantError("stateless mode is reserved for proportional and rotation")

    def _resolve(self, context: SlotContext) -> Mapping[str, bool]:
        if self.mode is BaselinePolicyMode.STATELESS:
            problem = self._planning_problem(context, self._design_snapshot())
            strategy = self._require_strategy()
            plan = strategy.plan(problem, step_index=context.slot_index)
            return {
                block_id: bool(plan.open_by_slot[position][0])
                for position, block_id in enumerate(plan.block_ids)
            }
        snapshot = self.signals.update(context)
        self._snapshots.append(snapshot)
        problem = self._planning_problem(context, snapshot)
        if self.mode is BaselinePolicyMode.ORACLE:
            opens = self._oracle_opens(context, problem, snapshot)
        else:
            strategy = self._require_strategy()
            plan = strategy.plan(problem, step_index=context.slot_index)
            opens = {
                block_id: bool(plan.open_by_slot[position][0])
                for position, block_id in enumerate(plan.block_ids)
            }
        self.signals.account(snapshot, opens)
        return opens

    def _oracle_opens(
        self,
        context: SlotContext,
        problem: PlanningProblem,
        snapshot: SignalSnapshot,
    ) -> dict[str, bool]:
        oracle = self._require_oracle()
        try:
            outcome = oracle.solve(problem, step_index=context.slot_index)
        except DomainInvariantError:
            decision = select_fallback(
                problem,
                FallbackContext(
                    step_index=context.slot_index,
                    reason=FallbackReason.INFEASIBLE,
                    policy=_fallback_policy(self.config),
                    last_feasible=self._last_feasible,
                    confidence=snapshot.confidence,
                ),
            )
            self._fallback_counts[decision.level] = self._fallback_counts.get(decision.level, 0) + 1
            if decision.review_required:
                self._review_required_count += 1
            return {block_id: bool(flag) for block_id, flag in decision.opens.items()}
        self._n_resolves += 1
        self._solve_seconds_total += outcome.solve_seconds
        self._record_gap(outcome.relative_gap)
        return {
            block_id: bool(outcome.plan.open_by_slot[position][0])
            for position, block_id in enumerate(outcome.plan.block_ids)
        }

    def _require_strategy(self) -> BaselineStrategy:
        strategy = self.strategy
        if strategy is None:
            raise DomainInvariantError("baseline strategy is not configured")
        return strategy

    def _require_oracle(self) -> OracleStrategy:
        oracle = self.oracle
        if oracle is None:
            raise DomainInvariantError("oracle strategy is not configured")
        return oracle


type PlanningPolicy = SeraPolicy | BaselinePolicy


def create_policy(
    method: BaselineMethod,
    *,
    config: PolicyConfig,
    network: NetworkIndex,
    target_table: TargetTable,
    sensor_block_ids: Sequence[str],
    seed: int,
    registry: BaselineRegistry = DEFAULT_REGISTRY,
) -> PlanningPolicy:
    if not isinstance(method, BaselineMethod):
        raise DomainInvariantError("method must be a BaselineMethod")
    if not isinstance(config, PolicyConfig):
        raise DomainInvariantError("config must be a PolicyConfig")
    if not isinstance(registry, BaselineRegistry):
        raise DomainInvariantError("registry must be a BaselineRegistry")
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise DomainInvariantError("seed must be a non-negative integer")
    if method is BaselineMethod.SERA:
        return SeraPolicy(
            config=config,
            network=network,
            target_table=target_table,
            signals=ObservedSignals.build(
                config, network, target_table, sensor_block_ids, full_sensing=False
            ),
            rng=generator_for(seed, "policy", method.value),
        )
    if method is BaselineMethod.ORACLE:
        return BaselinePolicy(
            method=method,
            mode=BaselinePolicyMode.ORACLE,
            config=config,
            network=network,
            target_table=target_table,
            signals=ObservedSignals.build(
                config, network, target_table, network.block_ids, full_sensing=True
            ),
            rng=generator_for(seed, "policy", method.value),
            oracle=OracleStrategy(lexicographic=_lexicographic_request(config)),
        )
    mode = (
        BaselinePolicyMode.OBSERVED
        if method is BaselineMethod.GREEDY
        else BaselinePolicyMode.STATELESS
    )
    return BaselinePolicy(
        method=method,
        mode=mode,
        config=config,
        network=network,
        target_table=target_table,
        signals=ObservedSignals.build(
            config, network, target_table, sensor_block_ids, full_sensing=False
        ),
        rng=generator_for(seed, "policy", method.value),
        strategy=registry.create(method),
    )
