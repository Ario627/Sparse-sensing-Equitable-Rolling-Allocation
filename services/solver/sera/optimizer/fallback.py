from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from sera.core.types import DomainInvariantError, require_identifier, require_unique
from sera.core.units import flow_hours_to_volume_m3
from sera.optimizer.model import PlanningBlockSpec, PlanningProblem

CAPACITY_TOLERANCE: Final = 1.0e-9
DEFAULT_SHORT_HORIZON_SLOTS: Final = 3
DEFAULT_REVIEW_CONFIDENCE: Final = 0.5


class FallbackLevel(StrEnum):
    LAST_FEASIBLE = "LAST_FEASIBLE"
    LEDGER_GREEDY = "LEDGER_GREEDY"
    STATIC_ROTATION = "STATIC_ROTATION"
    ALL_CLOSED = "ALL_CLOSED"


class FallbackReason(StrEnum):
    INFEASIBLE = "INFEASIBLE"
    NO_SOLUTION = "NO_SOLUTION"
    SOLVER_ERROR = "SOLVER_ERROR"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    MANUAL = "MANUAL"
    NO_CONTEXT = "NO_CONTEXT"


def _require_fraction(value: float, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"{name} must be a number")
    number = float(value)
    if not 0.0 <= number <= 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1]")
    return number


def _require_step_index(value: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DomainInvariantError(f"{name} must be a non-negative integer")
    return value


def service_ratio_of(block: PlanningBlockSpec) -> float:
    if block.ledger_target_m3 <= 0.0:
        return 1.0
    return block.ledger_delivered_m3 / block.ledger_target_m3


@dataclass(frozen=True, slots=True)
class LastFeasiblePlan:
    step_index: int
    opens_by_block: Mapping[str, tuple[bool, ...]]

    def __post_init__(self) -> None:
        _require_step_index(self.step_index, "step_index")
        if not self.opens_by_block:
            raise DomainInvariantError("opens_by_block must not be empty")
        lengths: set[int] = set()
        for block_id, opens in self.opens_by_block.items():
            require_identifier(block_id, "block_id")
            if not opens:
                raise DomainInvariantError(f"opens for {block_id} must not be empty")
            lengths.add(len(opens))
        if len(lengths) != 1:
            raise DomainInvariantError("opens_by_block must share one horizon length")


@dataclass(frozen=True, slots=True)
class FallbackPolicy:
    short_horizon_slots: int = DEFAULT_SHORT_HORIZON_SLOTS
    rotation_schedule: tuple[tuple[str, ...], ...] | None = None
    review_below_confidence: float = DEFAULT_REVIEW_CONFIDENCE

    def __post_init__(self) -> None:
        if (
            isinstance(self.short_horizon_slots, bool)
            or not isinstance(self.short_horizon_slots, int)
            or self.short_horizon_slots < 1
        ):
            raise DomainInvariantError("short_horizon_slots must be a positive integer")
        _require_fraction(self.review_below_confidence, "review_below_confidence")
        if self.rotation_schedule is not None:
            if not self.rotation_schedule:
                raise DomainInvariantError("rotation_schedule must not be empty")
            for group in self.rotation_schedule:
                if not group:
                    raise DomainInvariantError("rotation groups must not be empty")
                for block_id in group:
                    require_identifier(block_id, "rotation block_id")
                require_unique(group, "rotation block_id")


@dataclass(frozen=True, slots=True)
class FallbackContext:
    step_index: int
    reason: FallbackReason
    policy: FallbackPolicy = FallbackPolicy()
    last_feasible: LastFeasiblePlan | None = None
    confidence: float | None = None

    def __post_init__(self) -> None:
        _require_step_index(self.step_index, "step_index")
        if self.confidence is not None:
            _require_fraction(self.confidence, "confidence")


@dataclass(frozen=True, slots=True)
class FallbackDecision:
    level: FallbackLevel
    reason: FallbackReason
    opens: Mapping[str, bool]
    review_required: bool

    def __post_init__(self) -> None:
        if not self.opens:
            raise DomainInvariantError("opens must not be empty")
        for block_id in self.opens:
            require_identifier(block_id, "block_id")


def _review_required(context: FallbackContext, level: FallbackLevel) -> bool:
    if context.reason is FallbackReason.LOW_CONFIDENCE:
        return True
    if (
        context.confidence is not None
        and context.confidence < context.policy.review_below_confidence
    ):
        return True
    return level is FallbackLevel.ALL_CLOSED


def _last_feasible_opens(context: FallbackContext) -> dict[str, bool] | None:
    last = context.last_feasible
    if last is None:
        return None
    offset = context.step_index - last.step_index
    if offset < 0 or offset >= context.policy.short_horizon_slots:
        return None
    if any(offset >= len(opens) for opens in last.opens_by_block.values()):
        return None
    return {block_id: bool(opens[offset]) for block_id, opens in last.opens_by_block.items()}


def _gross_volume_for_slot(block: PlanningBlockSpec, hours: float) -> float:
    return flow_hours_to_volume_m3(block.nominal_flow_lps, hours)


def _edges_serving(problem: PlanningProblem, block_id: str) -> tuple[str, ...]:
    return tuple(
        edge_id
        for edge_id, downstream in problem.edge_downstream_blocks.items()
        if block_id in downstream
    )


def ledger_greedy_opens(problem: PlanningProblem) -> dict[str, bool]:
    hours = problem.slot_hours
    supply_cap = flow_hours_to_volume_m3(problem.scenarios[0].supply_lps[0], hours)
    edge_caps = {
        edge_id: flow_hours_to_volume_m3(capacity, hours)
        for edge_id, capacity in problem.edge_capacity_lps.items()
    }
    edge_loads = dict.fromkeys(problem.edge_capacity_lps, 0.0)
    priority = sorted(
        problem.blocks,
        key=lambda block: (service_ratio_of(block), -block.debt_m3, block.block_id),
    )
    opens = {block.block_id: False for block in problem.blocks}
    total = 0.0
    for block in priority:
        if block.initial_storage_mm >= block.max_storage_mm:
            continue
        gross = _gross_volume_for_slot(block, hours)
        if total + gross > supply_cap + CAPACITY_TOLERANCE:
            continue
        edges = _edges_serving(problem, block.block_id)
        if any(
            edge_loads[edge_id] + gross > edge_caps[edge_id] + CAPACITY_TOLERANCE
            for edge_id in edges
        ):
            continue
        opens[block.block_id] = True
        total += gross
        for edge_id in edges:
            edge_loads[edge_id] += gross
    return opens


def _rotation_opens(
    problem: PlanningProblem,
    policy: FallbackPolicy,
    step_index: int,
) -> dict[str, bool] | None:
    schedule = policy.rotation_schedule
    if schedule is None:
        return None
    known = set(problem.block_ids)
    if any(block_id not in known for group in schedule for block_id in group):
        return None
    active = set(schedule[step_index % len(schedule)])
    return {block_id: block_id in active for block_id in problem.block_ids}


def _has_ledger_evidence(problem: PlanningProblem) -> bool:
    return any(block.ledger_target_m3 > 0.0 for block in problem.blocks)


def select_fallback(problem: PlanningProblem, context: FallbackContext) -> FallbackDecision:
    recovered = _last_feasible_opens(context)
    if recovered is not None:
        return FallbackDecision(
            level=FallbackLevel.LAST_FEASIBLE,
            reason=context.reason,
            opens=recovered,
            review_required=_review_required(context, FallbackLevel.LAST_FEASIBLE),
        )
    if _has_ledger_evidence(problem):
        return FallbackDecision(
            level=FallbackLevel.LEDGER_GREEDY,
            reason=context.reason,
            opens=ledger_greedy_opens(problem),
            review_required=_review_required(context, FallbackLevel.LEDGER_GREEDY),
        )
    rotation = _rotation_opens(problem, context.policy, context.step_index)
    if rotation is not None:
        return FallbackDecision(
            level=FallbackLevel.STATIC_ROTATION,
            reason=context.reason,
            opens=rotation,
            review_required=_review_required(context, FallbackLevel.STATIC_ROTATION),
        )
    return FallbackDecision(
        level=FallbackLevel.ALL_CLOSED,
        reason=context.reason,
        opens=dict.fromkeys(problem.block_ids, False),
        review_required=True,
    )
