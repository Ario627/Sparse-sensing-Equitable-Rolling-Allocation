from __future__ import annotations

from dataclasses import replace
from typing import Final

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.core.rng import generator_for
from app.core.types import CropStage, DomainInvariantError
from app.demand.kp01 import water_layer_replacement_mm_per_day
from simulator.crop import (
    HALF_MONTH_DAYS,
    SEASON_DAYS,
    CropDayTruth,
    CropFieldState,
    CropTruthSpec,
    advance_crop_day,
    field_wlr_rate_mm_per_day,
    initial_field_state,
    nominal_kc,
    stage_for_day,
)

RNG_SEED: Final = 20_261_008
ET0_MM_PER_DAY: Final = 5.0
WET_STORAGE_MM: Final = 60.0

STAGE_BOUNDARIES: Final[tuple[tuple[int, CropStage], ...]] = (
    (0, CropStage.VEGETATIVE),
    (14, CropStage.VEGETATIVE),
    (15, CropStage.VEGETATIVE),
    (29, CropStage.VEGETATIVE),
    (30, CropStage.TILLERING),
    (44, CropStage.TILLERING),
    (45, CropStage.TILLERING),
    (59, CropStage.TILLERING),
    (60, CropStage.PANICLE_INITIATION),
    (74, CropStage.PANICLE_INITIATION),
    (75, CropStage.FLOWERING),
    (89, CropStage.FLOWERING),
    (90, CropStage.GRAIN_FILLING),
    (104, CropStage.GRAIN_FILLING),
    (105, CropStage.RIPENING),
    (119, CropStage.RIPENING),
    (365, CropStage.RIPENING),
)

WLR_ACTIVE_DAYS: Final[tuple[int, ...]] = (30, 31, 44, 60, 74)
WLR_IDLE_DAYS: Final[tuple[int, ...]] = (0, 29, 45, 59, 75, 90)


def field_state(
    *,
    day_index: int = 0,
    storage_mm: float = WET_STORAGE_MM,
    kc_deviation: float = 0.0,
    perc_log_drift: float = 0.0,
) -> CropFieldState:
    return CropFieldState(
        block_id="b1",
        day_index=day_index,
        storage_mm=storage_mm,
        kc_deviation=kc_deviation,
        perc_log_drift=perc_log_drift,
    )


def ponding_factor(storage_mm: float, spec: CropTruthSpec) -> float:
    return 1.0 + spec.perc_ponding_gain * min(storage_mm / spec.s_max_mm, 1.0)


def expected_percolation_mm(storage_mm: float, spec: CropTruthSpec) -> float:
    return spec.perc_base_mm_per_day * ponding_factor(storage_mm, spec)


def record_for_day(day_index: int) -> CropDayTruth:
    _, record = advance_crop_day(
        field_state(day_index=day_index),
        CropTruthSpec(),
        generator_for(RNG_SEED, "crop-wlr", day_index),
        delivered_mm=0.0,
        rain_mm=0.0,
        et0_mm_per_day=ET0_MM_PER_DAY,
    )
    return record


def test_season_spans_eight_half_months() -> None:
    assert HALF_MONTH_DAYS == 15.0
    assert SEASON_DAYS == 120


@pytest.mark.parametrize(("day_index", "expected"), STAGE_BOUNDARIES)
def test_stage_for_day_maps_half_month_windows(day_index: int, expected: CropStage) -> None:
    assert stage_for_day(day_index) is expected


def test_stage_for_day_rejects_invalid_inputs() -> None:
    with pytest.raises(DomainInvariantError):
        stage_for_day(-1)
    with pytest.raises(DomainInvariantError):
        stage_for_day(True)


def test_nominal_kc_matches_kp01_stage_table() -> None:
    assert nominal_kc(CropStage.VEGETATIVE) == pytest.approx(1.10)
    assert nominal_kc(CropStage.FLOWERING) == pytest.approx(1.27)
    assert nominal_kc(CropStage.PANICLE_INITIATION) > nominal_kc(CropStage.TILLERING)


def test_field_wlr_rate_spreads_one_application_over_the_window() -> None:
    spec = CropTruthSpec()
    assert field_wlr_rate_mm_per_day(spec) == pytest.approx(
        water_layer_replacement_mm_per_day(spec.wlr_window_days)
    )
    assert field_wlr_rate_mm_per_day(spec) == pytest.approx(50.0 / 15.0)


def test_wlr_windows_open_at_tillering_and_panicle_initiation() -> None:
    spec = CropTruthSpec()
    for start in spec.wlr_start_days:
        assert stage_for_day(start) in (CropStage.TILLERING, CropStage.PANICLE_INITIATION)


def test_crop_truth_spec_rejects_inconsistent_bounds() -> None:
    with pytest.raises(DomainInvariantError):
        CropTruthSpec(initial_storage_mm=120.0)
    with pytest.raises(DomainInvariantError):
        CropTruthSpec(stress_full_mm=10.0)
    with pytest.raises(DomainInvariantError):
        CropTruthSpec(wlr_start_days=())
    with pytest.raises(DomainInvariantError):
        CropTruthSpec(wlr_start_days=(30, 30))


def test_initial_field_state_is_seed_deterministic() -> None:
    spec = CropTruthSpec()
    first = initial_field_state("b1", spec, generator_for(RNG_SEED, "crop-init", "b1"))
    second = initial_field_state("b1", spec, generator_for(RNG_SEED, "crop-init", "b1"))
    assert first == second
    assert first.day_index == 0
    assert first.storage_mm == spec.initial_storage_mm
    assert -0.2 <= first.kc_deviation <= 0.2


def test_advance_crop_day_interior_balance_matches_anchor() -> None:
    spec = CropTruthSpec()
    state = field_state()
    next_state, record = advance_crop_day(
        state,
        spec,
        generator_for(RNG_SEED, "crop", "anchor"),
        delivered_mm=10.0,
        rain_mm=2.0,
        et0_mm_per_day=ET0_MM_PER_DAY,
    )
    expected_etc = nominal_kc(CropStage.VEGETATIVE) * ET0_MM_PER_DAY
    expected_storage = (
        WET_STORAGE_MM + 10.0 + 2.0 - expected_etc - expected_percolation_mm(WET_STORAGE_MM, spec)
    )
    assert record.stage is CropStage.VEGETATIVE
    assert record.kc_true == pytest.approx(nominal_kc(CropStage.VEGETATIVE))
    assert record.etc_true_mm == pytest.approx(expected_etc)
    assert record.perc_true_mm == pytest.approx(expected_percolation_mm(WET_STORAGE_MM, spec))
    assert record.wlr_true_mm == 0.0
    assert record.spill_mm == 0.0
    assert record.unmet_mm == 0.0
    assert record.storage_mm == pytest.approx(expected_storage)
    assert next_state.day_index == 1
    assert next_state.storage_mm == pytest.approx(record.storage_mm)


def test_advance_crop_day_applies_kc_deviation_to_truth() -> None:
    spec = CropTruthSpec()
    _, record = advance_crop_day(
        field_state(kc_deviation=0.1),
        spec,
        generator_for(RNG_SEED, "crop", "deviation"),
        delivered_mm=0.0,
        rain_mm=0.0,
        et0_mm_per_day=ET0_MM_PER_DAY,
    )
    assert record.kc_true == pytest.approx(nominal_kc(CropStage.VEGETATIVE) * 1.1)


def test_stress_floors_transpiration_below_wilting_storage() -> None:
    spec = CropTruthSpec()
    _, record = advance_crop_day(
        field_state(storage_mm=spec.stress_empty_mm - 1.0),
        spec,
        generator_for(RNG_SEED, "crop", "stress-floor"),
        delivered_mm=0.0,
        rain_mm=0.0,
        et0_mm_per_day=ET0_MM_PER_DAY,
    )
    assert record.etc_true_mm == pytest.approx(
        nominal_kc(CropStage.VEGETATIVE) * ET0_MM_PER_DAY * spec.stress_et_floor
    )


def test_stress_interpolates_between_empty_and_full_thresholds() -> None:
    spec = CropTruthSpec()
    midpoint = (spec.stress_empty_mm + spec.stress_full_mm) / 2.0
    _, record = advance_crop_day(
        field_state(storage_mm=midpoint),
        spec,
        generator_for(RNG_SEED, "crop", "stress-mid"),
        delivered_mm=0.0,
        rain_mm=0.0,
        et0_mm_per_day=ET0_MM_PER_DAY,
    )
    factor = spec.stress_et_floor + (1.0 - spec.stress_et_floor) * 0.5
    assert record.etc_true_mm == pytest.approx(
        nominal_kc(CropStage.VEGETATIVE) * ET0_MM_PER_DAY * factor
    )


def test_stress_is_full_at_and_above_full_threshold() -> None:
    spec = CropTruthSpec()
    _, record = advance_crop_day(
        field_state(storage_mm=spec.stress_full_mm),
        spec,
        generator_for(RNG_SEED, "crop", "stress-full"),
        delivered_mm=0.0,
        rain_mm=0.0,
        et0_mm_per_day=ET0_MM_PER_DAY,
    )
    assert record.etc_true_mm == pytest.approx(nominal_kc(CropStage.VEGETATIVE) * ET0_MM_PER_DAY)


@pytest.mark.parametrize("day_index", WLR_ACTIVE_DAYS)
def test_wlr_window_days_pay_replacement(day_index: int) -> None:
    record = record_for_day(day_index)
    assert record.wlr_true_mm == pytest.approx(field_wlr_rate_mm_per_day(CropTruthSpec()))


@pytest.mark.parametrize("day_index", WLR_IDLE_DAYS)
def test_days_outside_wlr_windows_pay_nothing(day_index: int) -> None:
    assert record_for_day(day_index).wlr_true_mm == 0.0


def test_advance_crop_day_spills_above_field_capacity() -> None:
    spec = CropTruthSpec()
    state = field_state(storage_mm=spec.s_max_mm - 1.0)
    next_state, record = advance_crop_day(
        state,
        spec,
        generator_for(RNG_SEED, "crop", "spill"),
        delivered_mm=20.0,
        rain_mm=5.0,
        et0_mm_per_day=0.0,
    )
    raw = state.storage_mm + 20.0 + 5.0 - expected_percolation_mm(state.storage_mm, spec)
    assert next_state.storage_mm == pytest.approx(spec.s_max_mm)
    assert record.spill_mm == pytest.approx(raw - spec.s_max_mm)
    assert record.unmet_mm == 0.0


def test_advance_crop_day_reports_unmet_when_field_dries() -> None:
    spec = CropTruthSpec()
    state = field_state(storage_mm=1.0)
    next_state, record = advance_crop_day(
        state,
        spec,
        generator_for(RNG_SEED, "crop", "unmet"),
        delivered_mm=0.0,
        rain_mm=0.0,
        et0_mm_per_day=8.0,
    )
    stress = spec.stress_et_floor
    raw = (
        state.storage_mm
        - nominal_kc(CropStage.VEGETATIVE) * 8.0 * stress
        - expected_percolation_mm(state.storage_mm, spec)
    )
    assert next_state.storage_mm == 0.0
    assert record.unmet_mm == pytest.approx(-raw)
    assert record.spill_mm == 0.0


def test_drift_parameters_decay_without_noise() -> None:
    spec = replace(
        CropTruthSpec(),
        kc_drift_sigma=0.0,
        perc_drift_sigma=0.0,
        kc_drift_phi=0.5,
        perc_drift_phi=0.5,
    )
    next_state, _ = advance_crop_day(
        field_state(kc_deviation=0.2, perc_log_drift=1.0),
        spec,
        generator_for(RNG_SEED, "crop", "decay"),
        delivered_mm=10.0,
        rain_mm=0.0,
        et0_mm_per_day=ET0_MM_PER_DAY,
    )
    assert next_state.kc_deviation == pytest.approx(0.1)
    assert next_state.perc_log_drift == pytest.approx(0.5)


@given(
    storage_mm=st.floats(min_value=0.0, max_value=120.0, allow_nan=False, allow_infinity=False),
    delivered_mm=st.floats(min_value=0.0, max_value=60.0, allow_nan=False, allow_infinity=False),
    rain_mm=st.floats(min_value=0.0, max_value=40.0, allow_nan=False, allow_infinity=False),
    et0_mm_per_day=st.floats(min_value=0.0, max_value=12.0, allow_nan=False, allow_infinity=False),
    kc_deviation=st.floats(min_value=-0.2, max_value=0.2, allow_nan=False, allow_infinity=False),
    perc_log_drift=st.floats(min_value=-2.0, max_value=2.0, allow_nan=False, allow_infinity=False),
    day_index=st.integers(min_value=0, max_value=119),
)
def test_advance_crop_day_conserves_mass_and_respects_bounds(
    storage_mm: float,
    delivered_mm: float,
    rain_mm: float,
    et0_mm_per_day: float,
    kc_deviation: float,
    perc_log_drift: float,
    day_index: int,
) -> None:
    spec = CropTruthSpec()
    state = field_state(
        day_index=day_index,
        storage_mm=storage_mm,
        kc_deviation=kc_deviation,
        perc_log_drift=perc_log_drift,
    )
    next_state, record = advance_crop_day(
        state,
        spec,
        generator_for(RNG_SEED, "crop", day_index, storage_mm),
        delivered_mm=delivered_mm,
        rain_mm=rain_mm,
        et0_mm_per_day=et0_mm_per_day,
    )
    raw = (
        storage_mm
        + delivered_mm
        + rain_mm
        - record.etc_true_mm
        - record.perc_true_mm
        - record.wlr_true_mm
    )
    assert 0.0 <= record.storage_mm <= spec.s_max_mm
    assert record.storage_mm + record.spill_mm - record.unmet_mm == pytest.approx(
        raw, rel=1e-9, abs=1e-9
    )
    assert record.spill_mm * record.unmet_mm == 0.0
    assert next_state.day_index == day_index + 1
    assert -0.2 <= next_state.kc_deviation <= 0.2
