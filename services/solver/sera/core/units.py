from __future__ import annotations

import math
from collections.abc import Iterable

from sera.core.types import (
    DomainInvariantError,
    require_efficiency,
    require_finite,
    require_non_negative,
    require_positive,
)

LPS_HOUR_TO_M3 = 3.6
MM_PER_M = 1000.0


def flow_hours_to_volume_m3(flow_lps: float, hours: float) -> float:
    return (
        LPS_HOUR_TO_M3
        * require_non_negative(flow_lps, "flow_lps")
        * require_non_negative(hours, "hours")
    )


def volume_m3_to_storage_mm(volume_m3: float, area_m2: float) -> float:
    return (
        require_non_negative(volume_m3, "volume_m3")
        / require_positive(area_m2, "area_m2")
        * MM_PER_M
    )


def storage_mm_to_volume_m3(storage_mm: float, area_m2: float) -> float:
    return (
        require_finite(storage_mm, "storage_mm") / MM_PER_M * require_positive(area_m2, "area_m2")
    )


def combined_path_efficiency(segment_efficiencies: Iterable[float]) -> float:
    values = tuple(
        require_efficiency(value, f"segment_efficiencies[{index}]")
        for index, value in enumerate(segment_efficiencies)
    )
    if not values:
        raise DomainInvariantError("segment_efficiencies must contain at least one segment")
    return math.prod(values)


def gross_volume_from_delivered_m3(delivered_m3: float, path_efficiency: float) -> float:
    return require_non_negative(delivered_m3, "delivered_m3") / require_efficiency(
        path_efficiency, "path_efficiency"
    )


def delivered_volume_m3(
    flow_lps: float,
    hours: float,
    gate_open: bool,
    path_efficiency: float,
) -> float:
    volume = flow_hours_to_volume_m3(flow_lps, hours)
    efficiency = require_efficiency(path_efficiency, "path_efficiency")
    return volume * efficiency if gate_open else 0.0


def storage_delta_mm(
    flow_lps: float,
    hours: float,
    gate_open: bool,
    path_efficiency: float,
    area_m2: float,
) -> float:
    delivered = delivered_volume_m3(flow_lps, hours, gate_open, path_efficiency)
    return volume_m3_to_storage_mm(delivered, area_m2)
