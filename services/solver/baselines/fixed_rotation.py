from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from app.core.types import DomainInvariantError, require_identifier, require_unique
from baselines.base import BaselineMethod, BaselinePlan, require_step_index
from optimizer.model import PlanningProblem

DEFAULT_TURN_SLOTS: Final = 1


@dataclass(frozen=True, slots=True)
class FixedRotationStrategy:
    schedule: tuple[tuple[str, ...], ...] | None = None
    turn_slots: int = DEFAULT_TURN_SLOTS

    def __post_init__(self) -> None:
        if (
            isinstance(self.turn_slots, bool)
            or not isinstance(self.turn_slots, int)
            or self.turn_slots < 1
        ):
            raise DomainInvariantError("turn_slots must be a positive integer")
        schedule = self.schedule
        if schedule is None:
            return
        if not schedule:
            raise DomainInvariantError("rotation schedule must not be empty")
        for group in schedule:
            if not group:
                raise DomainInvariantError("rotation groups must not be empty")
            for block_id in group:
                require_identifier(block_id, "rotation block_id")
            require_unique(group, "rotation block_id")
        require_unique(
            (block_id for group in schedule for block_id in group),
            "rotation block_id",
        )

    @property
    def method(self) -> BaselineMethod:
        return BaselineMethod.ROTATION

    def plan(self, problem: PlanningProblem, step_index: int = 0) -> BaselinePlan:
        require_step_index(step_index)
        groups = self._resolved_schedule(problem)
        self._require_cover(problem, groups)
        opens = {block_id: [False] * problem.slot_count for block_id in problem.block_ids}
        for slot in range(problem.slot_count):
            turn = (step_index + slot) // self.turn_slots
            for block_id in groups[turn % len(groups)]:
                opens[block_id][slot] = True
        return BaselinePlan.from_mapping(
            self.method,
            problem,
            {block_id: tuple(opens[block_id]) for block_id in problem.block_ids},
        )

    def _resolved_schedule(self, problem: PlanningProblem) -> tuple[tuple[str, ...], ...]:
        schedule = self.schedule
        if schedule is not None:
            return schedule
        return tuple((block_id,) for block_id in problem.block_ids)

    @staticmethod
    def _require_cover(
        problem: PlanningProblem,
        groups: tuple[tuple[str, ...], ...],
    ) -> None:
        declared = {block_id for group in groups for block_id in group}
        unknown = sorted(declared - set(problem.block_ids))
        if unknown:
            raise DomainInvariantError(f"rotation schedule references unknown blocks: {unknown}")
        missing = sorted(set(problem.block_ids) - declared)
        if missing:
            raise DomainInvariantError(f"rotation schedule omits blocks: {missing}")