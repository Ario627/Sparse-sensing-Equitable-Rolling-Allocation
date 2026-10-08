from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

import numpy as np  # type: ignore

from app.core.types import (
    DomainInvariantError,
    require_efficiency,
    require_finite,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
)
from app.core.units import volume_m3_to_storage_mm
from app.demand.crop_water import slot_mm_from_daily_rate
from estimator.observations import MeasurementBatch

DEFAULT_INITIAL_STORAGE_MM: Final = 50.0
DEFAULT_INITIAL_SIGMA_MM: Final = 15.0


def _frozen(array: np.ndarray) -> np.ndarray:
    frozen = np.array(array, dtype=float, copy=True)
    frozen.setflags(write=False)
    return frozen


def _clip_storage(value: float, s_max_mm: float) -> float:
    return min(max(value, 0.0), s_max_mm)


@dataclass(frozen=True, slots=True)
class StorageDynamicsParams:
    percolation_mm_per_day: float = 2.0
    wlr_mm_per_day: float = 1.6666667
    s_max_mm: float = 100.0
    process_sigma_mm_per_slot: float = 1.0
    min_variance_mm2: float = 1.0e-6

    def __post_init__(self) -> None:
        require_non_negative(self.percolation_mm_per_day, "percolation_mm_per_day")
        require_non_negative(self.wlr_mm_per_day, "wlr_mm_per_day")
        require_positive(self.s_max_mm, "s_max_mm")
        require_non_negative(self.process_sigma_mm_per_slot, "process_sigma_mm_per_slot")
        require_positive(self.min_variance_mm2, "min_variance_mm2")


@dataclass(frozen=True, slots=True, eq=False)
class StorageEstimate:
    block_ids: tuple[str, ...]
    means_mm: np.ndarray
    variances_mm2: np.ndarray
    slot_index: int = 0

    def __post_init__(self) -> None:
        require_unique(self.block_ids, "block_id")
        sizes = (len(self.block_ids), int(self.means_mm.size), int(self.variances_mm2.size))
        if len(set(sizes)) != 1:
            raise DomainInvariantError("storage estimate arrays must share one length")
        if (
            isinstance(self.slot_index, bool)
            or not isinstance(self.slot_index, int)
            or self.slot_index < 0
        ):
            raise DomainInvariantError("slot_index must be a non-negative integer")
        if not np.all(np.isfinite(self.means_mm)):
            raise DomainInvariantError("storage means must be finite")
        if not np.all(np.isfinite(self.variances_mm2)) or not np.all(self.variances_mm2 >= 0.0):
            raise DomainInvariantError("storage variances must be finite and non-negative")
        object.__setattr__(self, "means_mm", _frozen(self.means_mm))
        object.__setattr__(self, "variances_mm2", _frozen(self.variances_mm2))

    def __len__(self) -> int:
        return len(self.block_ids)

    def position_of(self, block_id: str) -> int:
        try:
            return self.block_ids.index(block_id)
        except ValueError as error:
            raise DomainInvariantError(f"block not tracked: {block_id}") from error

    def mean_of(self, block_id: str) -> float:
        return float(self.means_mm[self.position_of(block_id)])

    def variance_of(self, block_id: str) -> float:
        return float(self.variances_mm2[self.position_of(block_id)])

    def std_of(self, block_id: str) -> float:
        return math.sqrt(self.variance_of(block_id))


@dataclass(frozen=True, slots=True)
class StorageForecastInput:
    delivered_mm_by_block: Mapping[str, float]
    etc_mm_by_block: Mapping[str, float]
    effective_rain_mm: float = 0.0
    hours: float = 1.0

    def __post_init__(self) -> None:
        require_positive(self.hours, "hours")
        require_non_negative(self.effective_rain_mm, "effective_rain_mm")
        for block_id, value in self.delivered_mm_by_block.items():
            require_identifier(block_id, "delivered block_id")
            require_non_negative(value, f"delivered_mm[{block_id}]")
        for block_id, value in self.etc_mm_by_block.items():
            require_identifier(block_id, "etc block_id")
            require_non_negative(value, f"etc_mm[{block_id}]")


def delivery_mm_by_block(
    gross_m3_by_block: Mapping[str, float],
    assumed_efficiency_by_block: Mapping[str, float],
    area_m2_by_block: Mapping[str, float],
) -> dict[str, float]:
    delivery: dict[str, float] = {}
    for block_id, gross_m3 in gross_m3_by_block.items():
        if block_id not in assumed_efficiency_by_block:
            raise DomainInvariantError(f"missing assumed efficiency for block: {block_id}")
        if block_id not in area_m2_by_block:
            raise DomainInvariantError(f"missing area for block: {block_id}")
        delivered_m3 = require_non_negative(gross_m3, f"gross_m3[{block_id}]") * (
            require_efficiency(
                assumed_efficiency_by_block[block_id],
                f"assumed_efficiency[{block_id}]",
            )
        )
        delivery[block_id] = volume_m3_to_storage_mm(delivered_m3, area_m2_by_block[block_id])
    return delivery


def initial_storage_estimate(
    block_ids: tuple[str, ...],
    *,
    initial_mm: float = DEFAULT_INITIAL_STORAGE_MM,
    initial_sigma_mm: float = DEFAULT_INITIAL_SIGMA_MM,
    slot_index: int = 0,
) -> StorageEstimate:
    require_non_negative(initial_mm, "initial_mm")
    require_positive(initial_sigma_mm, "initial_sigma_mm")
    count = len(block_ids)
    return StorageEstimate(
        block_ids=block_ids,
        means_mm=np.full(count, initial_mm, dtype=float),
        variances_mm2=np.full(count, initial_sigma_mm * initial_sigma_mm, dtype=float),
        slot_index=slot_index,
    )


def correct_storage(
    estimate: StorageEstimate,
    batch: MeasurementBatch,
    params: StorageDynamicsParams,
) -> StorageEstimate:
    if batch.is_empty:
        return estimate
    means = np.array(estimate.means_mm, dtype=float)
    variances = np.array(estimate.variances_mm2, dtype=float)
    for row, block_id in enumerate(batch.block_ids):
        position = estimate.position_of(block_id)
        prior_variance = float(variances[position])
        measurement_variance = float(batch.variances_mm2[row])
        gain = prior_variance / (prior_variance + measurement_variance)
        residual = float(batch.values_mm[row]) - float(means[position])
        means[position] = _clip_storage(float(means[position]) + gain * residual, params.s_max_mm)
        variances[position] = max((1.0 - gain) * prior_variance, params.min_variance_mm2)
    return StorageEstimate(
        block_ids=estimate.block_ids,
        means_mm=means,
        variances_mm2=variances,
        slot_index=estimate.slot_index,
    )


def inflate_variance(estimate: StorageEstimate, *, factor: float) -> StorageEstimate:
    require_finite(factor, "factor")
    if factor < 1.0:
        raise DomainInvariantError("factor must be >= 1")
    return StorageEstimate(
        block_ids=estimate.block_ids,
        means_mm=estimate.means_mm,
        variances_mm2=estimate.variances_mm2 * factor,
        slot_index=estimate.slot_index,
    )


def predict_storage(
    estimate: StorageEstimate,
    params: StorageDynamicsParams,
    forecast: StorageForecastInput,
) -> StorageEstimate:
    missing_delivered = [
        block_id
        for block_id in estimate.block_ids
        if block_id not in forecast.delivered_mm_by_block
    ]
    missing_etc = [
        block_id for block_id in estimate.block_ids if block_id not in forecast.etc_mm_by_block
    ]
    if missing_delivered or missing_etc:
        raise DomainInvariantError(
            f"forecast missing blocks: delivered={missing_delivered} etc={missing_etc}"
        )
    percolation_slot = slot_mm_from_daily_rate(params.percolation_mm_per_day, forecast.hours)
    wlr_slot = slot_mm_from_daily_rate(params.wlr_mm_per_day, forecast.hours)
    process_variance = params.process_sigma_mm_per_slot * params.process_sigma_mm_per_slot
    means = np.empty(len(estimate), dtype=float)
    variances = np.empty(len(estimate), dtype=float)
    for position, block_id in enumerate(estimate.block_ids):
        etc_slot = slot_mm_from_daily_rate(forecast.etc_mm_by_block[block_id], forecast.hours)
        predicted = (
            float(estimate.means_mm[position])
            + float(forecast.delivered_mm_by_block[block_id])
            + forecast.effective_rain_mm
            - etc_slot
            - percolation_slot
            - wlr_slot
        )
        means[position] = _clip_storage(predicted, params.s_max_mm)
        variances[position] = float(estimate.variances_mm2[position]) + process_variance
    return StorageEstimate(
        block_ids=estimate.block_ids,
        means_mm=means,
        variances_mm2=variances,
        slot_index=estimate.slot_index + 1,
    )
