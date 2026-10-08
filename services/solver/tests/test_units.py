from __future__ import annotations

import math
from typing import Final

import pytest  # type: ignore
from hypothesis import given  # type: ignore
from hypothesis import strategies as st  # type: ignore

from app.core.types import DomainInvariantError
from app.core.units import (
    LPS_HOUR_TO_M3,
    MM_PER_M,
    combined_path_efficiency,
    delivered_volume_m3,
    flow_hours_to_volume_m3,
    gross_volume_from_delivered_m3,
    storage_delta_mm,
    storage_mm_to_volume_m3,
    volume_m3_to_storage_mm,
)
from baselines.base import block_gross_per_slot_m3
from optimizer.model import PlanningBlockSpec

HECTARE_M2: Final = 10_000.0
LITRES_PER_M3: Final = 1_000.0
SECONDS_PER_HOUR: Final = 3_600.0

FLOWS_LPS: Final = st.floats(min_value=0.0, max_value=150.0, allow_nan=False, allow_infinity=False)
HOURS: Final = st.floats(min_value=0.5, max_value=48.0, allow_nan=False, allow_infinity=False)
AREAS_M2: Final = st.floats(
    min_value=200.0, max_value=80_000.0, allow_nan=False, allow_infinity=False
)
EFFICIENCIES: Final = st.floats(
    min_value=1.0e-3, max_value=1.0, allow_nan=False, allow_infinity=False
)
STORAGE_MM: Final = st.floats(min_value=0.0, max_value=400.0, allow_nan=False, allow_infinity=False)
DELIVERED_M3: Final = st.floats(
    min_value=0.0, max_value=5_000.0, allow_nan=False, allow_infinity=False
)
POSITIVE_FLOWS_LPS: Final = st.floats(
    min_value=1.0e-3, max_value=150.0, allow_nan=False, allow_infinity=False
)


def test_litre_per_second_anchor_for_one_hour_equals_three_point_six_cubic_metres() -> None:
    assert flow_hours_to_volume_m3(1.0, 1.0) == pytest.approx(LPS_HOUR_TO_M3, rel=0.0, abs=1e-12)


def test_flow_hours_matches_second_based_conversion() -> None:
    flow_lps, hours = 10.0, 6.0
    litres = flow_lps * hours * SECONDS_PER_HOUR
    assert flow_hours_to_volume_m3(flow_lps, hours) == pytest.approx(
        litres / LITRES_PER_M3, rel=1e-12
    )


def test_flow_hours_zero_inputs_yield_zero_volume() -> None:
    assert flow_hours_to_volume_m3(0.0, 6.0) == 0.0
    assert flow_hours_to_volume_m3(10.0, 0.0) == 0.0


def test_flow_hours_rejects_negative_flow() -> None:
    with pytest.raises(DomainInvariantError):
        flow_hours_to_volume_m3(-0.5, 1.0)


def test_flow_hours_rejects_negative_hours() -> None:
    with pytest.raises(DomainInvariantError):
        flow_hours_to_volume_m3(5.0, -1.0)


def test_flow_hours_rejects_non_finite_flow() -> None:
    with pytest.raises(DomainInvariantError):
        flow_hours_to_volume_m3(math.nan, 1.0)
    with pytest.raises(DomainInvariantError):
        flow_hours_to_volume_m3(math.inf, 1.0)


def test_volume_to_storage_uses_hectare_anchor() -> None:
    assert volume_m3_to_storage_mm(10.0, HECTARE_M2) == pytest.approx(1.0)
    assert volume_m3_to_storage_mm(100.0, HECTARE_M2) == pytest.approx(10.0)
    assert storage_mm_to_volume_m3(10.0, HECTARE_M2) == pytest.approx(100.0)


def test_volume_to_storage_scales_by_inverse_area() -> None:
    area_m2 = 7_500.0
    assert volume_m3_to_storage_mm(1.0, area_m2) == pytest.approx(MM_PER_M / area_m2)


def test_volume_to_storage_rejects_bad_inputs() -> None:
    with pytest.raises(DomainInvariantError):
        volume_m3_to_storage_mm(-1.0, HECTARE_M2)
    with pytest.raises(DomainInvariantError):
        volume_m3_to_storage_mm(1.0, 0.0)


def test_combined_path_efficiency_is_product_of_segments() -> None:
    assert combined_path_efficiency((0.95, 0.9, 0.85)) == pytest.approx(0.95 * 0.9 * 0.85)


def test_combined_path_efficiency_accepts_a_single_segment() -> None:
    assert combined_path_efficiency([0.83]) == pytest.approx(0.83)


def test_combined_path_efficiency_requires_at_least_one_segment() -> None:
    with pytest.raises(DomainInvariantError):
        combined_path_efficiency([])


@pytest.mark.parametrize("segment_efficiency", [0.0, -0.25, 1.5])
def test_combined_path_efficiency_rejects_out_of_domain_segments(
    segment_efficiency: float,
) -> None:
    with pytest.raises(DomainInvariantError):
        combined_path_efficiency([segment_efficiency])


def test_closed_gate_delivers_and_withdraws_nothing() -> None:
    assert delivered_volume_m3(10.0, 6.0, False, 0.9) == 0.0
    assert gross_volume_from_delivered_m3(0.0, 0.9) == 0.0
    assert storage_delta_mm(10.0, 6.0, False, 0.9, HECTARE_M2) == 0.0


def test_delivered_volume_matches_documented_formula() -> None:
    flow_lps, hours, efficiency = 10.0, 6.0, 0.9
    expected = LPS_HOUR_TO_M3 * flow_lps * hours * 1.0 * efficiency
    assert delivered_volume_m3(flow_lps, hours, True, efficiency) == pytest.approx(expected)


def test_delivery_plus_path_loss_reconstructs_gross_withdrawal() -> None:
    flow_lps, hours, efficiency = 8.0, 4.0, 0.8
    delivered = delivered_volume_m3(flow_lps, hours, True, efficiency)
    gross = gross_volume_from_delivered_m3(delivered, efficiency)
    assert gross == pytest.approx(flow_hours_to_volume_m3(flow_lps, hours), rel=1e-12)


def test_solver_convention_treats_flow_as_source_rating() -> None:
    flow_lps, hours, efficiency = 10.0, 6.0, 0.9
    base = flow_hours_to_volume_m3(flow_lps, hours)
    assert delivered_volume_m3(flow_lps, hours, True, efficiency) == pytest.approx(
        base * efficiency, rel=1e-12
    )
    assert gross_volume_from_delivered_m3(base * efficiency, efficiency) == pytest.approx(
        base, rel=1e-12
    )


def block_spec(*, flow_lps: float, efficiency: float) -> PlanningBlockSpec:
    return PlanningBlockSpec(
        block_id="b-quantum",
        area_m2=HECTARE_M2,
        nominal_flow_lps=flow_lps,
        path_efficiency=efficiency,
        min_storage_mm=0.0,
        max_storage_mm=100.0,
        initial_storage_mm=50.0,
        ledger_delivered_m3=0.0,
        ledger_target_m3=0.0,
        debt_m3=0.0,
    )


def test_block_gross_quantum_is_flow_hours_anchor() -> None:
    quantum = block_gross_per_slot_m3(block_spec(flow_lps=10.0, efficiency=0.9), 6.0)
    assert quantum == pytest.approx(flow_hours_to_volume_m3(10.0, 6.0))


def test_block_gross_quantum_does_not_shrink_with_path_efficiency() -> None:
    lossy = block_gross_per_slot_m3(block_spec(flow_lps=10.0, efficiency=0.5), 6.0)
    clean = block_gross_per_slot_m3(block_spec(flow_lps=10.0, efficiency=1.0), 6.0)
    assert lossy == clean


@given(flow_lps=POSITIVE_FLOWS_LPS, hours=HOURS, efficiency=EFFICIENCIES)
def test_block_gross_quantum_reconstructs_from_delivered(
    flow_lps: float, hours: float, efficiency: float
) -> None:
    quantum = block_gross_per_slot_m3(block_spec(flow_lps=flow_lps, efficiency=efficiency), hours)
    delivered = delivered_volume_m3(flow_lps, hours, True, efficiency)
    assert quantum == pytest.approx(flow_hours_to_volume_m3(flow_lps, hours), rel=1e-12)
    assert gross_volume_from_delivered_m3(delivered, efficiency) == pytest.approx(
        quantum, rel=1e-9, abs=1e-12
    )


def test_gross_volume_from_delivered_inverts_net_volume() -> None:
    delivered_m3, efficiency = 86.4, 0.75
    gross = gross_volume_from_delivered_m3(delivered_m3, efficiency)
    assert gross == pytest.approx(delivered_m3 / efficiency)
    assert gross * efficiency == pytest.approx(delivered_m3, rel=1e-12)


def test_storage_delta_converts_delivered_volume_to_millimetres() -> None:
    delta = storage_delta_mm(10.0, 6.0, True, 0.9, HECTARE_M2)
    net = delivered_volume_m3(10.0, 6.0, True, 0.9)
    assert delta == pytest.approx(volume_m3_to_storage_mm(net, HECTARE_M2))


@given(flow_lps=FLOWS_LPS, hours=HOURS, scale=st.floats(min_value=0.5, max_value=8.0))
def test_flow_hours_is_linear_in_duration(flow_lps: float, hours: float, scale: float) -> None:
    base = flow_hours_to_volume_m3(flow_lps, hours)
    scaled = flow_hours_to_volume_m3(flow_lps, hours * scale)
    assert scaled == pytest.approx(base * scale, rel=1e-9, abs=1e-9)


@given(storage_mm=STORAGE_MM, area_m2=AREAS_M2)
def test_storage_round_trip_recovers_millimetres(storage_mm: float, area_m2: float) -> None:
    volume = storage_mm_to_volume_m3(storage_mm, area_m2)
    assert volume_m3_to_storage_mm(volume, area_m2) == pytest.approx(storage_mm, rel=1e-9, abs=1e-9)


@given(flow_lps=FLOWS_LPS, hours=HOURS, efficiency=EFFICIENCIES)
def test_net_arrival_is_base_release_times_efficiency(
    flow_lps: float, hours: float, efficiency: float
) -> None:
    delivered = delivered_volume_m3(flow_lps, hours, True, efficiency)
    base = flow_hours_to_volume_m3(flow_lps, hours)
    assert delivered == pytest.approx(base * efficiency, rel=1e-9, abs=1e-12)


@given(delivered_m3=DELIVERED_M3, efficiency=EFFICIENCIES)
def test_gross_from_delivered_never_loses_water(delivered_m3: float, efficiency: float) -> None:
    gross = gross_volume_from_delivered_m3(delivered_m3, efficiency)
    assert gross >= delivered_m3 - 1e-9
