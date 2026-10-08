from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final, Protocol

from sera.core.types import (
    DomainInvariantError,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
)
from sera.core.units import flow_hours_to_volume_m3
from sera.optimizer.model import PlanningBlockSpec, PlanningProblem, PlanningScenario

CAPACITY_TOLERANCE: Final = 1.0e-9


class BaselineMethod(StrEnum):
    SERA = "sera"
    PROPORTIONAL = "proportional"
    ROTATION = "rotation"
    GREEDY = "greedy"
    ORACLE = "oracle"


@dataclass(frozen=True, slots=True)
class BaselinePlan:
    method: BaselineMethod
    block_ids: tuple[str, ...]
    open_by_slot: tuple[tuple[bool, ...], ...]

    def __post_init__(self) -> None:
        if not self.block_ids:
            raise DomainInvariantError("block_ids must not be empty")
        require_unique(self.block_ids, "block_id")
        if len(self.open_by_slot) != len(self.block_ids):
            raise DomainInvariantError("open_by_slot must align with block_ids")
        slot_count = len(self.open_by_slot[0])
        if slot_count < 1:
            raise DomainInvariantError("open_by_slot must span at least one slot")
        for row in self.open_by_slot:
            if len(row) != slot_count:
                raise DomainInvariantError("open_by_slot rows must share one horizon")
            for flag in row:
                if not isinstance(flag, bool):
                    raise DomainInvariantError("open flags must be boolean")

    @classmethod
    def from_mapping(
        cls,
        method: BaselineMethod,
        problem: PlanningProblem,
        opens: Mapping[str, Sequence[bool]],
    ) -> BaselinePlan:
        unknown = sorted(set(opens) - set(problem.block_ids))
        if unknown:
            raise DomainInvariantError(f"plan returned unknown blocks: {unknown}")
        missing = sorted(set(problem.block_ids) - set(opens))
        if missing:
            raise DomainInvariantError(f"plan omitted blocks: {missing}")
        rows: list[tuple[bool, ...]] = []
        for block_id in problem.block_ids:
            row = tuple(bool(flag) for flag in opens[block_id])
            if len(row) != problem.slot_count:
                raise DomainInvariantError("plan rows must match the slot count")
            rows.append(row)
        return cls(method=method, block_ids=problem.block_ids, open_by_slot=tuple(rows))

    @property
    def slot_count(self) -> int:
        return len(self.open_by_slot[0])

    def execution_by_block(self, commit_slots: int) -> dict[str, tuple[bool, ...]]:
        if isinstance(commit_slots, bool) or not isinstance(commit_slots, int):
            raise DomainInvariantError("commit_slots must be an integer")
        if not 0 <= commit_slots <= self.slot_count:
            raise DomainInvariantError("commit_slots must lie in [0, slot count]")
        return {
            block_id: tuple(row[:commit_slots])
            for block_id, row in zip(self.block_ids, self.open_by_slot, strict=True)
        }


class BaselineStrategy(Protocol):
    @property
    def method(self) -> BaselineMethod: ...

    def plan(self, problem: PlanningProblem, step_index: int = 0) -> BaselinePlan: ...


def require_step_index(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DomainInvariantError("step_index must be a non-negative integer")
    return value


def _require_slot(problem: PlanningProblem, slot: int) -> int:
    if isinstance(slot, bool) or not isinstance(slot, int) or not 0 <= slot < problem.slot_count:
        raise DomainInvariantError("slot must lie in [0, slot count)")
    return slot


def central_scenario(problem: PlanningProblem) -> PlanningScenario:
    return problem.scenarios[0]


def slot_supply_gross_m3(problem: PlanningProblem, slot: int) -> float:
    _require_slot(problem, slot)
    scenario = central_scenario(problem)
    return flow_hours_to_volume_m3(scenario.supply_lps[slot], problem.slot_hours)


def block_gross_per_slot_m3(block: PlanningBlockSpec, slot_hours: float) -> float:
    return flow_hours_to_volume_m3(block.nominal_flow_lps, slot_hours)


def serving_edge_ids(problem: PlanningProblem, block_id: str) -> tuple[str, ...]:
    if block_id not in problem.block_ids:
        raise DomainInvariantError(f"unknown block: {block_id!r}")
    return tuple(
        edge_id
        for edge_id, downstream in problem.edge_downstream_blocks.items()
        if block_id in downstream
    )


@dataclass(slots=True)
class SlotCapacityBudget:
    supply_cap_m3: float
    edge_cap_m3: Mapping[str, float]
    used_supply_m3: float = 0.0
    used_edge_m3: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        require_non_negative(self.supply_cap_m3, "supply_cap_m3")
        require_non_negative(self.used_supply_m3, "used_supply_m3")
        for edge_id, capacity in self.edge_cap_m3.items():
            require_identifier(edge_id, "edge_id")
            require_non_negative(capacity, f"edge_cap_m3[{edge_id}]")

    @classmethod
    def from_problem(cls, problem: PlanningProblem, slot: int) -> SlotCapacityBudget:
        edge_caps = {
            edge_id: flow_hours_to_volume_m3(capacity_lps, problem.slot_hours)
            for edge_id, capacity_lps in problem.edge_capacity_lps.items()
        }
        return cls(supply_cap_m3=slot_supply_gross_m3(problem, slot), edge_cap_m3=edge_caps)

    def allows(self, gross_m3: float, edge_ids: tuple[str, ...]) -> bool:
        require_positive(gross_m3, "gross_m3")
        if self.used_supply_m3 + gross_m3 > self.supply_cap_m3 + CAPACITY_TOLERANCE:
            return False
        for edge_id in edge_ids:
            capacity = self.edge_cap_m3.get(edge_id)
            if capacity is None:
                raise DomainInvariantError(f"unknown edge for capacity budget: {edge_id!r}")
            if self.used_edge_m3.get(edge_id, 0.0) + gross_m3 > capacity + CAPACITY_TOLERANCE:
                return False
        return True

    def commit(self, gross_m3: float, edge_ids: tuple[str, ...]) -> None:
        if not self.allows(gross_m3, edge_ids):
            raise DomainInvariantError("commit would exceed the slot capacity budget")
        self.used_supply_m3 += gross_m3
        for edge_id in edge_ids:
            self.used_edge_m3[edge_id] = self.used_edge_m3.get(edge_id, 0.0) + gross_m3
