from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Final, cast

import numpy as np  # type: ignore
from fastapi import APIRouter  # type: ignore
from pydantic import JsonValue  # type: ignore

from .network_payload import network_spec_from_payload
from api.schemas import (
    BlockStateEntry,
    EstimateDiagnostics,
    EstimateRequest,
    EstimateResponse,
    IdentifiabilitySummary,
    IntervalPayload,
    LossEntry,
    NetworkPayload,
)
from api.water_model import full_sensing_model
from app.core.types import DomainInvariantError, LossZone, SensorKind
from estimator.confidence import (
    DEFAULT_LEVEL,
    bounded_interval,
    check_innovation,
    confidence_score,
    eta_interval,
    gaussian_interval,
)
from estimator.ekf import GaussianState, Innovation, ekf_update
from estimator.identifiability import IdentifiabilityReport, information_contribution
from estimator.loss import (
    JointEstimateView,
    JointStorageLossModel,
    PreparedMeasurement,
    initial_joint_state,
    prepare_measurement,
)
from estimator.observations import (
    DEFAULT_ASSUMED_SIGMA_MM,
    LevelReading,
    LevelReadingLike,
    MeasurementBatch,
    build_measurement_batch,
)
from estimator.state import (
    DEFAULT_INITIAL_SIGMA_MM,
    DEFAULT_INITIAL_STORAGE_MM,
    StorageDynamicsParams,
    StorageEstimate,
    correct_storage,
)
from simulator.network import NetworkIndex

DEFAULT_CONFIDENCE_TOLERANCE_MM: Final = 5.0
PRIOR_ETA_DEFAULT: Final = 0.9
PRIOR_ETA_SIGMA_LOGIT_DEFAULT: Final = 0.5
PARAM_KEYS: Final = frozenset(
    {
        "assumed_sigma_mm",
        "confidence_level",
        "confidence_tolerance_mm",
        "prior_storage_mm",
        "prior_storage_sigma_mm",
        "prior_eta",
        "prior_eta_sigma_logit",
        "s_max_mm",
        "percolation_mm_per_day",
        "wlr_mm_per_day",
        "process_sigma_mm_per_slot",
    }
)


def _number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"{name} must be a number")
    return float(value)


def _number_param(params: Mapping[str, JsonValue], key: str) -> float | None:
    if key not in params:
        return None
    return _number(params[key], key)


def _override(value: float | None, default: float) -> float:
    return default if value is None else value


@dataclass(frozen=True, slots=True)
class _EstimateTuning:
    assumed_sigma_mm: float
    confidence_level: float
    confidence_tolerance_mm: float
    prior_storage_mm: float
    prior_storage_sigma_mm: float
    prior_eta: float
    prior_eta_sigma_logit: float
    dynamics: StorageDynamicsParams


@dataclass(frozen=True, slots=True)
class ReadingSet:
    readings: tuple[LevelReading, ...]
    sensor_block_of: Mapping[str, str]
    total: int

    @property
    def used(self) -> int:
        return len(self.readings)

    @property
    def ignored(self) -> int:
        return self.total - len(self.readings)


def _tuning(params: Mapping[str, JsonValue]) -> _EstimateTuning:
    unknown = sorted(set(params) - PARAM_KEYS)
    if unknown:
        raise DomainInvariantError(f"unknown estimate params: {unknown}")
    base = StorageDynamicsParams()
    dynamics = replace(
        base,
        percolation_mm_per_day=_override(
            _number_param(params, "percolation_mm_per_day"),
            base.percolation_mm_per_day,
        ),
        wlr_mm_per_day=_override(_number_param(params, "wlr_mm_per_day"), base.wlr_mm_per_day),
        s_max_mm=_override(_number_param(params, "s_max_mm"), base.s_max_mm),
        process_sigma_mm_per_slot=_override(
            _number_param(params, "process_sigma_mm_per_slot"),
            base.process_sigma_mm_per_slot,
        ),
    )
    return _EstimateTuning(
        assumed_sigma_mm=_override(
            _number_param(params, "assumed_sigma_mm"), DEFAULT_ASSUMED_SIGMA_MM
        ),
        confidence_level=_override(_number_param(params, "confidence_level"), DEFAULT_LEVEL),
        confidence_tolerance_mm=_override(
            _number_param(params, "confidence_tolerance_mm"),
            DEFAULT_CONFIDENCE_TOLERANCE_MM,
        ),
        prior_storage_mm=_override(
            _number_param(params, "prior_storage_mm"), DEFAULT_INITIAL_STORAGE_MM
        ),
        prior_storage_sigma_mm=_override(
            _number_param(params, "prior_storage_sigma_mm"), DEFAULT_INITIAL_SIGMA_MM
        ),
        prior_eta=_override(_number_param(params, "prior_eta"), PRIOR_ETA_DEFAULT),
        prior_eta_sigma_logit=_override(
            _number_param(params, "prior_eta_sigma_logit"), PRIOR_ETA_SIGMA_LOGIT_DEFAULT
        ),
        dynamics=dynamics,
    )


def _collect_readings(request: EstimateRequest) -> ReadingSet:
    readings: list[LevelReading] = []
    mapping: dict[str, str] = {}
    for entry in request.observations:
        if entry.kind is not SensorKind.WATER_LEVEL or entry.target_id is None:
            continue
        previous = mapping.get(entry.sensor_id)
        if previous is not None and previous != entry.target_id:
            raise DomainInvariantError(f"sensor {entry.sensor_id!r} maps to multiple blocks")
        mapping[entry.sensor_id] = entry.target_id
        readings.append(
            LevelReading(sensor_id=entry.sensor_id, value=entry.value, quality=entry.quality)
        )
    return ReadingSet(
        readings=tuple(readings),
        sensor_block_of=MappingProxyType(mapping),
        total=len(request.observations),
    )


def _joint_prior(
    model: JointStorageLossModel,
    request: EstimateRequest,
    tuning: _EstimateTuning,
) -> GaussianState:
    prior = initial_joint_state(
        model,
        initial_storage_mm=tuning.prior_storage_mm,
        storage_sigma_mm=tuning.prior_storage_sigma_mm,
        initial_eta=tuning.prior_eta,
        eta_sigma_logit=tuning.prior_eta_sigma_logit,
    )
    previous = request.state_prev
    if previous is None:
        return prior
    means = np.array(prior.mean, dtype=float)
    covariance = np.array(prior.covariance, dtype=float)
    positions = {block_id: index for index, block_id in enumerate(model.block_ids)}
    for entry in previous.entries:
        position = positions.get(entry.block_id)
        if position is None:
            raise DomainInvariantError(f"state_prev references unknown block: {entry.block_id!r}")
        means[position] = entry.mean_mm
        variance = (
            tuning.prior_storage_sigma_mm * tuning.prior_storage_sigma_mm
            if entry.std_mm is None
            else entry.std_mm * entry.std_mm
        )
        covariance[position, position] = variance
    return GaussianState(mean=means, covariance=covariance)


def _joint_update(
    model: JointStorageLossModel,
    prior: GaussianState,
    batch: MeasurementBatch,
) -> tuple[GaussianState, Innovation | None, PreparedMeasurement | None]:
    prepared = prepare_measurement(model, batch)
    if prepared is None:
        return prior, None, None
    state, innovation = ekf_update(
        prepared.model,
        prior,
        prepared.values_mm,
        np.diag(prepared.variances_mm2),
    )
    return state, innovation, prepared


def _condition_number(value: float) -> float | None:
    return value if math.isfinite(value) else None


def _identifiability(
    prepared: PreparedMeasurement | None,
    state: GaussianState,
) -> IdentifiabilitySummary | None:
    if prepared is None:
        return None
    jacobian = prepared.model.observation_jacobian(state.mean)
    contribution = information_contribution(jacobian, np.diag(prepared.variances_mm2))
    report = IdentifiabilityReport.assess(contribution)
    return IdentifiabilitySummary(
        passed=report.passed,
        rank=report.rank,
        expected_rank=report.expected_rank,
        condition_number=_condition_number(report.condition_number),
        min_eigenvalue=max(report.min_eigenvalue, 0.0),
        failures=list(report.failures),
    )


def _storage_state_entries(
    model: JointStorageLossModel,
    state: GaussianState,
    s_max_mm: float,
    level: float,
) -> list[BlockStateEntry]:
    covariance = np.asarray(state.covariance, dtype=float)
    entries: list[BlockStateEntry] = []
    for position, block_id in enumerate(model.block_ids):
        mean = float(state.mean[position])
        std = math.sqrt(max(float(covariance[position, position]), 0.0))
        interval = bounded_interval(mean, std, lower=0.0, upper=s_max_mm, level=level)
        entries.append(
            BlockStateEntry(
                block_id=block_id,
                storage_mm=interval.clip(mean),
                std_mm=std,
                interval=IntervalPayload(lower=interval.lower, upper=interval.upper),
            )
        )
    return entries


def _loss_entries(
    model: JointStorageLossModel,
    state: GaussianState,
    level: float,
) -> list[LossEntry]:
    view = JointEstimateView.from_state(model, state)
    covariance = np.asarray(state.covariance, dtype=float)
    entries: list[LossEntry] = []
    for offset, group_id in enumerate(model.group_ids):
        position = model.n_blocks + offset
        z_std = math.sqrt(max(float(covariance[position, position]), 0.0))
        interval = eta_interval(view.z_by_group[group_id], z_std, level)
        entries.append(
            LossEntry(
                zone=LossZone(group_id),
                eta=view.eta_by_group[group_id],
                interval=IntervalPayload(lower=interval.lower, upper=interval.upper),
            )
        )
    return entries


def _confidence_from(stds: Sequence[float], tolerance: float) -> float:
    if not stds:
        return 1.0
    return min(confidence_score(std, tolerance) for std in stds)


def _matrix_payload(matrix: np.ndarray) -> list[list[float]]:
    return [[float(value) for value in row] for row in np.asarray(matrix, dtype=float)]


def _joint_response(
    request: EstimateRequest,
    network: NetworkPayload,
    readings: ReadingSet,
    tuning: _EstimateTuning,
) -> EstimateResponse:
    index = NetworkIndex.from_spec(network_spec_from_payload(network))
    model = full_sensing_model(index, s_max_mm=tuning.dynamics.s_max_mm)
    prior = _joint_prior(model, request, tuning)
    batch = build_measurement_batch(
        cast(Sequence[LevelReadingLike], readings.readings),
        readings.sensor_block_of,
        assumed_sigma_mm=tuning.assumed_sigma_mm,
    )
    state, innovation, prepared = _joint_update(model, prior, batch)
    view = JointEstimateView.from_state(model, state)
    verdict = None if innovation is None else check_innovation(innovation, tuning.confidence_level)
    slot_index = 0 if request.state_prev is None else request.state_prev.slot_index + 1
    diagnostics = EstimateDiagnostics(
        slot_index=slot_index,
        block_count=model.n_blocks,
        observations_used=readings.used if prepared is not None else 0,
        observations_ignored=readings.ignored if prepared is not None else readings.total,
        confidence_level=tuning.confidence_level,
        nis=None if innovation is None else innovation.nis,
        nis_threshold=None if verdict is None else verdict.threshold,
        nis_consistent=None if verdict is None else verdict.is_consistent,
        identifiability=_identifiability(prepared, state),
    )
    return EstimateResponse(
        request_id=request.request_id,
        network_id=request.network_id,
        state=_storage_state_entries(
            model, state, tuning.dynamics.s_max_mm, tuning.confidence_level
        ),
        covariance=_matrix_payload(state.covariance),
        loss=_loss_entries(model, state, tuning.confidence_level),
        confidence=_confidence_from(
            [view.storage_std_mm[block_id] for block_id in model.block_ids],
            tuning.confidence_tolerance_mm,
        ),
        diagnostics=diagnostics,
    )


def _storage_prior(
    request: EstimateRequest,
    tuning: _EstimateTuning,
) -> StorageEstimate:
    previous = request.state_prev
    if previous is None:
        raise DomainInvariantError("state_prev or network is required")
    return StorageEstimate(
        block_ids=tuple(entry.block_id for entry in previous.entries),
        means_mm=np.array([entry.mean_mm for entry in previous.entries], dtype=float),
        variances_mm2=np.array(
            [
                (
                    tuning.prior_storage_sigma_mm * tuning.prior_storage_sigma_mm
                    if entry.std_mm is None
                    else entry.std_mm * entry.std_mm
                )
                for entry in previous.entries
            ],
            dtype=float,
        ),
        slot_index=previous.slot_index,
    )


def _restricted_to(
    batch: MeasurementBatch,
    allowed: frozenset[str],
) -> MeasurementBatch:
    keep = [position for position, block_id in enumerate(batch.block_ids) if block_id in allowed]
    if not keep:
        return MeasurementBatch.empty()
    return MeasurementBatch(
        block_ids=tuple(batch.block_ids[position] for position in keep),
        values_mm=np.array([batch.values_mm[position] for position in keep], dtype=float),
        variances_mm2=np.array([batch.variances_mm2[position] for position in keep], dtype=float),
        qualities=tuple(batch.qualities[position] for position in keep),
    )


def _diagonal_payload(estimate: StorageEstimate) -> list[list[float]]:
    size = len(estimate.block_ids)
    return [
        [float(estimate.variances_mm2[row]) if row == column else 0.0 for column in range(size)]
        for row in range(size)
    ]


def _storage_response(
    request: EstimateRequest,
    readings: ReadingSet,
    tuning: _EstimateTuning,
) -> EstimateResponse:
    estimate = _storage_prior(request, tuning)
    batch = build_measurement_batch(
        cast(Sequence[LevelReadingLike], readings.readings),
        readings.sensor_block_of,
        assumed_sigma_mm=tuning.assumed_sigma_mm,
    )
    restricted = _restricted_to(batch, frozenset(estimate.block_ids))
    corrected = (
        estimate if restricted.is_empty else correct_storage(estimate, restricted, tuning.dynamics)
    )
    entries: list[BlockStateEntry] = []
    for position, block_id in enumerate(corrected.block_ids):
        mean = float(corrected.means_mm[position])
        std = corrected.std_of(block_id)
        interval = gaussian_interval(mean, std, tuning.confidence_level)
        entries.append(
            BlockStateEntry(
                block_id=block_id,
                storage_mm=max(mean, 0.0),
                std_mm=std,
                interval=IntervalPayload(lower=interval.lower, upper=interval.upper),
            )
        )
    diagnostics = EstimateDiagnostics(
        slot_index=estimate.slot_index + 1,
        block_count=len(corrected.block_ids),
        observations_used=0 if restricted.is_empty else readings.used,
        observations_ignored=readings.total if restricted.is_empty else readings.ignored,
        confidence_level=tuning.confidence_level,
    )
    return EstimateResponse(
        request_id=request.request_id,
        network_id=request.network_id,
        state=entries,
        covariance=_diagonal_payload(corrected),
        loss=[],
        confidence=_confidence_from(
            [corrected.std_of(block_id) for block_id in corrected.block_ids],
            tuning.confidence_tolerance_mm,
        ),
        diagnostics=diagnostics,
    )


router = APIRouter(tags=["estimate"])


@router.post("/v1/estimate", response_model=EstimateResponse)
def estimate(request: EstimateRequest) -> EstimateResponse:
    tuning = _tuning(request.params)
    readings = _collect_readings(request)
    network = request.network
    if network is not None:
        return _joint_response(request, network, readings, tuning)
    return _storage_response(request, readings, tuning)
