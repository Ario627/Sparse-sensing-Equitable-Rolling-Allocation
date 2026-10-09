from __future__ import annotations

from dataclasses import replace
from typing import Final

import numpy as np
import pytest
from scipy.special import logit

from sera.core.types import DomainInvariantError, LossZone, ReadingQuality
from sera.core.units import volume_m3_to_storage_mm
from sera.estimator.ekf import ekf_predict, ekf_update
from sera.estimator.loss import (
    JointControl,
    JointEstimateView,
    JointStorageLossModel,
    LossGroupSpec,
    build_joint_model,
    gross_base_mm_by_block,
    group_edge_counts,
    initial_joint_state,
    joint_process_covariance,
    path_efficiency_from_z,
    path_efficiency_z_gradient,
    prepare_measurement,
)
from sera.estimator.observations import MeasurementBatch
from sera.simulator.network import NetworkIndex, chain_network

BLOCK_COUNT: Final = 6
S_MAX_MM: Final = 100.0
HECTARE_M2: Final = 10_000.0
ZONE_ETAS: Final = (0.95, 0.90, 0.85)
ZONE_ORDER: Final = (LossZone.HEAD, LossZone.MIDDLE, LossZone.TAIL)
Z_VECTOR: Final = [logit(eta) for eta in ZONE_ETAS]


def zoned_chain_index() -> NetworkIndex:
    spec = chain_network(BLOCK_COUNT, network_id="loss-chain")
    last = len(spec.edges) - 1
    edges = tuple(
        replace(
            edge,
            zone=(
                LossZone.HEAD
                if position == 0
                else LossZone.TAIL
                if position == last
                else LossZone.MIDDLE
            ),
        )
        for position, edge in enumerate(spec.edges)
    )
    return NetworkIndex.from_spec(replace(spec, edges=edges))


def loss_model(
    *,
    measured: tuple[str, ...] = ("b1", "b6"),
    group: LossGroupSpec | None = None,
) -> JointStorageLossModel:
    index = zoned_chain_index()
    edge_zone = {edge_id: index.edge_by_id[edge_id].zone for edge_id in index.edge_order}
    spec = group if group is not None else LossGroupSpec.per_zone(ZONE_ORDER)
    return build_joint_model(
        index.path_edges,
        edge_zone,
        block_ids=index.block_ids,
        measured_block_ids=measured,
        group_spec=spec,
        s_max_mm=S_MAX_MM,
    )


def joint_state(
    model: JointStorageLossModel, storage_mm: float, z_values: list[float]
) -> np.ndarray:
    return np.array([storage_mm] * model.n_blocks + z_values, dtype=float)


def joint_control(
    model: JointStorageLossModel,
    *,
    gross_base_mm: float,
    etc_mm: float = 0.0,
    rain_mm: float = 0.0,
    perc_mm: float = 0.0,
    wlr_mm: float = 0.0,
) -> np.ndarray:
    control = JointControl(
        gross_base_mm=(gross_base_mm,) * model.n_blocks,
        etc_mm=(etc_mm,) * model.n_blocks,
        effective_rain_mm=rain_mm,
        percolation_mm=perc_mm,
        wlr_mm=wlr_mm,
    )
    return control.as_vector()


def expected_path_efficiency(counts: tuple[int, ...], etas: tuple[float, ...]) -> float:
    efficiency = 1.0
    for count, eta in zip(counts, etas, strict=True):
        efficiency *= eta**count
    return efficiency


def single_measurement(
    block_id: str,
    value_mm: float,
    variance_mm2: float,
) -> MeasurementBatch:
    return MeasurementBatch(
        block_ids=(block_id,),
        values_mm=np.array([value_mm], dtype=float),
        variances_mm2=np.array([variance_mm2], dtype=float),
        qualities=(ReadingQuality.GOOD,),
    )


def test_loss_group_spec_per_zone_deduplicates_in_order() -> None:
    spec = LossGroupSpec.per_zone((LossZone.TAIL, LossZone.HEAD, LossZone.TAIL))
    assert spec.group_ids == ("TAIL", "HEAD")
    assert spec.zone_to_group == {LossZone.TAIL: "TAIL", LossZone.HEAD: "HEAD"}
    assert spec.group_index("HEAD") == 1


def test_loss_group_spec_single_group_maps_every_zone() -> None:
    spec = LossGroupSpec.single_group("ALL")
    assert spec.group_ids == ("ALL",)
    for zone in LossZone:
        assert spec.zone_to_group[zone] == "ALL"


def test_loss_group_spec_rejects_unknown_group_reference() -> None:
    with pytest.raises(DomainInvariantError):
        LossGroupSpec(group_ids=("A",), zone_to_group={LossZone.HEAD: "B"})
    with pytest.raises(DomainInvariantError):
        LossGroupSpec(group_ids=(), zone_to_group={})


def test_loss_group_spec_rejects_unknown_lookup() -> None:
    spec = LossGroupSpec.per_zone(ZONE_ORDER)
    with pytest.raises(DomainInvariantError):
        spec.group_index("MISSING")


def test_group_edge_counts_tallies_zones_along_each_path() -> None:
    index = zoned_chain_index()
    edge_zone = {edge_id: index.edge_by_id[edge_id].zone for edge_id in index.edge_order}
    counts = group_edge_counts(index.path_edges, edge_zone, LossGroupSpec.per_zone(ZONE_ORDER))
    assert counts["b1"] == (1, 0, 0)
    assert counts["b2"] == (1, 1, 0)
    assert counts["b6"] == (1, 4, 1)


def test_group_edge_counts_requires_zone_for_every_edge() -> None:
    index = zoned_chain_index()
    edge_zone = {edge_id: index.edge_by_id[edge_id].zone for edge_id in index.edge_order[1:]}
    with pytest.raises(DomainInvariantError):
        group_edge_counts(index.path_edges, edge_zone, LossGroupSpec.per_zone(ZONE_ORDER))


def test_path_efficiency_is_product_of_group_etas() -> None:
    z = np.array([logit(0.9), logit(0.8)], dtype=float)
    efficiency = path_efficiency_from_z(z, (2, 1))
    assert efficiency == pytest.approx(0.9**2 * 0.8)


def test_path_efficiency_floors_at_minimum_eta() -> None:
    efficiency = path_efficiency_from_z(np.array([-100.0]), (1,))
    assert efficiency == pytest.approx(1.0e-12)


def test_path_efficiency_rejects_empty_counts() -> None:
    with pytest.raises(DomainInvariantError):
        path_efficiency_from_z(np.array([logit(0.9)]), (0,))


def test_path_efficiency_gradient_matches_closed_form() -> None:
    z = np.array([logit(0.9), logit(0.7)], dtype=float)
    gradient = path_efficiency_z_gradient(z, (2, 1))
    efficiency = 0.9**2 * 0.7
    assert gradient[0] == pytest.approx(efficiency * 2 * 0.1)
    assert gradient[1] == pytest.approx(efficiency * 1 * 0.3)


def test_path_efficiency_gradient_matches_finite_difference() -> None:
    z = np.array([logit(0.92), logit(0.83)], dtype=float)
    counts = (3, 2)
    gradient = path_efficiency_z_gradient(z, counts)
    delta = 1.0e-6
    for index in range(z.size):
        bumped = np.array(z, dtype=float)
        lowered = np.array(z, dtype=float)
        bumped[index] += delta
        lowered[index] -= delta
        numeric = (
            path_efficiency_from_z(bumped, counts) - path_efficiency_from_z(lowered, counts)
        ) / (2.0 * delta)
        assert gradient[index] == pytest.approx(numeric, rel=1.0e-6)


def test_gross_base_mm_by_block_converts_against_area() -> None:
    base = gross_base_mm_by_block({"b1": 100.0}, {"b1": HECTARE_M2})
    assert base["b1"] == pytest.approx(volume_m3_to_storage_mm(100.0, HECTARE_M2))


def test_gross_base_mm_by_block_requires_area() -> None:
    with pytest.raises(DomainInvariantError):
        gross_base_mm_by_block({"b1": 100.0}, {})
    with pytest.raises(DomainInvariantError):
        gross_base_mm_by_block({"b1": -1.0}, {"b1": HECTARE_M2})


def test_joint_control_vector_layout() -> None:
    control = JointControl(
        gross_base_mm=(1.0, 2.0),
        etc_mm=(3.0, 4.0),
        effective_rain_mm=5.0,
        percolation_mm=6.0,
        wlr_mm=7.0,
    )
    assert control.block_count == 2
    assert tuple(control.as_vector()) == (1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0)


def test_joint_control_rejects_misaligned_and_negative_input() -> None:
    with pytest.raises(DomainInvariantError):
        JointControl(gross_base_mm=(1.0,), etc_mm=(1.0, 2.0))
    with pytest.raises(DomainInvariantError):
        JointControl(gross_base_mm=(-1.0,), etc_mm=(1.0,))


def test_build_joint_model_rejects_measured_block_outside_network() -> None:
    index = zoned_chain_index()
    edge_zone = {edge_id: index.edge_by_id[edge_id].zone for edge_id in index.edge_order}
    with pytest.raises(DomainInvariantError):
        build_joint_model(
            index.path_edges,
            edge_zone,
            block_ids=index.block_ids,
            measured_block_ids=("b99",),
            group_spec=LossGroupSpec.per_zone(ZONE_ORDER),
            s_max_mm=S_MAX_MM,
        )


def test_joint_model_dimension_counts_blocks_and_groups() -> None:
    model = loss_model()
    assert model.n_blocks == BLOCK_COUNT
    assert model.n_groups == 3
    assert model.dimension == BLOCK_COUNT + 3
    assert model.measurement_dimension == 2


def test_joint_model_transition_matches_balance_anchor() -> None:
    model = loss_model()
    state = joint_state(model, 50.0, Z_VECTOR)
    control = joint_control(
        model, gross_base_mm=10.0, etc_mm=1.0, rain_mm=2.0, perc_mm=0.5, wlr_mm=0.25
    )
    updated = model.transition(state, control)
    assert updated[0] == pytest.approx(50.0 + 10.0 * 0.95 + 0.25)
    assert updated[5] == pytest.approx(
        50.0 + 10.0 * expected_path_efficiency((1, 4, 1), ZONE_ETAS) + 0.25
    )
    assert np.allclose(updated[model.n_blocks :], Z_VECTOR)


def test_joint_model_transition_clips_at_capacity() -> None:
    model = loss_model()
    state = joint_state(model, 99.0, Z_VECTOR)
    control = joint_control(model, gross_base_mm=50.0)
    updated = model.transition(state, control)
    assert np.all(updated[: model.n_blocks] == pytest.approx(S_MAX_MM))


def test_joint_model_transition_jacobian_matches_finite_difference() -> None:
    model = loss_model()
    state = joint_state(model, 50.0, Z_VECTOR)
    control = joint_control(model, gross_base_mm=10.0, etc_mm=1.0)
    jacobian = model.transition_jacobian(state, control)
    delta = 1.0e-6
    for group in range(model.n_groups):
        bumped = np.array(state, dtype=float)
        lowered = np.array(state, dtype=float)
        bumped[model.n_blocks + group] += delta
        lowered[model.n_blocks + group] -= delta
        numeric = (model.transition(bumped, control) - model.transition(lowered, control)) / (
            2.0 * delta
        )
        assert np.allclose(jacobian[:, model.n_blocks + group], numeric, rtol=1.0e-6, atol=1.0e-9)


def test_joint_model_observes_only_measured_positions() -> None:
    model = loss_model(measured=("b2", "b4"))
    state = joint_state(model, 42.0, Z_VECTOR)
    state[1] = 55.0
    state[3] = 61.0
    observed = model.observe(state)
    assert tuple(observed) == (55.0, 61.0)
    jacobian = model.observation_jacobian(state)
    assert jacobian.shape == (2, model.dimension)
    assert jacobian[0, 1] == pytest.approx(1.0)
    assert jacobian[1, 3] == pytest.approx(1.0)


def test_joint_model_measurement_swap_preserves_problem() -> None:
    model = loss_model(measured=("b1", "b6"))
    swapped = model.with_measurements(("b3",))
    assert swapped.measured_block_ids == ("b3",)
    assert swapped.block_ids == model.block_ids
    assert swapped.counts == model.counts


def test_joint_process_covariance_layout() -> None:
    model = loss_model()
    covariance = joint_process_covariance(model, storage_sigma_mm=2.0, drift_sigma_logit=0.05)
    diagonal = np.diag(covariance)
    assert np.allclose(diagonal[: model.n_blocks], 4.0)
    assert np.allclose(diagonal[model.n_blocks :], 0.0025)
    off_diagonal = covariance - np.diag(diagonal)
    assert np.allclose(off_diagonal, 0.0)


def test_joint_process_covariance_rejects_non_positive_sigma() -> None:
    model = loss_model()
    with pytest.raises(DomainInvariantError):
        joint_process_covariance(model, storage_sigma_mm=0.0, drift_sigma_logit=0.05)
    with pytest.raises(DomainInvariantError):
        joint_process_covariance(model, storage_sigma_mm=1.0, drift_sigma_logit=0.0)


def test_initial_joint_state_encodes_storage_and_eta_prior() -> None:
    model = loss_model()
    state = initial_joint_state(
        model, initial_storage_mm=45.0, initial_eta=0.9, eta_sigma_logit=0.5
    )
    assert np.allclose(state.mean[: model.n_blocks], 45.0)
    assert np.allclose(state.mean[model.n_blocks :], logit(0.9))
    diagonal = np.diag(state.covariance)
    assert np.allclose(diagonal[: model.n_blocks], 15.0**2)
    assert np.allclose(diagonal[model.n_blocks :], 0.25)


def test_joint_estimate_view_exposes_eta_from_logit() -> None:
    model = loss_model()
    state = initial_joint_state(model, initial_storage_mm=50.0, initial_eta=0.8)
    view = JointEstimateView.from_state(model, state)
    assert view.storage_mm["b1"] == pytest.approx(50.0)
    assert view.storage_std_mm["b1"] == pytest.approx(15.0)
    for group_id in model.group_ids:
        assert view.eta_by_group[group_id] == pytest.approx(0.8, rel=1.0e-9)


def test_prepare_measurement_rejects_untracked_blocks() -> None:
    model = loss_model(measured=("b2", "b4"))
    with pytest.raises(DomainInvariantError):
        prepare_measurement(model, single_measurement("b5", 50.0, 9.0))


def test_prepare_measurement_returns_none_for_empty_batch() -> None:
    model = loss_model(measured=("b2", "b4"))
    assert prepare_measurement(model, MeasurementBatch.empty()) is None


def test_prepare_measurement_restricts_to_available_blocks() -> None:
    model = loss_model(measured=("b2", "b4"))
    prepared = prepare_measurement(model, single_measurement("b4", 61.0, 9.0))
    assert prepared is not None
    assert prepared.model.measured_block_ids == ("b4",)
    assert tuple(prepared.values_mm) == (61.0,)
    assert tuple(prepared.variances_mm2) == (9.0,)


def test_joint_model_ekf_round_trip_shrinks_measured_uncertainty() -> None:
    model = loss_model()
    state = initial_joint_state(model)
    control = joint_control(model, gross_base_mm=10.0, etc_mm=1.0, perc_mm=0.5)
    predicted = ekf_predict(
        model,
        state,
        control,
        joint_process_covariance(model, storage_sigma_mm=1.0, drift_sigma_logit=0.02),
    )
    prepared = prepare_measurement(model, single_measurement("b1", 55.0, 9.0))
    assert prepared is not None
    updated, innovation = ekf_update(
        prepared.model, predicted, prepared.values_mm, np.diag(prepared.variances_mm2)
    )
    assert updated.covariance[0, 0] < predicted.covariance[0, 0]
    assert innovation.residual[0] == pytest.approx(55.0 - predicted.mean[0])
    assert innovation.nis >= 0.0
