from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from app.core.types import (
    DomainInvariantError,
    require_finite,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
)

PROBABILITY_TOLERANCE: Final = 1.0e-6


def _require_probability(value: float, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"{name} must be a number")
    number = float(value)
    if not 0.0 <= number <= 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1]")
    return number


def _require_cvar_alpha(alpha: float) -> float:
    if isinstance(alpha, bool) or not isinstance(alpha, (int, float)):
        raise DomainInvariantError("alpha must be a number")
    number = float(alpha)
    if not 0.0 < number < 1.0:
        raise DomainInvariantError("alpha must lie in (0, 1)")
    return number


@dataclass(frozen=True, slots=True)
class ScenarioEvaluation:
    scenario_id: str
    probability: float
    shortage_m3: float
    min_service_ratio: float

    def __post_init__(self) -> None:
        require_identifier(self.scenario_id, "scenario_id")
        _require_probability(self.probability, "probability")
        require_non_negative(self.shortage_m3, "shortage_m3")
        require_non_negative(self.min_service_ratio, "min_service_ratio")


@dataclass(frozen=True, slots=True)
class SensorCandidate:
    location_id: str
    cost: float

    def __post_init__(self) -> None:
        require_identifier(self.location_id, "location_id")
        require_positive(self.cost, "cost")


def _require_simplex(
    evaluations: Sequence[ScenarioEvaluation],
    name: str,
) -> tuple[ScenarioEvaluation, ...]:
    items = tuple(evaluations)
    if not items:
        raise DomainInvariantError(f"{name} must contain at least one scenario evaluation")
    require_unique((item.scenario_id for item in items), "scenario_id")
    total = math.fsum(item.probability for item in items)
    if abs(total - 1.0) > PROBABILITY_TOLERANCE:
        raise DomainInvariantError(f"{name} probabilities must sum to one")
    if all(item.probability <= 0.0 for item in items):
        raise DomainInvariantError(f"{name} must assign mass to at least one scenario")
    return items


@dataclass(frozen=True, slots=True)
class ValueOfInformation:
    location_id: str
    cost: float
    expected_shortage_reduction_m3: float
    cvar_shortage_reduction_m3: float
    service_floor_gain: float

    def __post_init__(self) -> None:
        require_identifier(self.location_id, "location_id")
        require_positive(self.cost, "cost")
        require_finite(self.expected_shortage_reduction_m3, "expected_shortage_reduction_m3")
        require_finite(self.cvar_shortage_reduction_m3, "cvar_shortage_reduction_m3")
        require_finite(self.service_floor_gain, "service_floor_gain")

    @property
    def expected_reduction_per_cost(self) -> float:
        return self.expected_shortage_reduction_m3 / self.cost


def expected_shortage(evaluations: Sequence[ScenarioEvaluation]) -> float:
    items = _require_simplex(evaluations, "evaluations")
    return math.fsum(item.probability * item.shortage_m3 for item in items)


def service_floor(evaluations: Sequence[ScenarioEvaluation]) -> float:
    items = _require_simplex(evaluations, "evaluations")
    return min(item.min_service_ratio for item in items)


def cvar_shortage(evaluations: Sequence[ScenarioEvaluation], *, alpha: float) -> float:
    items = _require_simplex(evaluations, "evaluations")
    tail_mass = 1.0 - _require_cvar_alpha(alpha)
    ordered = sorted(items, key=lambda item: (-item.shortage_m3, item.scenario_id))
    remaining = tail_mass
    total = 0.0
    for item in ordered:
        if remaining <= 0.0:
            break
        take = min(item.probability, remaining)
        total += take * item.shortage_m3
        remaining -= take
    return total / tail_mass


def align_paired(
    first: Sequence[ScenarioEvaluation],
    second: Sequence[ScenarioEvaluation],
) -> tuple[tuple[ScenarioEvaluation, ScenarioEvaluation], ...]:
    left = _require_simplex(first, "first evaluations")
    right = _require_simplex(second, "second evaluations")
    right_by_id = {item.scenario_id: item for item in right}
    left_ids = {item.scenario_id for item in left}
    right_ids = set(right_by_id)
    missing = sorted(left_ids - right_ids)
    if missing:
        raise DomainInvariantError(f"second evaluations missing scenarios: {missing}")
    unknown = sorted(right_ids - left_ids)
    if unknown:
        raise DomainInvariantError(f"second evaluations carry unknown scenarios: {unknown}")
    pairs: list[tuple[ScenarioEvaluation, ScenarioEvaluation]] = []
    for item in sorted(left, key=lambda entry: entry.scenario_id):
        partner = right_by_id[item.scenario_id]
        if abs(item.probability - partner.probability) > PROBABILITY_TOLERANCE:
            raise DomainInvariantError(
                f"scenario {item.scenario_id!r} probabilities must match across evaluations"
            )
        pairs.append((item, partner))
    return tuple(pairs)


def marginal_voi(
    candidate: SensorCandidate,
    base: Sequence[ScenarioEvaluation],
    augmented: Sequence[ScenarioEvaluation],
    *,
    cvar_alpha: float,
) -> ValueOfInformation:
    align_paired(base, augmented)
    expected_reduction = expected_shortage(base) - expected_shortage(augmented)
    cvar_reduction = cvar_shortage(base, alpha=cvar_alpha) - cvar_shortage(
        augmented, alpha=cvar_alpha
    )
    floor_gain = service_floor(augmented) - service_floor(base)
    return ValueOfInformation(
        location_id=candidate.location_id,
        cost=candidate.cost,
        expected_shortage_reduction_m3=expected_reduction,
        cvar_shortage_reduction_m3=cvar_reduction,
        service_floor_gain=floor_gain,
    )


def screen_candidates(
    base: Sequence[ScenarioEvaluation],
    augmented_by_location: Mapping[str, Sequence[ScenarioEvaluation]],
    candidates: Sequence[SensorCandidate],
    *,
    cvar_alpha: float,
) -> tuple[ValueOfInformation, ...]:
    if not candidates:
        raise DomainInvariantError("candidates must not be empty")
    require_unique((candidate.location_id for candidate in candidates), "location_id")
    known = {candidate.location_id for candidate in candidates}
    available = set(augmented_by_location)
    missing = sorted(known - available)
    if missing:
        raise DomainInvariantError(f"augmented evaluations missing locations: {missing}")
    unknown = sorted(available - known)
    if unknown:
        raise DomainInvariantError(f"augmented evaluations carry unknown locations: {unknown}")
    entries = [
        marginal_voi(
            candidate,
            base,
            augmented_by_location[candidate.location_id],
            cvar_alpha=cvar_alpha,
        )
        for candidate in candidates
    ]
    return tuple(
        sorted(
            entries,
            key=lambda entry: (-entry.expected_reduction_per_cost, entry.location_id),
        )
    )
