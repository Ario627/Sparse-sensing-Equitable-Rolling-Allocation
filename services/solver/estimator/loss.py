from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Final

import numpy as np # type: ignore
from scipy.special import expit, logit # type: ignore

from app.core.types import (
    DomainInvariantError,
    LossZone,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
    require_unit_open_closed,
)
from app.core.units import volume_m3_to_storage_mm
from estimator.ekf import GaussianState, diagonal_covariance
from estimator.observations import MeasurementBatch

CONTROL_TAIL_SIZE: Final = 3
MIN_ETA: Final = 1.0e-12
MIN_LOG_EFFICIENCY: Final = -700.0


def _z_and_counts(z: np.ndarray, counts: Sequence[int]) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(z, dtype=float)
    if values.ndim != 1:
        raise DomainInvariantError("z must be one-dimensional")
    if not np.all(np.isfinite(values)):
        raise DomainInvariantError("z must be finite")
    tally = np.asarray(counts, dtype=float)
    if tally.ndim != 1 or tally.size != values.size:
        raise DomainInvariantError("counts must match the z dimension")
    if float(tally.sum()) < 1.0:
        raise DomainInvariantError("counts must reference at least one edge")
    return values, tally


@dataclass(frozen=True, slots=True)
class LossGroupSpec:
    group_ids: tuple[str, ...]
    zone_to_group: Mapping[LossZone, str]

    def __post_init__(self) -> None:
        if not self.group_ids:
            raise DomainInvariantError("group_ids must not be empty")
        for group_id in self.group_ids:
            require_identifier(group_id, "group_id")
        require_unique(self.group_ids, "group_id")
        known = set(self.group_ids)
        for zone, group in self.zone_to_group.items():
            if group not in known:
                raise DomainInvariantError(
                    f"zone {zone} maps to unknown group {group!r}"
                )

    @classmethod
    def per_zone(cls, zones: Sequence[LossZone]) -> LossGroupSpec:
        matched = tuple(dict.fromkeys(zones))
        return cls(
            group_ids=tuple(zone.value for zone in matched),
            zone_to_group={zone: zone.value for zone in matched},
        )

    @classmethod
    def single_group(cls, name: str = "ALL") -> LossGroupSpec:
        require_identifier(name, "name")
        return cls(
            group_ids=(name,),
            zone_to_group={zone: name for zone in LossZone},
        )

    def group_index(self, group_id: str) -> int:
        try:
            return self.group_ids.index(group_id)
        except ValueError as error:
            raise DomainInvariantError(f"unknown loss group: {group_id}") from error


@dataclass(frozen=True, slots=True)
class JointControl:
    gross_base_mm: tuple[float, ...]
    etc_mm: tuple[float, ...]
    effective_rain_mm: float = 0.0
    percolation_mm: float = 0.0
    wlr_mm: float = 0.0

    def __post_init__(self) -> None:
        if len(self.gross_base_mm) != len(self.etc_mm):
            raise DomainInvariantError(
                "gross_base_mm and etc_mm must share one length"
            )
        for value in self.gross_base_mm:
            require_non_negative(value, "gross_base_mm")
        for value in self.etc_mm:
            require_non_negative(value, "etc_mm")
        require_non_negative(self.effective_rain_mm, "effective_rain_mm")
        require_non_negative(self.percolation_mm, "percolation_mm")
        require_non_negative(self.wlr_mm, "wlr_mm")

    @property
    def block_count(self) -> int:
        return len(self.gross_base_mm)

    def as_vector(self) -> np.ndarray:
        return np.array(
            (
                *self.gross_base_mm,
                *self.etc_mm,
                self.effective_rain_mm,
                self.percolation_mm,
                self.wlr_mm,
            ),
            dtype=float,
        )


def gross_base_mm_by_block(
    gross_m3_by_block: Mapping[str, float],
    area_m2_by_block: Mapping[str, float],
) -> dict[str, float]:
    base: dict[str, float] = {}
    for block_id, gross_m3 in gross_m3_by_block.items():
        require_identifier(block_id, "block_id")
        if block_id not in area_m2_by_block:
            raise DomainInvariantError(f"missing area for block: {block_id}")
        base[block_id] = volume_m3_to_storage_mm(
            require_non_negative(gross_m3, f"gross_m3[{block_id}]"),
            area_m2_by_block[block_id],
        )
    return base


def group_edge_counts(
    path_edges: Mapping[str, Sequence[str]],
    edge_zone: Mapping[str, LossZone],
    spec: LossGroupSpec,
) -> dict[str, tuple[int, ...]]:
    counts: dict[str, tuple[int, ...]] = {}
    for block_id, edges in path_edges.items():
        require_identifier(block_id, "block_id")
        if not edges:
            raise DomainInvariantError(
                f"path for {block_id} must contain at least one edge"
            )
        tally = [0] * len(spec.group_ids)
        for edge_id in edges:
            zone = edge_zone.get(edge_id)
            if zone is None:
                raise DomainInvariantError(f"missing zone for edge: {edge_id}")
            group = spec.zone_to_group.get(zone)
            if group is None:
                raise DomainInvariantError(
                    f"zone {zone} is not mapped by the loss group spec"
                )
            tally[spec.group_index(group)] += 1
        counts[block_id] = tuple(tally)
    return counts


def path_efficiency_from_z(z: np.ndarray, counts: Sequence[int]) -> float:
    values, tally = _z_and_counts(z, counts)
    eta = np.clip(expit(values), MIN_ETA, 1.0)
    log_efficiency = float(np.dot(tally, np.log(eta)))
    return float(np.exp(max(log_efficiency, MIN_LOG_EFFICIENCY)))


def path_efficiency_z_gradient(
    z: np.ndarray,
    counts: Sequence[int],
) -> np.ndarray:
    values, tally = _z_and_counts(z, counts)
    eta = np.clip(expit(values), MIN_ETA, 1.0)
    efficiency = path_efficiency_from_z(values, counts)
    return efficiency * tally * (1.0 - eta)


@dataclass(frozen=True, slots=True)
class JointStorageLossModel:
    block_ids: tuple[str, ...]
    group_ids: tuple[str, ...]
    counts: tuple[tuple[int, ...], ...]
    measured_block_ids: tuple[str, ...]
    s_max_mm: float

    def __post_init__(self) -> None:
        if not self.block_ids:
            raise DomainInvariantError("block_ids must not be empty")
        if not self.group_ids:
            raise DomainInvariantError("group_ids must not be empty")
        require_unique(self.block_ids, "block_id")
        require_unique(self.group_ids, "group_id")
        if len(self.counts) != len(self.block_ids):
            raise DomainInvariantError("counts must align with block_ids")
        group_count = len(self.group_ids)
        for tally in self.counts:
            if len(tally) != group_count:
                raise DomainInvariantError("counts must align with group_ids")
            for count in tally:
                if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                    raise DomainInvariantError(
                        "counts must contain non-negative integers"
                    )
            if sum(tally) < 1:
                raise DomainInvariantError(
                    "each block must traverse at least one edge"
                )
        require_unique(self.measured_block_ids, "measured_block_id")
        known = set(self.block_ids)
        for block_id in self.measured_block_ids:
            if block_id not in known:
                raise DomainInvariantError(f"measured block is not modeled: {block_id}")
        require_positive(self.s_max_mm, "s_max_mm")

    @property
    def n_blocks(self) -> int:
        return len(self.block_ids)

    @property
    def n_groups(self) -> int:
        return len(self.group_ids)

    @property
    def dimension(self) -> int:
        return self.n_blocks + self.n_groups

    @property
    def measurement_dimension(self) -> int:
        return len(self.measured_block_ids)

    def _measured_positions(self) -> tuple[int, ...]:
        return tuple(
            self.block_ids.index(block_id) for block_id in self.measured_block_ids
        )

    def _validated_state(self, state: np.ndarray) -> np.ndarray:
        vector = np.asarray(state, dtype=float)
        if vector.shape != (self.dimension,):
            raise DomainInvariantError(
                f"state must have shape ({self.dimension},), got {vector.shape}"
            )
        if not np.all(np.isfinite(vector)):
            raise DomainInvariantError("state must be finite")
        return vector

    def _unpack_control(
        self, control: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, float, float, float]:
        vector = np.asarray(control, dtype=float)
        expected = 2 * self.n_blocks + CONTROL_TAIL_SIZE
        if vector.shape != (expected,):
            raise DomainInvariantError(
                f"control must have shape ({expected},), got {vector.shape}"
            )
        if not np.all(np.isfinite(vector)):
            raise DomainInvariantError("control must be finite")
        blocks = self.n_blocks
        return (
            vector[:blocks],
            vector[blocks : 2 * blocks],
            float(vector[2 * blocks]),
            float(vector[2 * blocks + 1]),
            float(vector[2 * blocks + 2]),
        )

    def with_measurements(
        self, measured_block_ids: tuple[str, ...]
    ) -> JointStorageLossModel:
        return replace(self, measured_block_ids=tuple(measured_block_ids))

    def transition(self, state: np.ndarray, control: np.ndarray) -> np.ndarray:
        vector = self._validated_state(state)
        z = vector[self.n_blocks :]
        base, etc, rain, percolation, wlr = self._unpack_control(control)
        updated = np.empty(self.dimension, dtype=float)
        for position in range(self.n_blocks):
            efficiency = path_efficiency_from_z(z, self.counts[position])
            predicted = (
                float(vector[position])
                + float(base[position]) * efficiency
                + rain
                - float(etc[position])
                - percolation
                - wlr
            )
            updated[position] = min(max(predicted, 0.0), self.s_max_mm)
        updated[self.n_blocks :] = z
        return updated

    def transition_jacobian(self, state: np.ndarray, control: np.ndarray) -> np.ndarray:
        vector = self._validated_state(state)
        z = vector[self.n_blocks :]
        base, _, _, _, _ = self._unpack_control(control)
        jacobian = np.eye(self.dimension)
        for position in range(self.n_blocks):
            if float(base[position]) <= 0.0:
                continue
            gradient = path_efficiency_z_gradient(z, self.counts[position])
            jacobian[position, self.n_blocks :] = float(base[position]) * gradient
        return jacobian

    def observe(self, state: np.ndarray) -> np.ndarray:
        vector = self._validated_state(state)
        return np.array(
            [float(vector[position]) for position in self._measured_positions()],
            dtype=float,
        )

    def observation_jacobian(self, state: np.ndarray) -> np.ndarray:
        self._validated_state(state)
        matrix = np.zeros((self.measurement_dimension, self.dimension), dtype=float)
        for row, position in enumerate(self._measured_positions()):
            matrix[row, position] = 1.0
        return matrix


def build_joint_model(
    path_edges: Mapping[str, Sequence[str]],
    edge_zone: Mapping[str, LossZone],
    *,
    block_ids: Sequence[str],
    measured_block_ids: Sequence[str],
    group_spec: LossGroupSpec,
    s_max_mm: float,
) -> JointStorageLossModel:
    ordered_blocks = tuple(block_ids)
    require_unique(ordered_blocks, "block_id")
    counts_by_block = group_edge_counts(path_edges, edge_zone, group_spec)
    missing = [block_id for block_id in ordered_blocks if block_id not in counts_by_block]
    if missing:
        raise DomainInvariantError(f"missing path counts for blocks: {missing}")
    return JointStorageLossModel(
        block_ids=ordered_blocks,
        group_ids=group_spec.group_ids,
        counts=tuple(counts_by_block[block_id] for block_id in ordered_blocks),
        measured_block_ids=tuple(measured_block_ids),
        s_max_mm=s_max_mm,
    )


def joint_process_covariance(
    model: JointStorageLossModel,
    *,
    storage_sigma_mm: float,
    drift_sigma_logit: float,
) -> np.ndarray:
    storage_sigma = require_positive(storage_sigma_mm, "storage_sigma_mm")
    drift_sigma = require_positive(drift_sigma_logit, "drift_sigma_logit")
    variances = [storage_sigma * storage_sigma] * model.n_blocks + [
        drift_sigma * drift_sigma
    ] * model.n_groups
    return diagonal_covariance(variances)


def initial_joint_state(
    model: JointStorageLossModel,
    *,
    initial_storage_mm: float = 50.0,
    storage_sigma_mm: float = 15.0,
    initial_eta: float = 0.9,
    eta_sigma_logit: float = 0.5,
) -> GaussianState:
    storage = require_non_negative(initial_storage_mm, "initial_storage_mm")
    storage_sigma = require_positive(storage_sigma_mm, "storage_sigma_mm")
    eta = require_unit_open_closed(initial_eta, "initial_eta")
    eta_sigma = require_positive(eta_sigma_logit, "eta_sigma_logit")
    center = float(logit(eta))
    mean = np.array(
        [storage] * model.n_blocks + [center] * model.n_groups, dtype=float
    )
    variances = [storage_sigma * storage_sigma] * model.n_blocks + [
        eta_sigma * eta_sigma
    ] * model.n_groups
    return GaussianState(mean=mean, covariance=diagonal_covariance(variances))


@dataclass(frozen=True, slots=True)
class JointEstimateView:
    storage_mm: dict[str, float]
    storage_std_mm: dict[str, float]
    eta_by_group: dict[str, float]
    z_by_group: dict[str, float]

    @classmethod
    def from_state(
        cls,
        model: JointStorageLossModel,
        state: GaussianState,
    ) -> JointEstimateView:
        if state.dimension != model.dimension:
            raise DomainInvariantError("state dimension does not match the model")
        covariance = state.covariance
        storage_mm: dict[str, float] = {}
        storage_std_mm: dict[str, float] = {}
        for position, block_id in enumerate(model.block_ids):
            storage_mm[block_id] = float(state.mean[position])
            storage_std_mm[block_id] = float(
                np.sqrt(max(float(covariance[position, position]), 0.0))
            )
        eta_by_group: dict[str, float] = {}
        z_by_group: dict[str, float] = {}
        for offset, group_id in enumerate(model.group_ids):
            position = model.n_blocks + offset
            z_value = float(state.mean[position])
            z_by_group[group_id] = z_value
            eta_by_group[group_id] = float(expit(z_value))
        return cls(
            storage_mm=storage_mm,
            storage_std_mm=storage_std_mm,
            eta_by_group=eta_by_group,
            z_by_group=z_by_group,
        )


@dataclass(frozen=True, slots=True)
class PreparedMeasurement:
    model: JointStorageLossModel
    values_mm: np.ndarray
    variances_mm2: np.ndarray


def prepare_measurement(
    model: JointStorageLossModel,
    batch: MeasurementBatch,
) -> PreparedMeasurement | None:
    unknown = tuple(
        sorted(
            block_id
            for block_id in batch.block_ids
            if block_id not in model.measured_block_ids
        )
    )
    if unknown:
        raise DomainInvariantError(
            f"measurement batch contains blocks outside the model: {list(unknown)}"
        )
    available = tuple(
        block_id
        for block_id in model.measured_block_ids
        if batch.contains(block_id)
    )
    if not available:
        return None
    restricted = model.with_measurements(available)
    values = np.array(
        [float(batch.values_mm[batch.index_of(block_id)]) for block_id in available],
        dtype=float,
    )
    variances = np.array(
        [
            float(batch.variances_mm2[batch.index_of(block_id)])
            for block_id in available
        ],
        dtype=float,
    )
    return PreparedMeasurement(model=restricted, values_mm=values, variances_mm2=variances)