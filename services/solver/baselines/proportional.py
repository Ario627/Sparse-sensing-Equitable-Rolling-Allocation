from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from baselines.base import (
    BaselineMethod,
    BaselinePlan,
    SlotCapacityBudget,
    block_gross_per_slot_m3,
    central_scenario,
    require_step_index,
    serving_edge_ids,
    slot_supply_gross_m3,
)
from optimizer.model import PlanningProblem

CREDIT_TOLERANCE: Final = 1.0e-9


class WeightBasis(StrEnum):
    AREA = "area"
    DEMAND = "demand"


@dataclass(frozen=True, slots=True)
class ProportionalStrategy:
    basis: WeightBasis = WeightBasis.AREA

    @property
    def method(self) -> BaselineMethod:
        return BaselineMethod.PROPORTIONAL

    def plan(self, problem: PlanningProblem, step_index: int = 0) -> BaselinePlan:
        require_step_index(step_index)
        block_ids = problem.block_ids
        quanta = {
            block.block_id: block_gross_per_slot_m3(block, problem.slot_hours)
            for block in problem.blocks
        }
        edges = {block_id: serving_edge_ids(problem, block_id) for block_id in block_ids}
        weights = self._weights(problem)
        credits = dict.fromkeys(block_ids, 0.0)
        opens = {block_id: [False] * problem.slot_count for block_id in block_ids}
        for slot in range(problem.slot_count):
            supply = slot_supply_gross_m3(problem, slot)
            for block_id in block_ids:
                credits[block_id] += weights[block_id][slot] * supply
            budget = SlotCapacityBudget.from_problem(problem, slot)
            order = sorted(block_ids, key=lambda block_id: (-credits[block_id], block_id))
            for block_id in order:
                quantum = quanta[block_id]
                if credits[block_id] + CREDIT_TOLERANCE < quantum:
                    continue
                if not budget.allows(quantum, edges[block_id]):
                    continue
                opens[block_id][slot] = True
                credits[block_id] -= quantum
                budget.commit(quantum, edges[block_id])
        return BaselinePlan.from_mapping(
            self.method,
            problem,
            {block_id: tuple(opens[block_id]) for block_id in block_ids},
        )

    def _weights(self, problem: PlanningProblem) -> dict[str, tuple[float, ...]]:
        if self.basis is WeightBasis.AREA:
            return self._area_weights(problem)
        return self._demand_weights(problem)

    @staticmethod
    def _area_weights(problem: PlanningProblem) -> dict[str, tuple[float, ...]]:
        total = math.fsum(block.area_m2 for block in problem.blocks)
        return {
            block.block_id: (block.area_m2 / total,) * problem.slot_count
            for block in problem.blocks
        }

    @staticmethod
    def _demand_weights(problem: PlanningProblem) -> dict[str, tuple[float, ...]]:
        scenario = central_scenario(problem)
        positions = range(len(problem.blocks))
        totals = tuple(
            math.fsum(scenario.target_fair_m3[position][slot] for position in positions)
            for slot in range(problem.slot_count)
        )
        return {
            block.block_id: tuple(
                scenario.target_fair_m3[position][slot] / totals[slot]
                if totals[slot] > 0.0
                else 0.0
                for slot in range(problem.slot_count)
            )
            for position, block in enumerate(problem.blocks)
        }