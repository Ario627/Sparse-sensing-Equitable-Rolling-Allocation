from __future__ import annotations

import math
from typing import Final

import pytest

from sera.optimizer.model import (
    PlanningBlockSpec,
    PlanningProblem,
    PlanningScenario,
    build_plan_model,
    extract_plan,
)
from sera.optimizer.objectives import (
    LexicographicOutcome,
    LexicographicRequest,
    solve_lexicographic,
)
from sera.optimizer.solver import SolveBudget

SLOT_HOURS: Final = 6.0
AREA_M2: Final = 10_000.0
FLOW_LPS: Final = 10.0
PATH_EFFICIENCY: Final = 0.9
MIN_STORAGE_MM: Final = 10.0
MAX_STORAGE_MM: Final = 100.0
INITIAL_STORAGE_MM: Final = 50.0
SLOT_COUNT: Final = 3
BLOCK_IDS: Final = ("b1", "b2")
EDGE_CAPACITY_LPS: Final = 200.0
RICH_SUPPLY_LPS: Final = 30.0
POOR_SUPPLY_LPS: Final = 0.0
TARGET_FAIR_M3: Final = 50.0
STAGE_TIME_LIMIT_S: Final = 3.0
BINARY_TOLERANCE: Final = 1.0e-6
FLOW_TOLERANCE: Final = 0.5


def make_block(block_id: str) -> PlanningBlockSpec:
    return PlanningBlockSpec(
        block_id=block_id,
        area_m2=AREA_M2,
        nominal_flow_lps=FLOW_LPS,
        path_efficiency=PATH_EFFICIENCY,
        min_storage_mm=MIN_STORAGE_MM,
        max_storage_mm=MAX_STORAGE_MM,
        initial_storage_mm=INITIAL_STORAGE_MM,
        ledger_delivered_m3=0.0,
        ledger_target_m3=0.0,
        debt_m3=0.0,
    )


def make_scenario(
    scenario_id: str,
    probability: float,
    supply_lps: float,
) -> PlanningScenario:
    return PlanningScenario(
        scenario_id=scenario_id,
        probability=probability,
        supply_lps=(supply_lps,) * SLOT_COUNT,
        etc_mm=((1.0,) * SLOT_COUNT,) * len(BLOCK_IDS),
        perc_mm=((0.5,) * SLOT_COUNT,) * len(BLOCK_IDS),
        wlr_mm=((0.25,) * SLOT_COUNT,) * len(BLOCK_IDS),
        rain_effective_mm=((0.0,) * SLOT_COUNT,) * len(BLOCK_IDS),
        target_fair_m3=((TARGET_FAIR_M3,) * SLOT_COUNT,) * len(BLOCK_IDS),
    )


def two_scenario_problem(commit_slots: int) -> PlanningProblem:
    blocks = tuple(make_block(block_id) for block_id in BLOCK_IDS)
    downstream = {"e1": BLOCK_IDS, "e2": ("b2",)}
    return PlanningProblem(
        blocks=blocks,
        scenarios=(
            make_scenario("sc00", 0.5, RICH_SUPPLY_LPS),
            make_scenario("sc01", 0.5, POOR_SUPPLY_LPS),
        ),
        slot_hours=SLOT_HOURS,
        edge_capacity_lps=dict.fromkeys(downstream, EDGE_CAPACITY_LPS),
        edge_downstream_blocks=downstream,
        previous_gate_open=(False, False),
        commit_slots=commit_slots,
    )


def solve(problem: PlanningProblem) -> tuple[LexicographicOutcome, dict[str, float]]:
    model = build_plan_model(problem)
    request = LexicographicRequest(
        budget=SolveBudget(time_limit_s=STAGE_TIME_LIMIT_S),
        stage_time_limit_s=STAGE_TIME_LIMIT_S,
    )
    outcome = solve_lexicographic(model, request)
    final = outcome.final
    assert final is not None
    return outcome, dict(final.variable_values)


def gate_value(values: dict[str, float], block_id: str, slot: int, scenario_id: str) -> float:
    return values[f"y|{block_id}|{slot}|{scenario_id}"]


def delivery_value(values: dict[str, float], block_id: str, slot: int, scenario_id: str) -> float:
    return values[f"x|{block_id}|{slot}|{scenario_id}"]


def assert_committed_slots_agree(values: dict[str, float], slots: int) -> None:
    for block_id in BLOCK_IDS:
        for slot in range(slots):
            rich_gate = gate_value(values, block_id, slot, "sc00")
            poor_gate = gate_value(values, block_id, slot, "sc01")
            assert rich_gate == pytest.approx(poor_gate, abs=BINARY_TOLERANCE)
            rich_delivery = delivery_value(values, block_id, slot, "sc00")
            poor_delivery = delivery_value(values, block_id, slot, "sc01")
            assert rich_delivery == pytest.approx(poor_delivery, abs=BINARY_TOLERANCE)


def assert_branches_later(values: dict[str, float], block_id: str, slot: int) -> None:
    rich_gate = gate_value(values, block_id, slot, "sc00")
    poor_gate = gate_value(values, block_id, slot, "sc01")
    rich_delivery = delivery_value(values, block_id, slot, "sc00")
    poor_delivery = delivery_value(values, block_id, slot, "sc01")
    assert rich_gate - poor_gate > BINARY_TOLERANCE
    assert rich_delivery - poor_delivery > FLOW_TOLERANCE


def test_without_commit_scenarios_branch_from_the_first_slot() -> None:
    _, values = solve(two_scenario_problem(commit_slots=0))
    assert_branches_later(values, "b1", 0)


def test_commit_one_forces_identical_decision_on_first_slot() -> None:
    _, values = solve(two_scenario_problem(commit_slots=1))
    assert_committed_slots_agree(values, 1)
    assert_branches_later(values, "b1", 2)


def test_commit_two_pins_both_leading_slots() -> None:
    _, values = solve(two_scenario_problem(commit_slots=2))
    assert_committed_slots_agree(values, 2)
    assert_branches_later(values, "b1", 2)


def test_committed_slot_decision_stays_feasible_in_the_poorest_scenario() -> None:
    _, values = solve(two_scenario_problem(commit_slots=1))
    for block_id in BLOCK_IDS:
        assert delivery_value(values, block_id, 0, "sc01") == pytest.approx(
            0.0, abs=BINARY_TOLERANCE
        )


def test_commit_constraint_changes_the_committed_decision() -> None:
    _, uncommitted = solve(two_scenario_problem(commit_slots=0))
    _, committed = solve(two_scenario_problem(commit_slots=1))
    free_delivery = delivery_value(uncommitted, "b1", 0, "sc00")
    pinned_delivery = delivery_value(committed, "b1", 0, "sc00")
    assert free_delivery > FLOW_TOLERANCE
    assert pinned_delivery == pytest.approx(0.0, abs=BINARY_TOLERANCE)


def test_extracted_plan_reports_every_scenario() -> None:
    problem = two_scenario_problem(commit_slots=1)
    model = build_plan_model(problem)
    request = LexicographicRequest(
        budget=SolveBudget(time_limit_s=STAGE_TIME_LIMIT_S),
        stage_time_limit_s=STAGE_TIME_LIMIT_S,
    )
    outcome = solve_lexicographic(model, request)
    final = outcome.final
    assert final is not None
    plan = extract_plan(model, final)
    assert plan.scenario_ids == ("sc00", "sc01")
    assert len(plan.open_by_slot) == len(BLOCK_IDS)
    assert len(plan.terminal_storage_mm) == len(BLOCK_IDS)


def test_committed_execution_matches_across_scenarios() -> None:
    problem = two_scenario_problem(commit_slots=1)
    model = build_plan_model(problem)
    request = LexicographicRequest(
        budget=SolveBudget(time_limit_s=STAGE_TIME_LIMIT_S),
        stage_time_limit_s=STAGE_TIME_LIMIT_S,
    )
    outcome = solve_lexicographic(model, request)
    final = outcome.final
    assert final is not None
    plan = extract_plan(model, final)
    first_slot = tuple(row[0] for row in plan.open_by_slot)
    assert first_slot == (False, False)


def test_gross_withdrawal_respects_every_scenario_supply() -> None:
    problem = two_scenario_problem(commit_slots=1)
    model = build_plan_model(problem)
    request = LexicographicRequest(
        budget=SolveBudget(time_limit_s=STAGE_TIME_LIMIT_S),
        stage_time_limit_s=STAGE_TIME_LIMIT_S,
    )
    outcome = solve_lexicographic(model, request)
    final = outcome.final
    assert final is not None
    values = dict(final.variable_values)
    for scenario_id, supply_lps in (("sc00", RICH_SUPPLY_LPS), ("sc01", POOR_SUPPLY_LPS)):
        capacity = 3.6 * supply_lps * SLOT_HOURS
        for slot in range(SLOT_COUNT):
            gross = math.fsum(
                delivery_value(values, block_id, slot, scenario_id) / PATH_EFFICIENCY
                for block_id in BLOCK_IDS
            )
            assert gross <= capacity + 1.0e-6
