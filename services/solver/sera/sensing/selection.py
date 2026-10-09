from __future__ import annotations

import itertools
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from types import MappingProxyType
from typing import Final

import numpy as np

from sera.core.rng import generator_for
from sera.core.types import (
    DomainInvariantError,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
)
from sera.estimator.identifiability import IdentifiabilityReport, IdentifiabilityThresholds

DEFAULT_MAX_EXACT_COMBINATIONS: Final = 10_000
DEFAULT_RIDGE: Final = 1.0e-9
DEFAULT_MIN_SWAP_IMPROVEMENT: Final = 0.0

type SensorSet = tuple[str, ...]
type ScoreFunction = Callable[[SensorSet], float]


def _require_candidates(candidates: Sequence[str]) -> tuple[str, ...]:
    items = tuple(candidates)
    if not items:
        raise DomainInvariantError("candidates must not be empty")
    for item in items:
        require_identifier(item, "candidate location")
    require_unique(items, "candidate location")
    return items


def _require_k(k: int, candidate_count: int) -> int:
    if isinstance(k, bool) or not isinstance(k, int):
        raise DomainInvariantError("k must be an integer")
    if not 0 <= k <= candidate_count:
        raise DomainInvariantError("k must lie in [0, candidate count]")
    return k


def _require_positive_int(value: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise DomainInvariantError(f"{name} must be a positive integer")
    return value


def _require_ridge(ridge: float) -> float:
    return require_positive(ridge, "ridge")


def _require_seed(seed: int) -> int:
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise DomainInvariantError("seed must be a non-negative integer")
    return seed


def _require_repetitions(repetitions: int) -> int:
    if isinstance(repetitions, bool) or not isinstance(repetitions, int) or repetitions < 1:
        raise DomainInvariantError("repetitions must be a positive integer")
    return repetitions


def _require_square_matrix(matrix: np.ndarray, name: str) -> np.ndarray:
    values = np.asarray(matrix, dtype=float)
    if values.ndim != 2 or values.shape[0] != values.shape[1]:
        raise DomainInvariantError(f"{name} must be a square matrix")
    if not np.all(np.isfinite(values)):
        raise DomainInvariantError(f"{name} must be finite")
    return values


def _frozen(array: np.ndarray) -> np.ndarray:
    frozen = np.array(array, dtype=float, copy=True)
    frozen.setflags(write=False)
    return frozen


def _require_score_function(score: ScoreFunction) -> ScoreFunction:
    if not callable(score):
        raise DomainInvariantError("score must be callable")
    return score


def _canonical_subset(selected: Sequence[str], candidates: tuple[str, ...]) -> SensorSet:
    position = {location: index for index, location in enumerate(candidates)}
    for location in selected:
        if location not in position:
            raise DomainInvariantError(f"unknown sensor location: {location!r}")
    return tuple(sorted(selected, key=position.__getitem__))


def _require_score(value: float, subset: SensorSet) -> float:
    number = float(value)
    if math.isnan(number):
        raise DomainInvariantError(f"score returned NaN for subset {subset!r}")
    return number


def _stabilized(posterior: np.ndarray, ridge: float) -> np.ndarray:
    dimension = int(posterior.shape[0])
    return posterior + ridge * np.eye(dimension)


class SearchStrategy(StrEnum):
    EXACT = "EXACT"
    GREEDY = "GREEDY"
    GREEDY_REFINED = "GREEDY_REFINED"
    RANDOM = "RANDOM"
    RANDOM_REFINED = "RANDOM_REFINED"


_REFINED_STRATEGY: Final[Mapping[SearchStrategy, SearchStrategy]] = MappingProxyType(
    {
        SearchStrategy.GREEDY: SearchStrategy.GREEDY_REFINED,
        SearchStrategy.GREEDY_REFINED: SearchStrategy.GREEDY_REFINED,
        SearchStrategy.RANDOM: SearchStrategy.RANDOM_REFINED,
        SearchStrategy.RANDOM_REFINED: SearchStrategy.RANDOM_REFINED,
    }
)


@dataclass(frozen=True, slots=True)
class SensorSelection:
    strategy: SearchStrategy
    selected: SensorSet
    score: float
    evaluated_subsets: int

    def __post_init__(self) -> None:
        if not isinstance(self.strategy, SearchStrategy):
            raise DomainInvariantError("strategy must be a SearchStrategy")
        for location in self.selected:
            require_identifier(location, "selected sensor location")
        require_unique(self.selected, "selected sensor location")
        if math.isnan(self.score):
            raise DomainInvariantError("score must not be NaN")
        if (
            isinstance(self.evaluated_subsets, bool)
            or not isinstance(self.evaluated_subsets, int)
            or self.evaluated_subsets < 1
        ):
            raise DomainInvariantError("evaluated_subsets must be a positive integer")


@dataclass(frozen=True, slots=True, eq=False)
class InformationBudget:
    prior_information: np.ndarray
    contributions: Mapping[str, np.ndarray]

    def __post_init__(self) -> None:
        prior = _require_square_matrix(self.prior_information, "prior_information")
        if not self.contributions:
            raise DomainInvariantError("contributions must not be empty")
        frozen: dict[str, np.ndarray] = {}
        for location, matrix in self.contributions.items():
            require_identifier(location, "contribution location")
            values = _require_square_matrix(matrix, f"contributions[{location}]")
            if values.shape != prior.shape:
                raise DomainInvariantError("contributions must match the prior shape")
            frozen[location] = _frozen(values)
        object.__setattr__(self, "prior_information", _frozen(prior))
        object.__setattr__(self, "contributions", MappingProxyType(frozen))


def enumerate_subsets(candidates: Sequence[str], k: int) -> tuple[SensorSet, ...]:
    items = _require_candidates(candidates)
    size = _require_k(k, len(items))
    return tuple(itertools.combinations(items, size))


def posterior_information(budget: InformationBudget, selected: Sequence[str]) -> np.ndarray:
    chosen = _canonical_subset(selected, tuple(budget.contributions))
    total = np.array(budget.prior_information, dtype=float, copy=True)
    for location in chosen:
        total = total + budget.contributions[location]
    return (total + total.T) / 2.0


def trace_p_score(
    budget: InformationBudget,
    selected: Sequence[str],
    *,
    ridge: float = DEFAULT_RIDGE,
) -> float:
    _require_ridge(ridge)
    posterior = posterior_information(budget, selected)
    stabilized = _stabilized(posterior, ridge)
    dimension = int(stabilized.shape[0])
    try:
        covariance = np.linalg.solve(stabilized, np.eye(dimension))
    except np.linalg.LinAlgError as error:
        raise DomainInvariantError("stabilized posterior information is singular") from error
    return -float(np.trace(covariance))


def logdet_score(
    budget: InformationBudget,
    selected: Sequence[str],
    *,
    ridge: float = DEFAULT_RIDGE,
) -> float:
    _require_ridge(ridge)
    posterior = posterior_information(budget, selected)
    stabilized = _stabilized(posterior, ridge)
    sign, logdet = np.linalg.slogdet(stabilized)
    if sign <= 0.0:
        raise DomainInvariantError("posterior information must be positive definite")
    return float(logdet)


def identifiability_report(
    budget: InformationBudget,
    selected: Sequence[str],
    *,
    thresholds: IdentifiabilityThresholds | None = None,
    expected_rank: int | None = None,
) -> IdentifiabilityReport:
    return IdentifiabilityReport.assess(
        posterior_information(budget, selected),
        thresholds,
        expected_rank=expected_rank,
    )


def exact_search(
    candidates: Sequence[str],
    k: int,
    score: ScoreFunction,
) -> SensorSelection:
    items = _require_candidates(candidates)
    size = _require_k(k, len(items))
    _require_score_function(score)
    subsets = tuple(itertools.combinations(items, size))
    best = subsets[0]
    best_score = _require_score(score(best), best)
    evaluated = 1
    for subset in subsets[1:]:
        value = _require_score(score(subset), subset)
        evaluated += 1
        if value > best_score:
            best_score = value
            best = subset
    return SensorSelection(
        strategy=SearchStrategy.EXACT,
        selected=best,
        score=best_score,
        evaluated_subsets=evaluated,
    )


def greedy_forward(
    candidates: Sequence[str],
    k: int,
    score: ScoreFunction,
) -> SensorSelection:
    items = _require_candidates(candidates)
    size = _require_k(k, len(items))
    _require_score_function(score)
    selected: list[str] = []
    remaining = list(items)
    best_score = _require_score(score(()), ())
    evaluated = 1
    for _ in range(size):
        first = remaining[0]
        first_subset = _canonical_subset((*selected, first), items)
        best_location = first
        best_value = _require_score(score(first_subset), first_subset)
        evaluated += 1
        for location in remaining[1:]:
            subset = _canonical_subset((*selected, location), items)
            value = _require_score(score(subset), subset)
            evaluated += 1
            if value > best_value:
                best_value = value
                best_location = location
        selected.append(best_location)
        remaining.remove(best_location)
        best_score = best_value
    return SensorSelection(
        strategy=SearchStrategy.GREEDY,
        selected=tuple(selected),
        score=best_score,
        evaluated_subsets=evaluated,
    )


def _sample_subset(
    rng: np.random.Generator,
    candidates: tuple[str, ...],
    size: int,
) -> SensorSet:
    if size == 0:
        return ()
    indices = rng.choice(len(candidates), size=size, replace=False)
    drawn = tuple(candidates[int(index)] for index in indices)
    return _canonical_subset(drawn, candidates)


def random_search(
    candidates: Sequence[str],
    k: int,
    score: ScoreFunction,
    *,
    seed: int,
    repetitions: int,
) -> SensorSelection:
    items = _require_candidates(candidates)
    size = _require_k(k, len(items))
    count = _require_repetitions(repetitions)
    base_seed = _require_seed(seed)
    _require_score_function(score)
    rng = generator_for(base_seed, "sensing", "random", size)
    subsets: list[SensorSet] = []
    seen: set[SensorSet] = set()
    for _ in range(count):
        subset = _sample_subset(rng, items, size)
        if subset not in seen:
            seen.add(subset)
            subsets.append(subset)
    values = [_require_score(score(subset), subset) for subset in subsets]
    best_index = max(range(len(subsets)), key=values.__getitem__)
    return SensorSelection(
        strategy=SearchStrategy.RANDOM,
        selected=subsets[best_index],
        score=values[best_index],
        evaluated_subsets=len(subsets),
    )


def local_swap_refine(
    candidates: Sequence[str],
    selection: SensorSelection,
    score: ScoreFunction,
    *,
    min_improvement: float = DEFAULT_MIN_SWAP_IMPROVEMENT,
) -> SensorSelection:
    items = _require_candidates(candidates)
    threshold = require_non_negative(min_improvement, "min_improvement")
    _require_score_function(score)
    refined = _REFINED_STRATEGY.get(selection.strategy)
    if refined is None:
        raise DomainInvariantError("exact selections are globally optimal and cannot be refined")
    selected = _canonical_subset(selection.selected, items)
    current = selection.score
    evaluated = selection.evaluated_subsets
    while True:
        best_swap: tuple[str, str] | None = None
        best_value = current
        for outgoing in selected:
            rest = tuple(location for location in selected if location != outgoing)
            for incoming in items:
                if incoming in selected:
                    continue
                subset = _canonical_subset((*rest, incoming), items)
                value = _require_score(score(subset), subset)
                evaluated += 1
                if value - current > threshold and value > best_value:
                    best_value = value
                    best_swap = (outgoing, incoming)
        if best_swap is None:
            break
        survivors = tuple(location for location in selected if location != best_swap[0])
        selected = _canonical_subset((*survivors, best_swap[1]), items)
        current = best_value
    return replace(
        selection,
        strategy=refined,
        selected=selected,
        score=current,
        evaluated_subsets=evaluated,
    )


def select_sensors(
    candidates: Sequence[str],
    k: int,
    score: ScoreFunction,
    *,
    max_exact_combinations: int = DEFAULT_MAX_EXACT_COMBINATIONS,
    refine: bool = True,
    min_improvement: float = DEFAULT_MIN_SWAP_IMPROVEMENT,
) -> SensorSelection:
    items = _require_candidates(candidates)
    size = _require_k(k, len(items))
    limit = _require_positive_int(max_exact_combinations, "max_exact_combinations")
    if math.comb(len(items), size) <= limit:
        return exact_search(items, size, score)
    greedy = greedy_forward(items, size, score)
    if refine:
        return local_swap_refine(items, greedy, score, min_improvement=min_improvement)
    return greedy
    return greedy
