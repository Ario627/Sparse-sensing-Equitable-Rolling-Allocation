from __future__ import annotations

from dataclasses import dataclass
from typing import Final

import numpy as np  # type: ignore

from app.core.types import (
    CropStage,
    DomainInvariantError,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
)
from app.demand.kp01 import (
    KP01_PERC_DEFAULT_MM_PER_DAY,
    kc_for_stage,
    water_layer_replacement_mm_per_day,
)

HALF_MONTH_DAYS: Final = 15.0
SEASON_DAYS: Final = int(HALF_MONTH_DAYS) * 8
KC_DEVIATION_MIN: Final = -0.2
KC_DEVIATION_MAX: Final = 0.2

STAGE_BY_HALF_MONTH: Final[tuple[CropStage, ...]] = (
    CropStage.VEGETATIVE,
    CropStage.VEGETATIVE,
    CropStage.TILLERING,
    CropStage.TILLERING,
    CropStage.PANICLE_INITIATION,
    CropStage.FLOWERING,
    CropStage.GRAIN_FILLING,
    CropStage.RIPENING,
)


def _require_persistence(value: float, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"{name} must be a number")
    number = float(value)
    if not 0.0 <= number < 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1)")
    return number


def stage_for_day(day_index: int) -> CropStage:
    if isinstance(day_index, bool) or not isinstance(day_index, int) or day_index < 0:
        raise DomainInvariantError("day_index must be a non-negative integer")
    half_month = min(day_index // int(HALF_MONTH_DAYS), len(STAGE_BY_HALF_MONTH) - 1)
    return STAGE_BY_HALF_MONTH[half_month]


def nominal_kc(stage: CropStage | str) -> float:
    return kc_for_stage(stage)


@dataclass(frozen=True, slots=True)
class CropTruthSpec:
    s_max_mm: float = 100.0
    initial_storage_mm: float = 60.0
    kc_base_sigma: float = 0.04
    kc_drift_sigma: float = 0.004
    kc_drift_phi: float = 0.98
    perc_base_mm_per_day: float = KP01_PERC_DEFAULT_MM_PER_DAY
    perc_drift_sigma: float = 0.15
    perc_drift_phi: float = 0.95
    perc_ponding_gain: float = 0.3
    stress_empty_mm: float = 10.0
    stress_full_mm: float = 40.0
    stress_et_floor: float = 0.4
    wlr_window_days: float = 15.0
    wlr_start_days: tuple[int, ...] = (30, 60)

    def __post_init__(self) -> None:
        require_positive(self.s_max_mm, "s_max_mm")
        require_non_negative(self.initial_storage_mm, "initial_storage_mm")
        if self.initial_storage_mm > self.s_max_mm:
            raise DomainInvariantError("initial_storage_mm must not exceed s_max_mm")
        require_non_negative(self.kc_base_sigma, "kc_base_sigma")
        require_non_negative(self.kc_drift_sigma, "kc_drift_sigma")
        _require_persistence(self.kc_drift_phi, "kc_drift_phi")
        require_positive(self.perc_base_mm_per_day, "perc_base_mm_per_day")
        require_non_negative(self.perc_drift_sigma, "perc_drift_sigma")
        _require_persistence(self.perc_drift_phi, "perc_drift_phi")
        require_non_negative(self.perc_ponding_gain, "perc_ponding_gain")
        require_non_negative(self.stress_empty_mm, "stress_empty_mm")
        require_positive(self.stress_full_mm, "stress_full_mm")
        if self.stress_full_mm <= self.stress_empty_mm:
            raise DomainInvariantError("stress_full_mm must exceed stress_empty_mm")
        if not 0.0 < self.stress_et_floor <= 1.0:
            raise DomainInvariantError("stress_et_floor must lie in (0, 1]")
        require_positive(self.wlr_window_days, "wlr_window_days")
        if not self.wlr_start_days:
            raise DomainInvariantError("wlr_start_days must not be empty")
        for start in self.wlr_start_days:
            if isinstance(start, bool) or not isinstance(start, int) or start < 0:
                raise DomainInvariantError("wlr_start_days must contain non-negative integers")
        require_unique(self.wlr_start_days, "wlr_start_days")


@dataclass(frozen=True, slots=True)
class CropDayTruth:
    day_index: int
    stage: CropStage
    kc_true: float
    etc_true_mm: float
    perc_true_mm: float
    wlr_true_mm: float
    delivered_mm: float
    rain_mm: float
    spill_mm: float
    unmet_mm: float
    storage_mm: float

    def __post_init__(self) -> None:
        require_non_negative(self.kc_true, "kc_true")
        require_non_negative(self.etc_true_mm, "etc_true_mm")
        require_non_negative(self.perc_true_mm, "perc_true_mm")
        require_non_negative(self.wlr_true_mm, "wlr_true_mm")
        require_non_negative(self.delivered_mm, "delivered_mm")
        require_non_negative(self.rain_mm, "rain_mm")
        require_non_negative(self.spill_mm, "spill_mm")
        require_non_negative(self.unmet_mm, "unmet_mm")
        require_non_negative(self.storage_mm, "storage_mm")


@dataclass(frozen=True, slots=True)
class CropFieldState:
    block_id: str
    day_index: int
    storage_mm: float
    kc_deviation: float
    perc_log_drift: float

    def __post_init__(self) -> None:
        require_identifier(self.block_id, "block_id")
        if (
            isinstance(self.day_index, bool)
            or not isinstance(self.day_index, int)
            or self.day_index < 0
        ):
            raise DomainInvariantError("day_index must be a non-negative integer")
        require_non_negative(self.storage_mm, "storage_mm")
        if not KC_DEVIATION_MIN <= self.kc_deviation <= KC_DEVIATION_MAX:
            raise DomainInvariantError("kc_deviation out of bounds")


def field_wlr_rate_mm_per_day(spec: CropTruthSpec) -> float:
    return water_layer_replacement_mm_per_day(spec.wlr_window_days)


def _wlr_rate_for_day(day_index: int, spec: CropTruthSpec) -> float:
    active = any(
        start <= day_index < start + int(spec.wlr_window_days) for start in spec.wlr_start_days
    )
    return field_wlr_rate_mm_per_day(spec) if active else 0.0


def _stress_factor(storage_mm: float, spec: CropTruthSpec) -> float:
    span = spec.stress_full_mm - spec.stress_empty_mm
    position = min(max((storage_mm - spec.stress_empty_mm) / span, 0.0), 1.0)
    return spec.stress_et_floor + (1.0 - spec.stress_et_floor) * position


def initial_field_state(
    block_id: str,
    spec: CropTruthSpec,
    rng: np.random.Generator,
) -> CropFieldState:
    deviation = float(rng.standard_normal()) * spec.kc_base_sigma
    drift = float(rng.standard_normal()) * spec.perc_drift_sigma
    return CropFieldState(
        block_id=block_id,
        day_index=0,
        storage_mm=spec.initial_storage_mm,
        kc_deviation=min(max(deviation, KC_DEVIATION_MIN), KC_DEVIATION_MAX),
        perc_log_drift=drift,
    )


def advance_crop_day(
    state: CropFieldState,
    spec: CropTruthSpec,
    rng: np.random.Generator,
    *,
    delivered_mm: float,
    rain_mm: float,
    et0_mm_per_day: float,
) -> tuple[CropFieldState, CropDayTruth]:
    irrigation = require_non_negative(delivered_mm, "delivered_mm")
    rainfall = require_non_negative(rain_mm, "rain_mm")
    reference_et0 = require_non_negative(et0_mm_per_day, "et0_mm_per_day")
    day = state.day_index
    stage = stage_for_day(day)
    kc_true = nominal_kc(stage) * (1.0 + state.kc_deviation)
    stress = _stress_factor(state.storage_mm, spec)
    etc_true = kc_true * reference_et0 * stress
    perc_true = (
        spec.perc_base_mm_per_day
        * float(np.exp(state.perc_log_drift))
        * (1.0 + spec.perc_ponding_gain * min(state.storage_mm / spec.s_max_mm, 1.0))
    )
    wlr_true = _wlr_rate_for_day(day, spec)
    raw = state.storage_mm + irrigation + rainfall - etc_true - perc_true - wlr_true
    spill = max(0.0, raw - spec.s_max_mm)
    held = min(raw, spec.s_max_mm)
    unmet = max(0.0, -held)
    kc_noise = float(rng.standard_normal())
    perc_noise = float(rng.standard_normal())
    next_state = CropFieldState(
        block_id=state.block_id,
        day_index=day + 1,
        storage_mm=max(0.0, held),
        kc_deviation=min(
            max(
                spec.kc_drift_phi * state.kc_deviation + spec.kc_drift_sigma * kc_noise,
                KC_DEVIATION_MIN,
            ),
            KC_DEVIATION_MAX,
        ),
        perc_log_drift=spec.perc_drift_phi * state.perc_log_drift
        + spec.perc_drift_sigma * perc_noise,
    )
    record = CropDayTruth(
        day_index=day,
        stage=stage,
        kc_true=kc_true,
        etc_true_mm=etc_true,
        perc_true_mm=perc_true,
        wlr_true_mm=wlr_true,
        delivered_mm=irrigation,
        rain_mm=rainfall,
        spill_mm=spill,
        unmet_mm=unmet,
        storage_mm=next_state.storage_mm,
    )
    return next_state, record
