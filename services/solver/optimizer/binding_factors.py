from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from app.core.types import (
    CropStage,
    DomainInvariantError,
    require_finite,
    require_identifier,
    require_non_negative,
)

DEFAULT_FLOOR_TOLERANCE: Final = 1.0e-3
DEFAULT_CONFIDENCE_THRESHOLD: Final = 0.5


class DeficitLevel(StrEnum):
    NONE = "NONE"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class ForecastLabel(StrEnum):
    DRY = "DRY"
    NORMAL = "NORMAL"
    WET = "WET"


class BindingFactor(StrEnum):
    SERVICE_FLOOR = "SERVICE_FLOOR"
    WATER_DEFICIT = "WATER_DEFICIT"
    UPSTREAM_SUPPLY = "UPSTREAM_SUPPLY"
    EDGE_CAPACITY = "EDGE_CAPACITY"
    SAFETY_FLOOR = "SAFETY_FLOOR"
    CRITICAL_STAGE = "CRITICAL_STAGE"
    SENSOR_CONFIDENCE = "SENSOR_CONFIDENCE"
    DEBT_PRIORITY = "DEBT_PRIORITY"
    STABILITY = "STABILITY"
    FALLBACK = "FALLBACK"


def _require_enum(value: object, enum_type: type[StrEnum], name: str) -> None:
    try:
        enum_type(value)
    except ValueError as error:
        raise DomainInvariantError(f"unknown {name}: {value!r}") from error


def _require_unit_interval(value: float, name: str) -> float:
    number = require_finite(value, name)
    if not 0.0 <= number <= 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1]")
    return number


def _require_window(start: int | None, end: int | None) -> None:
    if start is None and end is None:
        return
    if start is None or end is None:
        raise DomainInvariantError("window bounds must be supplied together")
    if isinstance(start, bool) or not isinstance(start, int) or start < 0:
        raise DomainInvariantError("window start slot must be a non-negative integer")
    if isinstance(end, bool) or not isinstance(end, int) or end <= start:
        raise DomainInvariantError("window end slot must exceed the start slot")


def deficit_level_from_ratio(
    ratio: float,
    *,
    medium_threshold: float = 0.10,
    high_threshold: float = 0.30,
) -> DeficitLevel:
    value = require_non_negative(ratio, "ratio")
    medium = require_non_negative(medium_threshold, "medium_threshold")
    high = require_non_negative(high_threshold, "high_threshold")
    if high <= medium:
        raise DomainInvariantError("high_threshold must exceed medium_threshold")
    if value >= high:
        return DeficitLevel.HIGH
    if value >= medium:
        return DeficitLevel.MEDIUM
    if value > 0.0:
        return DeficitLevel.LOW
    return DeficitLevel.NONE


def forecast_label_from_rainfall(
    daily_mm: float,
    *,
    dry_below_mm: float = 1.0,
    wet_above_mm: float = 8.0,
) -> ForecastLabel:
    value = require_non_negative(daily_mm, "daily_mm")
    dry = require_non_negative(dry_below_mm, "dry_below_mm")
    wet = require_non_negative(wet_above_mm, "wet_above_mm")
    if wet <= dry:
        raise DomainInvariantError("wet_above_mm must exceed dry_below_mm")
    if value < dry:
        return ForecastLabel.DRY
    if value > wet:
        return ForecastLabel.WET
    return ForecastLabel.NORMAL


@dataclass(frozen=True, slots=True)
class BlockSituation:
    block_id: str
    service_ratio: float
    deficit_level: DeficitLevel
    crop_stage: CropStage
    critical_stage: bool
    tail_position: bool
    forecast_label: ForecastLabel
    sensor_confidence: float | None = None
    service_floor_z: float | None = None
    supply_binding: bool = False
    capacity_binding: bool = False
    storage_floor_binding: bool = False
    debt_priority: bool = False
    fallback_used: bool = False
    switching_block: bool = False
    window_slot_start: int | None = None
    window_slot_end: int | None = None

    def __post_init__(self) -> None:
        require_identifier(self.block_id, "block_id")
        require_non_negative(self.service_ratio, "service_ratio")
        _require_enum(self.deficit_level, DeficitLevel, "deficit_level")
        _require_enum(self.crop_stage, CropStage, "crop_stage")
        _require_enum(self.forecast_label, ForecastLabel, "forecast_label")
        if self.sensor_confidence is not None:
            _require_unit_interval(self.sensor_confidence, "sensor_confidence")
        if self.service_floor_z is not None:
            _require_unit_interval(self.service_floor_z, "service_floor_z")
        _require_window(self.window_slot_start, self.window_slot_end)


def derive_binding_factors(
    situation: BlockSituation,
    *,
    floor_tolerance: float = DEFAULT_FLOOR_TOLERANCE,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
) -> tuple[BindingFactor, ...]:
    tolerance = require_non_negative(floor_tolerance, "floor_tolerance")
    threshold = _require_unit_interval(confidence_threshold, "confidence_threshold")
    floor_active = (
        situation.service_floor_z is not None
        and situation.service_floor_z > tolerance
        and situation.service_ratio <= situation.service_floor_z + tolerance
    )
    factors: list[BindingFactor] = []
    if floor_active:
        factors.append(BindingFactor.SERVICE_FLOOR)
    if situation.deficit_level is DeficitLevel.HIGH:
        factors.append(BindingFactor.WATER_DEFICIT)
    if situation.supply_binding:
        factors.append(BindingFactor.UPSTREAM_SUPPLY)
    if situation.capacity_binding:
        factors.append(BindingFactor.EDGE_CAPACITY)
    if situation.storage_floor_binding:
        factors.append(BindingFactor.SAFETY_FLOOR)
    if situation.critical_stage:
        factors.append(BindingFactor.CRITICAL_STAGE)
    if (
        situation.sensor_confidence is not None
        and situation.sensor_confidence < threshold
    ):
        factors.append(BindingFactor.SENSOR_CONFIDENCE)
    if situation.debt_priority:
        factors.append(BindingFactor.DEBT_PRIORITY)
    if situation.switching_block:
        factors.append(BindingFactor.STABILITY)
    if situation.fallback_used:
        factors.append(BindingFactor.FALLBACK)
    return tuple(factors)


@dataclass(frozen=True, slots=True)
class BlockExplanation:
    block_id: str
    service_ratio: float
    deficit_level: DeficitLevel
    crop_stage: CropStage
    tail_position: bool
    forecast_label: ForecastLabel
    sensor_confidence: float | None
    window_slot_start: int | None
    window_slot_end: int | None
    binding_factors: tuple[BindingFactor, ...]

    def __post_init__(self) -> None:
        require_identifier(self.block_id, "block_id")
        require_non_negative(self.service_ratio, "service_ratio")
        if self.sensor_confidence is not None:
            _require_unit_interval(self.sensor_confidence, "sensor_confidence")
        _require_window(self.window_slot_start, self.window_slot_end)
        for factor in self.binding_factors:
            _require_enum(factor, BindingFactor, "binding factor")


def build_block_explanation(
    situation: BlockSituation,
    *,
    floor_tolerance: float = DEFAULT_FLOOR_TOLERANCE,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
) -> BlockExplanation:
    return BlockExplanation(
        block_id=situation.block_id,
        service_ratio=situation.service_ratio,
        deficit_level=situation.deficit_level,
        crop_stage=situation.crop_stage,
        tail_position=situation.tail_position,
        forecast_label=situation.forecast_label,
        sensor_confidence=situation.sensor_confidence,
        window_slot_start=situation.window_slot_start,
        window_slot_end=situation.window_slot_end,
        binding_factors=derive_binding_factors(
            situation,
            floor_tolerance=floor_tolerance,
            confidence_threshold=confidence_threshold,
        ),
    )


def build_explanations(
    situations: Sequence[BlockSituation],
    *,
    floor_tolerance: float = DEFAULT_FLOOR_TOLERANCE,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
) -> tuple[BlockExplanation, ...]:
    return tuple(
        build_block_explanation(
            situation,
            floor_tolerance=floor_tolerance,
            confidence_threshold=confidence_threshold,
        )
        for situation in situations
    )