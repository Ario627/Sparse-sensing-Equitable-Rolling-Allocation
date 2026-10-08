from __future__ import annotations

from typing import Final

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sera.core.rng import generator_for
from sera.core.types import DomainInvariantError
from sera.simulator.gate import (
    GateFaultSpec,
    GateState,
    GateUnit,
    build_gate_fleet,
    gate_flow_lps,
    initial_gate_state,
    issue_gate_command,
    step_gate,
)

RNG_SEED: Final = 20_261_008
NOMINAL_FLOW_LPS: Final = 10.0
GATE_IDS: Final = ("g1", "g2", "g3")
DELAY_MIN: Final = 15.0


def healthy_unit(
    *,
    response_delay_min: float = 0.0,
    flow_factor: float = 1.0,
    flow_bias: float = 0.0,
) -> GateUnit:
    return GateUnit(
        gate_id="g1",
        response_delay_min=response_delay_min,
        flow_factor=flow_factor,
        flow_bias=flow_bias,
    )


def test_healthy_gate_starts_closed() -> None:
    state = initial_gate_state(healthy_unit())
    assert state.open_applied is False
    assert state.pending_open is None


def test_stuck_open_gate_starts_open() -> None:
    unit = GateUnit(
        gate_id="g1",
        response_delay_min=0.0,
        flow_factor=1.0,
        flow_bias=0.0,
        stuck=True,
        stuck_open=True,
    )
    assert initial_gate_state(unit).open_applied is True


def test_gate_unit_rejects_inconsistent_stuck_flags() -> None:
    with pytest.raises(DomainInvariantError):
        GateUnit(
            gate_id="g1", response_delay_min=0.0, flow_factor=1.0, flow_bias=0.0, stuck_open=True
        )
    with pytest.raises(DomainInvariantError):
        GateUnit(gate_id="g1", response_delay_min=0.0, flow_factor=0.0, flow_bias=0.0)
    with pytest.raises(DomainInvariantError):
        GateUnit(gate_id="g1", response_delay_min=0.0, flow_factor=1.0, flow_bias=-1.0)


def test_command_without_delay_applies_on_the_same_step() -> None:
    state = initial_gate_state(healthy_unit())
    issued = issue_gate_command(state, open_requested=True, now_min=0.0)
    assert issued.pending_open is True
    stepped = step_gate(issued, now_min=0.0)
    assert stepped.open_applied is True
    assert stepped.pending_open is None


def test_delay_postpones_the_applied_state() -> None:
    state = issue_gate_command(
        initial_gate_state(healthy_unit(response_delay_min=DELAY_MIN)),
        open_requested=True,
        now_min=0.0,
    )
    assert step_gate(state, now_min=DELAY_MIN - 0.001).open_applied is False
    assert step_gate(state, now_min=DELAY_MIN).open_applied is True


def test_step_gate_without_pending_command_is_a_no_op() -> None:
    state = initial_gate_state(healthy_unit(response_delay_min=DELAY_MIN))
    assert step_gate(state, now_min=100.0) == state


def test_repeated_command_keeps_the_first_deadline() -> None:
    state = issue_gate_command(
        initial_gate_state(healthy_unit(response_delay_min=DELAY_MIN)),
        open_requested=True,
        now_min=0.0,
    )
    repeated = issue_gate_command(state, open_requested=True, now_min=5.0)
    assert repeated is state
    assert repeated.pending_applies_at_min == DELAY_MIN


def test_reversal_matching_current_state_cancels_pending_command() -> None:
    state = issue_gate_command(
        initial_gate_state(healthy_unit(response_delay_min=DELAY_MIN)),
        open_requested=True,
        now_min=0.0,
    )
    cancelled = issue_gate_command(state, open_requested=False, now_min=5.0)
    assert cancelled.pending_open is None
    assert step_gate(cancelled, now_min=100.0).open_applied is False


def test_open_then_close_command_returns_to_closed() -> None:
    unit = healthy_unit(response_delay_min=DELAY_MIN)
    state = step_gate(
        issue_gate_command(initial_gate_state(unit), open_requested=True, now_min=0.0),
        now_min=DELAY_MIN,
    )
    assert state.open_applied is True
    closed = step_gate(
        issue_gate_command(state, open_requested=False, now_min=DELAY_MIN), now_min=2.0 * DELAY_MIN
    )
    assert closed.open_applied is False


def test_stuck_gate_ignores_commands() -> None:
    unit = GateUnit(
        gate_id="g1", response_delay_min=0.0, flow_factor=1.0, flow_bias=0.0, stuck=True
    )
    state = initial_gate_state(unit)
    assert issue_gate_command(state, open_requested=True, now_min=0.0) is state
    assert step_gate(state, now_min=1000.0) is state


def test_closed_gate_passes_no_flow() -> None:
    assert (
        gate_flow_lps(initial_gate_state(healthy_unit()), nominal_flow_lps=NOMINAL_FLOW_LPS) == 0.0
    )


def test_open_gate_scales_nominal_flow_by_factor_and_bias() -> None:
    unit = healthy_unit(flow_factor=0.8, flow_bias=0.25)
    state = GateState(unit=unit, open_applied=True)
    assert gate_flow_lps(state, nominal_flow_lps=NOMINAL_FLOW_LPS) == pytest.approx(
        NOMINAL_FLOW_LPS * 0.8 * 1.25
    )
    partial = GateState(unit=healthy_unit(flow_factor=0.5, flow_bias=-0.5), open_applied=True)
    assert gate_flow_lps(partial, nominal_flow_lps=NOMINAL_FLOW_LPS) == pytest.approx(
        NOMINAL_FLOW_LPS * 0.5 * 0.5
    )


def test_fault_spec_rejects_inverted_partial_window() -> None:
    with pytest.raises(DomainInvariantError):
        GateFaultSpec(partial_open_min=0.9, partial_open_max=0.5)
    with pytest.raises(DomainInvariantError):
        GateFaultSpec(partial_open_min=0.0)


def test_zero_fault_fleet_is_fully_healthy_and_deterministic() -> None:
    first = build_gate_fleet(generator_for(RNG_SEED, "gate", "fleet"), GATE_IDS, GateFaultSpec())
    second = build_gate_fleet(generator_for(RNG_SEED, "gate", "fleet"), GATE_IDS, GateFaultSpec())
    assert first == second
    assert tuple(first) == GATE_IDS
    for unit in first.values():
        assert unit.response_delay_min == 0.0
        assert unit.flow_factor == 1.0
        assert unit.flow_bias == 0.0
        assert unit.stuck is False


def test_full_stuck_fleet_ignores_commands_and_keeps_open_flow() -> None:
    fault = GateFaultSpec(stuck_prob=1.0, stuck_open_prob=1.0)
    fleet = build_gate_fleet(generator_for(RNG_SEED, "gate", "stuck"), GATE_IDS, fault)
    for unit in fleet.values():
        assert unit.stuck is True
        assert unit.stuck_open is True
        state = initial_gate_state(unit)
        assert state.open_applied is True
        assert issue_gate_command(state, open_requested=False, now_min=0.0) is state
        assert gate_flow_lps(state, nominal_flow_lps=NOMINAL_FLOW_LPS) == pytest.approx(
            NOMINAL_FLOW_LPS
        )


def test_delayed_fleet_respects_minimum_delay() -> None:
    fault = GateFaultSpec(response_delay_min=10.0, delay_jitter_min=5.0)
    fleet = build_gate_fleet(generator_for(RNG_SEED, "gate", "delay"), GATE_IDS, fault)
    for unit in fleet.values():
        assert unit.response_delay_min >= 10.0


def test_partial_fleet_factors_stay_inside_the_window() -> None:
    fault = GateFaultSpec(partial_open_prob=1.0, partial_open_min=0.5, partial_open_max=0.7)
    fleet = build_gate_fleet(generator_for(RNG_SEED, "gate", "partial"), GATE_IDS, fault)
    for unit in fleet.values():
        assert 0.5 <= unit.flow_factor <= 0.7


def test_fleet_generation_is_seed_deterministic() -> None:
    fault = GateFaultSpec(
        response_delay_min=5.0, delay_jitter_min=2.0, stuck_prob=0.5, stuck_open_prob=0.5
    )
    first = build_gate_fleet(generator_for(RNG_SEED, "gate", "seed-a"), GATE_IDS, fault)
    second = build_gate_fleet(generator_for(RNG_SEED, "gate", "seed-a"), GATE_IDS, fault)
    other = build_gate_fleet(generator_for(RNG_SEED, "gate", "seed-b"), GATE_IDS, fault)
    assert first == second
    assert first != other


def test_fleet_requires_gate_ids() -> None:
    with pytest.raises(DomainInvariantError):
        build_gate_fleet(generator_for(RNG_SEED, "gate", "empty"), (), GateFaultSpec())


@given(
    nominal=st.floats(min_value=0.1, max_value=100.0, allow_nan=False, allow_infinity=False),
    factor=st.floats(min_value=0.01, max_value=1.0, allow_nan=False, allow_infinity=False),
    bias=st.floats(min_value=-0.9, max_value=2.0, allow_nan=False, allow_infinity=False),
    open_applied=st.booleans(),
)
def test_gate_flow_matches_open_state_factor_and_bias(
    nominal: float,
    factor: float,
    bias: float,
    open_applied: bool,
) -> None:
    unit = healthy_unit(flow_factor=factor, flow_bias=bias)
    state = GateState(unit=unit, open_applied=open_applied)
    flow = gate_flow_lps(state, nominal_flow_lps=nominal)
    expected = nominal * factor * (1.0 + bias) if open_applied else 0.0
    assert flow == pytest.approx(expected, rel=1e-12)


@given(
    delay=st.floats(min_value=0.0, max_value=120.0, allow_nan=False, allow_infinity=False),
    now=st.floats(min_value=0.0, max_value=240.0, allow_nan=False, allow_infinity=False),
)
def test_pending_command_applies_exactly_after_the_delay(delay: float, now: float) -> None:
    state = issue_gate_command(
        initial_gate_state(healthy_unit(response_delay_min=delay)),
        open_requested=True,
        now_min=0.0,
    )
    stepped = step_gate(state, now_min=now)
    assert stepped.open_applied is (now >= delay)
