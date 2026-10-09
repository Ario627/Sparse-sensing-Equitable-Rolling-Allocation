from __future__ import annotations

from dataclasses import dataclass

from sera.core.types import require_non_negative


def agricultural_deficit_m3(target_req_m3: float, delivered_m3: float) -> float:
    requirement = require_non_negative(target_req_m3, "target_req_m3")
    delivered = require_non_negative(delivered_m3, "delivered_m3")
    return max(0.0, requirement - delivered)


def structural_deficit_m3(target_req_m3: float, target_phys_m3: float) -> float:
    requirement = require_non_negative(target_req_m3, "target_req_m3")
    physical = require_non_negative(target_phys_m3, "target_phys_m3")
    return max(0.0, requirement - physical)


def adequacy_ratio(target_req_m3: float, delivered_m3: float) -> float:
    requirement = require_non_negative(target_req_m3, "target_req_m3")
    delivered = require_non_negative(delivered_m3, "delivered_m3")
    if requirement <= 0.0:
        return 1.0
    return delivered / requirement


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
        target_req_m3: float,
        delivered_m3: float,
        target_phys_m3: float,
    ) -> DeficitBreakdown:
        return cls(
            agricultural_deficit_m3=agricultural_deficit_m3(target_req_m3, delivered_m3),
            structural_deficit_m3=structural_deficit_m3(target_req_m3, target_phys_m3),
            adequacy=adequacy_ratio(target_req_m3, delivered_m3),
        )
