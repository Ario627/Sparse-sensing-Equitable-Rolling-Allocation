from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Final, Protocol

from sera.baselines.base import BaselineMethod
from sera.baselines.registry import DEFAULT_REGISTRY, BaselineRegistry
from sera.core.rng import generator_for
from sera.core.types import (
    DomainInvariantError,
    Interval,
    LossZone,
    NetworkSpec,
    require_positive,
    require_utc,
)
from sera.estimator.confidence import DEFAULT_LEVEL, calibration_error, coverage_rate
from sera.experiments.metrics import SlotRecord, SolverTelemetry, compute_run_metrics
from sera.experiments.policies import (
    PlanningPolicy,
    PolicyConfig,
    PolicyTelemetry,
    SignalSnapshot,
    TargetTable,
    create_policy,
    slots_per_day_for,
)
from sera.experiments.runner import RunOutcome, RunSpec
from sera.optimizer.params import CVAR_ALPHA_DEFAULT
from sera.simulator.engine import SimulationConfig, SimulationResult, run_simulation
from sera.simulator.network import NetworkIndex
from sera.simulator.scenarios import ScenarioSpec, build_network_for, scenario_from_preset
from sera.simulator.weather import (
    DailyWeather,
    ForecastDay,
    forecast_error_for,
    forecast_horizon,
    regime_for,
    sample_truth_series,
)

NETWORK_STREAM: Final = "network"
WEATHER_STREAM: Final = "weather"
FORECAST_STREAM: Final = "forecast"
DEFAULT_START_TIME: Final = datetime(2026, 1, 1, tzinfo=UTC)


class TimeseriesSink(Protocol):
    def record(
        self,
        spec: RunSpec,
        simulation: SimulationResult,
        snapshots: tuple[SignalSnapshot, ...],
        target_table: TargetTable,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class ExperimentExecutor:
    start_time: datetime = DEFAULT_START_TIME
    slot_hours: float = 1.0
    policy: PolicyConfig = field(default_factory=PolicyConfig)
    registry: BaselineRegistry = DEFAULT_REGISTRY
    metric_cvar_alpha: float | None = None
    verify_streams: bool = True
    timeseries_sink: TimeseriesSink | None = None

    def __post_init__(self) -> None:
        require_utc(self.start_time, "start_time")
        require_positive(self.slot_hours, "slot_hours")
        slots_per_day_for(self.slot_hours)
        if not isinstance(self.policy, PolicyConfig):
            raise DomainInvariantError("policy must be a PolicyConfig")
        if not isinstance(self.registry, BaselineRegistry):
            raise DomainInvariantError("registry must be a BaselineRegistry")
        if self.metric_cvar_alpha is not None and not 0.0 < self.metric_cvar_alpha < 1.0:
            raise DomainInvariantError("metric_cvar_alpha must lie in (0, 1)")
        if not isinstance(self.verify_streams, bool):
            raise DomainInvariantError("verify_streams must be a boolean")
        if self.timeseries_sink is not None and not callable(
            getattr(self.timeseries_sink, "record", None)
        ):
            raise DomainInvariantError("timeseries_sink must expose a callable record method")

    def __call__(self, spec: RunSpec) -> RunOutcome:
        return self.execute(spec)

    def execute(self, spec: RunSpec) -> RunOutcome:
        if not isinstance(spec, RunSpec):
            raise DomainInvariantError("spec must be a RunSpec")
        base = scenario_from_preset(
            spec.scenario_id,
            n_blocks=spec.n_blocks,
            topology=spec.topology,
            k_schedule=((0, spec.k_factor),),
        )
        index = self._network_index(spec, base)
        instrumented = self._instrumented_blocks(spec, index)
        scenario = replace(
            base,
            sensor_block_ids=None if spec.method is BaselineMethod.ORACLE else instrumented,
        )
        weather_truth = self._weather_truth(spec, scenario)
        config = replace(self.policy, supply_lps=scenario.supply_nominal_lps)
        target_table = TargetTable.build(
            network=index,
            forecast=self._forecast(spec, scenario, weather_truth),
            config=config,
            slot_hours=self.slot_hours,
        )
        policy: PlanningPolicy = create_policy(
            spec.method,
            config=config,
            network=index,
            target_table=target_table,
            sensor_block_ids=instrumented,
            seed=spec.seed,
            registry=self.registry,
        )
        simulation = run_simulation(
            SimulationConfig(
                scenario=scenario,
                seed=spec.seed,
                start_time=self.start_time,
                slot_hours=self.slot_hours,
            ),
            policy,
        )
        if len(simulation.outcomes) != target_table.slot_count:
            raise DomainInvariantError("simulation horizon and target table diverged")
        if self.verify_streams:
            _verify_environment(simulation, index.network, weather_truth)
        telemetry = policy.telemetry()
        snapshots = policy.history()
        if snapshots and len(snapshots) != len(simulation.outcomes):
            raise DomainInvariantError("policy history does not cover every slot")
        truth_series, estimate_series = _storage_series(simulation, index.block_ids, snapshots)
        metrics = compute_run_metrics(
            _slot_records(simulation, index, target_table),
            SolverTelemetry(
                solve_seconds_total=telemetry.solve_seconds_total,
                n_resolves=telemetry.n_resolves,
                mip_gap=telemetry.mip_gap,
            ),
            cvar_alpha=self._metric_alpha(),
            tail_block_ids=_tail_blocks(index) or None,
            truth_storage_mm=truth_series,
            estimate_storage_mm=estimate_series,
            fallback_used=telemetry.fallback_count > 0,
        )
        extras = _extras(
            spec=spec,
            config=config,
            telemetry=telemetry,
            snapshots=snapshots,
            simulation=simulation,
            block_ids=index.block_ids,
            instrumented=instrumented,
        )
        if self.timeseries_sink is not None:
            self.timeseries_sink.record(spec, simulation, snapshots, target_table)
        return RunOutcome(metrics=metrics, extras=extras)

    def _metric_alpha(self) -> float:
        if self.metric_cvar_alpha is not None:
            return self.metric_cvar_alpha
        if self.policy.cvar_alpha is not None:
            return self.policy.cvar_alpha
        return CVAR_ALPHA_DEFAULT

    def _network_index(self, spec: RunSpec, scenario: ScenarioSpec) -> NetworkIndex:
        network = build_network_for(
            scenario, generator_for(spec.seed, NETWORK_STREAM, scenario.scenario_id)
        )
        return NetworkIndex.from_spec(network)

    def _instrumented_blocks(self, spec: RunSpec, index: NetworkIndex) -> tuple[str, ...]:
        if spec.method is BaselineMethod.ORACLE:
            return index.block_ids
        unknown = sorted(set(spec.sensor_set) - set(index.block_ids))
        if unknown:
            raise DomainInvariantError(f"sensor set references unknown blocks: {unknown}")
        return tuple(spec.sensor_set)

    def _weather_truth(self, spec: RunSpec, scenario: ScenarioSpec) -> tuple[DailyWeather, ...]:
        rng = generator_for(spec.seed, WEATHER_STREAM, scenario.scenario_id)
        return sample_truth_series(rng, regime_for(scenario.season), days=scenario.horizon_days)

    def _forecast(
        self,
        spec: RunSpec,
        scenario: ScenarioSpec,
        weather: tuple[DailyWeather, ...],
    ) -> tuple[ForecastDay, ...]:
        rng = generator_for(spec.seed, FORECAST_STREAM, scenario.scenario_id)
        return forecast_horizon(
            rng,
            weather,
            start_index=0,
            horizon=scenario.horizon_days,
            spec=forecast_error_for(scenario.forecast_grade),
        )


def _verify_environment(
    simulation: SimulationResult,
    network: NetworkSpec,
    weather: tuple[DailyWeather, ...],
) -> None:
    if simulation.network != network:
        raise DomainInvariantError("network stream replication failed; CRN guard tripped")
    if simulation.weather != weather:
        raise DomainInvariantError("weather stream replication failed; CRN guard tripped")


def _slot_records(
    simulation: SimulationResult,
    index: NetworkIndex,
    target_table: TargetTable,
) -> tuple[SlotRecord, ...]:
    records = [
        SlotRecord(
            block_id=block_id,
            slot_index=outcome.slot_index,
            delivered_m3=outcome.delivered_m3[block_id],
            required_m3=target_table.required_of(block_id, outcome.slot_index),
            fair_target_m3=target_table.fair_of(block_id, outcome.slot_index),
            gross_m3=outcome.released_gross_m3[block_id],
            gate_open=outcome.gate_open[block_id],
        )
        for outcome in simulation.outcomes
        for block_id in index.block_ids
    ]
    return tuple(records)


def _storage_series(
    simulation: SimulationResult,
    block_ids: tuple[str, ...],
    snapshots: tuple[SignalSnapshot, ...],
) -> tuple[tuple[float, ...] | None, tuple[float, ...] | None]:
    if not snapshots:
        return None, None
    truth = tuple(
        outcome.storage_mm[block_id] for outcome in simulation.outcomes for block_id in block_ids
    )
    estimate = tuple(
        snapshot.storage_mm[block_id] for snapshot in snapshots for block_id in block_ids
    )
    return truth, estimate


def _tail_blocks(index: NetworkIndex) -> tuple[str, ...]:
    return tuple(
        block_id
        for block_id in index.block_ids
        if any(
            index.edge_by_id[edge_id].zone is LossZone.TAIL
            for edge_id in index.path_edges[block_id]
        )
    )


def _coverage_extras(
    simulation: SimulationResult,
    snapshots: tuple[SignalSnapshot, ...],
    block_ids: tuple[str, ...],
) -> tuple[float | None, float | None]:
    if not snapshots:
        return None, None
    intervals: list[Interval] = []
    truths: list[float] = []
    for outcome, snapshot in zip(simulation.outcomes, snapshots, strict=True):
        for block_id in block_ids:
            intervals.append(snapshot.storage_intervals[block_id])
            truths.append(outcome.storage_mm[block_id])
    return coverage_rate(intervals, truths), calibration_error(intervals, truths, DEFAULT_LEVEL)


def _extras(
    *,
    spec: RunSpec,
    config: PolicyConfig,
    telemetry: PolicyTelemetry,
    snapshots: tuple[SignalSnapshot, ...],
    simulation: SimulationResult,
    block_ids: tuple[str, ...],
    instrumented: tuple[str, ...],
) -> dict[str, object]:
    coverage, calibration = _coverage_extras(simulation, snapshots, block_ids)
    final = snapshots[-1] if snapshots else None
    mean_confidence = (
        math.fsum(snapshot.confidence for snapshot in snapshots) / len(snapshots)
        if snapshots
        else None
    )
    return {
        "method": spec.method.value,
        "policy_profile": config.profile.value,
        "full_sensing": spec.method is BaselineMethod.ORACLE,
        "sensor_blocks": list(instrumented),
        "n_resolves": telemetry.n_resolves,
        "n_fallbacks": telemetry.fallback_count,
        "fallback_by_level": {
            level.value: count for level, count in telemetry.fallback_by_level.items()
        },
        "review_required": telemetry.review_required_count,
        "nis_violations": telemetry.nis_violations,
        "dropouts": telemetry.dropouts,
        "mean_confidence": mean_confidence,
        "storage_coverage": coverage,
        "storage_calibration_error": calibration,
        "eta_group_intervals": dict(final.eta_intervals) if final is not None else {},
    }
