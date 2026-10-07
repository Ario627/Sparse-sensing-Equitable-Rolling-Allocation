from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np  # type: ignore
from scipy.stats import rankdata, spearmanr, wilcoxon  # type: ignore

from app.core.rng import generator_for
from app.core.types import (
    DomainInvariantError,
    Interval,
    require_finite,
    require_non_negative,
)

type SampleStatistic = Callable[[np.ndarray], np.ndarray]

DEFAULT_LEVEL: Final = 0.95
DEFAULT_RESAMPLES: Final = 10_000
MIN_RESAMPLES: Final = 100
MIN_SPEARMAN_SAMPLES: Final = 3
KNEE_TOLERANCE: Final = 1.0e-9
EFFECT_TOLERANCE: Final = 1.0e-9


def mean_statistic(samples: np.ndarray) -> np.ndarray:
    return np.mean(samples, axis=-1)


def median_statistic(samples: np.ndarray) -> np.ndarray:
    return np.median(samples, axis=-1)


def _require_level(level: float) -> float:
    if isinstance(level, bool) or not isinstance(level, (int, float)):
        raise DomainInvariantError("level must be a number")
    value = float(level)
    if not 0.0 < value < 1.0:
        raise DomainInvariantError("level must lie in (0, 1)")
    return value


def _require_resamples(resamples: int) -> int:
    if isinstance(resamples, bool) or not isinstance(resamples, int):
        raise DomainInvariantError("resamples must be an integer")
    if resamples < MIN_RESAMPLES:
        raise DomainInvariantError(f"resamples must be at least {MIN_RESAMPLES}")
    return resamples


def _require_seed(seed: int) -> int:
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise DomainInvariantError("seed must be a non-negative integer")
    return seed


def _require_probability(value: float, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"{name} must be a number")
    number = float(value)
    if not 0.0 <= number <= 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1]")
    return number


def _require_vector(values: Sequence[float], name: str) -> np.ndarray:
    array = np.asarray(values, dtype=float)
    if array.ndim != 1:
        raise DomainInvariantError(f"{name} must be one-dimensional")
    if array.size < 1:
        raise DomainInvariantError(f"{name} must not be empty")
    if not np.all(np.isfinite(array)):
        raise DomainInvariantError(f"{name} must be finite")
    return array


@dataclass(frozen=True, slots=True)
class SampleSummary:
    n: int
    mean: float
    median: float
    ci: Interval

    def __post_init__(self) -> None:
        if isinstance(self.n, bool) or not isinstance(self.n, int) or self.n < 1:
            raise DomainInvariantError("n must be a positive integer")
        require_finite(self.mean, "mean")
        require_finite(self.median, "median")
        if not isinstance(self.ci, Interval):
            raise DomainInvariantError("ci must be an Interval")


@dataclass(frozen=True, slots=True)
class SignedRankResult:
    statistic: float
    p_value: float
    n_effective: int
    rank_biserial: float

    def __post_init__(self) -> None:
        require_non_negative(self.statistic, "statistic")
        _require_probability(self.p_value, "p_value")
        if (
            isinstance(self.n_effective, bool)
            or not isinstance(self.n_effective, int)
            or self.n_effective < 0
        ):
            raise DomainInvariantError("n_effective must be a non-negative integer")
        effect = require_finite(self.rank_biserial, "rank_biserial")
        if abs(effect) > 1.0 + EFFECT_TOLERANCE:
            raise DomainInvariantError("rank_biserial must lie in [-1, 1]")


@dataclass(frozen=True, slots=True)
class RankCorrelation:
    rho: float
    p_value: float
    n: int

    def __post_init__(self) -> None:
        rho = require_finite(self.rho, "rho")
        if abs(rho) > 1.0 + EFFECT_TOLERANCE:
            raise DomainInvariantError("rho must lie in [-1, 1]")
        _require_probability(self.p_value, "p_value")
        if isinstance(self.n, bool) or not isinstance(self.n, int) or self.n < MIN_SPEARMAN_SAMPLES:
            raise DomainInvariantError(f"n must be at least {MIN_SPEARMAN_SAMPLES}")


@dataclass(frozen=True, slots=True)
class KneePoint:
    index: int
    x: float
    y: float
    distance: float

    def __post_init__(self) -> None:
        if isinstance(self.index, bool) or not isinstance(self.index, int) or self.index < 0:
            raise DomainInvariantError("index must be a non-negative integer")
        require_finite(self.x, "x")
        require_finite(self.y, "y")
        require_non_negative(self.distance, "distance")


def paired_differences(
    treatment: Sequence[float],
    control: Sequence[float],
) -> tuple[float, ...]:
    left = _require_vector(treatment, "treatment")
    right = _require_vector(control, "control")
    if left.size != right.size:
        raise DomainInvariantError("paired series must share one length")
    return tuple(float(value) for value in left - right)


def bootstrap_ci(
    samples: Sequence[float],
    *,
    statistic: SampleStatistic = mean_statistic,
    level: float = DEFAULT_LEVEL,
    resamples: int = DEFAULT_RESAMPLES,
    seed: int,
) -> Interval:
    values = _require_vector(samples, "samples")
    confidence = _require_level(level)
    count = _require_resamples(resamples)
    base_seed = _require_seed(seed)
    rng = generator_for(base_seed, "stats", "bootstrap")
    positions = rng.integers(0, values.size, size=(count, values.size))
    resampled = np.asarray(statistic(values[positions]), dtype=float)
    if resampled.shape != (count,):
        raise DomainInvariantError("statistic must reduce along the sample axis")
    tail = (1.0 - confidence) / 2.0
    return Interval(
        lower=float(np.quantile(resampled, tail)),
        upper=float(np.quantile(resampled, 1.0 - tail)),
    )


def summarize(
    samples: Sequence[float],
    *,
    level: float = DEFAULT_LEVEL,
    resamples: int = DEFAULT_RESAMPLES,
    seed: int,
) -> SampleSummary:
    values = _require_vector(samples, "samples")
    return SampleSummary(
        n=int(values.size),
        mean=float(np.mean(values)),
        median=float(np.median(values)),
        ci=bootstrap_ci(values, level=level, resamples=resamples, seed=seed),
    )


def signed_rank(differences: Sequence[float]) -> SignedRankResult:
    values = _require_vector(differences, "differences")
    nonzero = values[values != 0.0]
    if nonzero.size == 0:
        return SignedRankResult(
            statistic=0.0,
            p_value=1.0,
            n_effective=0,
            rank_biserial=0.0,
        )
    ranks = rankdata(np.abs(nonzero))
    positive = float(np.sum(ranks[nonzero > 0.0]))
    negative = float(np.sum(ranks[nonzero < 0.0]))
    total = positive + negative
    outcome = wilcoxon(
        nonzero,
        zero_method="wilcox",
        alternative="two-sided",
        method="asymptotic",
    )
    effect = (positive - negative) / total if total > 0.0 else 0.0
    return SignedRankResult(
        statistic=positive,
        p_value=float(outcome.pvalue),
        n_effective=int(nonzero.size),
        rank_biserial=effect,
    )


def rank_correlation(first: Sequence[float], second: Sequence[float]) -> RankCorrelation:
    left = _require_vector(first, "first")
    right = _require_vector(second, "second")
    if left.size != right.size:
        raise DomainInvariantError("correlated series must share one length")
    if left.size < MIN_SPEARMAN_SAMPLES:
        raise DomainInvariantError(f"at least {MIN_SPEARMAN_SAMPLES} samples are required")
    if np.ptp(left) <= 0.0 or np.ptp(right) <= 0.0:
        raise DomainInvariantError("constant series have undefined rank correlation")
    outcome = spearmanr(left, right)
    rho = float(outcome.statistic)
    if not math.isfinite(rho):
        raise DomainInvariantError("rank correlation is undefined")
    return RankCorrelation(rho=rho, p_value=float(outcome.pvalue), n=int(left.size))


def knee_point(xs: Sequence[float], ys: Sequence[float]) -> KneePoint | None:
    axis = _require_vector(xs, "xs")
    values = _require_vector(ys, "ys")
    if axis.size != values.size:
        raise DomainInvariantError("xs and ys must share one length")
    if axis.size < 3:
        raise DomainInvariantError("at least three points are required")
    if not np.all(np.diff(axis) > 0.0):
        raise DomainInvariantError("xs must be strictly increasing")
    span_x = float(axis[-1] - axis[0])
    span_y = float(np.max(values) - np.min(values))
    if span_y <= KNEE_TOLERANCE:
        return None
    normalized_x = (axis - axis[0]) / span_x
    normalized_y = (values - np.min(values)) / span_y
    chord = normalized_y[0] + (normalized_y[-1] - normalized_y[0]) * normalized_x
    distances = normalized_y - chord
    best = int(np.argmax(distances))
    if float(distances[best]) <= KNEE_TOLERANCE:
        return None
    return KneePoint(
        index=best,
        x=float(axis[best]),
        y=float(values[best]),
        distance=float(distances[best]),
    )


def holm_adjust(p_values: Sequence[float]) -> tuple[float, ...]:
    items = tuple(_require_probability(float(value), "p_value") for value in p_values)
    if not items:
        return ()
    count = len(items)
    order = sorted(range(count), key=items.__getitem__)
    adjusted: list[float] = [0.0] * count
    running = 0.0
    for rank, index in enumerate(order):
        candidate = min(1.0, items[index] * (count - rank))
        running = max(running, candidate)
        adjusted[index] = running
    return tuple(adjusted)