from __future__ import annotations

from typing import Final

import pytest

from app.core.types import DomainInvariantError, PolicyProfile
from optimizer.model import (
    PlanModel,
    PlanningBlockSpec,
    PlanningProblem,
    PlanningScenario,
    build_plan_model,
    extract_plan,
)
from optimizer.objectives import (
    BALANCED_POLICY,
    DEFAULT_ORDER,
    EQUITY_FIRST_POLICY,
    PROFILE_POLICIES,
    SHORTAGE_FIRST_POLICY,
    LexicographicOutcome,
    LexicographicRequest,
    LexicographicStage,
    ProfilePolicy,
    StageTolerances,
    solve_lexicographic,
    stage_objective,
)
from optimizer.solver import SolveBudget, SolverBackend, solve_model

SLOT_HOURS: Final = 6.0
AREA_M2: Final = 10_000.0
FLOW_LPS: Final = 10.0
PATH_EFFICIENCY: Final = 0.9
MIN_STORAGE_MM: Final = 10.0
MAX_STORAGE_MM: Final = 100.0
INITIAL_STORAGE_MM: Final = 50.0
TARGET_FAIR_M3: Final = 100.0
SLOT_COUNT: Final = 4
ABUNDANT_SUPPLY_LPS: Final = 60.0
DEFAULT_EDGE_CAPACITY_LPS: Final = 200.0
STAGE_TIME_LIMIT_S: Final = 2.0

MINIMIZE_BY_STAGE: Final[dict[LexicographicStage, bool]] = {
    LexicographicStage.SAFETY: True,
    LexicographicStage.SHORTAGE_RISK: True,
    LexicographicStage.EQUITY: False,
    LexicographicStage.DISPERSION: True,
    LexicographicStage.STABILITY: True,
    LexicographicStage.GROSS_WITHDRAWAL: True,
}


def make_block(
    block_id: str,
    *,
    initial_storage_mm: float = INITIAL_STORAGE_MM,
    min_storage_mm: float = MIN_STORAGE_MM,
) -> PlanningBlockSpec:
    return PlanningBlockSpec(
        block_id=block_id,
        area_m2=AREA_M2,
        nominal_flow_lps=FLOW_LPS,
        path_efficiency=PATH_EFFICIENCY,
        min_storage_mm=min_storage_mm,
        max_storage_mm=MAX_STORAGE_MM,
        initial_storage_mm=initial_storage_mm,
        ledger_delivered_m3=0.0,
        ledger_target_m3=0.0,
        debt_m3=0.0,
    )


def make_scenario(
    block_count: int,
    *,
    supply_lps: float = ABUNDANT_SUPPLY_LPS,
    etc_mm: float = 1.0,
    perc_mm: float = 0.5,
    wlr_mm: float = 0.25,
    target_fair_m3: float = TARGET_FAIR_M3,
) -> PlanningScenario:
    return PlanningScenario(
        scenario_id="central",
        probability=1.0,
        supply_lps=(supply_lps,) * SLOT_COUNT,
        etc_mm=((etc_mm,) * SLOT_COUNT,) * block_count,
        perc_mm=((perc_mm,) * SLOT_COUNT,) * block_count,
        wlr_mm=((wlr_mm,) * SLOT_COUNT,) * block_count,
        rain_effective_mm=((0.0,) * SLOT_COUNT,) * block_count,
        target_fair_m3=((target_fair_m3,) * SLOT_COUNT,) * block_count,
    )


def make_problem(
    blocks: tuple[PlanningBlockSpec, ...],
    scenario: PlanningScenario,
) -> PlanningProblem:
    downstream = {
        f"e{index + 1}": tuple(block.block_id for block in blocks[index:])
        for index in range(len(blocks))
    }
    return PlanningProblem(
        blocks=blocks,
        scenarios=(scenario,),
        slot_hours=SLOT_HOURS,
        edge_capacity_lps=dict.fromkeys(downstream, DEFAULT_EDGE_CAPACITY_LPS),
        edge_downstream_blocks=downstream,
        previous_gate_open=tuple(False for _ in blocks),
    )


def request_for(profile: PolicyProfile = PolicyProfile.BALANCED) -> LexicographicRequest:
    return LexicographicRequest(
        profile=profile,
        budget=SolveBudget(time_limit_s=STAGE_TIME_LIMIT_S),
        stage_time_limit_s=STAGE_TIME_LIMIT_S,
    )


def solve_stack(
    problem: PlanningProblem, profile: PolicyProfile = PolicyProfile.BALANCED
) -> tuple[PlanModel, LexicographicRequest, LexicographicOutcome]:
    model = build_plan_model(problem)
    request = request_for(profile)
    return model, request, solve_lexicographic(model, request)


def safety_stage_optimum(problem: PlanningProblem) -> float:
    model = build_plan_model(problem)
    expression, minimize = stage_objective(model, LexicographicStage.SAFETY, shortage_lambda=0.0)
    assert minimize is True
    model.problem.minimize(expression)
    outcome = solve_model(
        model.problem,
        model.flat_variables,
        backend=SolverBackend.HIGHS,
        budget=SolveBudget(time_limit_s=STAGE_TIME_LIMIT_S),
    )
    value = outcome.objective_value
    assert value is not None
    return float(value)


def test_default_stage_order_matches_decision_engine() -> None:
    assert DEFAULT_ORDER == (
        LexicographicStage.SAFETY,
        LexicographicStage.SHORTAGE_RISK,
        LexicographicStage.EQUITY,
        LexicographicStage.DISPERSION,
        LexicographicStage.STABILITY,
        LexicographicStage.GROSS_WITHDRAWAL,
    )
    assert len(set(DEFAULT_ORDER)) == len(DEFAULT_ORDER)


def test_stage_tolerances_map_every_stage() -> None:
    tolerances = StageTolerances()
    expected = {
        LexicographicStage.SAFETY: tolerances.safety_m3,
        LexicographicStage.SHORTAGE_RISK: tolerances.shortage_m3,
        LexicographicStage.EQUITY: tolerances.equity_ratio,
        LexicographicStage.DISPERSION: tolerances.dispersion_ratio,
        LexicographicStage.STABILITY: tolerances.switching_count,
        LexicographicStage.GROSS_WITHDRAWAL: tolerances.gross_m3,
    }
    for stage, value in expected.items():
        assert tolerances.for_stage(stage) == pytest.approx(value)
    assert tolerances.safety_m3 <= 1.0e-3
    with pytest.raises(DomainInvariantError):
        StageTolerances(safety_m3=-1.0)


def test_profile_policies_share_order_and_adjust_tolerances() -> None:
    assert BALANCED_POLICY.order == DEFAULT_ORDER
    assert EQUITY_FIRST_POLICY.order == DEFAULT_ORDER
    assert SHORTAGE_FIRST_POLICY.order == DEFAULT_ORDER
    assert EQUITY_FIRST_POLICY.tolerances.equity_ratio < BALANCED_POLICY.tolerances.equity_ratio
    assert SHORTAGE_FIRST_POLICY.tolerances.shortage_m3 < BALANCED_POLICY.tolerances.shortage_m3
    assert set(PROFILE_POLICIES) == set(PolicyProfile)
    for profile, policy in PROFILE_POLICIES.items():
        assert policy.profile is profile


def test_profile_policy_rejects_duplicate_or_missing_stage() -> None:
    order = (*DEFAULT_ORDER[:-1], LexicographicStage.SAFETY)
    with pytest.raises(DomainInvariantError):
        ProfilePolicy(
            profile=PolicyProfile.BALANCED,
            order=order,
            tolerances=StageTolerances(),
        )


def test_request_resolves_policy_by_profile() -> None:
    for profile, policy in PROFILE_POLICIES.items():
        assert LexicographicRequest(profile=profile).policy() is policy


def test_request_rejects_invalid_parameters() -> None:
    with pytest.raises(DomainInvariantError):
        LexicographicRequest(stage_time_limit_s=0.0)
    with pytest.raises(DomainInvariantError):
        LexicographicRequest(shortage_lambda=-1.0)


def test_stage_objectives_carry_minimize_flags() -> None:
    problem = make_problem((make_block("b1"), make_block("b2")), make_scenario(2))
    model = build_plan_model(problem)
    for stage, minimize in MINIMIZE_BY_STAGE.items():
        _, flag = stage_objective(model, stage, shortage_lambda=0.0)
        assert flag is minimize


def test_full_stack_records_every_stage_outcome() -> None:
    problem = make_problem((make_block("b1"), make_block("b2")), make_scenario(2))
    _, request, outcome = solve_stack(problem)
    policy = request.policy()
    assert outcome.succeeded is True
    assert len(outcome.stages) == len(DEFAULT_ORDER)
    for position, stage_outcome in enumerate(outcome.stages):
        assert stage_outcome.stage is DEFAULT_ORDER[position]
        assert stage_outcome.tolerance == pytest.approx(
            policy.tolerances.for_stage(stage_outcome.stage)
        )
        assert stage_outcome.solve_seconds >= 0.0
        assert stage_outcome.objective_value is not None


def test_zero_supply_shortage_stage_records_total_deficit() -> None:
    problem = make_problem((make_block("b1"), make_block("b2")), make_scenario(2, supply_lps=0.0))
    _, _, outcome = solve_stack(problem)
    safety, shortage = outcome.stages[0], outcome.stages[1]
    assert safety.objective_value == pytest.approx(0.0, abs=1.0e-4)
    assert shortage.objective_value == pytest.approx(2 * SLOT_COUNT * TARGET_FAIR_M3, abs=0.6)


def test_abundant_run_saturates_service_floor_stage() -> None:
    problem = make_problem((make_block("b1"), make_block("b2")), make_scenario(2))
    model, _, outcome = solve_stack(problem)
    equity = outcome.stages[2]
    assert equity.objective_value is not None
    assert equity.objective_value > 0.999
    final = outcome.final
    assert final is not None
    plan = extract_plan(model, final)
    assert plan.service_floor_z > 0.99


def test_epsilon_slack_preserves_safety_stage_optimum() -> None:
    blocks = (
        make_block("b1", initial_storage_mm=44.0, min_storage_mm=45.0),
        make_block("b2", initial_storage_mm=44.0, min_storage_mm=45.0),
    )
    problem = make_problem(
        blocks,
        make_scenario(2, supply_lps=0.0, etc_mm=0.0, perc_mm=0.0, wlr_mm=0.0, target_fair_m3=0.0),
    )
    optimum = safety_stage_optimum(problem)
    assert optimum == pytest.approx(2 * SLOT_COUNT, abs=1.0e-4)
    model, _, outcome = solve_stack(problem)
    final = outcome.final
    assert final is not None
    plan = extract_plan(model, final)
    assert plan.safety_slack_total_expected <= optimum + 1.0e-3
    assert plan.safety_slack_total_expected == pytest.approx(optimum, abs=1.0e-3)
