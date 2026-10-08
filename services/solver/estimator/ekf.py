from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Protocol

import numpy as np  # type: ignore

from app.core.types import DomainInvariantError

_SYMMETRY_TOLERANCE: Final = 1.0e-9
_PSD_TOLERANCE: Final = 1.0e-10


class NonlinearStateModel(Protocol):
    def transition(self, state: np.ndarray, control: np.ndarray) -> np.ndarray: ...

    def transition_jacobian(self, state: np.ndarray, control: np.ndarray) -> np.ndarray: ...

    def observe(self, state: np.ndarray) -> np.ndarray: ...

    def observation_jacobian(self, state: np.ndarray) -> np.ndarray: ...


def _frozen(array: np.ndarray) -> np.ndarray:
    frozen = np.array(array, dtype=float, copy=True)
    frozen.setflags(write=False)
    return frozen


def _require_matrix_shape(matrix: np.ndarray, shape: tuple[int, int], name: str) -> None:
    if matrix.shape != shape:
        raise DomainInvariantError(f"{name} must have shape {shape}, got {matrix.shape}")


def _require_vector_shape(vector: np.ndarray, size: int, name: str) -> None:
    if vector.shape != (size,):
        raise DomainInvariantError(f"{name} must have shape ({size},), got {vector.shape}")


def _repair_covariance(covariance: np.ndarray, name: str) -> np.ndarray:
    if not np.allclose(covariance, covariance.T, rtol=0.0, atol=_SYMMETRY_TOLERANCE):
        raise DomainInvariantError(f"{name} must be symmetric")
    symmetric = (covariance + covariance.T) / 2.0
    eigenvalues, eigenvectors = np.linalg.eigh(symmetric)
    if float(np.min(eigenvalues)) < -_PSD_TOLERANCE:
        raise DomainInvariantError(f"{name} is not positive semidefinite")
    clipped = np.clip(eigenvalues, 0.0, None)
    return (eigenvectors * clipped) @ eigenvectors.T


def diagonal_covariance(variances: Sequence[float]) -> np.ndarray:
    values = np.array(variances, dtype=float)
    if values.ndim != 1:
        raise DomainInvariantError("variances must be one-dimensional")
    if not np.all(np.isfinite(values)) or not np.all(values > 0.0):
        raise DomainInvariantError("variances must be finite and positive")
    return _frozen(np.diag(values))


@dataclass(frozen=True, slots=True, eq=False)
class GaussianState:
    mean: np.ndarray
    covariance: np.ndarray

    def __post_init__(self) -> None:
        if self.mean.ndim != 1:
            raise DomainInvariantError("mean must be one-dimensional")
        dimension = int(self.mean.size)
        _require_matrix_shape(self.covariance, (dimension, dimension), "covariance")
        if not np.all(np.isfinite(self.mean)):
            raise DomainInvariantError("mean must be finite")
        if not np.all(np.isfinite(self.covariance)):
            raise DomainInvariantError("covariance must be finite")
        repaired = _repair_covariance(np.asarray(self.covariance, dtype=float), "covariance")
        object.__setattr__(self, "mean", _frozen(self.mean))
        object.__setattr__(self, "covariance", _frozen(repaired))

    @property
    def dimension(self) -> int:
        return int(self.mean.size)


@dataclass(frozen=True, slots=True, eq=False)
class Innovation:
    residual: np.ndarray
    covariance: np.ndarray

    def __post_init__(self) -> None:
        if self.residual.ndim != 1:
            raise DomainInvariantError("residual must be one-dimensional")
        size = int(self.residual.size)
        _require_matrix_shape(self.covariance, (size, size), "innovation covariance")
        if not np.all(np.isfinite(self.residual)):
            raise DomainInvariantError("residual must be finite")
        repaired = _repair_covariance(
            np.asarray(self.covariance, dtype=float), "innovation covariance"
        )
        object.__setattr__(self, "residual", _frozen(self.residual))
        object.__setattr__(self, "covariance", _frozen(repaired))

    @property
    def dimension(self) -> int:
        return int(self.residual.size)

    @property
    def nis(self) -> float:
        try:
            solved = np.linalg.solve(self.covariance, self.residual)
        except np.linalg.LinAlgError as error:
            raise DomainInvariantError("innovation covariance is singular") from error
        return float(self.residual @ solved)


def ekf_predict(
    model: NonlinearStateModel,
    state: GaussianState,
    control: np.ndarray,
    process_covariance: np.ndarray,
) -> GaussianState:
    dimension = state.dimension
    _require_matrix_shape(process_covariance, (dimension, dimension), "process_covariance")
    predicted_mean = np.asarray(model.transition(state.mean, control), dtype=float)
    _require_vector_shape(predicted_mean, dimension, "transition result")
    transition_jacobian = np.asarray(model.transition_jacobian(state.mean, control), dtype=float)
    _require_matrix_shape(transition_jacobian, (dimension, dimension), "transition_jacobian")
    process = _repair_covariance(np.asarray(process_covariance, dtype=float), "process_covariance")
    covariance = transition_jacobian @ state.covariance @ transition_jacobian.T + process
    return GaussianState(mean=predicted_mean, covariance=covariance)


def ekf_update(
    model: NonlinearStateModel,
    state: GaussianState,
    measurement: np.ndarray,
    measurement_covariance: np.ndarray,
) -> tuple[GaussianState, Innovation]:
    measurement_vector = np.asarray(measurement, dtype=float)
    if measurement_vector.ndim != 1 or measurement_vector.size == 0:
        raise DomainInvariantError("measurement must be a non-empty vector")
    if not np.all(np.isfinite(measurement_vector)):
        raise DomainInvariantError("measurement must be finite")
    measurement_size = int(measurement_vector.size)
    _require_matrix_shape(
        measurement_covariance,
        (measurement_size, measurement_size),
        "measurement_covariance",
    )
    dimension = state.dimension
    noise = _repair_covariance(
        np.asarray(measurement_covariance, dtype=float), "measurement_covariance"
    )
    predicted_measurement = np.asarray(model.observe(state.mean), dtype=float)
    _require_vector_shape(predicted_measurement, measurement_size, "observation result")
    observation_jacobian = np.asarray(model.observation_jacobian(state.mean), dtype=float)
    _require_matrix_shape(
        observation_jacobian,
        (measurement_size, dimension),
        "observation_jacobian",
    )
    innovation_covariance = _repair_covariance(
        observation_jacobian @ state.covariance @ observation_jacobian.T + noise,
        "innovation covariance",
    )
    residual = measurement_vector - predicted_measurement
    try:
        gain = np.linalg.solve(
            innovation_covariance, (state.covariance @ observation_jacobian.T).T
        ).T
    except np.linalg.LinAlgError as error:
        raise DomainInvariantError("innovation covariance is singular") from error
    updated_mean = state.mean + gain @ residual
    residual_operator = np.eye(dimension) - gain @ observation_jacobian
    updated_covariance = (
        residual_operator @ state.covariance @ residual_operator.T + gain @ noise @ gain.T
    )
    return (
        GaussianState(mean=updated_mean, covariance=updated_covariance),
        Innovation(residual=residual, covariance=innovation_covariance),
    )
