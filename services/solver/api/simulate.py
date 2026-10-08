from __future__ import annotations

import math
from dataclasses import replace
from typing import Final

from fastapi import APIRouter  # type: ignore

from api.schemas import (
    SimulateArtifacts,
    SimulateMetrics,
    SimulateRequest,
    SimulateResponse,
    SlotSupply,
    TrajectoryRow,
)
from app.core.rng import generator_for
from app.core.types import DomainInvariantError
from experiments.executors import DEFAULT_START_TIME
from experiments.policies import (
    PlanningPolicy,
    PolicyConfig,
    TargetTable,
    create_policy,
)
from simulator.engine import SimulationConfig, SimulationResult, run_simulation
from simulator.gate import GateFaultSpec
from simulator.network import NetworkIndex
from simulator.scenarios import ScenarioSpec, build_network_for
from simulator.weather import (
    DailyWeather,
    ForecastDay,
    forecast_error_for,
    forecast_horizon,
    regime_for,
    sample_truth_series,
)

MAX_TRAJECTORY_ROWS: Final = 30_000
NETWORK_STREAM: Final = "network"
WEATHER_STREAM: Final = "weather"
FORECAST_STREAM: Final = "forecast"
NOMINAL_K_FACTOR: Final = 1.0


def _scenario_spec(request: SimulateRequest) -> ScenarioSpec:
    payload = request.scenario_config
    k_schedule = ((0, NOMINAL_K_FACTOR),) if request.k_factor is None else ((0, request.k_factor),)
    return ScenarioSpec(
        scenario_id=payload.scenario_id,
        topology=payload.topology if request.topology is None else request.topology,
        n_blocks=payload.n_blocks,
        horizon_days=payload.horizon_days,
        season=payload.season,
        supply_nominal_lps=payload.supply_nominal_lps,
        k_schedule=k_schedule,
        loss_profile=payload.loss_profile,
        sensor_noise=payload.sensor_noise,
        sensor_block_ids=(
            None if payload.sensor_block_ids is None else tuple(payload.sensor_block_ids)
        ),
        failed_zones=tuple(payload.failed_zones),
        forecast_grade=payload.forecast_grade,
        gate_fault=GateFaultSpec(
            response_delay_min=payload.gate_fault.response_delay_min,
            delay_jitter_min=payload.gate_fault.delay_jitter_min,
            flow_bias_sigma=payload.gate_fault.flow_bias_sigma,
            partial_open_prob=payload.gate_fault.partial_open_prob,
            partial_open_min=payload.gate_fault.partial_open_min,
            partial_open_max=payload.gate_fault.partial_open_max,
            stuck_prob=payload.gate_fault.stuck_prob,
            stuck_open_prob=payload.gate_fault.stuck_open_prob,
        ),
        flow_velocity_m_per_s=payload.flow_velocity_m_per_s,
    )


def _network_index(spec: ScenarioSpec, seed: int) -> NetworkIndex:
    return NetworkIndex.from_spec(
        build_network_for(spec, generator_for(seed, NETWORK_STREAM, spec.scenario_id))
    )


def _weather_truth(spec: ScenarioSpec, seed: int) -> tuple[DailyWeather, ...]:
    return sample_truth_series(
        generator_for(seed, WEATHER_STREAM, spec.scenario_id),
        regime_for(spec.season),
        days=spec.horizon_days,
    )


def _forecast(
    spec: ScenarioSpec,
    seed: int,
    weather: tuple[DailyWeather, ...],
) -> tuple[ForecastDay, ...]:
    return forecast_horizon(
        generator_for(seed, FORECAST_STREAM, spec.scenario_id),
        weather,
        start_index=0,
        horizon=spec.horizon_days,
        spec=forecast_error_for(spec.forecast_grade),
    )


def _policy_config(spec: ScenarioSpec) -> PolicyConfig:
    return replace(PolicyConfig(), supply_lps=spec.supply_nominal_lps)


def _planned_sensor_blocks(
    request: SimulateRequest,
    spec: ScenarioSpec,
    index: NetworkIndex,
) -> tuple[str, ...]:
    configured = None if request.policy is None else request.policy.sensor_blocks
    if configured is not None:
        return tuple(configured)
    if spec.sensor_block_ids is not None:
        return spec.sensor_block_ids
    return index.block_ids


def _build_policy(
    request: SimulateRequest,
    config: PolicyConfig,
    index: NetworkIndex,
    target_table: TargetTable,
    sensor_blocks: tuple[str, ...],
    seed: int,
) -> PlanningPolicy | None:
    if request.policy is None:
        return None
    return create_policy(
        request.policy.method,
        config=config,
        network=index,
        target_table=target_table,
        sensor_block_ids=sensor_blocks,
        seed=seed,
    )


def _check_trajectory_size(block_count: int, slot_count: int) -> None:
    rows = block_count * slot_count
    if rows > MAX_TRAJECTORY_ROWS:
        raise DomainInvariantError(
            f"trajectory would hold {rows} rows; the cap is {MAX_TRAJECTORY_ROWS}"
        )


def _verify_horizon(simulation: SimulationResult, target_table: TargetTable) -> None:
    if len(simulation.outcomes) != target_table.slot_count:
        raise DomainInvariantError("simulation horizon and target table diverged")


def _slot_supplies(simulation: SimulationResult) -> list[SlotSupply]:
    return [
        SlotSupply(
            slot_index=outcome.slot_index,
            slot_start=outcome.slot_start,
            supply_lps=outcome.supply_lps,
            supply_binding=outcome.supply_binding,
            binding_edge_ids=list(outcome.binding_edge_ids),
        )
        for outcome in simulation.outcomes
    ]


def _trajectory_rows(
    simulation: SimulationResult,
    block_ids: tuple[str, ...],
) -> list[TrajectoryRow]:
    return [
        TrajectoryRow(
            slot_index=outcome.slot_index,
            day_index=outcome.day_index,
            block_id=block_id,
            gate_open=outcome.gate_open[block_id],
            requested_gross_m3=outcome.requested_gross_m3[block_id],
            released_gross_m3=outcome.released_gross_m3[block_id],
            delivered_m3=outcome.delivered_m3[block_id],
            storage_mm=outcome.storage_mm[block_id],
            path_efficiency=outcome.path_efficiency[block_id],
        )
        for outcome in simulation.outcomes
        for block_id in block_ids
    ]


def _metrics(
    simulation: SimulationResult,
    policy: PlanningPolicy | None,
    block_ids: tuple[str, ...],
) -> SimulateMetrics:
    final_storage = [simulation.final_storage_mm[block_id] for block_id in block_ids]
    snapshots = () if policy is None else policy.history()
    telemetry = None if policy is None else policy.telemetry()
    mean_confidence = (
        None
        if not snapshots
        else math.fsum(snapshot.confidence for snapshot in snapshots) / len(snapshots)
    )
    return SimulateMetrics(
        slots=len(simulation.outcomes),
        total_delivered_m3=math.fsum(
            math.fsum(outcome.delivered_m3.values()) for outcome in simulation.outcomes
        ),
        total_gross_m3=math.fsum(
            math.fsum(outcome.released_gross_m3.values()) for outcome in simulation.outcomes
        ),
        final_storage_min_mm=min(final_storage),
        final_storage_mean_mm=math.fsum(final_storage) / len(final_storage),
        final_storage_max_mm=max(final_storage),
        supply_binding_slots=sum(1 for outcome in simulation.outcomes if outcome.supply_binding),
        n_resolves=None if telemetry is None else telemetry.n_resolves,
        fallback_count=None if telemetry is None else telemetry.fallback_count,
        nis_violations=None if telemetry is None else telemetry.nis_violations,
        dropouts=None if telemetry is None else telemetry.dropouts,
        mean_confidence=mean_confidence,
    )


router = APIRouter(tags=["simulate"])


@router.post("/v1/simulate", response_model=SimulateResponse)
def simulate(request: SimulateRequest) -> SimulateResponse:
    spec = _scenario_spec(request)
    index = _network_index(spec, request.seed)
    sensor_blocks = _planned_sensor_blocks(request, spec, index)
    scenario = replace(spec, sensor_block_ids=sensor_blocks)
    config = _policy_config(spec)
    target_table = TargetTable.build(
        network=index,
        forecast=_forecast(spec, request.seed, _weather_truth(spec, request.seed)),
        config=config,
        slot_hours=request.slot_hours,
    )
    policy = _build_policy(request, config, index, target_table, sensor_blocks, request.seed)
    _check_trajectory_size(len(index.block_ids), target_table.slot_count)
    start_time = DEFAULT_START_TIME if request.start_time is None else request.start_time
    simulation = run_simulation(
        SimulationConfig(
            scenario=scenario,
            seed=request.seed,
            start_time=start_time,
            slot_hours=request.slot_hours,
        ),
        policy,
    )
    _verify_horizon(simulation, target_table)
    return SimulateResponse(
        request_id=request.request_id,
        scenario_id=simulation.scenario_id,
        network_id=simulation.network.network_id,
        slot_count=len(simulation.outcomes),
        slots=_slot_supplies(simulation),
        trajectory=_trajectory_rows(simulation, index.block_ids),
        metrics=_metrics(simulation, policy, index.block_ids),
        artifacts=SimulateArtifacts(),
    )
