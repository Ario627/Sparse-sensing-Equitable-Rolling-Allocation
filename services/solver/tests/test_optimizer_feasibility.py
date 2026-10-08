from __future__ import annotations

import math
from dataclasses import replace
from typing import Final

import pytest

from app.core.types import DomainInvariantError
from app.core.units import flow_hours_to_volume_m3
from optimizer.model import (
    PlanDecision,
    PlanningBlockSpec,
    PlanningProblem,
    PlanningScenario,
    build_plan_model,
    extract_plan,
)
from optimizer.objectives import LexicographicRequest, solve_lexicographic
from optimizer.solver import SolveBudget, SolveOutcome

SLOT_HOURS: Final = 6.0
AREA_M2: Final = 10_000.0
FLOW_LPS: Final = 10.0
EFFICIENCIES: Final = (0.95, 0.90, 0.85)
MIN_STORAGE_MM: Final = 10.0
MAX_STORAGE_MM: Final = 100.0
INITIAL_STORAGE_MM: Final = 50.0
TARGET_FAIR_M3: Final = 100.0
SLOT_COUNT: Final = 4
ABUNDANT_SUPPLY_LPS: Final = 60.0
SCARCE_SUPPLY_LPS: Final = 8.0
DEFAULT_EDGE_CAPACITY_LPS: Final = 200.0
STAGE_TIME_LIMIT_S: Final = 2.0
SOLVE_TOLERANCE: Final = 1.0e-6


def make_blocks(
    count: int = 3,
    *,
    initial_storage_mm: float = INITIAL_STORAGE_MM,
    min_storage_mm: float = MIN_STORAGE_MM,
) -> tuple[PlanningBlockSpec, ...]:
    return tuple(
        PlanningBlockSpec(
            block_id=f"b{index + 1}",
            area_m2=AREA_M2,
            nominal_flow_lps=FLOW_LPS,
            path_efficiency=EFFICIENCIES[index % len(EFFICIENCIES)],
            min_storage_mm=min_storage_mm,
            max_storage_mm=MAX_STORAGE_MM,
            initial_storage_mm=initial_storage_mm,
            ledger_delivered_m3=0.0,
            ledger_target_m3=0.0,
            debt_m3=0.0,
        )
        for index in range(count)
    )


def make_scenario(
    block_count: int,
    *,
    slot_count: int = SLOT_COUNT,
    supply_lps: float = ABUNDANT_SUPPLY_LPS,
    etc_mm: float = 1.0,
    perc_mm: float = 0.5,
    wlr_mm: float = 0.25,
    rain_mm: float = 0.0,
    target_fair_m3: float = TARGET_FAIR_M3,
) -> PlanningScenario:
    return PlanningScenario(
        scenario_id="central",
        probability=1.0,
        supply_lps=(supply_lps,) * slot_count,
        etc_mm=((etc_mm,) * slot_count,) * block_count,
        perc_mm=((perc_mm,) * slot_count,) * block_count,
        wlr_mm=((wlr_mm,) * slot_count,) * block_count,
        rain_effective_mm=((rain_mm,) * slot_count,) * block_count,
        target_fair_m3=((target_fair_m3,) * slot_count,) * block_count,
    )


def make_problem(
    blocks: tuple[PlanningBlockSpec, ...],
    scenario: PlanningScenario,
    *,
    edge_capacity_lps: dict[str, float] | None = None,
    previous_gate_open: tuple[bool, ...] | None = None,
    commit_slots: int = 1,
) -> PlanningProblem:
    downstream = {
        f"e{index + 1}": tuple(block.block_id for block in blocks[index:])
        for index in range(len(blocks))
    }
    capacities = (
        dict.fromkeys(downstream, DEFAULT_EDGE_CAPACITY_LPS)
        if edge_capacity_lps is None
        else edge_capacity_lps
    )
    return PlanningProblem(
        blocks=blocks,
        scenarios=(scenario,),
        slot_hours=SLOT_HOURS,
        edge_capacity_lps=capacities,
        edge_downstream_blocks=downstream,
        previous_gate_open=(
            tuple(False for _ in blocks) if previous_gate_open is None else previous_gate_open
        ),
        commit_slots=commit_slots,
    )


def solve_stack(problem: PlanningProblem) -> tuple[PlanDecision, SolveOutcome]:
    model = build_plan_model(problem)
    request = LexicographicRequest(
        budget=SolveBudget(time_limit_s=STAGE_TIME_LIMIT_S),
        stage_time_limit_s=STAGE_TIME_LIMIT_S,
    )
    outcome = solve_lexicographic(model, request)
    final = outcome.final
    assert final is not None
    return extract_plan(model, final), final


def potential_net_m3(block: PlanningBlockSpec) -> float:
    return flow_hours_to_volume_m3(block.nominal_flow_lps, SLOT_HOURS) * block.path_efficiency


def delivered_by_block(
    problem: PlanningProblem, plan: PlanDecision
) -> dict[str, tuple[float, ...]]:
    return {
        block.block_id: plan.delivered_m3_by_slot[position]
        for position, block in enumerate(problem.blocks)
    }


def assert_supply_feasible(problem: PlanningProblem, plan: PlanDecision) -> None:
    scenario = problem.scenarios[0]
    for slot in range(problem.slot_count):
        gross = math.fsum(
            plan.delivered_m3_by_slot[position][slot] * block.gross_per_net
            for position, block in enumerate(problem.blocks)
        )
        capacity = flow_hours_to_volume_m3(scenario.supply_lps[slot], problem.slot_hours)
        assert gross <= capacity + SOLVE_TOLERANCE


def assert_edge_capacity_feasible(problem: PlanningProblem, plan: PlanDecision) -> None:
    delivered = delivered_by_block(problem, plan)
    gross_per_net = {block.block_id: block.gross_per_net for block in problem.blocks}
    for slot in range(problem.slot_count):
        for edge_id, downstream in problem.edge_downstream_blocks.items():
            gross = math.fsum(
                delivered[block_id][slot] * gross_per_net[block_id] for block_id in downstream
            )
            capacity = flow_hours_to_volume_m3(
                problem.edge_capacity_lps[edge_id], problem.slot_hours
            )
            assert gross <= capacity + SOLVE_TOLERANCE


def assert_gate_link_feasible(problem: PlanningProblem, plan: PlanDecision) -> None:
    for position, block in enumerate(problem.blocks):
        ceiling = potential_net_m3(block)
        for slot in range(problem.slot_count):
            delivered = plan.delivered_m3_by_slot[position][slot]
            assert delivered >= -SOLVE_TOLERANCE
            assert delivered <= ceiling + SOLVE_TOLERANCE
            if delivered > SOLVE_TOLERANCE:
                assert plan.open_by_slot[position][slot]


def assert_plan_feasible(problem: PlanningProblem, plan: PlanDecision) -> None:
    assert_supply_feasible(problem, plan)
    assert_edge_capacity_feasible(problem, plan)
    assert_gate_link_feasible(problem, plan)
    for value in plan.terminal_storage_mm:
        assert -SOLVE_TOLERANCE <= value <= MAX_STORAGE_MM + SOLVE_TOLERANCE
    assert 0.0 <= plan.service_floor_z <= 1.0 + SOLVE_TOLERANCE


def test_abundant_supply_clears_shortage_and_saturates_equity_floor() -> None:
    blocks = make_blocks(3)
    problem = make_problem(blocks, make_scenario(3, supply_lps=ABUNDANT_SUPPLY_LPS))
    plan, _ = solve_stack(problem)
    assert_plan_feasible(problem, plan)
    assert plan.shortage_total_expected_m3 <= 0.5 + SOLVE_TOLERANCE
    assert plan.service_floor_z > 0.99


def test_scarce_supply_stays_feasible_with_positive_shortage() -> None:
    blocks = make_blocks(3)
    problem = make_problem(blocks, make_scenario(3, supply_lps=SCARCE_SUPPLY_LPS))
    plan, _ = solve_stack(problem)
    assert_plan_feasible(problem, plan)
    assert plan.shortage_total_expected_m3 > 0.0
    assert 0.0 < plan.service_floor_z < 1.0


def test_zero_supply_delivers_nothing_and_reports_full_deficit() -> None:
    blocks = make_blocks(3)
    problem = make_problem(blocks, make_scenario(3, supply_lps=0.0))
    plan, _ = solve_stack(problem)
    assert_plan_feasible(problem, plan)
    for row in plan.delivered_m3_by_slot:
        for value in row:
            assert value == pytest.approx(0.0, abs=SOLVE_TOLERANCE)
    expected_shortage = 3 * SLOT_COUNT * TARGET_FAIR_M3
    assert plan.shortage_total_expected_m3 == pytest.approx(expected_shortage, abs=0.6)


def test_binding_edge_capacity_limits_tail_block() -> None:
    blocks = make_blocks(3)
    capacities = {"e1": 200.0, "e2": 200.0, "e3": 2.0}
    problem = make_problem(
        blocks, make_scenario(3, supply_lps=ABUNDANT_SUPPLY_LPS), edge_capacity_lps=capacities
    )
    plan, _ = solve_stack(problem)
    assert_plan_feasible(problem, plan)
    tail_ceiling = flow_hours_to_volume_m3(2.0, SLOT_HOURS) * EFFICIENCIES[2]
    for value in delivered_by_block(problem, plan)["b3"]:
        assert value <= tail_ceiling + SOLVE_TOLERANCE


def test_stability_keeps_open_gates_without_switching() -> None:
    blocks = make_blocks(3)
    problem = make_problem(
        blocks,
        make_scenario(3, supply_lps=0.0, etc_mm=0.0, perc_mm=0.0, wlr_mm=0.0, target_fair_m3=0.0),
        previous_gate_open=(True, True, True),
    )
    plan, _ = solve_stack(problem)
    assert plan.switching_total_expected == pytest.approx(0.0, abs=SOLVE_TOLERANCE)
    for row in plan.open_by_slot:
        for flag in row:
            assert flag


def test_safety_slack_absorbs_storage_floor_violation() -> None:
    blocks = make_blocks(3, initial_storage_mm=44.0, min_storage_mm=45.0)
    problem = make_problem(
        blocks,
        make_scenario(3, supply_lps=0.0, etc_mm=0.0, perc_mm=0.0, wlr_mm=0.0, target_fair_m3=0.0),
    )
    plan, _ = solve_stack(problem)
    assert plan.safety_slack_total_expected == pytest.approx(float(3 * SLOT_COUNT), abs=1.0e-3)
    assert plan.shortage_total_expected_m3 == pytest.approx(0.0, abs=SOLVE_TOLERANCE)


def test_problem_rejects_misaligned_previous_gates() -> None:
    blocks = make_blocks(3)
    scenario = make_scenario(3)
    with pytest.raises(DomainInvariantError):
        make_problem(blocks, scenario, previous_gate_open=(True, False))


def test_problem_rejects_probability_mass_not_one() -> None:
    with pytest.raises(DomainInvariantError):
        make_problem(make_blocks(3), replace(make_scenario(3), probability=0.9))


def test_problem_rejects_commit_slots_beyond_horizon() -> None:
    with pytest.raises(DomainInvariantError):
        make_problem(make_blocks(3), make_scenario(3), commit_slots=SLOT_COUNT + 1)
