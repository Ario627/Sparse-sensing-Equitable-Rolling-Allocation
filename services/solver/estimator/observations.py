from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Protocol

import numpy as np

from app.core.types import (
    DomainInvariantError,
    ReadingQuality,
    require_finite,
    require_identifier,
    require_positive,
)

DEFAULT_ASSUMED_SIGMA_MM: Final = 3.0

_QUALITY_SEVERITY: Final[dict[ReadingQuality, int]] = {
    ReadingQuality.GOOD: 0,
    ReadingQuality.SUSPECT: 1,
    ReadingQuality.STALE: 2,
    ReadingQuality.BAD: 3,
}


class LevelReadingLike(Protocol):
    sensor_id: str
    value: float
    quality: ReadingQuality


@dataclass(frozen=True, slots=True)
class LevelReading:
    sensor_id: str
    value_mm: float
    quality: ReadingQuality = ReadingQuality.GOOD

    def __post_init__(self) -> None:
        require_identifier(self.sensor_id, "sensor_id")
        require_finite(self.value_mm, "value_mm")


@dataclass(frozen=True, slots=True)
class MeasurementQualityPolicy:
    suspect_variance_multiplier: float = 9.0
    stale_variance_multiplier: float = 25.0
    excluded: frozenset[ReadingQuality] = frozenset((ReadingQuality.BAD,))

    def __post_init__(self) -> None:
        if self.suspect_variance_multiplier < 1.0:
            raise DomainInvariantError("suspect_variance_multiplier must be >= 1")
        if self.stale_variance_multiplier < 1.0:
            raise DomainInvariantError("stale_variance_multiplier must be >= 1")

    def variance_multiplier(self, quality: ReadingQuality | str) -> float | None:
        try:
            kind = ReadingQuality(quality)
        except ValueError as error:
            raise DomainInvariantError(f"unknown reading quality: {quality!r}") from error
        if kind in self.excluded:
            return None
        if kind is ReadingQuality.SUSPECT:
            return self.suspect_variance_multiplier
        if kind is ReadingQuality.STALE:
            return self.stale_variance_multiplier
        if kind is ReadingQuality.BAD:
            return self.stale_variance_multiplier
        return 1.0


def _frozen(array: np.ndarray) -> np.ndarray:
    frozen = np.array(array, dtype=float, copy=True)
    frozen.setflags(write=False)
    return frozen


@dataclass(frozen=True, slots=True, eq=False)
class MeasurementBatch:
    block_ids: tuple[str, ...]
    values_mm: np.ndarray
    variances_mm2: np.ndarray
    qualities: tuple[ReadingQuality, ...]

    def __post_init__(self) -> None:
        lengths = (
            len(self.block_ids),
            len(self.qualities),
            int(self.values_mm.size),
            int(self.variances_mm2.size),
        )
        if len(set(lengths)) != 1:
            raise DomainInvariantError("measurement batch arrays must share one length")
        seen: set[str] = set()
        for block_id in self.block_ids:
            require_identifier(block_id, "block_id")
            if block_id in seen:
                raise DomainInvariantError(
                    f"duplicate block in measurement batch: {block_id}"
                )
            seen.add(block_id)
        if not np.all(np.isfinite(self.values_mm)):
            raise DomainInvariantError("measurement values must be finite")
        if not np.all(np.isfinite(self.variances_mm2)) or not np.all(
            self.variances_mm2 > 0.0
        ):
            raise DomainInvariantError("measurement variances must be finite and positive")
        object.__setattr__(self, "values_mm", _frozen(self.values_mm))
        object.__setattr__(self, "variances_mm2", _frozen(self.variances_mm2))

    @classmethod
    def empty(cls) -> MeasurementBatch:
        return cls(
            block_ids=(),
            values_mm=np.empty(0, dtype=float),
            variances_mm2=np.empty(0, dtype=float),
            qualities=(),
        )

    def __len__(self) -> int:
        return len(self.block_ids)

    @property
    def is_empty(self) -> bool:
        return not self.block_ids

    def contains(self, block_id: str) -> bool:
        return block_id in self.block_ids

    def index_of(self, block_id: str) -> int:
        try:
            return self.block_ids.index(block_id)
        except ValueError as error:
            raise DomainInvariantError(f"block not observed: {block_id}") from error

    def variance_matrix(self) -> np.ndarray:
        return np.diag(self.variances_mm2)


def _pool(
    pairs: Sequence[tuple[float, float, ReadingQuality]],
) -> tuple[float, float, ReadingQuality]:
    if len(pairs) == 1:
        return pairs[0]
    information = math.fsum(1.0 / variance for _, variance, _ in pairs)
    variance = 1.0 / information
    value = math.fsum(value / pair_variance for value, pair_variance, _ in pairs) * variance
    worst = max(pairs, key=lambda pair: _QUALITY_SEVERITY[pair[2]])[2]
    return value, variance, worst


def build_measurement_batch(
    readings: Sequence[LevelReadingLike],
    sensor_block_of: Mapping[str, str],
    *,
    assumed_sigma_mm: float = DEFAULT_ASSUMED_SIGMA_MM,
    policy: MeasurementQualityPolicy | None = None,
) -> MeasurementBatch:
    active = policy if policy is not None else MeasurementQualityPolicy()
    sigma = require_positive(assumed_sigma_mm, "assumed_sigma_mm")
    base_variance = sigma * sigma
    grouped: dict[str, list[tuple[float, float, ReadingQuality]]] = {}
    for reading in readings:
        multiplier = active.variance_multiplier(reading.quality)
        if multiplier is None:
            continue
        block_id = sensor_block_of.get(reading.sensor_id)
        if block_id is None:
            raise DomainInvariantError(
                f"no block mapped for sensor: {reading.sensor_id}"
            )
        value = require_finite(float(reading.value), f"reading[{reading.sensor_id}]")
        grouped.setdefault(block_id, []).append(
            (value, base_variance * multiplier, reading.quality)
        )
    block_ids = tuple(sorted(grouped))
    pooled = [_pool(grouped[block_id]) for block_id in block_ids]
    return MeasurementBatch(
        block_ids=block_ids,
        values_mm=np.array([value for value, _, _ in pooled], dtype=float),
        variances_mm2=np.array([variance for _, variance, _ in pooled], dtype=float),
        qualities=tuple(quality for _, _, quality in pooled),
    )