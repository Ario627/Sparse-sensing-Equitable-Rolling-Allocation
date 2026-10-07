from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from app.core.types import (
    DomainInvariantError,
    require_finite,
    require_non_negative,
    require_positive,
)
from estimator.confidence import NisVerdict
from optimizer.params import (
    HEARTBEAT_INTERVAL_MIN_DEFAULT,
    TAU_FORECAST_DEFAULT,
    TAU_SERVICE_FLOOR_DEFAULT,
    TAU_SUPPLY_DRIFT_DEFAULT,
)

FORECAST_SCALE_FLOOR: Final = 1.0e-9


class TriggerKind(StrEnum):
    SUPPLY_DRIFT = "SUPPLY_DRIFT"
    SERVICE_FLOOR_BREACH = "SERVICE_FLOOR_BREACH"
    NIS_INCONSISTENT = "NIS_INCONSISTENT"
    FORECAST_SHIFT = "FORECAST_SHIFT"
    GATE_MISMATCH = "GATE_MISMATCH"
    HEARTBEAT = "HEARTBEAT"


def _require_unit_interval(value: float, name: str) -> float:
    number = require_finite(value, name)
    if not 0.0 <= number <= 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1]")
    return number


def supply_drift_ratio(observed_lps: float, planned_lps: float) -> float:
    planned = require_positive(planned_lps, "planned_lps")
    observed = require_non_negative(observed_lps, "observed_lps")
    return abs(observed - planned) / planned


def forecast_shift_ratio(previous: Sequence[float], current: Sequence[float]) -> float:
    if len(previous) != len(current):
        raise DomainInvariantError("forecast series must share one length")
    if not previous:
        raise DomainInvariantError("forecast series must not be empty")
    past = tuple(
        require_finite(float(value), "previous forecast value") for value in previous
    )
    present = tuple(
        require_finite(float(value), "current forecast value") for value in current
    )
    scale = max(
        max(abs(value) for value in past),
        max(abs(value) for value in present),
        FORECAST_SCALE_FLOOR,
    )
    peak = max(abs(after - before) for before, after in zip(past, present, strict=True))
    return peak / scale


def gate_mismatch_count(
    commanded: Mapping[str, bool],
    feedback: Mapping[str, bool],
) -> int:
    identifiers = set(commanded) | set(feedback)
    mismatch = 0
    for gate_id in identifiers:
        commanded_state = commanded.get(gate_id)
        feedback_state = feedback.get(gate_id)
        if (
            commanded_state is None
            or feedback_state is None
            or bool(commanded_state) != bool(feedback_state)
        ):
            mismatch += 1
    return mismatch


@dataclass(frozen=True, slots=True)
class TriggerEvent:
    kind: TriggerKind
    observed: float
    threshold: float

    def __post_init__(self) -> None:
        require_finite(self.observed, "observed")
        require_finite(self.threshold, "threshold")


@dataclass(frozen=True, slots=True)
class TriggerPolicy:
    supply_drift_ratio: float = TAU_SUPPLY_DRIFT_DEFAULT
    service_floor_margin: float = TAU_SERVICE_FLOOR_DEFAULT
    forecast_shift_ratio: float = TAU_FORECAST_DEFAULT
    heartbeat_interval_min: float = HEARTBEAT_INTERVAL_MIN_DEFAULT
    cooldown_min: float = 0.0

    def __post_init__(self) -> None:
        require_positive(self.supply_drift_ratio, "supply_drift_ratio")
        require_positive(self.service_floor_margin, "service_floor_margin")
        require_positive(self.forecast_shift_ratio, "forecast_shift_ratio")
        require_positive(self.heartbeat_interval_min, "heartbeat_interval_min")
        require_non_negative(self.cooldown_min, "cooldown_min")
        if self.cooldown_min > self.heartbeat_interval_min:
            raise DomainInvariantError(
                "cooldown must not exceed the heartbeat interval"
            )


@dataclass(frozen=True, slots=True)
class TriggerInputs:
    now_min: float
    last_solve_min: float
    planned_supply_lps: float | None = None
    observed_supply_lps: float | None = None
    service_floor_target: float | None = None
    min_service_ratio: float | None = None
    nis_verdict: NisVerdict | None = None
    forecast_previous: tuple[float, ...] | None = None
    forecast_current: tuple[float, ...] | None = None
    commanded_gates: Mapping[str, bool] | None = None
    feedback_gates: Mapping[str, bool] | None = None

    def __post_init__(self) -> None:
        require_non_negative(self.now_min, "now_min")
        require_non_negative(self.last_solve_min, "last_solve_min")
        if self.last_solve_min > self.now_min:
            raise DomainInvariantError("last_solve_min must not exceed now_min")
        if (self.planned_supply_lps is None) != (self.observed_supply_lps is None):
            raise DomainInvariantError("supply observations must be supplied together")
        if (self.service_floor_target is None) != (self.min_service_ratio is None):
            raise DomainInvariantError("service floor signals must be supplied together")
        if (self.forecast_previous is None) != (self.forecast_current is None):
            raise DomainInvariantError("forecast series must be supplied together")
        if (self.commanded_gates is None) != (self.feedback_gates is None):
            raise DomainInvariantError("gate states must be supplied together")
        if self.service_floor_target is not None:
            _require_unit_interval(self.service_floor_target, "service_floor_target")
        if self.min_service_ratio is not None:
            require_non_negative(self.min_service_ratio, "min_service_ratio")

    @property
    def elapsed_min(self) -> float:
        return self.now_min - self.last_solve_min


def _supply_event(inputs: TriggerInputs, policy: TriggerPolicy) -> TriggerEvent | None:
    if inputs.planned_supply_lps is None or inputs.observed_supply_lps is None:
        return None
    ratio = supply_drift_ratio(inputs.observed_supply_lps, inputs.planned_supply_lps)
    if ratio <= policy.supply_drift_ratio:
        return None
    return TriggerEvent(TriggerKind.SUPPLY_DRIFT, ratio, policy.supply_drift_ratio)


def _service_event(inputs: TriggerInputs, policy: TriggerPolicy) -> TriggerEvent | None:
    if inputs.service_floor_target is None or inputs.min_service_ratio is None:
        return None
    threshold = inputs.service_floor_target - policy.service_floor_margin
    if inputs.min_service_ratio >= threshold:
        return None
    return TriggerEvent(
        TriggerKind.SERVICE_FLOOR_BREACH, inputs.min_service_ratio, threshold
    )


def _nis_event(inputs: TriggerInputs) -> TriggerEvent | None:
    verdict = inputs.nis_verdict
    if verdict is None or verdict.is_consistent:
        return None
    return TriggerEvent(TriggerKind.NIS_INCONSISTENT, verdict.nis, verdict.threshold)


def _forecast_event(inputs: TriggerInputs, policy: TriggerPolicy) -> TriggerEvent | None:
    if inputs.forecast_previous is None or inputs.forecast_current is None:
        return None
    shift = forecast_shift_ratio(inputs.forecast_previous, inputs.forecast_current)
    if shift <= policy.forecast_shift_ratio:
        return None
    return TriggerEvent(TriggerKind.FORECAST_SHIFT, shift, policy.forecast_shift_ratio)


def _gate_event(inputs: TriggerInputs) -> TriggerEvent | None:
    if inputs.commanded_gates is None or inputs.feedback_gates is None:
        return None
    count = gate_mismatch_count(inputs.commanded_gates, inputs.feedback_gates)
    if count == 0:
        return None
    return TriggerEvent(TriggerKind.GATE_MISMATCH, float(count), 0.0)


def _heartbeat_event(inputs: TriggerInputs, policy: TriggerPolicy) -> TriggerEvent | None:
    if inputs.elapsed_min < policy.heartbeat_interval_min:
        return None
    return TriggerEvent(
        TriggerKind.HEARTBEAT, inputs.elapsed_min, policy.heartbeat_interval_min
    )


@dataclass(frozen=True, slots=True)
class TriggerDecision:
    should_solve: bool
    elapsed_min: float
    events: tuple[TriggerEvent, ...]
    suppressed: tuple[TriggerEvent, ...]
    cooldown_active: bool

    @property
    def triggered_kinds(self) -> tuple[TriggerKind, ...]:
        return tuple(event.kind for event in self.events)


def evaluate_triggers(
    inputs: TriggerInputs,
    policy: TriggerPolicy | None = None,
) -> TriggerDecision:
    active = policy if policy is not None else TriggerPolicy()
    candidates = (
        _supply_event(inputs, active),
        _service_event(inputs, active),
        _nis_event(inputs),
        _forecast_event(inputs, active),
        _gate_event(inputs),
        _heartbeat_event(inputs, active),
    )
    crossed = tuple(event for event in candidates if event is not None)
    if not crossed:
        return TriggerDecision(False, inputs.elapsed_min, (), (), False)
    if inputs.elapsed_min < active.cooldown_min:
        return TriggerDecision(False, inputs.elapsed_min, (), crossed, True)
    return TriggerDecision(True, inputs.elapsed_min, crossed, (), False)