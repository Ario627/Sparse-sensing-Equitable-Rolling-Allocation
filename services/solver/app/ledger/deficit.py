from __future__ import annotations

from dataclasses import dataclass

from app.core.types import require_non_negative


def agricultural_deficit_m3(required_m3: float, delivered_m3: float) -> float:
    required = require_non_negative(required_m3, "required_m3")
    delivered = require_non_negative(delivered_m3, "delivered_m3")
    return max(0.0, required - delivered)


def structural_deficit_m3(required_m3: float, physical_capacity_m3: float) -> float:
    required = require_non_negative(required_m3, "required_m3")
    capacity = require_non_negative(physical_capacity_m3, "physical_capacity_m3")
    return max(0.0, required - capacity)


def adequacy_ratio(required_m3: float, delivered_m3: float) -> float:
    required = require_non_negative(required_m3, "required_m3")
    delivered = require_non_negative(delivered_m3, "delivered_m3")
    if required <= 0.0:
        return 1.0
    return delivered / required


@dataclass(frozen=True, slots=True)
class DeficitBreakdown:
    agricultural_deficit_m3: float
    structural_deficit_m3: float
    adequacy: float

    def __post_init__(self) -> None:
        require_non_negative(self.agricultural_deficit_m3, "agricultural_deficit_m3")
        require_non_negative(self.structural_deficit_m3, "structural_deficit_m3")
        require_non_negative(self.adequacy, "adequacy")

    @classmethod
    def from_volumes(
        cls,
        *,
        required_m3: float,
        delivered_m3: float,
        physical_capacity_m3: float,
    ) -> DeficitBreakdown:
        return cls(
            agricultural_deficit_m3=agricultural_deficit_m3(required_m3, delivered_m3),
            structural_deficit_m3=structural_deficit_m3(required_m3, physical_capacity_m3),
            adequacy=adequacy_ratio(required_m3, delivered_m3),
        )
