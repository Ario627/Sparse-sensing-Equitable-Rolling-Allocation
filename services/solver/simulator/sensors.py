from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Final

import numpy as np  # type: ignore

from app.core.types import (
    DomainInvariantError,
    ReadingQuality,
    SensorKind,
    require_identifier,
    require_non_negative,
    require_positive,
)

MM_PER_M: Final = 1000.0


def _require_probability(value: float, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"{name} must be a number")
    number = float(value)
    if not 0.0 <= number <= 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1]")
    return number


def _require_sample_index(sample_index: int) -> int:
    if isinstance(sample_index, bool) or not isinstance(sample_index, int) or sample_index < 0:
        raise DomainInvariantError("sample_index must be a non-negative integer")
    return sample_index


class SensorNoiseLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


@dataclass(frozen=True, slots=True)
class LevelRating:
    coefficient_lps_per_m_pow: float
    exponent: float

    def __post_init__(self) -> None:
        require_positive(self.coefficient_lps_per_m_pow, "coefficient_lps_per_m_pow")
        require_positive(self.exponent, "exponent")


@dataclass(frozen=True, slots=True)
class SensorSample:
    sensor_id: str
    kind: SensorKind
    sample_index: int
    value: float
    quality: ReadingQuality

    def __post_init__(self) -> None:
        require_identifier(self.sensor_id, "sensor_id")
        _require_sample_index(self.sample_index)
        if not isinstance(self.value, (int, float)) or isinstance(self.value, bool):
            raise DomainInvariantError("value must be numeric")


@dataclass(frozen=True, slots=True)
class LevelSensorSpec:
    noise_sigma_mm: float
    bias_drift_sigma_mm: float
    bias_limit_mm: float
    dropout_prob: float
    stuck_prob: float
    unstuck_prob: float
    stale_after_samples: int

    def __post_init__(self) -> None:
        require_non_negative(self.noise_sigma_mm, "noise_sigma_mm")
        require_non_negative(self.bias_drift_sigma_mm, "bias_drift_sigma_mm")
        require_positive(self.bias_limit_mm, "bias_limit_mm")
        _require_probability(self.dropout_prob, "dropout_prob")
        _require_probability(self.stuck_prob, "stuck_prob")
        _require_probability(self.unstuck_prob, "unstuck_prob")
        if (
            isinstance(self.stale_after_samples, bool)
            or not isinstance(self.stale_after_samples, int)
            or self.stale_after_samples < 1
        ):
            raise DomainInvariantError("stale_after_samples must be a positive integer")

    @classmethod
    def from_noise_level(cls, level: SensorNoiseLevel | str) -> LevelSensorSpec:
        try:
            kind = SensorNoiseLevel(level)
        except ValueError as error:
            raise DomainInvariantError(f"unknown noise level: {level!r}") from error
        return _NOISE_PRESETS[kind]


_NOISE_PRESETS: Final[dict[SensorNoiseLevel, LevelSensorSpec]] = {
    SensorNoiseLevel.LOW: LevelSensorSpec(
        noise_sigma_mm=1.0,
        bias_drift_sigma_mm=0.05,
        bias_limit_mm=10.0,
        dropout_prob=0.0,
        stuck_prob=0.0,
        unstuck_prob=0.35,
        stale_after_samples=5,
    ),
    SensorNoiseLevel.MEDIUM: LevelSensorSpec(
        noise_sigma_mm=3.0,
        bias_drift_sigma_mm=0.15,
        bias_limit_mm=10.0,
        dropout_prob=0.01,
        stuck_prob=0.005,
        unstuck_prob=0.35,
        stale_after_samples=5,
    ),
    SensorNoiseLevel.HIGH: LevelSensorSpec(
        noise_sigma_mm=8.0,
        bias_drift_sigma_mm=0.30,
        bias_limit_mm=15.0,
        dropout_prob=0.05,
        stuck_prob=0.02,
        unstuck_prob=0.35,
        stale_after_samples=5,
    ),
}


@dataclass(frozen=True, slots=True)
class LevelSensorState:
    sensor_id: str
    spec: LevelSensorSpec
    bias_mm: float = 0.0
    last_value_mm: float | None = None
    stuck: bool = False
    stuck_samples: int = 0
    failed_until_index: int | None = None

    def __post_init__(self) -> None:
        require_identifier(self.sensor_id, "sensor_id")
        if self.stuck_samples < 0:
            raise DomainInvariantError("stuck_samples must be non-negative")
        if self.failed_until_index is not None:
            _require_sample_index(self.failed_until_index)


def create_level_sensor(sensor_id: str, spec: LevelSensorSpec) -> LevelSensorState:
    return LevelSensorState(sensor_id=sensor_id, spec=spec)


def fail_sensor(state: LevelSensorState, *, until_index: int) -> LevelSensorState:
    return replace(state, failed_until_index=_require_sample_index(until_index))


def recover_sensor(state: LevelSensorState) -> LevelSensorState:
    return replace(state, failed_until_index=None)


def flow_lps_from_level(level_mm: float, rating: LevelRating) -> float:
    level = require_non_negative(level_mm, "level_mm")
    if level <= 0.0:
        return 0.0
    return rating.coefficient_lps_per_m_pow * (level / MM_PER_M) ** rating.exponent


def observe_level(
    state: LevelSensorState,
    truth_level_mm: float,
    *,
    sample_index: int,
    rng: np.random.Generator,
) -> tuple[LevelSensorState, SensorSample | None]:
    index = _require_sample_index(sample_index)
    truth = require_non_negative(truth_level_mm, "truth_level_mm")
    if state.failed_until_index is not None and index < state.failed_until_index:
        return state, None
    active = (
        replace(state, failed_until_index=None) if state.failed_until_index is not None else state
    )
    spec = active.spec
    drop_roll = float(rng.random())
    stuck_roll = float(rng.random())
    unstuck_roll = float(rng.random())
    noise_roll = float(rng.standard_normal())
    bias_roll = float(rng.standard_normal())
    if drop_roll < spec.dropout_prob:
        return active, None
    if active.stuck:
        if unstuck_roll < spec.unstuck_prob:
            fresh_state = replace(active, stuck=False, stuck_samples=0)
            return _fresh_sample(fresh_state, truth, index, rng, noise_roll, bias_roll)
        held = active.last_value_mm if active.last_value_mm is not None else truth + active.bias_mm
        quality = (
            ReadingQuality.SUSPECT
            if active.stuck_samples < spec.stale_after_samples
            else ReadingQuality.STALE
        )
        stuck_state = replace(
            active,
            stuck=True,
            stuck_samples=active.stuck_samples + 1,
            last_value_mm=held,
        )
        return (
            stuck_state,
            SensorSample(
                sensor_id=active.sensor_id,
                kind=SensorKind.WATER_LEVEL,
                sample_index=index,
                value=held,
                quality=quality,
            ),
        )
    if stuck_roll < spec.stuck_prob:
        stuck_state = replace(
            active,
            stuck=True,
            stuck_samples=0,
            last_value_mm=truth + active.bias_mm,
        )
        return (
            stuck_state,
            SensorSample(
                sensor_id=active.sensor_id,
                kind=SensorKind.WATER_LEVEL,
                sample_index=index,
                value=truth + active.bias_mm,
                quality=ReadingQuality.SUSPECT,
            ),
        )
    return _fresh_sample(active, truth, index, rng, noise_roll, bias_roll)


def _fresh_sample(
    state: LevelSensorState,
    truth_level_mm: float,
    sample_index: int,
    rng: np.random.Generator,
    noise_roll: float,
    bias_roll: float,
) -> tuple[LevelSensorState, SensorSample]:
    spec = state.spec
    bias = min(
        max(state.bias_mm + spec.bias_drift_sigma_mm * bias_roll, -spec.bias_limit_mm),
        spec.bias_limit_mm,
    )
    value = truth_level_mm + bias + spec.noise_sigma_mm * noise_roll
    fresh = replace(
        state,
        bias_mm=bias,
        last_value_mm=value,
        stuck=False,
        stuck_samples=0,
    )
    return (
        fresh,
        SensorSample(
            sensor_id=state.sensor_id,
            kind=SensorKind.WATER_LEVEL,
            sample_index=sample_index,
            value=value,
            quality=ReadingQuality.GOOD,
        ),
    )
