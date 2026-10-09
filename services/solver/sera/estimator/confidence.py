from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from statistics import NormalDist
from typing import Final

import numpy as np
from scipy.special import expit
from scipy.stats import chi2

from sera.core.types import (
    DomainInvariantError,
    Interval,
    require_finite,
    require_non_negative,
    require_positive,
)
from sera.estimator.ekf import GaussianState, Innovation
from sera.estimator.state import StorageEstimate

DEFAULT_LEVEL: Final = 0.95
_STANDARD_NORMAL: Final = NormalDist()


def _require_confidence_level(level: float) -> float:
    if isinstance(level, bool) or not isinstance(level, (int, float)):
        raise DomainInvariantError("level must be a number")
    value = float(level)
    if not 0.0 < value < 1.0:
        raise DomainInvariantError("level must lie in (0, 1)")
    return value


def standard_normal_multiplier(level: float = DEFAULT_LEVEL) -> float:
    confidence = _require_confidence_level(level)
    return float(_STANDARD_NORMAL.inv_cdf(1.0 - (1.0 - confidence) / 2.0))


def gaussian_interval(
    mean: float,
    std: float,
    level: float = DEFAULT_LEVEL,
) -> Interval:
    center = require_finite(mean, "mean")
    spread = require_non_negative(std, "std")
    multiplier = standard_normal_multiplier(level)
    return Interval(center - multiplier * spread, center + multiplier * spread)


def confidence_score(std: float, tolerance: float) -> float:
    spread = require_non_negative(std, "std")
    scale = require_positive(tolerance, "tolerance")
    if spread == 0.0:
        return 1.0
    ratio = scale / spread
    return float(_STANDARD_NORMAL.cdf(ratio) - _STANDARD_NORMAL.cdf(-ratio))


def nis_threshold(dof: int, level: float = DEFAULT_LEVEL) -> float:
    if isinstance(dof, bool) or not isinstance(dof, int) or dof < 1:
        raise DomainInvariantError("dof must be a positive integer")
    confidence = _require_confidence_level(level)
    return float(chi2.ppf(confidence, dof))


@dataclass(frozen=True, slots=True)
class NisVerdict:
    nis: float
    threshold: float
    level: float
    dof: int

    def __post_init__(self) -> None:
        require_non_negative(self.nis, "nis")
        require_positive(self.threshold, "threshold")
        _require_confidence_level(self.level)
        if isinstance(self.dof, bool) or not isinstance(self.dof, int) or self.dof < 1:
            raise DomainInvariantError("dof must be a positive integer")

    @property
    def is_consistent(self) -> bool:
        return self.nis <= self.threshold


def check_innovation(
    innovation: Innovation,
    level: float = DEFAULT_LEVEL,
) -> NisVerdict:
    dof = innovation.dimension
    return NisVerdict(
        nis=innovation.nis,
        threshold=nis_threshold(dof, level),
        level=_require_confidence_level(level),
        dof=dof,
    )


def bounded_interval(
    mean: float,
    std: float,
    *,
    lower: float,
    upper: float,
    level: float = DEFAULT_LEVEL,
) -> Interval:
    floor = require_finite(lower, "lower")
    ceiling = require_finite(upper, "upper")
    if ceiling < floor:
        raise DomainInvariantError("upper must be >= lower")
    interval = gaussian_interval(mean, std, level)
    clipped_low = min(max(interval.lower, floor), ceiling)
    clipped_high = max(min(interval.upper, ceiling), floor)
    return Interval(clipped_low, clipped_high)


def marginal_interval(
    gaussian: GaussianState,
    index: int,
    level: float = DEFAULT_LEVEL,
) -> Interval:
    if isinstance(index, bool) or not isinstance(index, int):
        raise DomainInvariantError("index must be an integer")
    if index < 0 or index >= gaussian.dimension:
        raise DomainInvariantError("index is outside the state dimension")
    variances = np.diag(gaussian.covariance)
    std = float(np.sqrt(max(float(variances[index]), 0.0)))
    return gaussian_interval(float(gaussian.mean[index]), std, level)


def eta_interval(
    z_mean: float,
    z_std: float,
    level: float = DEFAULT_LEVEL,
) -> Interval:
    center = require_finite(z_mean, "z_mean")
    spread = require_non_negative(z_std, "z_std")
    multiplier = standard_normal_multiplier(level)
    return Interval(
        float(expit(center - multiplier * spread)),
        float(expit(center + multiplier * spread)),
    )


def storage_intervals(
    estimate: StorageEstimate,
    level: float = DEFAULT_LEVEL,
) -> dict[str, Interval]:
    intervals: dict[str, Interval] = {}
    for position, block_id in enumerate(estimate.block_ids):
        std = float(np.sqrt(max(float(estimate.variances_mm2[position]), 0.0)))
        intervals[block_id] = gaussian_interval(float(estimate.means_mm[position]), std, level)
    return intervals


def coverage_rate(
    intervals: Sequence[Interval],
    truths: Sequence[float],
) -> float:
    if len(intervals) != len(truths):
        raise DomainInvariantError("intervals and truths must share one length")
    if not intervals:
        raise DomainInvariantError("at least one interval is required")
    covered = 0
    for interval, truth in zip(intervals, truths, strict=True):
        value = require_finite(truth, "truth")
        if interval.contains(value):
            covered += 1
    return covered / len(intervals)


def calibration_error(
    intervals: Sequence[Interval],
    truths: Sequence[float],
    level: float = DEFAULT_LEVEL,
) -> float:
    confidence = _require_confidence_level(level)
    return abs(coverage_rate(intervals, truths) - confidence)
