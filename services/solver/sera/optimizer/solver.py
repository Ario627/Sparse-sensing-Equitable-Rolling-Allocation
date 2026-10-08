from __future__ import annotations

import datetime
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Final

from ortools.math_opt.python import mathopt
from ortools.math_opt.solvers import highs_pb2

from sera.core.types import DomainInvariantError, require_non_negative, require_positive

DEFAULT_TIME_LIMIT_S: Final = 25.0


class SolverBackend(StrEnum):
    HIGHS = "highs"
    SCIP = "scip"


class SolveStatus(StrEnum):
    OPTIMAL = "OPTIMAL"
    FEASIBLE = "FEASIBLE"
    INFEASIBLE = "INFEASIBLE"
    UNBOUNDED = "UNBOUNDED"
    INFEASIBLE_OR_UNBOUNDED = "INFEASIBLE_OR_UNBOUNDED"
    NO_SOLUTION = "NO_SOLUTION"
    NUMERICAL = "NUMERICAL"
    OTHER = "OTHER"


_BACKEND_TO_MATHOPT: Final[dict[SolverBackend, mathopt.SolverType]] = {
    SolverBackend.HIGHS: mathopt.SolverType.HIGHS,
    SolverBackend.SCIP: mathopt.SolverType.GSCIP,
}

_TERMINATION_TO_STATUS: Final[dict[mathopt.TerminationReason, SolveStatus]] = {
    mathopt.TerminationReason.OPTIMAL: SolveStatus.OPTIMAL,
    mathopt.TerminationReason.FEASIBLE: SolveStatus.FEASIBLE,
    mathopt.TerminationReason.INFEASIBLE: SolveStatus.INFEASIBLE,
    mathopt.TerminationReason.UNBOUNDED: SolveStatus.UNBOUNDED,
    mathopt.TerminationReason.INFEASIBLE_OR_UNBOUNDED: SolveStatus.INFEASIBLE_OR_UNBOUNDED,
    mathopt.TerminationReason.NO_SOLUTION_FOUND: SolveStatus.NO_SOLUTION,
    mathopt.TerminationReason.NUMERICAL_ERROR: SolveStatus.NUMERICAL,
    mathopt.TerminationReason.OTHER_ERROR: SolveStatus.OTHER,
}


@dataclass(frozen=True, slots=True)
class SolveBudget:
    time_limit_s: float = DEFAULT_TIME_LIMIT_S
    relative_gap: float | None = None
    absolute_gap: float | None = None
    threads: int | None = 1
    random_seed: int = 0
    enable_output: bool = False

    def __post_init__(self) -> None:
        require_positive(self.time_limit_s, "time_limit_s")
        if self.relative_gap is not None:
            require_non_negative(self.relative_gap, "relative_gap")
        if self.absolute_gap is not None:
            require_non_negative(self.absolute_gap, "absolute_gap")
        if self.threads is not None and self.threads < 1:
            raise DomainInvariantError("threads must be >= 1")
        if self.random_seed < 0:
            raise DomainInvariantError("random_seed must be >= 0")

    def with_time_limit(self, time_limit_s: float) -> SolveBudget:
        return replace(self, time_limit_s=time_limit_s)


@dataclass(frozen=True, slots=True)
class SolveOutcome:
    status: SolveStatus
    hit_time_limit: bool
    objective_value: float | None
    best_bound: float | None
    relative_gap: float | None
    solve_seconds: float
    variable_values: Mapping[str, float]

    @property
    def has_solution(self) -> bool:
        return self.objective_value is not None

    def value(self, name: str, default: float = 0.0) -> float:
        return float(self.variable_values.get(name, default))


def resolve_backend(configured: str, *, scip_enabled: bool) -> SolverBackend:
    try:
        backend = SolverBackend(configured.strip().lower())
    except ValueError as error:
        raise DomainInvariantError(f"unknown solver backend: {configured!r}") from error
    if backend is SolverBackend.SCIP and not scip_enabled:
        raise DomainInvariantError("scip backend requires scip_enabled=true")
    return backend


def _objective_and_bound(result: mathopt.SolveResult) -> tuple[float | None, float | None]:
    objective: float | None = None
    bound: float | None = None
    if result.has_primal_feasible_solution():
        objective = float(result.objective_value())
    try:
        bound = float(result.best_objective_bound())
    except ValueError:
        bound = None
    return objective, bound


def _relative_gap(objective: float | None, bound: float | None) -> float | None:
    if objective is None or bound is None:
        return None
    scale = max(abs(objective), abs(bound), 1.0e-9)
    return abs(objective - bound) / scale


def _solve_seconds(result: mathopt.SolveResult) -> float:
    stats = result.solve_stats
    elapsed = getattr(stats, "solve_time", None)
    if elapsed is None:
        return 0.0
    return float(elapsed.total_seconds())


def _values_by_name(
    result: mathopt.SolveResult,
    variables: Sequence[mathopt.Variable],
) -> dict[str, float]:
    if not result.has_primal_feasible_solution():
        return {}
    values = result.variable_values(variables)
    return {variable.name: float(value) for variable, value in zip(variables, values, strict=True)}


def _solve_parameters(
    budget: SolveBudget,
    backend: SolverBackend,
    *,
    presolve: bool,
) -> mathopt.SolveParameters:
    return mathopt.SolveParameters(
        time_limit=datetime.timedelta(seconds=budget.time_limit_s),
        relative_gap_tolerance=budget.relative_gap,
        absolute_gap_tolerance=budget.absolute_gap,
        threads=budget.threads if backend is SolverBackend.SCIP else None,
        random_seed=budget.random_seed,
        enable_output=budget.enable_output,
        highs=highs_pb2.HighsOptionsProto(
            bool_options={"log_to_console": budget.enable_output},
            string_options={} if presolve else {"presolve": "off"},
        ),
    )


def _attempt_solve(
    problem: mathopt.Model,
    solver_type: mathopt.SolverType,
    parameters: mathopt.SolveParameters,
) -> mathopt.SolveResult | None:
    try:
        return mathopt.solve(problem, solver_type, params=parameters)
    except Exception:
        return None


def solve_model(
    problem: mathopt.Model,
    variables: Sequence[mathopt.Variable],
    *,
    backend: SolverBackend,
    budget: SolveBudget,
) -> SolveOutcome:
    solver_type = _BACKEND_TO_MATHOPT[backend]
    result = _attempt_solve(problem, solver_type, _solve_parameters(budget, backend, presolve=True))
    if result is None or result.termination.reason is mathopt.TerminationReason.INFEASIBLE:
        retry = _attempt_solve(
            problem, solver_type, _solve_parameters(budget, backend, presolve=False)
        )
        if retry is not None:
            result = retry
    if result is None:
        return SolveOutcome(
            status=SolveStatus.NUMERICAL,
            hit_time_limit=False,
            objective_value=None,
            best_bound=None,
            relative_gap=None,
            solve_seconds=0.0,
            variable_values={},
        )
    termination = result.termination
    status = _TERMINATION_TO_STATUS.get(termination.reason, SolveStatus.OTHER)
    hit_limit = termination.limit is mathopt.Limit.TIME
    objective, bound = _objective_and_bound(result)
    return SolveOutcome(
        status=status,
        hit_time_limit=hit_limit,
        objective_value=objective,
        best_bound=bound,
        relative_gap=_relative_gap(objective, bound),
        solve_seconds=_solve_seconds(result),
        variable_values=_values_by_name(result, variables),
    )
