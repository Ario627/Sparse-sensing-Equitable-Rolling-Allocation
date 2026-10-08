from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Final

import numpy as np  # type: ignore

from app.core.types import (
    DomainInvariantError,
    LossZone,
    require_efficiency,
    require_finite,
    require_non_negative,
    require_positive,
    require_unit_open_closed,
)
from app.core.units import LPS_HOUR_TO_M3
from simulator.network import NetworkIndex

_DEFAULT_LOSS_LOWER: Final = 0.5
_DEFAULT_LOSS_UPPER: Final = 0.99


def logit(probability: float) -> float:
    value = require_finite(probability, "probability")
    if not 0.0 < value < 1.0:
        raise DomainInvariantError("probability must lie in (0, 1)")
    return math.log(value / (1.0 - value))


def expit(value: float) -> float:
    number = require_finite(value, "value")
    if number >= 0.0:
        return 1.0 / (1.0 + math.exp(-number))
    exponential = math.exp(number)
    return exponential / (1.0 + exponential)


def edge_latency_h(length_m: float, velocity_m_per_s: float) -> float:
    length = require_non_negative(length_m, "length_m")
    velocity = require_positive(velocity_m_per_s, "velocity_m_per_s")
    return length / velocity / 3600.0


def arrival_slot_index(slot_index: int, latency_h: float, slot_hours: float) -> int:
    if not isinstance(slot_index, int) or isinstance(slot_index, bool) or slot_index < 0:
        raise DomainInvariantError("slot_index must be a non-negative integer")
    latency = require_non_negative(latency_h, "latency_h")
    duration = require_positive(slot_hours, "slot_hours")
    return slot_index + math.ceil(latency / duration)


def _check_logit_bounds(lower: float, upper: float) -> tuple[float, float]:
    low = require_unit_open_closed(lower, "lower")
    high = require_unit_open_closed(upper, "upper")
    if high >= 1.0:
        raise DomainInvariantError("upper bound must stay below one")
    if high <= low:
        raise DomainInvariantError("upper bound must exceed lower bound")
    return low, high


def latency_by_block(
    index: NetworkIndex,
    *,
    velocity_m_per_s: float,
) -> dict[str, float]:
    edge_latency: dict[str, float] = {}
    for edge_id in index.edge_order:
        edge = index.edge_by_id[edge_id]
        if edge.length_m is None:
            raise DomainInvariantError(f"edge {edge_id} has no length")
        edge_latency[edge_id] = edge_latency_h(edge.length_m, velocity_m_per_s)
    return {
        block_id: sum(edge_latency[edge_id] for edge_id in index.path_edges[block_id])
        for block_id in index.block_ids
    }


def build_true_losses(
    index: NetworkIndex,
    rng: np.random.Generator,
    *,
    zone_base: Mapping[LossZone, float],
    spread: float = 0.08,
    lower: float = _DEFAULT_LOSS_LOWER,
    upper: float = _DEFAULT_LOSS_UPPER,
) -> dict[str, float]:
    low, high = _check_logit_bounds(lower, upper)
    variation = require_non_negative(spread, "spread")
    base_values: list[float] = []
    for edge_id in index.edge_order:
        zone = index.edge_by_id[edge_id].zone
        if zone not in zone_base:
            raise DomainInvariantError(f"missing zone base loss for zone {zone}")
        base_values.append(zone_base[zone])
    base = np.array(base_values, dtype=float)
    if not np.all((base > 0.0) & (base < 1.0)):
        raise DomainInvariantError("zone base losses must lie in (0, 1)")
    logit_base = np.log(base / (1.0 - base))
    noise = variation * rng.standard_normal(base.size)
    moved = np.clip(logit_base + noise, logit(low), logit(high))
    losses = np.exp(-np.logaddexp(0.0, -moved))
    return dict(zip(index.edge_order, losses.tolist(), strict=True))


def advance_loss_logit(
    current: Mapping[str, float],
    rng: np.random.Generator,
    *,
    sigma: float,
    lower: float = _DEFAULT_LOSS_LOWER,
    upper: float = _DEFAULT_LOSS_UPPER,
) -> dict[str, float]:
    low, high = _check_logit_bounds(lower, upper)
    step = require_non_negative(sigma, "sigma")
    edge_ids = sorted(current)
    values = np.array([current[edge_id] for edge_id in edge_ids], dtype=float)
    if not np.all((values > 0.0) & (values < 1.0)):
        raise DomainInvariantError("current losses must lie in (0, 1)")
    if step == 0.0:
        return dict(zip(edge_ids, values.tolist(), strict=True))
    logit_values = np.log(values / (1.0 - values))
    moved = np.clip(
        logit_values + step * rng.standard_normal(values.size),
        logit(low),
        logit(high),
    )
    updated = np.exp(-np.logaddexp(0.0, -moved))
    return dict(zip(edge_ids, updated.tolist(), strict=True))


@dataclass(slots=True)
class TransportPipe:
    arrivals: dict[str, dict[int, float]]

    @classmethod
    def for_blocks(cls, block_ids: Iterable[str]) -> TransportPipe:
        identifiers = tuple(block_ids)
        if not identifiers:
            raise DomainInvariantError("block_ids must not be empty")
        return cls(arrivals={block_id: {} for block_id in identifiers})

    def release(
        self,
        block_id: str,
        gross_m3: float,
        *,
        arrival_index: int,
        path_efficiency: float,
    ) -> None:
        if block_id not in self.arrivals:
            raise DomainInvariantError(f"unknown block {block_id}")
        if (
            not isinstance(arrival_index, int)
            or isinstance(arrival_index, bool)
            or arrival_index < 0
        ):
            raise DomainInvariantError("arrival_index must be a non-negative integer")
        volume = require_non_negative(gross_m3, "gross_m3")
        delivered = volume * require_efficiency(path_efficiency, "path_efficiency")
        if delivered <= 0.0:
            return
        bucket = self.arrivals[block_id]
        bucket[arrival_index] = bucket.get(arrival_index, 0.0) + delivered

    def collect(self, slot_index: int) -> dict[str, float]:
        if not isinstance(slot_index, int) or isinstance(slot_index, bool) or slot_index < 0:
            raise DomainInvariantError("slot_index must be a non-negative integer")
        delivered: dict[str, float] = {}
        for block_id, bucket in self.arrivals.items():
            volume = bucket.pop(slot_index, 0.0)
            if volume > 0.0:
                delivered[block_id] = volume
        return delivered


@dataclass(frozen=True, slots=True)
class CapacityAdjustedReleases:
    gross_m3_by_block: dict[str, float]
    binding_edge_ids: tuple[str, ...]


def apply_capacity_limit(
    index: NetworkIndex,
    gross_m3_by_block: Mapping[str, float],
    *,
    capacity_lps: Mapping[str, float],
    hours: float,
) -> CapacityAdjustedReleases:
    duration = require_positive(hours, "hours")
    missing_blocks = sorted(
        block_id for block_id in index.block_ids if block_id not in gross_m3_by_block
    )
    if missing_blocks:
        raise DomainInvariantError(f"missing release volumes for blocks: {missing_blocks}")
    unknown_blocks = sorted(
        block_id for block_id in gross_m3_by_block if block_id not in index.block_by_id
    )
    if unknown_blocks:
        raise DomainInvariantError(f"unknown blocks in release volumes: {unknown_blocks}")
    volumes = {
        block_id: require_non_negative(gross_m3_by_block[block_id], f"gross_m3[{block_id}]")
        for block_id in index.block_ids
    }
    capacities: dict[str, float] = {}
    for edge_id in index.edge_order:
        if edge_id not in capacity_lps:
            raise DomainInvariantError(f"missing capacity for edge {edge_id}")
        capacities[edge_id] = require_positive(capacity_lps[edge_id], f"capacity_lps[{edge_id}]")
    binding: list[str] = []
    for edge_id in index.reverse_edge_order:
        capacity_volume = LPS_HOUR_TO_M3 * capacities[edge_id] * duration
        served = index.downstream[edge_id]
        total = sum(volumes[block_id] for block_id in served)
        if total > capacity_volume:
            scale = capacity_volume / total
            for block_id in served:
                volumes[block_id] *= scale
            binding.append(edge_id)
    return CapacityAdjustedReleases(
        gross_m3_by_block=volumes,
        binding_edge_ids=tuple(binding),
    )
