from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, replace
from typing import Final

import numpy as np

from app.core.types import (
    DomainInvariantError,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
    require_unit_open_closed,
)

_DEFAULT_PARTIAL_MIN: Final = 0.6
_DEFAULT_PARTIAL_MAX: Final = 1.0


def _require_probability(value: float, name: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise DomainInvariantError(f"{name} must be a number")
    number = float(value)
    if not 0.0 <= number <= 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1]")
    return number


@dataclass(frozen=True, slots=True)
class GateFaultSpec:
    response_delay_min: float = 0.0
    delay_jitter_min: float = 0.0
    flow_bias_sigma: float = 0.0
    partial_open_prob: float = 0.0
    partial_open_min: float = _DEFAULT_PARTIAL_MIN
    partial_open_max: float = _DEFAULT_PARTIAL_MAX
    stuck_prob: float = 0.0
    stuck_open_prob: float = 0.5

    def __post_init__(self) -> None:
        require_non_negative(self.response_delay_min, "response_delay_min")
        require_non_negative(self.delay_jitter_min, "delay_jitter_min")
        require_non_negative(self.flow_bias_sigma, "flow_bias_sigma")
        _require_probability(self.partial_open_prob, "partial_open_prob")
        _require_probability(self.stuck_prob, "stuck_prob")
        _require_probability(self.stuck_open_prob, "stuck_open_prob")
        floor = require_unit_open_closed(self.partial_open_min, "partial_open_min")
        ceiling = require_unit_open_closed(self.partial_open_max, "partial_open_max")
        if ceiling < floor:
            raise DomainInvariantError(
                "partial_open_max must be >= partial_open_min"
            )


@dataclass(frozen=True, slots=True)
class GateUnit:
    gate_id: str
    response_delay_min: float
    flow_factor: float
    flow_bias: float
    stuck: bool = False
    stuck_open: bool = False

    def __post_init__(self) -> None:
        require_identifier(self.gate_id, "gate_id")
        require_non_negative(self.response_delay_min, "response_delay_min")
        require_unit_open_closed(self.flow_factor, "flow_factor")
        if self.flow_bias <= -1.0:
            raise DomainInvariantError("flow_bias must be greater than -1")
        if self.stuck_open and not self.stuck:
            raise DomainInvariantError("stuck_open requires stuck")


@dataclass(frozen=True, slots=True)
class GateState:
    unit: GateUnit
    open_applied: bool = False
    pending_open: bool | None = None
    pending_applies_at_min: float = 0.0

    def __post_init__(self) -> None:
        require_non_negative(self.pending_applies_at_min, "pending_applies_at_min")


def initial_gate_state(unit: GateUnit) -> GateState:
    return GateState(unit=unit, open_applied=unit.stuck and unit.stuck_open)


def issue_gate_command(
    state: GateState,
    *,
    open_requested: bool,
    now_min: float,
) -> GateState:
    now = require_non_negative(now_min, "now_min")
    unit = state.unit
    if unit.stuck:
        return state
    if open_requested == state.open_applied:
        return replace(state, pending_open=None, pending_applies_at_min=0.0)
    if state.pending_open == open_requested:
        return state
    return replace(
        state,
        pending_open=open_requested,
        pending_applies_at_min=now + unit.response_delay_min,
    )


def step_gate(state: GateState, *, now_min: float) -> GateState:
    now = require_non_negative(now_min, "now_min")
    if state.pending_open is None or now < state.pending_applies_at_min:
        return state
    return replace(
        state,
        open_applied=state.pending_open,
        pending_open=None,
        pending_applies_at_min=0.0,
    )


def gate_flow_lps(state: GateState, *, nominal_flow_lps: float) -> float:
    nominal = require_positive(nominal_flow_lps, "nominal_flow_lps")
    if not state.open_applied:
        return 0.0
    return nominal * state.unit.flow_factor * (1.0 + state.unit.flow_bias)


def build_gate_fleet(
    rng: np.random.Generator,
    gate_ids: Iterable[str],
    fault: GateFaultSpec,
) -> dict[str, GateUnit]:
    identifiers = tuple(require_identifier(gate_id, "gate_id") for gate_id in gate_ids)
    if not identifiers:
        raise DomainInvariantError("gate_ids must not be empty")
    require_unique(identifiers, "gate_id")
    fleet: dict[str, GateUnit] = {}
    for gate_id in sorted(identifiers):
        delay_noise = abs(float(rng.standard_normal()))
        bias = fault.flow_bias_sigma * float(rng.standard_normal())
        partial_roll = float(rng.random())
        factor_roll = float(
            rng.uniform(fault.partial_open_min, fault.partial_open_max)
        )
        stuck_roll = float(rng.random())
        stuck_open_roll = float(rng.random())
        stuck = stuck_roll < fault.stuck_prob
        fleet[gate_id] = GateUnit(
            gate_id=gate_id,
            response_delay_min=fault.response_delay_min
            + fault.delay_jitter_min * delay_noise,
            flow_factor=factor_roll if partial_roll < fault.partial_open_prob else 1.0,
            flow_bias=bias,
            stuck=stuck,
            stuck_open=stuck and stuck_open_roll < fault.stuck_open_prob,
        )
    return fleet