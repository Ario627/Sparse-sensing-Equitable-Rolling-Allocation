from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Final

from ortools.math_opt.python import mathopt  # type: ignore

from app.core.types import (
    DomainInvariantError,
    PolicyProfile,
    require_non_negative,
    require_positive,
)
from optimizer.model import PlanModel
from optimizer.solver import SolveBudget, SolveOutcome, SolverBackend, SolveStatus, solve_model


class LexicographicStage(StrEnum):
    SAFETY = "SAFETY"
    SHORTAGE_RISK = "SHORTAGE_RISK"
    EQUITY = "EQUITY"
    DISPERSION = "DISPERSION"
    STABILITY = "STABILITY"
    GROSS_WITHDRAWAL = "GROSS_WITHDRAWAL"


DEFAULT_ORDER: Final[tuple[LexicographicStage, ...]] = (
    LexicographicStage.SAFETY,
    LexicographicStage.SHORTAGE_RISK,
    LexicographicStage.EQUITY,
    LexicographicStage.DISPERSION,
    LexicographicStage.STABILITY,
    LexicographicStage.GROSS_WITHDRAWAL,
)


@dataclass(frozen=True, slots=True)
class StageTolerances:
    safety_m3: float = 1.0e-4
    shortage_m3: float = 0.5
    equity_ratio: float = 0.005
    dispersion_ratio: float = 0.005
    switching_count: float = 1.0e-4
    gross_m3: float = 0.5

    def __post_init__(self) -> None:
        for name in (
            "safety_m3",
            "shortage_m3",
            "equity_ratio",
            "dispersion_ratio",
            "switching_count",
            "gross_m3",
        ):
            require_non_negative(getattr(self, name), name)

    def for_stage(self, stage: LexicographicStage) -> float:
        return {
            LexicographicStage.SAFETY: self.safety_m3,
            LexicographicStage.SHORTAGE_RISK: self.shortage_m3,
            LexicographicStage.EQUITY: self.equity_ratio,
            LexicographicStage.DISPERSION: self.dispersion_ratio,
            LexicographicStage.STABILITY: self.switching_count,
            LexicographicStage.GROSS_WITHDRAWAL: self.gross_m3,
        }[stage]


@dataclass(frozen=True, slots=True)
class ProfilePolicy:
    profile: PolicyProfile
    order: tuple[LexicographicStage, ...]
    tolerances: StageTolerances

    def __post_init__(self) -> None:
        if len(set(self.order)) != len(DEFAULT_ORDER):
            raise DomainInvariantError("stage order must contain every stage exactly once")


BALANCED_POLICY: Final = ProfilePolicy(
    profile=PolicyProfile.BALANCED,
    order=DEFAULT_ORDER,
    tolerances=StageTolerances(),
)

EQUITY_FIRST_POLICY: Final = ProfilePolicy(
    profile=PolicyProfile.EQUITY_FIRST,
    order=DEFAULT_ORDER,
    tolerances=replace(StageTolerances(), equity_ratio=0.001),
)

SHORTAGE_FIRST_POLICY: Final = ProfilePolicy(
    profile=PolicyProfile.SHORTAGE_FIRST,
    order=DEFAULT_ORDER,
    tolerances=replace(StageTolerances(), shortage_m3=0.05),
)

PROFILE_POLICIES: Final[dict[PolicyProfile, ProfilePolicy]] = {
    PolicyProfile.BALANCED: BALANCED_POLICY,
    PolicyProfile.EQUITY_FIRST: EQUITY_FIRST_POLICY,
    PolicyProfile.SHORTAGE_FIRST: SHORTAGE_FIRST_POLICY,
}


@dataclass(frozen=True, slots=True)
class LexicographicRequest:
    profile: PolicyProfile = PolicyProfile.BALANCED
    backend: SolverBackend = SolverBackend.HIGHS
    budget: SolveBudget = field(default_factory=SolveBudget)
    stage_time_limit_s: float = 6.0
    shortage_lambda: float = 0.0

    def __post_init__(self) -> None:
        require_positive(self.stage_time_limit_s, "stage_time_limit_s")
        require_non_negative(self.shortage_lambda, "shortage_lambda")

    def policy(self) -> ProfilePolicy:
        return PROFILE_POLICIES[self.profile]


@dataclass(frozen=True, slots=True)
class StageOutcome:
    stage: LexicographicStage
    status: SolveStatus
    objective_value: float | None
    tolerance: float
    solve_seconds: float


@dataclass(frozen=True, slots=True)
class LexicographicOutcome:
    request: LexicographicRequest
    stages: tuple[StageOutcome, ...]
    final: SolveOutcome | None

    @property
    def succeeded(self) -> bool:
        return self.final is not None and self.final.has_solution


def _safety_expression(model: PlanModel) -> mathopt.LinearBase:
    return mathopt.fast_sum(
        model.scenario(scenario_id).probability
        * model.rho_variables[(block.block_id, slot, scenario_id)]
        for block in model.planning.blocks
        for slot in range(model.planning.slot_count)
        for scenario_id in model.planning.scenario_ids
    )


def _shortage_expression(model: PlanModel, shortage_lambda: float) -> mathopt.LinearBase:
    expected = mathopt.fast_sum(
        model.scenario(scenario_id).probability * model.shortage_expression(scenario_id)
        for scenario_id in model.planning.scenario_ids
    )
    cvar = model.cvar_expression()
    if cvar is None or shortage_lambda <= 0.0:
        return expected
    return expected + shortage_lambda * cvar


def _equity_expression(model: PlanModel) -> mathopt.LinearBase:
    return model.service_floor_variable


def _dispersion_expression(model: PlanModel) -> mathopt.LinearBase:
    return mathopt.fast_sum(
        model.scenario(key[2]).probability * model.dispersion_variables[key]
        for key in model.dispersion_variables
    )


def _stability_expression(model: PlanModel) -> mathopt.LinearBase:
    return model.expected_switching_expression()


def _gross_expression(model: PlanModel) -> mathopt.LinearBase:
    return model.expected_gross_expression()


def stage_objective(
    model: PlanModel,
    stage: LexicographicStage,
    *,
    shortage_lambda: float,
) -> tuple[mathopt.LinearBase, bool]:
    if stage is LexicographicStage.SAFETY:
        return _safety_expression(model), True
    if stage is LexicographicStage.SHORTAGE_RISK:
        return _shortage_expression(model, shortage_lambda), True
    if stage is LexicographicStage.EQUITY:
        return _equity_expression(model), False
    if stage is LexicographicStage.DISPERSION:
        return _dispersion_expression(model), True
    if stage is LexicographicStage.STABILITY:
        return _stability_expression(model), True
    return _gross_expression(model), True


def _fix_objective(
    model: PlanModel,
    expression: mathopt.LinearBase,
    *,
    optimum: float,
    tolerance: float,
    minimize: bool,
    stage: LexicographicStage,
) -> None:
    if minimize:
        model.problem.add_linear_constraint(
            expression - (optimum + tolerance) <= 0.0,
            name=f"lexfix|{stage}|upper",
        )
    else:
        model.problem.add_linear_constraint(
            (optimum - tolerance) - expression <= 0.0,
            name=f"lexfix|{stage}|lower",
        )


def solve_lexicographic(
    model: PlanModel, request: LexicographicRequest
) -> LexicographicOutcome:
    policy = request.policy()
    stage_budget = request.budget.with_time_limit(
        min(request.budget.time_limit_s, request.stage_time_limit_s)
    )
    stages: list[StageOutcome] = []
    final: SolveOutcome | None = None
    for index, stage in enumerate(policy.order):
        expression, minimize = stage_objective(
            model, stage, shortage_lambda=request.shortage_lambda
        )
        if minimize:
            model.problem.minimize(expression)
        else:
            model.problem.maximize(expression)
        outcome = solve_model(
            model.problem,
            model.flat_variables,
            backend=request.backend,
            budget=stage_budget,
        )
        tolerance = policy.tolerances.for_stage(stage)
        stages.append(
            StageOutcome(
                stage=stage,
                status=outcome.status,
                objective_value=outcome.objective_value,
                tolerance=tolerance,
                solve_seconds=outcome.solve_seconds,
            )
        )
        if not outcome.has_solution:
            return LexicographicOutcome(request=request, stages=tuple(stages), final=None)
        objective_value = outcome.objective_value
        if index == len(policy.order) - 1:
            final = outcome
            break
        if objective_value is None:
            return LexicographicOutcome(request=request, stages=tuple(stages), final=None)
        _fix_objective(
            model,
            expression,
            optimum=float(objective_value),
            tolerance=tolerance,
            minimize=minimize,
            stage=stage,
        )
    return LexicographicOutcome(request=request, stages=tuple(stages), final=final)
