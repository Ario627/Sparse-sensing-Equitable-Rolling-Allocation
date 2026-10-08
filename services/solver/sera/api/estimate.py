from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Final

import numpy as np # type: ignore
from fastapi import APIRouter # type: ignore
from pydantic import JsonValue # type: ignore

from sera.api.network_payload import network_spec_from_payload
from sera.api.schemas import (
    EstimateCovariance,
    EstimateDiagnostics,
    EstimateLossEntry,
    EstimatePreviousState,
    EstimateRequest,
    EstimateResponse,
    EstimateStateEntry,
    EstimateStateVector,
)
from sera.api.water_model import full_sensing_model
from sera.core.types import DomainInvariantError, LossZone, SensorKind
from sera.estimator.confidence import (
    DEFAULT_LEVEL,
    check_innovation,
    confidence_score,
    eta_interval,
)
from sera.estimator.ekf import GaussianState, Innovation, ekf_update
from sera.estimator.identifiability import (
    IdentifiabilityReport,
    IdentifiabilityThresholds,
    information_contribution,
)
from sera.estimator.loss import (
    JointEstimateView,
    JointStorageLossModel,
    PreparedMeasurement,
    initial_joint_state,
    prepare_measurement,
)
from sera.estimator.observations import (
    DEFAULT_ASSUMED_SIGMA_MM,
    LevelReading,
    build_measurement_batch,
)
from sera.estimator.state import (
    DEFAULT_INITIAL_SIGMA_MM,
    DEFAULT_INITIAL_STORAGE_MM,
    StorageDynamicsParams,
)
from sera.simulator.network import NetworkIndex

DEFAULT_CONFIDENCE_TOLERANCE_MM: Final = 5.0
DEFAULT_S_MAX_MM: Final = StorageDynamicsParams().s_max_mm
PRIOR_ETA_DEFAULT: Final = 0.9
PRIOR_ETA_SIGMA_LOGIT_DEFAULT: Final = 0.5
ESTIMATOR_METHOD: Final = "joint-ekf"
MIN_ETA: Final = 1.0e-12
SCHUR_RIDGE: Final = 1.0e-12
SCHUR_THRESHOLDS: Final = IdentifiabilityThresholds(
    min_eigenvalue=1.0e-10, max_condition_number=1.0e10
)
LOSS_UNOBSERVED_REASON: Final = "LOSS_PARAMETERS_UNOBSERVED"
GATE_FAILURE_REASON: Final = "IDENTIFIABILITY_GATE_FAILED"
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
        "window_minutes",
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


def _integer_param(params: Mapping[str, JsonValue], key: str) -> int | None:
    if key not in params:
        return None
    value = params[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise DomainInvariantError(f"{key} must be an integer")
    return value


@dataclass(frozen=True, slots=True)
class _EstimateTuning:
    assumed_sigma_mm: float
    confidence_level: float
    confidence_tolerance_mm: float
    prior_storage_mm: float
    prior_storage_sigma_mm: float
    prior_eta: float
    prior_eta_sigma_logit: float
    s_max_mm: float
    window_minutes: int | None


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
    window_minutes = _integer_param(params, "window_minutes")
    if window_minutes is not None and window_minutes < 1:
        raise DomainInvariantError("window_minutes must be a positive integer")
    return _EstimateTuning(
        assumed_sigma_mm=_override(_number_param(params, "assumed_sigma_mm"), DEFAULT_ASSUMED_SIGMA_MM),
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
        s_max_mm=_override(_number_param(params, "s_max_mm"), DEFAULT_S_MAX_MM),
        window_minutes=window_minutes,
    )


def _observation_kind(value: str) -> SensorKind | None:
    try:
        return SensorKind(value.strip().upper())
    except ValueError:
        return None


def _collect_readings(request: EstimateRequest) -> ReadingSet:
    readings: list[LevelReading] = []
    mapping: dict[str, str] = {}
    for entry in request.observations:
        if entry.block_id is None or _observation_kind(entry.type) is not SensorKind.WATER_LEVEL:
            continue
        previous = mapping.get(entry.sensor_id)
        if previous is not None and previous != entry.block_id:
            raise DomainInvariantError(f"sensor {entry.sensor_id!r} maps to multiple blocks")
        mapping[entry.sensor_id] = entry.block_id
        readings.append(
            LevelReading(sensor_id=entry.sensor_id, value=entry.value, quality=entry.quality)
        )
    return ReadingSet(
        readings=tuple(readings),
        sensor_block_of=MappingProxyType(mapping),
        total=len(request.observations),
    )


def _previous_std(covariance: JsonValue, block_id: str) -> float | None:
    if isinstance(covariance, bool):
        raise DomainInvariantError(f"state_prev[{block_id}].covariance must be a number or object")
    if isinstance(covariance, (int, float)):
        variance = float(covariance)
        if variance < 0.0:
            raise DomainInvariantError(f"state_prev[{block_id}].covariance must be non-negative")
        return math.sqrt(variance)
    if isinstance(covariance, Mapping):
        raw = covariance.get("variance_mm2")
        if raw is None:
            return None
        variance = _number(raw, f"state_prev[{block_id}].covariance.variance_mm2")
        if variance < 0.0:
            raise DomainInvariantError(f"state_prev[{block_id}].covariance must be non-negative")
        return math.sqrt(variance)
    return None


def _previous_storage(entry: EstimatePreviousState) -> tuple[float, float | None]:
    value = entry.state
    if isinstance(value, bool):
        raise DomainInvariantError(f"state_prev[{entry.block_id}].state must be a number or object")
    if isinstance(value, (int, float)):
        storage = float(value)
        std: float | None = None
    elif isinstance(value, Mapping):
        raw = value.get("storage_mm")
        if raw is None:
            raise DomainInvariantError(f"state_prev[{entry.block_id}].state must carry storage_mm")
        storage = _number(raw, f"state_prev[{entry.block_id}].state.storage_mm")
        raw_std = value.get("std_mm")
        std = (
            None
            if raw_std is None
            else _number(raw_std, f"state_prev[{entry.block_id}].state.std_mm")
        )
    else:
        raise DomainInvariantError(f"state_prev[{entry.block_id}].state must be a number or object")
    if storage < 0.0:
        raise DomainInvariantError(f"state_prev[{entry.block_id}].state must be non-negative")
    if std is None:
        std = _previous_std(entry.covariance, entry.block_id)
    return storage, std


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
    if not previous:
        return prior
    means = np.array(prior.mean, dtype=float)
    covariance = np.array(prior.covariance, dtype=float)
    positions = {block_id: index for index, block_id in enumerate(model.block_ids)}
    for entry in previous:
        position = positions.get(entry.block_id)
        if position is None:
            raise DomainInvariantError(f"state_prev references unknown block: {entry.block_id!r}")
        storage, std = _previous_storage(entry)
        means[position] = storage
        covariance[position, position] = (
            tuning.prior_storage_sigma_mm * tuning.prior_storage_sigma_mm
            if std is None
            else std * std
        )
    return GaussianState(mean=means, covariance=covariance)


@dataclass(frozen=True, slots=True)
class LossIdentifiability:
    report: IdentifiabilityReport
    marginal: Mapping[str, float]


def _loss_identifiability(
    model: JointStorageLossModel,
    prepared: PreparedMeasurement,
    state: GaussianState,
) -> LossIdentifiability:
    jacobian = prepared.model.observation_jacobian(state.mean)
    information = information_contribution(jacobian, np.diag(prepared.variances_mm2))
    blocks = model.n_blocks
    storage_block = information[:blocks, :blocks] + SCHUR_RIDGE * np.eye(blocks)
    cross = information[:blocks, blocks:]
    z_block = information[blocks:, blocks:]
    schur = z_block - cross.T @ np.linalg.solve(storage_block, cross)
    schur = (schur + schur.T) / 2.0
    report = IdentifiabilityReport.assess(schur, SCHUR_THRESHOLDS, expected_rank=model.n_groups)
    marginal = {
        group_id: float(schur[offset, offset]) for offset, group_id in enumerate(model.group_ids)
    }
    return LossIdentifiability(report=report, marginal=marginal)


def _loss_diagnostics(identifiability: LossIdentifiability) -> dict[str, JsonValue]:
    report = identifiability.report
    condition = report.condition_number
    diagnostics: dict[str, JsonValue] = {
        "rank": report.rank,
        "expected_rank": report.expected_rank,
        "min_eigenvalue": max(report.min_eigenvalue, 0.0),
        "condition_number": condition if math.isfinite(condition) else None,
        "marginal_information": dict(identifiability.marginal),
        "failures": [failure.value for failure in report.failures],
    }
    if not report.passed:
        diagnostics["reason"] = (
            LOSS_UNOBSERVED_REASON if report.rank == 0 else GATE_FAILURE_REASON
        )
    return diagnostics


def _clamp_eta(value: float) -> float:
    return min(max(value, MIN_ETA), 1.0)


def _state_entries(
    model: JointStorageLossModel,
    state: GaussianState,
    s_max_mm: float,
    tolerance_mm: float,
) -> list[EstimateStateEntry]:
    covariance = np.asarray(state.covariance, dtype=float)
    entries: list[EstimateStateEntry] = []
    for position, block_id in enumerate(model.block_ids):
        storage = min(max(float(state.mean[position]), 0.0), s_max_mm)
        std = math.sqrt(max(float(covariance[position, position]), 0.0))
        entries.append(
            EstimateStateEntry(
                block_id=block_id,
                state=EstimateStateVector(storage_mm=storage, std_mm=std),
                covariance=EstimateCovariance(variance_mm2=std * std),
                confidence=confidence_score(std, tolerance_mm),
                method=ESTIMATOR_METHOD,
            )
        )
    return entries


def _loss_entries(
    model: JointStorageLossModel,
    state: GaussianState,
    level: float,
    identifiability: LossIdentifiability | None,
) -> list[EstimateLossEntry]:
    view = JointEstimateView.from_state(model, state)
    covariance = np.asarray(state.covariance, dtype=float)
    entries: list[EstimateLossEntry] = []
    for offset, group_id in enumerate(model.group_ids):
        position = model.n_blocks + offset
        z_std = math.sqrt(max(float(covariance[position, position]), 0.0))
        interval = eta_interval(view.z_by_group[group_id], z_std, level)
        marginal = None if identifiability is None else identifiability.marginal.get(group_id)
        identified = (
            identifiability is not None
            and identifiability.report.passed
            and marginal is not None
            and marginal >= SCHUR_THRESHOLDS.min_eigenvalue
        )
        entries.append(
            EstimateLossEntry(
                zone=LossZone(group_id),
                eta_mean=_clamp_eta(view.eta_by_group[group_id]),
                eta_lower=_clamp_eta(interval.lower),
                eta_upper=_clamp_eta(interval.upper),
                identified=identified,
                diagnostics=(
                    None if identifiability is None else _loss_diagnostics(identifiability)
                ),
            )
        )
    return entries


def _diagnostics(
    readings: ReadingSet,
    prepared: PreparedMeasurement | None,
    innovation: Innovation | None,
    tuning: _EstimateTuning,
) -> EstimateDiagnostics:
    verdict = None if innovation is None else check_innovation(innovation, tuning.confidence_level)
    used = readings.used if prepared is not None else 0
    return EstimateDiagnostics(
        window_minutes=tuning.window_minutes,
        observations_total=readings.total,
        observations_used=used,
        observations_ignored=readings.total - used,
        confidence_level=tuning.confidence_level,
        nis=None if innovation is None else innovation.nis,
        nis_threshold=None if verdict is None else verdict.threshold,
        nis_consistent=None if verdict is None else verdict.is_consistent,
    )


router = APIRouter(tags=["estimate"])


@router.post("/v1/estimate", response_model=EstimateResponse)
def estimate(request: EstimateRequest) -> EstimateResponse:
    tuning = _tuning(request.params)
    index = NetworkIndex.from_spec(network_spec_from_payload(request.network))
    model = full_sensing_model(index, s_max_mm=tuning.s_max_mm)
    prior = _joint_prior(model, request, tuning)
    readings = _collect_readings(request)
    batch = build_measurement_batch(
        readings.readings,
        readings.sensor_block_of,
        assumed_sigma_mm=tuning.assumed_sigma_mm,
    )
    prepared = prepare_measurement(model, batch)
    if prepared is None:
        state = prior
        innovation: Innovation | None = None
        identifiability: LossIdentifiability | None = None
    else:
        state, innovation = ekf_update(
            prepared.model, prior, prepared.values_mm, np.diag(prepared.variances_mm2)
        )
        identifiability = _loss_identifiability(model, prepared, state)
    return EstimateResponse(
        request_id=request.request_id,
        ts=datetime.now(UTC),
        states=_state_entries(model, state, tuning.s_max_mm, tuning.confidence_tolerance_mm),
        losses=_loss_entries(model, state, tuning.confidence_level, identifiability),
        diagnostics=_diagnostics(readings, prepared, innovation, tuning),
    )