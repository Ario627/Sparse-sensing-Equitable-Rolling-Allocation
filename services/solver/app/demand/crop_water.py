from __future__ import annotations

from dataclasses import dataclass

from app.core.types import DemandTargets, require_non_negative, require_positive
from app.core.units import delivered_volume_m3, storage_mm_to_volume_m3

HOURS_PER_DAY = 24.0


def slot_mm_from_daily_rate(rate_mm_per_day: float, hours: float) -> float:
    rate = require_non_negative(rate_mm_per_day, "rate_mm_per_day")
    duration = require_positive(hours, "hours")
    return rate * duration / HOURS_PER_DAY


def total_consumptive_rate_mm_per_day(
    etc_mm_per_day: float,
    perc_mm_per_day: float,
    wlr_mm_per_day: float,
) -> float:
    return (
        require_non_negative(etc_mm_per_day, "etc_mm_per_day")
        + require_non_negative(perc_mm_per_day, "perc_mm_per_day")
        + require_non_negative(wlr_mm_per_day, "wlr_mm_per_day")
    )


def net_requirement_slot_mm(
    *,
    etc_mm_per_day: float,
    perc_mm_per_day: float,
    wlr_mm_per_day: float,
    effective_rain_slot_mm: float,
    hours: float,
) -> float:
    demand = slot_mm_from_daily_rate(
        total_consumptive_rate_mm_per_day(etc_mm_per_day, perc_mm_per_day, wlr_mm_per_day),
        hours,
    )
    rain = require_non_negative(effective_rain_slot_mm, "effective_rain_slot_mm")
    return max(0.0, demand - rain)


def storage_shortfall_mm(storage_mm: float, floor_mm: float) -> float:
    storage = require_non_negative(storage_mm, "storage_mm")
    floor = require_non_negative(floor_mm, "floor_mm")
    return max(0.0, floor - storage)


@dataclass(frozen=True, slots=True)
class FieldWaterBalance:
    storage_mm: float
    spill_mm: float
    unmet_mm: float

    def __post_init__(self) -> None:
        require_non_negative(self.storage_mm, "storage_mm")
        require_non_negative(self.spill_mm, "spill_mm")
        require_non_negative(self.unmet_mm, "unmet_mm")


def advance_storage_mm(
    storage_mm: float,
    *,
    hours: float,
    irrigation_slot_mm: float,
    effective_rain_slot_mm: float,
    etc_mm_per_day: float,
    perc_mm_per_day: float,
    wlr_mm_per_day: float,
    s_max_mm: float,
) -> FieldWaterBalance:
    initial = require_non_negative(storage_mm, "storage_mm")
    irrigation = require_non_negative(irrigation_slot_mm, "irrigation_slot_mm")
    rain = require_non_negative(effective_rain_slot_mm, "effective_rain_slot_mm")
    ceiling = require_positive(s_max_mm, "s_max_mm")
    depletion = (
        slot_mm_from_daily_rate(etc_mm_per_day, hours)
        + slot_mm_from_daily_rate(perc_mm_per_day, hours)
        + slot_mm_from_daily_rate(wlr_mm_per_day, hours)
    )
    raw = initial + irrigation + rain - depletion
    spilled = max(0.0, raw - ceiling)
    held = min(raw, ceiling)
    unmet = max(0.0, -held)
    return FieldWaterBalance(storage_mm=max(0.0, held), spill_mm=spilled, unmet_mm=unmet)


def required_slot_volume_m3(
    *,
    etc_mm_per_day: float,
    perc_mm_per_day: float,
    wlr_mm_per_day: float,
    effective_rain_slot_mm: float,
    hours: float,
    area_m2: float,
) -> float:
    requirement_mm = net_requirement_slot_mm(
        etc_mm_per_day=etc_mm_per_day,
        perc_mm_per_day=perc_mm_per_day,
        wlr_mm_per_day=wlr_mm_per_day,
        effective_rain_slot_mm=effective_rain_slot_mm,
        hours=hours,
    )
    return storage_mm_to_volume_m3(requirement_mm, area_m2)


def physical_slot_capacity_m3(
    *,
    nominal_flow_lps: float,
    hours: float,
    path_efficiency: float,
) -> float:
    return delivered_volume_m3(
        require_positive(nominal_flow_lps, "nominal_flow_lps"),
        require_positive(hours, "hours"),
        True,
        path_efficiency,
    )


def demand_targets(
    *,
    etc_mm_per_day: float,
    perc_mm_per_day: float,
    wlr_mm_per_day: float,
    effective_rain_slot_mm: float,
    hours: float,
    area_m2: float,
    nominal_flow_lps: float,
    path_efficiency: float,
    critical_stage: bool = False,
) -> DemandTargets:
    required = required_slot_volume_m3(
        etc_mm_per_day=etc_mm_per_day,
        perc_mm_per_day=perc_mm_per_day,
        wlr_mm_per_day=wlr_mm_per_day,
        effective_rain_slot_mm=effective_rain_slot_mm,
        hours=hours,
        area_m2=area_m2,
    )
    capacity = physical_slot_capacity_m3(
        nominal_flow_lps=nominal_flow_lps,
        hours=hours,
        path_efficiency=path_efficiency,
    )
    return DemandTargets.from_requirement(required, capacity, critical_stage=critical_stage)