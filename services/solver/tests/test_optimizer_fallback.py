from __future__ import annotations

from typing import Final

import pytest

from sera.core.types import DomainInvariantError
from sera.optimizer.fallback import (
    FallbackContext,
    FallbackDecision,
    FallbackLevel,
    FallbackPolicy,
    FallbackReason,
    LastFeasiblePlan,
    select_fallback,
    service_ratio_of,
)
from sera.optimizer.model import PlanningBlockSpec, PlanningProblem, PlanningScenario

SLOT_HOURS: Final = 6.0
AREA_M2: Final = 10_000.0
FLOW_LPS: Final = 10.0
PATH_EFFICIENCY: Final = 0.9
MIN_STORAGE_MM: Final = 10.0
MAX_STORAGE_MM: Final = 100.0
INITIAL_STORAGE_MM: Final = 50.0
DEFAULT_EDGE_CAPACITY_LPS: Final = 200.0
SLOT_COUNT: Final = 3
BLOCK_IDS: Final = ("b1", "b2", "b3")

REPLAY_PLAN: Final = LastFeasiblePlan(
    step_index=5,
    opens_by_block={
        "b1": (True, False, True),
        "b2": (False, True, False),
        "b3": (True, True, False),
    },
)


def ledger_block(
    block_id: str,
    *,
    delivered_m3: float = 0.0,
    target_m3: float = 0.0,
    debt_m3: float = 0.0,
    initial_storage_mm: float = INITIAL_STORAGE_MM,
) -> PlanningBlockSpec:
    return PlanningBlockSpec(
        block_id=block_id,
        area_m2=AREA_M2,
        nominal_flow_lps=FLOW_LPS,
        path_efficiency=PATH_EFFICIENCY,
        min_storage_mm=MIN_STORAGE_MM,
        max_storage_mm=MAX_STORAGE_MM,
        initial_storage_mm=initial_storage_mm,
        ledger_delivered_m3=delivered_m3,
        ledger_target_m3=target_m3,
        debt_m3=debt_m3,
    )


def chain_problem(
    blocks: tuple[PlanningBlockSpec, ...],
    *,
    supply_lps: float = 20.0,
    edge_capacity_lps: dict[str, float] | None = None,
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
    scenario = PlanningScenario(
        scenario_id="central",
        probability=1.0,
        supply_lps=(supply_lps,) * SLOT_COUNT,
        etc_mm=((0.0,) * SLOT_COUNT,) * len(blocks),
        perc_mm=((0.0,) * SLOT_COUNT,) * len(blocks),
        wlr_mm=((0.0,) * SLOT_COUNT,) * len(blocks),
        rain_effective_mm=((0.0,) * SLOT_COUNT,) * len(blocks),
        target_fair_m3=((0.0,) * SLOT_COUNT,) * len(blocks),
    )
    return PlanningProblem(
        blocks=blocks,
        scenarios=(scenario,),
        slot_hours=SLOT_HOURS,
        edge_capacity_lps=capacities,
        edge_downstream_blocks=downstream,
        previous_gate_open=tuple(False for _ in blocks),
    )


def ledger_problem(*, supply_lps: float = 20.0) -> PlanningProblem:
    blocks = (
        ledger_block("b1", delivered_m3=0.0, target_m3=10.0),
        ledger_block("b2", delivered_m3=2.0, target_m3=10.0, debt_m3=3.0),
        ledger_block("b3", delivered_m3=0.0, target_m3=10.0, debt_m3=5.0),
    )
    return chain_problem(blocks, supply_lps=supply_lps)


def decide(
    problem: PlanningProblem,
    *,
    step_index: int = 0,
    reason: FallbackReason = FallbackReason.INFEASIBLE,
    policy: FallbackPolicy | None = None,
    last_feasible: LastFeasiblePlan | None = None,
    confidence: float | None = None,
) -> FallbackDecision:
    context = FallbackContext(
        step_index=step_index,
        reason=reason,
        policy=FallbackPolicy() if policy is None else policy,
        last_feasible=last_feasible,
        confidence=confidence,
    )
    return select_fallback(problem, context)


def test_service_ratio_uses_ledger_fields() -> None:
    assert service_ratio_of(ledger_block("b1", delivered_m3=5.0, target_m3=10.0)) == pytest.approx(
        0.5
    )
    assert service_ratio_of(ledger_block("b1", delivered_m3=5.0, target_m3=0.0)) == pytest.approx(
        1.0
    )


def test_last_feasible_plan_is_replayed_within_horizon() -> None:
    problem = chain_problem(tuple(ledger_block(block_id) for block_id in BLOCK_IDS))
    first = decide(problem, step_index=5, last_feasible=REPLAY_PLAN)
    second = decide(problem, step_index=6, last_feasible=REPLAY_PLAN)
    third = decide(problem, step_index=7, last_feasible=REPLAY_PLAN)
    assert first.level is FallbackLevel.LAST_FEASIBLE
    assert first.opens == {"b1": True, "b2": False, "b3": True}
    assert second.opens == {"b1": False, "b2": True, "b3": True}
    assert third.opens == {"b1": True, "b2": False, "b3": False}
    assert first.review_required is False
    assert set(first.opens) == set(problem.block_ids)


def test_last_feasible_plan_expires_after_short_horizon() -> None:
    problem = chain_problem(tuple(ledger_block(block_id) for block_id in BLOCK_IDS))
    expired = decide(problem, step_index=8, last_feasible=REPLAY_PLAN)
    assert expired.level is FallbackLevel.ALL_CLOSED


def test_last_feasible_plan_with_short_horizon_falls_through_to_rotation() -> None:
    problem = chain_problem(tuple(ledger_block(block_id) for block_id in BLOCK_IDS))
    policy = FallbackPolicy(rotation_schedule=(("b1",),))
    decision = decide(problem, step_index=8, last_feasible=REPLAY_PLAN, policy=policy)
    assert decision.level is FallbackLevel.STATIC_ROTATION
    assert decision.opens == {"b1": True, "b2": False, "b3": False}


def test_last_feasible_plan_wins_over_ledger_evidence() -> None:
    problem = ledger_problem()
    decision = decide(problem, step_index=5, last_feasible=REPLAY_PLAN)
    assert decision.level is FallbackLevel.LAST_FEASIBLE


def test_ledger_greedy_prioritizes_lowest_service_ratio_and_debt() -> None:
    problem = ledger_problem(supply_lps=20.0)
    decision = decide(problem)
    assert decision.level is FallbackLevel.LEDGER_GREEDY
    assert decision.opens == {"b1": True, "b2": False, "b3": True}
    assert set(decision.opens) == set(problem.block_ids)


def test_ledger_greedy_respects_supply_budget() -> None:
    problem = ledger_problem(supply_lps=10.0)
    decision = decide(problem)
    assert decision.opens == {"b1": False, "b2": False, "b3": True}


def test_ledger_greedy_respects_edge_capacity() -> None:
    blocks = (
        ledger_block("b1", delivered_m3=0.0, target_m3=10.0),
        ledger_block("b2", delivered_m3=2.0, target_m3=10.0, debt_m3=3.0),
        ledger_block("b3", delivered_m3=0.0, target_m3=10.0, debt_m3=5.0),
    )
    problem = chain_problem(
        blocks,
        supply_lps=30.0,
        edge_capacity_lps={"e1": 200.0, "e2": 200.0, "e3": 5.0},
    )
    decision = decide(problem)
    assert decision.opens == {"b1": True, "b2": True, "b3": False}


def test_ledger_greedy_skips_blocks_at_field_capacity() -> None:
    blocks = (
        ledger_block("b1", delivered_m3=0.0, target_m3=10.0),
        ledger_block("b2", delivered_m3=2.0, target_m3=10.0, debt_m3=3.0),
        ledger_block(
            "b3",
            delivered_m3=0.0,
            target_m3=10.0,
            debt_m3=5.0,
            initial_storage_mm=MAX_STORAGE_MM,
        ),
    )
    problem = chain_problem(blocks, supply_lps=30.0)
    decision = decide(problem)
    assert decision.opens == {"b1": True, "b2": True, "b3": False}


def test_rotation_cycles_when_ledger_has_no_evidence() -> None:
    problem = chain_problem(tuple(ledger_block(block_id) for block_id in BLOCK_IDS))
    policy = FallbackPolicy(rotation_schedule=(("b1", "b2"), ("b3",)))
    first = decide(problem, step_index=0, reason=FallbackReason.MANUAL, policy=policy)
    second = decide(problem, step_index=1, reason=FallbackReason.MANUAL, policy=policy)
    third = decide(problem, step_index=2, reason=FallbackReason.MANUAL, policy=policy)
    assert first.level is FallbackLevel.STATIC_ROTATION
    assert first.opens == {"b1": True, "b2": True, "b3": False}
    assert second.opens == {"b1": False, "b2": False, "b3": True}
    assert third.opens == first.opens


def test_rotation_yields_to_ledger_greedy_when_targets_exist() -> None:
    problem = ledger_problem()
    policy = FallbackPolicy(rotation_schedule=(("b1",),))
    decision = decide(problem, policy=policy)
    assert decision.level is FallbackLevel.LEDGER_GREEDY


def test_rotation_with_unknown_block_closes_everything() -> None:
    problem = chain_problem(tuple(ledger_block(block_id) for block_id in BLOCK_IDS))
    policy = FallbackPolicy(rotation_schedule=(("b9",),))
    decision = decide(problem, reason=FallbackReason.MANUAL, policy=policy)
    assert decision.level is FallbackLevel.ALL_CLOSED
    assert decision.opens == {"b1": False, "b2": False, "b3": False}
    assert decision.review_required is True


def test_missing_rotation_and_evidence_closes_everything() -> None:
    problem = chain_problem(tuple(ledger_block(block_id) for block_id in BLOCK_IDS))
    decision = decide(problem, reason=FallbackReason.NO_SOLUTION)
    assert decision.level is FallbackLevel.ALL_CLOSED
    assert decision.review_required is True
    assert decision.reason is FallbackReason.NO_SOLUTION


def test_low_confidence_forces_review() -> None:
    problem = ledger_problem()
    shaky = decide(problem, reason=FallbackReason.MANUAL, confidence=0.4)
    steady = decide(problem, reason=FallbackReason.MANUAL, confidence=0.8)
    uncertain = decide(problem, reason=FallbackReason.LOW_CONFIDENCE, confidence=0.9)
    assert shaky.level is FallbackLevel.LEDGER_GREEDY
    assert shaky.review_required is True
    assert steady.review_required is False
    assert uncertain.review_required is True


def test_strict_review_threshold_can_be_configured() -> None:
    problem = ledger_problem()
    policy = FallbackPolicy(review_below_confidence=0.9)
    decision = decide(problem, reason=FallbackReason.MANUAL, policy=policy, confidence=0.8)
    assert decision.review_required is True


def test_decision_reason_is_propagated() -> None:
    problem = ledger_problem()
    decision = decide(problem, reason=FallbackReason.SOLVER_ERROR)
    assert decision.reason is FallbackReason.SOLVER_ERROR


def test_no_context_reason_stays_explicit() -> None:
    problem = ledger_problem()
    decision = decide(problem, reason=FallbackReason.NO_CONTEXT)
    assert decision.reason is FallbackReason.NO_CONTEXT


def test_last_feasible_plan_requires_alignment() -> None:
    with pytest.raises(DomainInvariantError):
        LastFeasiblePlan(step_index=0, opens_by_block={})
    with pytest.raises(DomainInvariantError):
        LastFeasiblePlan(step_index=0, opens_by_block={"b1": (True,), "b2": (True, False)})
    with pytest.raises(DomainInvariantError):
        LastFeasiblePlan(step_index=-1, opens_by_block={"b1": (True,)})
    with pytest.raises(DomainInvariantError):
        LastFeasiblePlan(step_index=0, opens_by_block={"b1": ()})


def test_fallback_policy_rejects_degenerate_rotation() -> None:
    with pytest.raises(DomainInvariantError):
        FallbackPolicy(short_horizon_slots=0)
    with pytest.raises(DomainInvariantError):
        FallbackPolicy(rotation_schedule=(("b1", "b1"),))
    with pytest.raises(DomainInvariantError):
        FallbackPolicy(rotation_schedule=((),))


def test_fallback_context_validates_inputs() -> None:
    with pytest.raises(DomainInvariantError):
        FallbackContext(step_index=-1, reason=FallbackReason.MANUAL)
    with pytest.raises(DomainInvariantError):
        FallbackContext(step_index=0, reason=FallbackReason.MANUAL, confidence=1.5)


def test_fallback_decision_requires_opens() -> None:
    with pytest.raises(DomainInvariantError):
        FallbackDecision(
            level=FallbackLevel.ALL_CLOSED,
            reason=FallbackReason.MANUAL,
            opens={},
            review_required=True,
        )
