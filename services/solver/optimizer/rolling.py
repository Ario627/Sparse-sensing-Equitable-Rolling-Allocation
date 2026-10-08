from __future__ import annotations

import math
from dataclasses import dataclass, replace

import numpy as np

from app.core.types import DomainInvariantError

from .fallback import (
    FallbackContext,
    FallbackDecision,
    FallbackPolicy,
    FallbackReason,
    LastFeasiblePlan,
    select_fallback,
)
from .model import (
    PlanDecision,
    PlanningProblem,
    PlanningScenario,
    build_plan_model,
    extract_plan,
)
from .objectives import (
    LexicographicOutcome,
    LexicographicRequest,
    StageOutcome,
    solve_lexicographic,
)
from .solver import SolveStatus
from .stochastic import (
    RiskMode,
    ScenarioConfig,
    ScenarioEnsembleSummary,
    build_ensemble,
    ensemble_summary,
    robust_ensemble,
)


@dataclass(frozen=True, slots=True)
class RollingRequest:
    lexicographic: LexicographicRequest
    scenario_config: ScenarioConfig | None = None
    risk_mode: RiskMode = RiskMode.STOCHASTIC
    cvar_alpha: float | None = None
    minimum_confidence: float | None = None

    def __post_init__(self) -> None:
        if self.cvar_alpha is not None and not 0.0 < self.cvar_alpha < 1.0:
            raise DomainInvariantError("cvar_alpha must lie in (0, 1)")
        if self.minimum_confidence is not None and not 0.0 <= self.minimum_confidence <= 1.0:
            raise DomainInvariantError("minimum_confidence must lie in [0, 1]")


@dataclass(frozen=True, slots=True)
class RollingOutcome:
    request: RollingRequest
    block_ids: tuple[str, ...]
    summary: ScenarioEnsembleSummary
    stages: tuple[StageOutcome, ...]
    plan: PlanDecision | None
    fallback: FallbackDecision | None
    total_solve_seconds: float
    commit_slots: int

    @property
    def used_fallback(self) -> bool:
        return self.fallback is not None

    def execution_by_block(self) -> dict[str, tuple[bool, ...]]:
        if self.fallback is not None:
            return {block_id: (bool(opens),) for block_id, opens in self.fallback.opens.items()}
        if self.plan is None:
            raise DomainInvariantError("outcome carries neither plan nor fallback")
        return {
            block_id: tuple(row[: self.commit_slots])
            for block_id, row in zip(self.block_ids, self.plan.open_by_slot, strict=True)
        }

    @classmethod
    def from_fallback(
        cls,
        request: RollingRequest,
        block_ids: tuple[str, ...],
        summary: ScenarioEnsembleSummary,
        stages: tuple[StageOutcome, ...],
        decision: FallbackDecision,
        total_solve_seconds: float,
        commit_slots: int,
    ) -> RollingOutcome:
        return cls(
            request=request,
            block_ids=block_ids,
            summary=summary,
            stages=stages,
            plan=None,
            fallback=decision,
            total_solve_seconds=total_solve_seconds,
            commit_slots=commit_slots,
        )


def _default_context() -> FallbackContext:
    return FallbackContext(
        step_index=0,
        reason=FallbackReason.MANUAL,
        policy=FallbackPolicy(),
        last_feasible=None,
        confidence=None,
    )


def _resolve_ensemble(
    problem: PlanningProblem,
    request: RollingRequest,
    rng: np.random.Generator,
) -> tuple[tuple[PlanningScenario, ...], ScenarioEnsembleSummary]:
    if request.scenario_config is None:
        ensemble = tuple(problem.scenarios)
        if request.risk_mode is RiskMode.ROBUST:
            ensemble = robust_ensemble(ensemble)
        summary = ensemble_summary(ensemble, problem.scenarios[0], cvar_alpha=request.cvar_alpha)
        return ensemble, summary
    if len(problem.scenarios) != 1:
        raise DomainInvariantError(
            "scenario_config requires a problem with a single central scenario"
        )
    return build_ensemble(
        problem.scenarios[0],
        request.scenario_config,
        request.risk_mode,
        rng,
        cvar_alpha=request.cvar_alpha,
    )


def _failure_reason(outcome: LexicographicOutcome) -> FallbackReason:
    statuses = {stage.status for stage in outcome.stages}
    if SolveStatus.INFEASIBLE in statuses:
        return FallbackReason.INFEASIBLE
    if SolveStatus.NUMERICAL in statuses or SolveStatus.OTHER in statuses:
        return FallbackReason.SOLVER_ERROR
    return FallbackReason.NO_SOLUTION


def _low_confidence(request: RollingRequest, context: FallbackContext) -> bool:
    if request.minimum_confidence is None or context.confidence is None:
        return False
    return context.confidence < request.minimum_confidence


def rolling_solve(
    problem: PlanningProblem,
    request: RollingRequest,
    rng: np.random.Generator,
    *,
    fallback_context: FallbackContext | None = None,
) -> RollingOutcome:
    context = fallback_context if fallback_context is not None else _default_context()
    ensemble, summary = _resolve_ensemble(problem, request, rng)
    expanded = replace(problem, scenarios=ensemble)
    if _low_confidence(request, context):
        decision = select_fallback(expanded, replace(context, reason=FallbackReason.LOW_CONFIDENCE))
        return RollingOutcome.from_fallback(
            request,
            problem.block_ids,
            summary,
            (),
            decision,
            0.0,
            problem.commit_slots,
        )
    model = build_plan_model(expanded)
    if request.cvar_alpha is not None:
        model.enable_cvar(request.cvar_alpha)
    outcome = solve_lexicographic(model, request.lexicographic)
    total_seconds = math.fsum(stage.solve_seconds for stage in outcome.stages)
    final = outcome.final
    if final is None or not final.has_solution:
        decision = select_fallback(expanded, replace(context, reason=_failure_reason(outcome)))
        return RollingOutcome.from_fallback(
            request,
            problem.block_ids,
            summary,
            outcome.stages,
            decision,
            total_seconds,
            problem.commit_slots,
        )
    return RollingOutcome(
        request=request,
        block_ids=problem.block_ids,
        summary=summary,
        stages=outcome.stages,
        plan=extract_plan(model, final),
        fallback=None,
        total_solve_seconds=total_seconds,
        commit_slots=problem.commit_slots,
    )


def last_feasible_snapshot(outcome: RollingOutcome, step_index: int) -> LastFeasiblePlan:
    if outcome.plan is None:
        raise DomainInvariantError("fallback outcome carries no plan to snapshot")
    return LastFeasiblePlan(
        step_index=step_index,
        opens_by_block={
            block_id: tuple(row)
            for block_id, row in zip(outcome.block_ids, outcome.plan.open_by_slot, strict=True)
        },
    )
