from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

from sera.baselines.base import BaselineMethod, BaselinePlan, require_step_index
from sera.core.types import DomainInvariantError, require_non_negative
from sera.optimizer.model import PlanningProblem, build_plan_model, extract_plan
from sera.optimizer.objectives import LexicographicRequest, StageOutcome, solve_lexicographic


@dataclass(frozen=True, slots=True)
class OracleOutcome:
    plan: BaselinePlan
    stages: tuple[StageOutcome, ...]
    solve_seconds: float
    relative_gap: float | None

    def __post_init__(self) -> None:
        require_non_negative(self.solve_seconds, "solve_seconds")
        if self.relative_gap is not None:
            require_non_negative(self.relative_gap, "relative_gap")


def _stage_summary(stages: tuple[StageOutcome, ...]) -> str:
    return ", ".join(f"{stage.stage}:{stage.status}" for stage in stages)


@dataclass(frozen=True, slots=True)
class OracleStrategy:
    lexicographic: LexicographicRequest = field(default_factory=LexicographicRequest)

    @property
    def method(self) -> BaselineMethod:
        return BaselineMethod.ORACLE

    def solve(self, problem: PlanningProblem, step_index: int = 0) -> OracleOutcome:
        require_step_index(step_index)
        clairvoyant = replace(problem, commit_slots=0)
        model = build_plan_model(clairvoyant)
        outcome = solve_lexicographic(model, self.lexicographic)
        final = outcome.final
        if final is None or not final.has_solution:
            raise DomainInvariantError(
                f"oracle lexicographic solve failed: {_stage_summary(outcome.stages)}"
            )
        decision = extract_plan(model, final)
        plan = BaselinePlan.from_mapping(
            self.method,
            clairvoyant,
            dict(zip(clairvoyant.block_ids, decision.open_by_slot, strict=True)),
        )
        return OracleOutcome(
            plan=plan,
            stages=outcome.stages,
            solve_seconds=math.fsum(stage.solve_seconds for stage in outcome.stages),
            relative_gap=final.relative_gap,
        )

    def plan(self, problem: PlanningProblem, step_index: int = 0) -> BaselinePlan:
        return self.solve(problem, step_index).plan
