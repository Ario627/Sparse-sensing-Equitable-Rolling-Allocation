from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final, Protocol

import numpy as np

from sera.core.rng import generator_for
from sera.core.types import (
    DomainInvariantError,
    NetworkSpec,
    require_positive,
    require_utc,
)
from sera.core.units import flow_hours_to_volume_m3, volume_m3_to_storage_mm
from sera.demand.crop_water import HOURS_PER_DAY
from sera.simulator.crop import (
    CropDayTruth,
    CropFieldState,
    CropTruthSpec,
    advance_crop_day,
    initial_field_state,
)
from sera.simulator.gate import (
    GateState,
    build_gate_fleet,
    gate_flow_lps,
    initial_gate_state,
    issue_gate_command,
    step_gate,
)
from sera.simulator.hydraulics import (
    TransportPipe,
    advance_loss_logit,
    apply_capacity_limit,
    arrival_slot_index,
    build_true_losses,
    latency_by_block,
)
from sera.simulator.network import NetworkIndex, path_efficiency_map
from sera.simulator.scenarios import (
    LOSS_DRIFT_SIGMA,
    LOSS_SPREAD,
    LOSS_ZONE_BASE,
    ScenarioSpec,
    blocks_in_zones,
    build_network_for,
    supply_lps_for_day,
)
from sera.simulator.sensors import (
    LevelSensorSpec,
    LevelSensorState,
    SensorSample,
    create_level_sensor,
    fail_sensor,
    observe_level,
)
from sera.simulator.weather import DailyWeather, regime_for, sample_truth_series

MINUTES_PER_HOUR: Final = 60.0


def _require_seed(seed: int) -> int:
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise DomainInvariantError("seed must be a non-negative integer")
    return seed


def _canonical_opens(
    opens: Mapping[str, bool],
    block_ids: tuple[str, ...],
) -> dict[str, bool]:
    unknown = sorted(set(opens) - set(block_ids))
    if unknown:
        raise DomainInvariantError(f"policy returned unknown blocks: {unknown}")
    missing = sorted(set(block_ids) - set(opens))
    if missing:
        raise DomainInvariantError(f"policy omitted blocks: {missing}")
    return {block_id: bool(opens[block_id]) for block_id in block_ids}


@dataclass(frozen=True, slots=True)
class SlotContext:
    slot_index: int
    day_index: int
    slot_start: datetime
    slot_hours: float
    index: NetworkIndex
    observations: tuple[SensorSample, ...]


class SlotPolicy(Protocol):
    def decide(self, context: SlotContext) -> Mapping[str, bool]: ...


class AlwaysOpenPolicy:
    def decide(self, context: SlotContext) -> Mapping[str, bool]:
        return dict.fromkeys(context.index.block_ids, True)


@dataclass(frozen=True, slots=True)
class SlotOutcome:
    slot_index: int
    day_index: int
    slot_start: datetime
    gate_open: dict[str, bool]
    requested_gross_m3: dict[str, float]
    released_gross_m3: dict[str, float]
    delivered_m3: dict[str, float]
    storage_mm: dict[str, float]
    path_efficiency: dict[str, float]
    supply_lps: float
    supply_binding: bool
    binding_edge_ids: tuple[str, ...]
    observations: tuple[SensorSample, ...]


@dataclass(frozen=True, slots=True)
class SimulationResult:
    scenario_id: str
    network: NetworkSpec
    outcomes: tuple[SlotOutcome, ...]
    weather: tuple[DailyWeather, ...]
    crop_days: dict[str, tuple[CropDayTruth, ...]]
    final_storage_mm: dict[str, float]
    loss_history: tuple[dict[str, float], ...]


@dataclass(frozen=True, slots=True)
class SimulationConfig:
    scenario: ScenarioSpec
    seed: int
    start_time: datetime
    slot_hours: float = 1.0

    def __post_init__(self) -> None:
        _require_seed(self.seed)
        require_utc(self.start_time, "start_time")
        require_positive(self.slot_hours, "slot_hours")
        ratio = HOURS_PER_DAY / self.slot_hours
        rounded = round(ratio)
        if rounded < 1 or not math.isclose(ratio, rounded, rel_tol=1e-9):
            raise DomainInvariantError("slot_hours must divide 24 hours into whole slots")

    @property
    def slots_per_day(self) -> int:
        return round(HOURS_PER_DAY / self.slot_hours)

    @property
    def horizon_slots(self) -> int:
        return self.scenario.horizon_days * self.slots_per_day


@dataclass(slots=True)
class _World:
    index: NetworkIndex
    losses: dict[str, float]
    loss_rng: np.random.Generator
    pi_true: dict[str, float]
    latencies: dict[str, float]
    gates: dict[str, GateState]
    pipe: TransportPipe
    crop_spec: CropTruthSpec
    crop_states: dict[str, CropFieldState]
    crop_rngs: dict[str, np.random.Generator]
    sensors: dict[str, LevelSensorState]
    sensor_block_of: dict[str, str]
    sensor_rngs: dict[str, np.random.Generator]
    daily_delivered_mm: dict[str, float]
    crop_days: dict[str, list[CropDayTruth]]
    loss_history: list[dict[str, float]]


def _build_sensor_states(
    config: SimulationConfig,
    index: NetworkIndex,
) -> tuple[dict[str, LevelSensorState], dict[str, str], dict[str, np.random.Generator]]:
    scenario = config.scenario
    requested = index.block_ids if scenario.sensor_block_ids is None else scenario.sensor_block_ids
    unknown = sorted(set(requested) - set(index.block_ids))
    if unknown:
        raise DomainInvariantError(f"sensor candidate blocks are not in the network: {unknown}")
    spec = LevelSensorSpec.from_noise_level(scenario.sensor_noise)
    disabled = set(blocks_in_zones(index, scenario.failed_zones))
    sensors: dict[str, LevelSensorState] = {}
    sensor_block_of: dict[str, str] = {}
    sensor_rngs: dict[str, np.random.Generator] = {}
    for block_id in requested:
        sensor_id = f"lvl-{block_id}"
        state = create_level_sensor(sensor_id, spec)
        if block_id in disabled:
            state = fail_sensor(state, until_index=config.horizon_slots)
        sensors[sensor_id] = state
        sensor_block_of[sensor_id] = block_id
        sensor_rngs[sensor_id] = generator_for(
            config.seed, "sensors", scenario.scenario_id, sensor_id
        )
    return sensors, sensor_block_of, sensor_rngs


def _build_world(config: SimulationConfig) -> tuple[_World, tuple[DailyWeather, ...]]:
    scenario = config.scenario
    network_rng = generator_for(config.seed, "network", scenario.scenario_id)
    index = NetworkIndex.from_spec(build_network_for(scenario, network_rng))
    loss_rng = generator_for(config.seed, "loss", scenario.scenario_id)
    losses = build_true_losses(
        index,
        loss_rng,
        zone_base=LOSS_ZONE_BASE[scenario.loss_profile],
        spread=LOSS_SPREAD[scenario.loss_profile],
    )
    gate_rng = generator_for(config.seed, "gates", scenario.scenario_id)
    fleet = build_gate_fleet(gate_rng, index.block_ids, scenario.gate_fault)
    crop_spec = CropTruthSpec()
    crop_rngs = {
        block_id: generator_for(config.seed, "crop", scenario.scenario_id, block_id)
        for block_id in index.block_ids
    }
    crop_states = {
        block_id: initial_field_state(block_id, crop_spec, crop_rngs[block_id])
        for block_id in index.block_ids
    }
    sensors, sensor_block_of, sensor_rngs = _build_sensor_states(config, index)
    weather_rng = generator_for(config.seed, "weather", scenario.scenario_id)
    weather = sample_truth_series(
        weather_rng,
        regime_for(scenario.season),
        days=scenario.horizon_days,
    )
    world = _World(
        index=index,
        losses=losses,
        loss_rng=loss_rng,
        pi_true=path_efficiency_map(index, losses),
        latencies=latency_by_block(index, velocity_m_per_s=scenario.flow_velocity_m_per_s),
        gates={block_id: initial_gate_state(fleet[block_id]) for block_id in index.block_ids},
        pipe=TransportPipe.for_blocks(index.block_ids),
        crop_spec=crop_spec,
        crop_states=crop_states,
        crop_rngs=crop_rngs,
        sensors=sensors,
        sensor_block_of=sensor_block_of,
        sensor_rngs=sensor_rngs,
        daily_delivered_mm=dict.fromkeys(index.block_ids, 0.0),
        crop_days={block_id: [] for block_id in index.block_ids},
        loss_history=[dict(losses)],
    )
    return world, weather


def _observe_sensors(world: _World, slot_index: int) -> list[SensorSample]:
    samples: list[SensorSample] = []
    for sensor_id, state in world.sensors.items():
        block_id = world.sensor_block_of[sensor_id]
        truth = world.crop_states[block_id].storage_mm
        next_state, sample = observe_level(
            state,
            truth,
            sample_index=slot_index,
            rng=world.sensor_rngs[sensor_id],
        )
        world.sensors[sensor_id] = next_state
        if sample is not None:
            samples.append(sample)
    return samples


def _close_day(world: _World, weather_day: DailyWeather) -> None:
    for block_id, state in world.crop_states.items():
        next_state, record = advance_crop_day(
            state,
            world.crop_spec,
            world.crop_rngs[block_id],
            delivered_mm=world.daily_delivered_mm[block_id],
            rain_mm=weather_day.rainfall_mm,
            et0_mm_per_day=weather_day.et0_mm_per_day,
        )
        world.crop_states[block_id] = next_state
        world.crop_days[block_id].append(record)
        world.daily_delivered_mm[block_id] = 0.0


def _apply_gate_commands(
    world: _World,
    *,
    opens: Mapping[str, bool],
    now_min: float,
    slot_hours: float,
) -> tuple[dict[str, bool], dict[str, float]]:
    gate_open: dict[str, bool] = {}
    requested: dict[str, float] = {}
    for block_id in world.index.block_ids:
        state = step_gate(world.gates[block_id], now_min=now_min)
        state = issue_gate_command(state, open_requested=opens[block_id], now_min=now_min)
        state = step_gate(state, now_min=now_min)
        world.gates[block_id] = state
        block = world.index.block_by_id[block_id]
        flow = gate_flow_lps(state, nominal_flow_lps=block.nominal_flow_lps)
        gate_open[block_id] = state.open_applied
        requested[block_id] = flow_hours_to_volume_m3(flow, slot_hours)
    return gate_open, requested


def _scale_to_supply(
    requested: Mapping[str, float],
    *,
    supply_lps: float,
    slot_hours: float,
) -> tuple[dict[str, float], bool]:
    capacity = flow_hours_to_volume_m3(supply_lps, slot_hours)
    total = math.fsum(requested.values())
    if total <= capacity:
        return dict(requested), False
    scale = capacity / total
    return {block_id: volume * scale for block_id, volume in requested.items()}, True


def _release_and_collect(
    world: _World,
    released: Mapping[str, float],
    *,
    slot_index: int,
    slot_hours: float,
) -> dict[str, float]:
    for block_id in world.index.block_ids:
        arrival = arrival_slot_index(slot_index, world.latencies[block_id], slot_hours)
        world.pipe.release(
            block_id,
            released[block_id],
            arrival_index=arrival,
            path_efficiency=world.pi_true[block_id],
        )
    arrivals = world.pipe.collect(slot_index)
    return {block_id: arrivals.get(block_id, 0.0) for block_id in world.index.block_ids}


def _accumulate_delivered(world: _World, delivered: Mapping[str, float]) -> None:
    for block_id, volume in delivered.items():
        area = world.index.block_by_id[block_id].area_m2
        world.daily_delivered_mm[block_id] += volume_m3_to_storage_mm(volume, area)


def run_simulation(
    config: SimulationConfig,
    policy: SlotPolicy | None = None,
) -> SimulationResult:
    active_policy: SlotPolicy = policy if policy is not None else AlwaysOpenPolicy()
    world, weather = _build_world(config)
    slots_per_day = config.slots_per_day
    capacity_lps = {edge.edge_id: edge.capacity_lps for edge in world.index.network.edges}
    outcomes: list[SlotOutcome] = []
    for slot_index in range(config.horizon_slots):
        day_index = slot_index // slots_per_day
        if slot_index > 0 and slot_index % slots_per_day == 0:
            world.losses = advance_loss_logit(
                world.losses,
                world.loss_rng,
                sigma=LOSS_DRIFT_SIGMA[config.scenario.loss_profile],
            )
            world.pi_true = path_efficiency_map(world.index, world.losses)
            world.loss_history.append(dict(world.losses))
        observations = tuple(_observe_sensors(world, slot_index))
        context = SlotContext(
            slot_index=slot_index,
            day_index=day_index,
            slot_start=config.start_time + timedelta(hours=config.slot_hours * slot_index),
            slot_hours=config.slot_hours,
            index=world.index,
            observations=observations,
        )
        opens = _canonical_opens(active_policy.decide(context), world.index.block_ids)
        gate_open, requested = _apply_gate_commands(
            world,
            opens=opens,
            now_min=slot_index * config.slot_hours * MINUTES_PER_HOUR,
            slot_hours=config.slot_hours,
        )
        supply_lps = supply_lps_for_day(config.scenario, day_index)
        scaled, supply_binding = _scale_to_supply(
            requested,
            supply_lps=supply_lps,
            slot_hours=config.slot_hours,
        )
        adjusted = apply_capacity_limit(
            world.index,
            scaled,
            capacity_lps=capacity_lps,
            hours=config.slot_hours,
        )
        delivered = _release_and_collect(
            world,
            adjusted.gross_m3_by_block,
            slot_index=slot_index,
            slot_hours=config.slot_hours,
        )
        _accumulate_delivered(world, delivered)
        outcomes.append(
            SlotOutcome(
                slot_index=slot_index,
                day_index=day_index,
                slot_start=context.slot_start,
                gate_open=gate_open,
                requested_gross_m3=requested,
                released_gross_m3=dict(adjusted.gross_m3_by_block),
                delivered_m3=delivered,
                storage_mm={
                    block_id: state.storage_mm for block_id, state in world.crop_states.items()
                },
                path_efficiency=dict(world.pi_true),
                supply_lps=supply_lps,
                supply_binding=supply_binding,
                binding_edge_ids=adjusted.binding_edge_ids,
                observations=observations,
            )
        )
        if (slot_index + 1) % slots_per_day == 0:
            _close_day(world, weather[day_index])
    return SimulationResult(
        scenario_id=config.scenario.scenario_id,
        network=world.index.network,
        outcomes=tuple(outcomes),
        weather=weather,
        crop_days={block_id: tuple(records) for block_id, records in world.crop_days.items()},
        final_storage_mm={
            block_id: state.storage_mm for block_id, state in world.crop_states.items()
        },
        loss_history=tuple(world.loss_history),
    )
