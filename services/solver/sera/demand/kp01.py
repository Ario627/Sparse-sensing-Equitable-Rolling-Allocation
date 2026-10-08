from __future__ import annotations

import math
from enum import StrEnum
from typing import Final

from sera.core.types import CropStage, DomainInvariantError, require_non_negative, require_positive

KP01_E0_FACTOR: Final = 1.1
KP01_EFFECTIVE_RAIN_FACTOR_PADDY: Final = 0.7
KP01_WLR_MM_PER_APPLICATION: Final = 50.0
KP01_WLR_APPLICATIONS_PER_SEASON: Final = 2
KP01_PERC_MIN_MM_PER_DAY: Final = 1.0
KP01_PERC_MAX_MM_PER_DAY: Final = 3.0
KP01_PERC_DEFAULT_MM_PER_DAY: Final = 2.0
KP01_DEFAULT_WLR_WINDOW_DAYS: Final = 30.0
KP01_DEFAULT_LAND_PREP_DAYS: Final = 30.0


class SoilTexture(StrEnum):
    LIGHT = "LIGHT"
    MEDIUM = "MEDIUM"
    HEAVY = "HEAVY"


KP01_SOIL_SATURATION_MM: Final[dict[SoilTexture, float]] = {
    SoilTexture.LIGHT: 200.0,
    SoilTexture.MEDIUM: 250.0,
    SoilTexture.HEAVY: 300.0,
}

KP01_PADDY_KC_HALF_MONTH: Final[tuple[float, ...]] = (
    1.10,
    1.10,
    1.10,
    1.10,
    1.27,
    1.27,
    1.27,
    1.27,
)

KP01_PADDY_STAGE_HALF_MONTH: Final[dict[CropStage, int]] = {
    CropStage.VEGETATIVE: 1,
    CropStage.TILLERING: 2,
    CropStage.PANICLE_INITIATION: 4,
    CropStage.FLOWERING: 5,
    CropStage.GRAIN_FILLING: 6,
    CropStage.RIPENING: 7,
}

KP01_CRITICAL_STAGES: Final[frozenset[CropStage]] = frozenset(
    {CropStage.PANICLE_INITIATION, CropStage.FLOWERING}
)


def kc_for_half_month(index: int) -> float:
    if not isinstance(index, int) or isinstance(index, bool):
        raise DomainInvariantError("half month index must be an integer")
    if index < 0 or index >= len(KP01_PADDY_KC_HALF_MONTH):
        upper = len(KP01_PADDY_KC_HALF_MONTH) - 1
        raise DomainInvariantError(f"half month index must be in [0, {upper}]")
    return KP01_PADDY_KC_HALF_MONTH[index]


def land_preparation_saturation_mm(soil: SoilTexture | str) -> float:
    try:
        texture = SoilTexture(soil)
    except ValueError as error:
        raise DomainInvariantError(f"unknown soil texture: {soil!r}") from error
    return KP01_SOIL_SATURATION_MM[texture]


def open_water_evaporation_mm_per_day(et0_mm_per_day: float) -> float:
    return KP01_E0_FACTOR * require_positive(et0_mm_per_day, "et0_mm_per_day")


def effective_rainfall_paddy_mm(r80_mm: float) -> float:
    return KP01_EFFECTIVE_RAIN_FACTOR_PADDY * require_non_negative(r80_mm, "r80_mm")


def water_layer_replacement_mm_per_day(window_days: float = KP01_DEFAULT_WLR_WINDOW_DAYS) -> float:
    return KP01_WLR_MM_PER_APPLICATION / require_positive(window_days, "window_days")


def water_layer_replacement_season_mm() -> float:
    return KP01_WLR_MM_PER_APPLICATION * KP01_WLR_APPLICATIONS_PER_SEASON


def is_critical_stage(stage: CropStage | str) -> bool:
    return CropStage(stage) in KP01_CRITICAL_STAGES


def kc_for_stage(stage: CropStage | str) -> float:
    half_month = KP01_PADDY_STAGE_HALF_MONTH.get(CropStage(stage))
    if half_month is None:
        raise DomainInvariantError(
            "land preparation demand must use land_preparation_requirement_mm_per_day"
        )
    return kc_for_half_month(half_month)


def crop_evapotranspiration_mm_per_day(et0_mm_per_day: float, stage: CropStage | str) -> float:
    return kc_for_stage(stage) * require_positive(et0_mm_per_day, "et0_mm_per_day")


def land_preparation_requirement_mm_per_day(
    et0_mm_per_day: float,
    percolation_mm_per_day: float,
    soil: SoilTexture | str,
    saturation_days: float = KP01_DEFAULT_LAND_PREP_DAYS,
) -> float:
    duration = require_positive(saturation_days, "saturation_days")
    water_loss = open_water_evaporation_mm_per_day(et0_mm_per_day) + require_non_negative(
        percolation_mm_per_day, "percolation_mm_per_day"
    )
    saturation = land_preparation_saturation_mm(soil)
    exponent = water_loss * duration / saturation
    return water_loss / -math.expm1(-exponent)
