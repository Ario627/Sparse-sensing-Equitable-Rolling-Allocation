from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Final

import numpy as np # type: ignore

from app.core.types import (
    DomainInvariantError,
    LossZone,
    NetworkSpec,
    TopologyKind,
    require_identifier,
    require_positive,
    require_unique,
    require_unit_open_closed,
)
from simulator.gate import GateFaultSpec
from simulator.network import (
    NetworkIndex,
    branched_network,
    chain_network,
    mixed_network,
    parameterize_network,
    zone_for_distance,
)
from simulator.sensors import SensorNoiseLevel
from simulator.weather import ForecastGrade, SeasonKind


class LossProfile(StrEnum):
    NORMAL = "NORMAL"
    STRESSED = "STRESSED"
    SEVERE = "SEVERE"


LOSS_ZONE_BASE: Final[dict[LossProfile, dict[LossZone, float]]] = {
    LossProfile.NORMAL: {
        LossZone.HEAD: 0.95,
        LossZone.MIDDLE: 0.90,
        LossZone.TAIL: 0.85,
    },
    LossProfile.STRESSED: {
        LossZone.HEAD: 0.90,
        LossZone.MIDDLE: 0.82,
        LossZone.TAIL: 0.74,
    },
    LossProfile.SEVERE: {
        LossZone.HEAD: 0.85,
        LossZone.MIDDLE: 0.70,
        LossZone.TAIL: 0.55,
    },
}

LOSS_SPREAD: Final[dict[LossProfile, float]] = {
    LossProfile.NORMAL: 0.06,
    LossProfile.STRESSED: 0.10,
    LossProfile.SEVERE: 0.14,
}

LOSS_DRIFT_SIGMA: Final[dict[LossProfile, float]] = {
    LossProfile.NORMAL: 0.010,
    LossProfile.STRESSED: 0.020,
    LossProfile.SEVERE: 0.035,
}


@dataclass(frozen=True, slots=True)
class ScenarioSpec:
    scenario_id: str
    topology: TopologyKind = TopologyKind.CHAIN
    n_blocks: int = 10
    horizon_days: int = 30
    season: SeasonKind = SeasonKind.DRY
    supply_nominal_lps: float = 10.0
    k_schedule: tuple[tuple[int, float], ...] = ((0, 1.0),)
    loss_profile: LossProfile = LossProfile.NORMAL
    sensor_noise: SensorNoiseLevel = SensorNoiseLevel.MEDIUM
    sensor_block_ids: tuple[str, ...] | None = None
    failed_zones: tuple[LossZone, ...] = ()
    forecast_grade: ForecastGrade = ForecastGrade.MODERATE
    gate_fault: GateFaultSpec = GateFaultSpec()
    flow_velocity_m_per_s: float = 0.25

    def __post_init__(self) -> None:
        require_identifier(self.scenario_id, "scenario_id")
        if (
            isinstance(self.n_blocks, bool)
            or not isinstance(self.n_blocks, int)
            or self.n_blocks < 1
        ):
            raise DomainInvariantError("n_blocks must be a positive integer")
        if (
            isinstance(self.horizon_days, bool)
            or not isinstance(self.horizon_days, int)
            or self.horizon_days < 1
        ):
            raise DomainInvariantError("horizon_days must be a positive integer")
        require_positive(self.supply_nominal_lps, "supply_nominal_lps")
        require_positive(self.flow_velocity_m_per_s, "flow_velocity_m_per_s")
        starts = [start for start, _ in self.k_schedule]
        if not starts:
            raise DomainInvariantError("k_schedule must not be empty")
        for start in starts:
            if isinstance(start, bool) or not isinstance(start, int) or start < 0:
                raise DomainInvariantError("k_schedule days must be non-negative integers")
        if starts[0] != 0:
            raise DomainInvariantError("k_schedule must start at day 0")
        require_unique(starts, "k_schedule day")
        if starts != sorted(starts):
            raise DomainInvariantError("k_schedule days must be ascending")
        for _, factor in self.k_schedule:
            require_unit_open_closed(factor, "k factor")
        if self.sensor_block_ids is not None:
            require_unique(self.sensor_block_ids, "sensor_block_id")
        require_unique(self.failed_zones, "failed zone")


def k_factor_for_day(spec: ScenarioSpec, day_index: int) -> float:
    if (
        isinstance(day_index, bool)
        or not isinstance(day_index, int)
        or day_index < 0
    ):
        raise DomainInvariantError("day_index must be a non-negative integer")
    factor = spec.k_schedule[0][1]
    for start, value in spec.k_schedule:
        if day_index >= start:
            factor = value
        else:
            break
    return factor


def supply_lps_for_day(spec: ScenarioSpec, day_index: int) -> float:
    return spec.supply_nominal_lps * k_factor_for_day(spec, day_index)


SCENARIO_PRESETS: Final[dict[str, ScenarioSpec]] = {
    "nominal": ScenarioSpec(scenario_id="nominal"),
    "drought": ScenarioSpec(
        scenario_id="drought",
        k_schedule=((0, 1.0), (10, 0.6), (20, 0.4)),
    ),
    "supply_shock": ScenarioSpec(
        scenario_id="supply_shock",
        k_schedule=((0, 1.0), (5, 0.6)),
    ),
    "sensor_failure": ScenarioSpec(
        scenario_id="sensor_failure",
        failed_zones=(LossZone.TAIL,),
    ),
    "sensor_noise_high": ScenarioSpec(
        scenario_id="sensor_noise_high",
        sensor_noise=SensorNoiseLevel.HIGH,
    ),
    "loss_stressed": ScenarioSpec(
        scenario_id="loss_stressed",
        loss_profile=LossProfile.STRESSED,
    ),
    "loss_severe": ScenarioSpec(
        scenario_id="loss_severe",
        loss_profile=LossProfile.SEVERE,
    ),
    "forecast_bad": ScenarioSpec(
        scenario_id="forecast_bad",
        forecast_grade=ForecastGrade.BAD,
    ),
    "gate_degraded": ScenarioSpec(
        scenario_id="gate_degraded",
        gate_fault=GateFaultSpec(
            response_delay_min=15.0,
            delay_jitter_min=5.0,
            flow_bias_sigma=0.05,
            partial_open_prob=0.30,
            partial_open_min=0.60,
            partial_open_max=0.90,
            stuck_prob=0.05,
            stuck_open_prob=0.50,
        ),
    ),
}


def scenario_from_preset(preset_key: str, **overrides: object) -> ScenarioSpec:
    if preset_key not in SCENARIO_PRESETS:
        raise DomainInvariantError(f"unknown scenario preset: {preset_key!r}")
    try:
        return replace(SCENARIO_PRESETS[preset_key], **overrides)
    except TypeError as error:
        raise DomainInvariantError(f"invalid scenario override: {error}") from error


def block_zones(index: NetworkIndex) -> dict[str, LossZone]:
    distances: dict[str, float] = {}
    for block_id, block in index.block_by_id.items():
        if block.distance_from_source_m is None:
            raise DomainInvariantError("network must be parameterized before zoning blocks")
        distances[block_id] = block.distance_from_source_m
    span = max(distances.values())
    return {
        block_id: zone_for_distance(distance, span)
        for block_id, distance in distances.items()
    }


def blocks_in_zones(index: NetworkIndex, zones: tuple[LossZone, ...]) -> tuple[str, ...]:
    if not zones:
        return ()
    wanted = set(zones)
    zone_map = block_zones(index)
    return tuple(
        sorted(block_id for block_id, zone in zone_map.items() if zone in wanted)
    )


_NETWORK_BUILDERS: Final[dict[TopologyKind, Callable[[int, str], NetworkSpec]]] = {
    TopologyKind.CHAIN: lambda n_blocks, network_id: chain_network(
        n_blocks, network_id=network_id
    ),
    TopologyKind.BRANCHED: lambda n_blocks, network_id: branched_network(
        n_blocks, network_id=network_id
    ),
    TopologyKind.MIXED: lambda n_blocks, network_id: mixed_network(
        n_blocks, network_id=network_id
    ),
}


def build_network_for(spec: ScenarioSpec, rng: np.random.Generator) -> NetworkSpec:
    builder = _NETWORK_BUILDERS.get(spec.topology)
    if builder is None:
        raise DomainInvariantError(f"unsupported topology: {spec.topology!r}")
    return parameterize_network(builder(spec.n_blocks, spec.scenario_id), rng)