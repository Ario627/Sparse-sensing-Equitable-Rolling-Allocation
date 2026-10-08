from __future__ import annotations

from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

import numpy as np  # type: ignore

from app.core.types import DomainInvariantError, require_positive

DEFAULT_MIN_EIGENVALUE: Final = 1.0e-8
DEFAULT_MAX_CONDITION_NUMBER: Final = 1.0e8


def _require_square(matrix: np.ndarray, name: str) -> np.ndarray:
    values = np.asarray(matrix, dtype=float)
    if values.ndim != 2 or values.shape[0] != values.shape[1]:
        raise DomainInvariantError(f"{name} must be a square matrix")
    if not np.all(np.isfinite(values)):
        raise DomainInvariantError(f"{name} must be finite")
    return values


def information_contribution(
    observation_jacobian: np.ndarray,
    measurement_covariance: np.ndarray,
) -> np.ndarray:
    jacobian = np.asarray(observation_jacobian, dtype=float)
    if jacobian.ndim != 2:
        raise DomainInvariantError("observation_jacobian must be two-dimensional")
    if not np.all(np.isfinite(jacobian)):
        raise DomainInvariantError("observation_jacobian must be finite")
    noise = _require_square(measurement_covariance, "measurement_covariance")
    if noise.shape[0] != jacobian.shape[0]:
        raise DomainInvariantError("measurement_covariance must match the observation dimension")
    try:
        solved = np.linalg.solve(noise, jacobian)
    except np.linalg.LinAlgError as error:
        raise DomainInvariantError("measurement_covariance is singular") from error
    contribution = jacobian.T @ solved
    return (contribution + contribution.T) / 2.0


def information_matrix(contributions: Sequence[np.ndarray]) -> np.ndarray:
    if not contributions:
        raise DomainInvariantError("at least one information contribution is required")
    total = np.zeros_like(_require_square(contributions[0], "information contribution"))
    for matrix in contributions:
        current = _require_square(matrix, "information contribution")
        if current.shape != total.shape:
            raise DomainInvariantError("information contributions must share one shape")
        total += current
    return (total + total.T) / 2.0


@dataclass(frozen=True, slots=True)
class IdentifiabilityThresholds:
    min_eigenvalue: float = DEFAULT_MIN_EIGENVALUE
    max_condition_number: float = DEFAULT_MAX_CONDITION_NUMBER

    def __post_init__(self) -> None:
        require_positive(self.min_eigenvalue, "min_eigenvalue")
        require_positive(self.max_condition_number, "max_condition_number")


class IdentifiabilityFailure(StrEnum):
    RANK_DEFICIENT = "RANK_DEFICIENT"
    WEAK_EIGENVALUE = "WEAK_EIGENVALUE"
    ILL_CONDITIONED = "ILL_CONDITIONED"


@dataclass(frozen=True, slots=True)
class IdentifiabilityReport:
    dimension: int
    expected_rank: int
    rank: int
    eigenvalues: tuple[float, ...]
    condition_number: float
    failures: tuple[IdentifiabilityFailure, ...]
    weakest_direction: tuple[float, ...]

    def __post_init__(self) -> None:
        if self.dimension < 1:
            raise DomainInvariantError("dimension must be positive")
        if len(self.eigenvalues) != self.dimension:
            raise DomainInvariantError("eigenvalues must match the dimension")
        if len(self.weakest_direction) != self.dimension:
            raise DomainInvariantError("weakest_direction must match the dimension")
        if self.expected_rank < 0 or self.expected_rank > self.dimension:
            raise DomainInvariantError("expected_rank must lie in [0, dimension]")
        if self.rank < 0 or self.rank > self.dimension:
            raise DomainInvariantError("rank must lie in [0, dimension]")

    @property
    def passed(self) -> bool:
        return not self.failures

    @property
    def min_eigenvalue(self) -> float:
        return self.eigenvalues[0] if self.eigenvalues else 0.0

    @classmethod
    def assess(
        cls,
        matrix: np.ndarray,
        thresholds: IdentifiabilityThresholds | None = None,
        *,
        expected_rank: int | None = None,
    ) -> IdentifiabilityReport:
        active = thresholds if thresholds is not None else IdentifiabilityThresholds()
        values = _require_square(matrix, "information matrix")
        dimension = int(values.shape[0])
        target_rank = dimension if expected_rank is None else expected_rank
        if target_rank < 0 or target_rank > dimension:
            raise DomainInvariantError("expected_rank must lie in [0, dimension]")
        symmetric = (values + values.T) / 2.0
        eigenvalues, eigenvectors = np.linalg.eigh(symmetric)
        rank = int(np.linalg.matrix_rank(symmetric))
        condition_number = float(np.linalg.cond(symmetric))
        failures: list[IdentifiabilityFailure] = []
        if rank < target_rank:
            failures.append(IdentifiabilityFailure.RANK_DEFICIENT)
        if float(eigenvalues[0]) < active.min_eigenvalue:
            failures.append(IdentifiabilityFailure.WEAK_EIGENVALUE)
        if condition_number > active.max_condition_number:
            failures.append(IdentifiabilityFailure.ILL_CONDITIONED)
        return cls(
            dimension=dimension,
            expected_rank=target_rank,
            rank=rank,
            eigenvalues=tuple(float(value) for value in eigenvalues),
            condition_number=condition_number,
            failures=tuple(failures),
            weakest_direction=tuple(float(value) for value in eigenvectors[:, 0]),
        )


class InformationWindow:
    def __init__(self, window: int) -> None:
        if isinstance(window, bool) or not isinstance(window, int) or window < 1:
            raise DomainInvariantError("window must be a positive integer")
        self._window = window
        self._contributions: deque[np.ndarray] = deque(maxlen=window)

    @property
    def window(self) -> int:
        return self._window

    @property
    def size(self) -> int:
        return len(self._contributions)

    def add(self, contribution: np.ndarray) -> None:
        self._contributions.append(_require_square(contribution, "information contribution"))

    def matrix(self) -> np.ndarray:
        return information_matrix(tuple(self._contributions))

    def assess(
        self,
        thresholds: IdentifiabilityThresholds | None = None,
        *,
        expected_rank: int | None = None,
    ) -> IdentifiabilityReport:
        return IdentifiabilityReport.assess(
            self.matrix(),
            thresholds,
            expected_rank=expected_rank,
        )
