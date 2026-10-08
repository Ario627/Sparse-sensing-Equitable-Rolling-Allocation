from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from app.core.types import require_non_negative
from app.core.units import flow_hours_to_volume_m3, volume_m3_to_storage_mm
from baselines.base import (
    BaselineMethod,
    BaselinePlan,
    SlotCapacityBudget,
    central_scenario,
    require_step_index,
    serving_edge_ids,
)
from optimizer.model import PlanningBlockSpec, PlanningProblem

OVERFLOW_TOLERANCE_MM: Final = 1.0e-6


def _urgent_rank(storage_mm: float, block: PlanningBlockSpec) -> int:
    return 0 if storage_mm < block.min_storage_mm else 1


def _service_ratio(delivered_m3: float, target_m3: float) -> float:
    if target_m3 <= 0.0:
        return 1.0
    return delivered_m3 / target_m3


def _net_quantum_m3(block: PlanningBlockSpec, slot_hours: float) -> float:
    return flow_hours_to_volume_m3(block.nominal_flow_lps, slot_hours) * block.path_efficiency


def _fits_within_storage(
    storage_mm: float,
    block: PlanningBlockSpec,
    net_quantum_mm: float,
    tolerance_mm: float,
) -> bool:
    return storage_mm + net_quantum_mm <= block.max_storage_mm + tolerance_mm


def _next_storage_mm(
    storage_mm: float,
    block: PlanningBlockSpec,
    *,
    net_added_mm: float,
    rain_mm: float,
    consumptive_mm: float,
) -> float:
    raw = storage_mm + net_added_mm + rain_mm - consumptive_mm
    return min(max(raw, 0.0), block.max_storage_mm)


@dataclass(frozen=True, slots=True)
class LedgerGreedyStrategy:
    overflow_tolerance_mm: float = OVERFLOW_TOLERANCE_MM

    def __post_init__(self) -> None:
        require_non_negative(self.overflow_tolerance_mm, "overflow_tolerance_mm")

    @property
    def method(self) -> BaselineMethod:
        return BaselineMethod.GREEDY

    def plan(self, problem: PlanningProblem, step_index: int = 0) -> BaselinePlan:
        require_step_index(step_index)
        scenario = central_scenario(problem)
        blocks = problem.blocks
        block_ids = problem.block_ids
        block_by_id = {block.block_id: block for block in blocks}
        quanta = {block.block_id: _net_quantum_m3(block, problem.slot_hours) for block in blocks}
        quantum_mm = {
            block.block_id: volume_m3_to_storage_mm(quanta[block.block_id], block.area_m2)
            for block in blocks
        }
        edges = {block_id: serving_edge_ids(problem, block_id) for block_id in block_ids}
        storage = {block.block_id: block.initial_storage_mm for block in blocks}
        delivered = {block.block_id: block.ledger_delivered_m3 for block in blocks}
        targets = {block.block_id: block.ledger_target_m3 for block in blocks}
        debts = {block.block_id: block.debt_m3 for block in blocks}
        opens = {block_id: [False] * problem.slot_count for block_id in block_ids}
        for slot in range(problem.slot_count):
            for position, block in enumerate(blocks):
                targets[block.block_id] += scenario.target_fair_m3[position][slot]
            budget = SlotCapacityBudget.from_problem(problem, slot)
            order = sorted(
                block_ids,
                key=lambda block_id: (
                    _urgent_rank(storage[block_id], block_by_id[block_id]),
                    _service_ratio(delivered[block_id], targets[block_id]),
                    -debts[block_id],
                    block_id,
                ),
            )
            for block_id in order:
                block = block_by_id[block_id]
                if not _fits_within_storage(
                    storage[block_id],
                    block,
                    quantum_mm[block_id],
                    self.overflow_tolerance_mm,
                ):
                    continue
                if not budget.allows(quanta[block_id], edges[block_id]):
                    continue
                opens[block_id][slot] = True
                budget.commit(quanta[block_id], edges[block_id])
                delivered[block_id] += quanta[block_id]
                debts[block_id] = max(0.0, debts[block_id] - quanta[block_id])
            for position, block in enumerate(blocks):
                storage[block.block_id] = _next_storage_mm(
                    storage[block.block_id],
                    block,
                    net_added_mm=quantum_mm[block.block_id] if opens[block.block_id][slot] else 0.0,
                    rain_mm=scenario.rain_effective_mm[position][slot],
                    consumptive_mm=scenario.etc_mm[position][slot]
                    + scenario.perc_mm[position][slot]
                    + scenario.wlr_mm[position][slot],
                )
        return BaselinePlan.from_mapping(
            self.method,
            problem,
            {block_id: tuple(row) for block_id, row in opens.items()},
        )
