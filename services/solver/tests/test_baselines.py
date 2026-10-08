from __future__ import annotations

from typing import Final

import pytest

from sera.baselines.base import (
    BaselineMethod,
    BaselinePlan,
    SlotCapacityBudget,
    block_gross_per_slot_m3,
    central_scenario,
    require_step_index,
    serving_edge_ids,
    slot_supply_gross_m3,
)
from sera.baselines.fixed_rotation import FixedRotationStrategy
from sera.baselines.ledger_greedy import LedgerGreedyStrategy
from sera.baselines.oracle import OracleStrategy
from sera.baselines.proportional import ProportionalStrategy, WeightBasis
from sera.baselines.registry import (
    DEFAULT_REGISTRY,
    BaselineRegistry,
    parse_method,
)
from sera.core.types import DomainInvariantError
from sera.core.units import flow_hours_to_volume_m3
from sera.optimizer.model import PlanningBlockSpec, PlanningProblem, PlanningScenario

SLOT_HOURS: Final = 6.0
AREA_M2: Final = 10_000.0
FLOW_LPS: Final = 10.0
PATH_EFFICIENCY: Final = 0.9
MIN_STORAGE_MM: Final = 10.0
MAX_STORAGE_MM: Final = 100.0
INITIAL_STORAGE_MM: Final = 50.0
EDGE_CAPACITY_LPS: Final = 200.0
QUANTUM_M3: Final = 216.0


def make_block(
    block_id: str,
    *,
    area_m2: float = AREA_M2,
    flow_lps: float = FLOW_LPS,
    efficiency: float = PATH_EFFICIENCY,
    initial_storage_mm: float = INITIAL_STORAGE_MM,
    delivered_m3: float = 0.0,
    target_m3: float = 0.0,
    debt_m3: float = 0.0,
) -> PlanningBlockSpec:
    return PlanningBlockSpec(
        block_id=block_id,
        area_m2=area_m2,
        nominal_flow_lps=flow_lps,
        path_efficiency=efficiency,
        min_storage_mm=MIN_STORAGE_MM,
        max_storage_mm=MAX_STORAGE_MM,
        initial_storage_mm=initial_storage_mm,
        ledger_delivered_m3=delivered_m3,
        ledger_target_m3=target_m3,
        debt_m3=debt_m3,
    )


def make_problem(
    blocks: tuple[PlanningBlockSpec, ...],
    *,
    supply_lps: float | tuple[float, ...] = 24.0,
    slot_count: int = 4,
    target_fair_m3: float = 5.0,
) -> PlanningProblem:
    supply = supply_lps if isinstance(supply_lps, tuple) else (supply_lps,) * slot_count
    downstream = {
        f"e{index + 1}": tuple(block.block_id for block in blocks[index:])
        for index in range(len(blocks))
    }
    scenario = PlanningScenario(
        scenario_id="central",
        probability=1.0,
        supply_lps=supply,
        etc_mm=((1.0,) * slot_count,) * len(blocks),
        perc_mm=((0.5,) * slot_count,) * len(blocks),
        wlr_mm=((0.25,) * slot_count,) * len(blocks),
        rain_effective_mm=((0.0,) * slot_count,) * len(blocks),
        target_fair_m3=((target_fair_m3,) * slot_count,) * len(blocks),
    )
    return PlanningProblem(
        blocks=blocks,
        scenarios=(scenario,),
        slot_hours=SLOT_HOURS,
        edge_capacity_lps=dict.fromkeys(downstream, EDGE_CAPACITY_LPS),
        edge_downstream_blocks=downstream,
        previous_gate_open=tuple(False for _ in blocks),
    )


def test_parse_method_normalizes_case_and_spaces() -> None:
    assert parse_method(" PROPORTIONAL ") is BaselineMethod.PROPORTIONAL
    assert parse_method("sera") is BaselineMethod.SERA
    with pytest.raises(DomainInvariantError):
        parse_method("unknown")


def test_registry_exposes_baselines_but_not_sera() -> None:
    assert DEFAULT_REGISTRY.baseline_methods() == (
        BaselineMethod.PROPORTIONAL,
        BaselineMethod.ROTATION,
        BaselineMethod.GREEDY,
        BaselineMethod.ORACLE,
    )
    assert DEFAULT_REGISTRY.experiment_methods()[0] is BaselineMethod.SERA
    assert BaselineMethod.SERA not in DEFAULT_REGISTRY
    with pytest.raises(DomainInvariantError):
        DEFAULT_REGISTRY.create(BaselineMethod.SERA)


def test_registry_creates_independent_strategy_instances() -> None:
    first = DEFAULT_REGISTRY.create(BaselineMethod.PROPORTIONAL)
    second = DEFAULT_REGISTRY.create(BaselineMethod.PROPORTIONAL)
    assert isinstance(first, ProportionalStrategy)
    assert first is not second


def test_registry_rejects_empty_and_sera_entries() -> None:
    with pytest.raises(DomainInvariantError):
        BaselineRegistry(factories={})
    with pytest.raises(DomainInvariantError):
        BaselineRegistry(factories={BaselineMethod.SERA: lambda: ProportionalStrategy()})


def test_baseline_plan_from_mapping_requires_full_coverage() -> None:
    problem = make_problem((make_block("b1"), make_block("b2")))
    with pytest.raises(DomainInvariantError):
        BaselinePlan.from_mapping(
            BaselineMethod.ROTATION, problem, {"b1": (True, False, True, False)}
        )
    with pytest.raises(DomainInvariantError):
        BaselinePlan.from_mapping(
            BaselineMethod.ROTATION,
            problem,
            {"b1": (True,), "b2": (False,)},
        )
    with pytest.raises(DomainInvariantError):
        BaselinePlan.from_mapping(
            BaselineMethod.ROTATION,
            problem,
            {"b1": (True, False, True, False), "b9": (False, False, False, False)},
        )


def test_baseline_plan_rejects_non_boolean_flags() -> None:
    with pytest.raises(DomainInvariantError):
        BaselinePlan(
            method=BaselineMethod.ROTATION,
            block_ids=("b1",),
            open_by_slot=((1, 0),),  # type: ignore
        )


def test_execution_by_block_slices_the_commit_horizon() -> None:
    plan = BaselinePlan(
        method=BaselineMethod.ROTATION,
        block_ids=("b1", "b2"),
        open_by_slot=((True, False, True), (False, True, False)),
    )
    assert plan.slot_count == 3
    execution = plan.execution_by_block(1)
    assert execution == {"b1": (True,), "b2": (False,)}
    with pytest.raises(DomainInvariantError):
        plan.execution_by_block(4)
    with pytest.raises(DomainInvariantError):
        plan.execution_by_block(True)


def test_slot_capacity_budget_tracks_supply_and_edges() -> None:
    problem = make_problem((make_block("b1"), make_block("b2")))
    budget = SlotCapacityBudget.from_problem(problem, 0)
    assert budget.supply_cap_m3 == pytest.approx(flow_hours_to_volume_m3(24.0, SLOT_HOURS))
    assert budget.allows(QUANTUM_M3, ("e1", "e2"))
    budget.commit(QUANTUM_M3, ("e1", "e2"))
    assert budget.allows(QUANTUM_M3, ("e1", "e2"))
    budget.commit(QUANTUM_M3, ("e1", "e2"))
    assert not budget.allows(QUANTUM_M3, ("e1", "e2"))


def test_slot_capacity_budget_rejects_invalid_commits() -> None:
    problem = make_problem((make_block("b1"),))
    budget = SlotCapacityBudget.from_problem(problem, 0)
    with pytest.raises(DomainInvariantError):
        budget.allows(0.0, ("e1",))
    with pytest.raises(DomainInvariantError):
        budget.allows(QUANTUM_M3, ("e99",))
    with pytest.raises(DomainInvariantError):
        budget.commit(3.0 * QUANTUM_M3, ("e1",))


def test_helpers_expose_scenario_supply_and_serving_edges() -> None:
    problem = make_problem((make_block("b1"), make_block("b2")))
    assert central_scenario(problem).scenario_id == "central"
    assert slot_supply_gross_m3(problem, 0) == pytest.approx(
        flow_hours_to_volume_m3(24.0, SLOT_HOURS)
    )
    assert serving_edge_ids(problem, "b2") == ("e1", "e2")
    assert serving_edge_ids(problem, "b1") == ("e1",)
    with pytest.raises(DomainInvariantError):
        serving_edge_ids(problem, "b9")
    with pytest.raises(DomainInvariantError):
        slot_supply_gross_m3(problem, 9)
    with pytest.raises(DomainInvariantError):
        require_step_index(-1)
    assert require_step_index(3) == 3


def test_block_gross_quantum_matches_source_rating() -> None:
    block = make_block("b1")
    assert block_gross_per_slot_m3(block, SLOT_HOURS) == pytest.approx(QUANTUM_M3)


def test_proportional_single_block_carries_credit_between_slots() -> None:
    problem = make_problem((make_block("b1"),), supply_lps=(5.0, 15.0, 5.0, 15.0))
    plan = ProportionalStrategy().plan(problem)
    assert plan.open_by_slot == ((False, True, False, True),)


def test_proportional_area_weights_prioritize_larger_blocks() -> None:
    blocks = (make_block("b1", area_m2=2.0 * AREA_M2), make_block("b2"))
    problem = make_problem(blocks, supply_lps=27.0, slot_count=3)
    plan = ProportionalStrategy().plan(problem)
    assert plan.open_by_slot == ((True, True, True), (False, True, True))


def test_proportional_demand_weights_split_supply_evenly() -> None:
    blocks = (make_block("b1", area_m2=2.0 * AREA_M2), make_block("b2"))
    problem = make_problem(blocks, supply_lps=27.0, slot_count=3)
    plan = ProportionalStrategy(basis=WeightBasis.DEMAND).plan(problem)
    assert plan.open_by_slot == ((True, True, True), (True, True, True))


def test_proportional_never_exceeds_slot_supply() -> None:
    blocks = (make_block("b1"), make_block("b2"), make_block("b3"))
    problem = make_problem(blocks, supply_lps=9.0, slot_count=4)
    plan = ProportionalStrategy().plan(problem)
    for slot in range(problem.slot_count):
        opened = sum(1 for row in plan.open_by_slot if row[slot])
        assert opened * QUANTUM_M3 <= slot_supply_gross_m3(problem, slot) + 1.0e-9


def test_fixed_rotation_cycles_singleton_groups_by_default() -> None:
    blocks = (make_block("b1"), make_block("b2"), make_block("b3"))
    problem = make_problem(blocks, slot_count=3)
    plan = FixedRotationStrategy().plan(problem)
    assert plan.open_by_slot == (
        (True, False, False),
        (False, True, False),
        (False, False, True),
    )


def test_fixed_rotation_respects_turn_slots_and_step_offset() -> None:
    blocks = (make_block("b1"), make_block("b2"), make_block("b3"))
    problem = make_problem(blocks, slot_count=4)
    plan = FixedRotationStrategy(turn_slots=2).plan(problem, step_index=1)
    assert plan.open_by_slot == (
        (True, False, False, False),
        (False, True, True, False),
        (False, False, False, True),
    )


def test_fixed_rotation_custom_groups_rotate_together() -> None:
    blocks = (make_block("b1"), make_block("b2"), make_block("b3"))
    problem = make_problem(blocks, slot_count=4)
    strategy = FixedRotationStrategy(schedule=(("b1", "b2"), ("b3",)))
    plan = strategy.plan(problem)
    assert plan.open_by_slot == (
        (True, False, True, False),
        (True, False, True, False),
        (False, True, False, True),
    )


def test_fixed_rotation_rejects_broken_schedules() -> None:
    blocks = (make_block("b1"), make_block("b2"))
    problem = make_problem(blocks)
    with pytest.raises(DomainInvariantError):
        FixedRotationStrategy(schedule=(("b1",),)).plan(problem)
    with pytest.raises(DomainInvariantError):
        FixedRotationStrategy(schedule=(("b1", "b2"), ("b9",))).plan(problem)
    with pytest.raises(DomainInvariantError):
        FixedRotationStrategy(schedule=(("b1", "b1"), ("b2",)))
    with pytest.raises(DomainInvariantError):
        FixedRotationStrategy(schedule=((),))
    with pytest.raises(DomainInvariantError):
        FixedRotationStrategy(turn_slots=0)


def test_ledger_greedy_prioritizes_ratio_debt_and_urgency() -> None:
    blocks = (
        make_block("b1", delivered_m3=0.0, target_m3=10.0),
        make_block("b2", delivered_m3=2.0, target_m3=10.0, debt_m3=3.0),
        make_block("b3", delivered_m3=0.0, target_m3=10.0, debt_m3=5.0),
    )
    problem = make_problem(blocks, supply_lps=20.0, slot_count=3)
    plan = LedgerGreedyStrategy().plan(problem)
    assert plan.open_by_slot == (
        (True, True, False),
        (False, True, True),
        (True, False, True),
    )


def test_ledger_greedy_respects_supply_budget() -> None:
    blocks = (make_block("b1"), make_block("b2"), make_block("b3"))
    problem = make_problem(blocks, supply_lps=5.0, slot_count=2)
    plan = LedgerGreedyStrategy().plan(problem)
    for row in plan.open_by_slot:
        for flag in row:
            assert flag is False


def test_ledger_greedy_skips_blocks_at_field_capacity() -> None:
    blocks = (
        make_block("b1"),
        make_block("b2"),
        make_block("b3", initial_storage_mm=MAX_STORAGE_MM),
    )
    problem = make_problem(blocks, supply_lps=30.0, slot_count=2)
    plan = LedgerGreedyStrategy().plan(problem)
    assert all(flag is False for flag in plan.open_by_slot[2])


def test_ledger_greedy_treats_empty_targets_as_full_service() -> None:
    blocks = (make_block("b1"), make_block("b2"))
    problem = make_problem(blocks, supply_lps=10.0, slot_count=1, target_fair_m3=0.0)
    plan = LedgerGreedyStrategy().plan(problem)
    assert plan.open_by_slot == ((True,), (False,))


def test_oracle_opens_everything_under_abundant_supply() -> None:
    blocks = (make_block("b1"), make_block("b2"), make_block("b3"))
    problem = make_problem(blocks, supply_lps=60.0, slot_count=3)
    outcome = OracleStrategy().solve(problem)
    assert outcome.plan.open_by_slot == ((True,) * 3,) * 3
    assert outcome.solve_seconds >= 0.0
    assert outcome.relative_gap is None or outcome.relative_gap >= 0.0
    assert all(stage.status.name in {"OPTIMAL", "FEASIBLE"} for stage in outcome.stages)


def test_oracle_plan_delegates_to_solve() -> None:
    blocks = (make_block("b1"), make_block("b2"))
    problem = make_problem(blocks, supply_lps=60.0, slot_count=2)
    strategy = OracleStrategy()
    plan = strategy.plan(problem)
    outcome = strategy.solve(problem)
    assert plan.open_by_slot == outcome.plan.open_by_slot
    assert plan.method is BaselineMethod.ORACLE


def test_oracle_closes_everything_under_zero_supply() -> None:
    blocks = (make_block("b1"), make_block("b2"))
    problem = make_problem(blocks, supply_lps=0.0, slot_count=2)
    outcome = OracleStrategy().solve(problem)
    assert outcome.plan.open_by_slot == ((False, False), (False, False))
