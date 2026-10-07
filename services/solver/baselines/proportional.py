from __future__ import annotations

import math
from collections.abc import Mapping

from app.core.types import (
    DomainInvariantError,
    require_non_negative,
    require_positive,
    require_unique,
)
from app.core.units import flow_hours_to_volume_m3
from baselines.base import MethodContext, validate_opens

METHOD_ID = "proportional"
CAPACITY_TOLERANCE = 1.0e-9


def _validate_block_order(block_order: tuple[str, ...]) -> None:
    if not block_order:
        raise DomainInvariantError("block_order must not be empty")
    require_unique(block_order, "block_id")


def _resolve_values(
    mapping: Mapping[str, float],
    block_order: tuple[str, ...],
    name: str,
    *,
    strictly_positive: bool,
) -> dict[str, float]:
    missing = sorted(set(block_order) - set(mapping))
    unknown = sorted(set(mapping) - set(block_order))
    if missing or unknown:
        raise DomainInvariantError(
            f"{name} keys must match block_order; missing={missing} unknown={unknown}"
        )
    return {
        block_id: require_positive(mapping[block_id], f"{name}[{block_id}]")
        if strictly_positive
        else require_non_negative(mapping[block_id], f"{name}[{block_id}]")
        for block_id in block_order
    }


class ProportionalMethod:
    def __init__(
        self,
        *,
        block_order: tuple[str, ...],
        nominal_flow_lps: Mapping[str, float],
        weights: Mapping[str, float] | None = None,
    ) -> None:
        _validate_block_order(block_order)
        self._block_order = block_order
        self._flows = _resolve_values(
            nominal_flow_lps, block_order, "nominal_flow_lps", strictly_positive=True
        )
        self._weights = (
            None
            if weights is None
            else _resolve_values(weights, block_order, "weights", strictly_positive=False)
        )
        self._credits = dict.fromkeys(block_order, 0.0)

    @property
    def method_id(self) -> str:
        return METHOD_ID

    @property
    def block_order(self) -> tuple[str, ...]:
        return self._block_order

    def reset(self) -> None:
        self._credits = dict.fromkeys(self._block_order, 0.0)

    def _weight_of(self, context: MethodContext, block_id: str) -> float:
        if self._weights is not None:
            return self._weights[block_id]
        return context.demand_of(block_id)

    def _request_volume_m3(self, context: MethodContext, block_id: str) -> float:
        return flow_hours_to_volume_m3(self._flows[block_id], context.slot_hours)

    def decide(self, context: MethodContext) -> dict[str, bool]:
        if context.block_order != self._block_order:
            raise DomainInvariantError(
                "context block order does not match the method configuration"
            )
        weights = {
            block_id: self._weight_of(context, block_id)
            for block_id in self._block_order
        }
        total_weight = math.fsum(weights.values())
        if total_weight <= 0.0:
            return validate_opens(
                dict.fromkeys(self._block_order, False),
                block_order=self._block_order,
                method_id=METHOD_ID,
            )
        for block_id in self._block_order:
            self._credits[block_id] += weights[block_id]
        capacity = context.supply_volume_m3()
        ordered = sorted(
            self._block_order,
            key=lambda block_id: (-self._credits[block_id], block_id),
        )
        opens: dict[str, bool] = dict.fromkeys(self._block_order, False)
        committed = 0.0
        for block_id in ordered:
            if weights[block_id] <= 0.0:
                continue
            request = self._request_volume_m3(context, block_id)
            if capacity is not None and committed + request > capacity + CAPACITY_TOLERANCE:
                continue
            opens[block_id] = True
            committed += request
            self._credits[block_id] -= total_weight
        return validate_opens(opens, block_order=self._block_order, method_id=METHOD_ID)