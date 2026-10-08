from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Final, cast

import numpy as np  # type: ignore
from fastapi import APIRouter  # type: ignore
from scipy.special import logit  # type: ignore

from api.network_payload import network_spec_from_payload
from api.schemas import SensingObjective, SensingSelectRequest, SensingSelectResponse
from api.water_model import full_sensing_model
from app.core.types import CropStage, DomainInvariantError, LossZone
from app.core.units import flow_hours_to_volume_m3, volume_m3_to_storage_mm
from app.demand.crop_water import slot_mm_from_daily_rate
from app.demand.kp01 import (
    KP01_PERC_DEFAULT_MM_PER_DAY,
    kc_for_stage,
    water_layer_replacement_mm_per_day,
)
from estimator.ekf import GaussianState, diagonal_covariance
from estimator.loss import JointControl, JointStorageLossModel
from estimator.state import (
    DEFAULT_INITIAL_SIGMA_MM,
    DEFAULT_INITIAL_STORAGE_MM,
    StorageDynamicsParams,
)
from sensing.selection import (
    InformationBudget,
    SearchStrategy,
    SensorSelection,
    exact_search,
    greedy_forward,
    local_swap_refine,
    logdet_score,
    posterior_information,
    random_search,
    select_sensors,
    trace_p_score,
)
from simulator.crop import stage_for_day
from simulator.network import NetworkIndex
from simulator.scenarios import LOSS_ZONE_BASE
from simulator.sensors import LevelSensorSpec
from simulator.weather import DRY_SEASON_REGIME

DEFAULT_GRAMIAN_STEPS: Final = 6
DESIGN_SLOT_HOURS: Final = 1.0
DESIGN_RAIN_MM: Final = 0.0
DESIGN_DAY: Final = 0
PRIOR_ETA_SIGMA_LOGIT: Final = 0.5

type ScoreFunction = Callable[[tuple[str, ...]], float]


def _design_stage() -> CropStage:
    return stage_for_day(DESIGN_DAY)


def _measurement_sigma_mm(request: SensingSelectRequest) -> float:
    return LevelSensorSpec.from_noise_level(request.sensor_noise).noise_sigma_mm


def _design_control(index: NetworkIndex, stage: CropStage, hours: float) -> np.ndarray:
    etc_per_day = kc_for_stage(stage) * DRY_SEASON_REGIME.et0_mean_mm_per_day
    control = JointControl(
        gross_base_mm=tuple(
            volume_m3_to_storage_mm(
                flow_hours_to_volume_m3(index.block_by_id[block_id].nominal_flow_lps, hours),
                index.block_by_id[block_id].area_m2,
            )
            for block_id in index.block_ids
        ),
        etc_mm=tuple(slot_mm_from_daily_rate(etc_per_day, hours) for _ in index.block_ids),
        effective_rain_mm=DESIGN_RAIN_MM,
        percolation_mm=slot_mm_from_daily_rate(KP01_PERC_DEFAULT_MM_PER_DAY, hours),
        wlr_mm=slot_mm_from_daily_rate(water_layer_replacement_mm_per_day(), hours),
    )
    return control.as_vector()


def _prior_state(
    model: JointStorageLossModel,
    request: SensingSelectRequest,
) -> GaussianState:
    loss_zone_profiles = cast(Mapping[object, Mapping[LossZone, float]], LOSS_ZONE_BASE)
    profile = loss_zone_profiles[request.loss_profile]
    means = np.array(
        [DEFAULT_INITIAL_STORAGE_MM] * model.n_blocks
        + [float(logit(profile[LossZone(group_id)])) for group_id in model.group_ids],
        dtype=float,
    )
    variances = [DEFAULT_INITIAL_SIGMA_MM**2] * model.n_blocks + [
        PRIOR_ETA_SIGMA_LOGIT**2
    ] * model.n_groups
    return GaussianState(mean=means, covariance=diagonal_covariance(variances))


def _gramian_factors(
    model: JointStorageLossModel,
    prior: GaussianState,
    control: np.ndarray,
    steps: int,
) -> tuple[np.ndarray, ...]:
    factors: list[np.ndarray] = []
    propagation = np.eye(model.dimension)
    state = np.asarray(prior.mean, dtype=float)
    for _ in range(steps):
        factors.append(propagation)
        propagation = model.transition_jacobian(state, control) @ propagation
        state = model.transition(state, control)
    return tuple(factors)


def _contribution(
    model: JointStorageLossModel,
    factors: tuple[np.ndarray, ...],
    position: int,
    sigma_mm: float,
) -> np.ndarray:
    weight = 1.0 / (sigma_mm * sigma_mm)
    total = np.zeros((model.dimension, model.dimension), dtype=float)
    for factor in factors:
        row = np.asarray(factor[position], dtype=float)
        total += weight * np.outer(row, row)
    return total


def _information_budget(
    model: JointStorageLossModel,
    prior: GaussianState,
    factors: tuple[np.ndarray, ...],
    candidates: tuple[str, ...],
    sigma_mm: float,
) -> InformationBudget:
    positions = {block_id: index for index, block_id in enumerate(model.block_ids)}
    return InformationBudget(
        prior_information=np.linalg.inv(np.asarray(prior.covariance, dtype=float)),
        contributions={
            block_id: _contribution(model, factors, positions[block_id], sigma_mm)
            for block_id in candidates
        },
    )


def _score_function(
    budget: InformationBudget,
    objective: SensingObjective,
) -> ScoreFunction:
    if objective is SensingObjective.ESTIMATION:
        return lambda selected: trace_p_score(budget, selected)
    if objective is SensingObjective.INFORMATION:
        return lambda selected: logdet_score(budget, selected)
    raise DomainInvariantError(
        "DECISION objective needs closed-loop policy evaluation, and the simulator cannot"
        " replay a caller-supplied network yet; use the experiments runner with sensor_sets"
        " or request ESTIMATION / INFORMATION"
    )


def _search(
    request: SensingSelectRequest,
    candidates: tuple[str, ...],
    score: ScoreFunction,
) -> SensorSelection:
    strategy = request.strategy
    if strategy is None:
        return select_sensors(candidates, request.k, score)
    if strategy is SearchStrategy.EXACT:
        return exact_search(candidates, request.k, score)
    if strategy is SearchStrategy.GREEDY:
        return greedy_forward(candidates, request.k, score)
    if strategy is SearchStrategy.RANDOM:
        return random_search(
            candidates,
            request.k,
            score,
            seed=request.seed,
            repetitions=request.repetitions,
        )
    base = (
        greedy_forward(candidates, request.k, score)
        if strategy is SearchStrategy.GREEDY_REFINED
        else random_search(
            candidates,
            request.k,
            score,
            seed=request.seed,
            repetitions=request.repetitions,
        )
    )
    return local_swap_refine(candidates, base, score)


def _matrix_payload(matrix: np.ndarray) -> list[list[float]]:
    return [[float(value) for value in row] for row in np.asarray(matrix, dtype=float)]


router = APIRouter(tags=["sensing"])


@router.post("/v1/sensing/select", response_model=SensingSelectResponse)
def select_sensing(request: SensingSelectRequest) -> SensingSelectResponse:
    index = NetworkIndex.from_spec(network_spec_from_payload(request.network))
    candidates = tuple(request.candidates)
    unknown = sorted(set(candidates) - set(index.block_ids))
    if unknown:
        raise DomainInvariantError(f"candidate locations are not blocks: {unknown}")
    model = full_sensing_model(index, s_max_mm=StorageDynamicsParams().s_max_mm)
    prior = _prior_state(model, request)
    factors = _gramian_factors(
        model,
        prior,
        _design_control(index, _design_stage(), DESIGN_SLOT_HOURS),
        DEFAULT_GRAMIAN_STEPS,
    )
    budget = _information_budget(model, prior, factors, candidates, _measurement_sigma_mm(request))
    selection = _search(request, candidates, _score_function(budget, request.objective))
    return SensingSelectResponse(
        request_id=request.request_id,
        network_id=request.network_id,
        objective=request.objective,
        strategy=selection.strategy,
        selected=list(selection.selected),
        score=selection.score,
        evaluated_subsets=selection.evaluated_subsets,
        info_matrix=_matrix_payload(posterior_information(budget, selection.selected)),
        regret_estimate=None,
    )
