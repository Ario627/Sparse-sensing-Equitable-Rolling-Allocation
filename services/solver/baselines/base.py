from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from app.core.types import (
    DomainInvariantError,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
)
from app.core.units import LPS_HOUR_TO_M3


def _require_slot_index(value: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DomainInvariantError(f"{name} must be a non-negative integer")
    return value


@dataclass(frozen=True, slots=True)
class LedgerView:
    service_ratio: float
    debt_m3: float

    def __post_init__(self) -> None:
        require_non_negative(self.service_ratio, "service_ratio")
        require_non_negative(self.debt_m3, "debt_m3")


@dataclass(frozen=True, slots=True)
class MethodContext:
    slot_index: int
    day_index: int
    slot_hours: float
    supply_lps: float | None
    demand_m3: Mapping[str, float]
    block_order: tuple[str, ...]
    ledger: Mapping[str, LedgerView] | None = None

    def __post_init__(self) -> None:
        _require_slot_index(self.slot_index, "slot_index")
        _require_slot_index(self.day_index, "day_index")
        require_positive(self.slot_hours, "slot_hours")
        if self.supply_lps is not None:
            require_non_negative(self.supply_lps, "supply_lps")
        if not self.block_order:
            raise DomainInvariantError("block_order must not be empty")
        for block_id in self.block_order:
            require_identifier(block_id, "block_id")
        require_unique(self.block_order, "block_id")
        known = set(self.block_order)
        missing = sorted(known - set(self.demand_m3))
        unknown = sorted(set(self.demand_m3) - known)
        if missing or unknown:
            raise DomainInvariantError(
                f"demand_m3 keys must match block_order; missing={missing} unknown={unknown}"
            )
        for block_id in self.block_order:
            require_non_negative(self.demand_m3[block_id], f"demand_m3[{block_id}]")
        if self.ledger is not None:
            stray = sorted(block_id for block_id in self.ledger if block_id not in known)
            if stray:
                raise DomainInvariantError(f"ledger references unknown blocks: {stray}")

    def demand_of(self, block_id: str) -> float:
        if block_id not in self.demand_m3:
            raise DomainInvariantError(f"block is not present in the context: {block_id}")
        return float(self.demand_m3[block_id])

    def ledger_of(self, block_id: str) -> LedgerView | None:
        if self.ledger is None:
            return None
        return self.ledger.get(block_id)

    def supply_volume_m3(self) -> float | None:
        if self.supply_lps is None:
            return None
        return LPS_HOUR_TO_M3 * self.supply_lps * self.slot_hours


def validate_opens(
    candidate: Mapping[str, bool],
    *,
    block_order: tuple[str, ...],
    method_id: str,
) -> dict[str, bool]:
    require_identifier(method_id, "method_id")
    unknown = sorted(set(candidate) - set(block_order))
    missing = sorted(set(block_order) - set(candidate))
    if unknown or missing:
        raise DomainInvariantError(
            f"{method_id} returned invalid blocks; unknown={unknown} missing={missing}"
        )
    return {block_id: bool(candidate[block_id]) for block_id in block_order}


@runtime_checkable
class AllocationMethod(Protocol):
    @property
    def method_id(self) -> str: ...

    def reset(self) -> None: ...

    def decide(self, context: MethodContext) -> Mapping[str, bool]: ...