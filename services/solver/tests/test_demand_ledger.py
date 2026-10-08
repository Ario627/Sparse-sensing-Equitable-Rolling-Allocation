from __future__ import annotations

from typing import Final

import pytest  # type: ignore
from hypothesis import given  # type: ignore
from hypothesis import strategies as st  # type: ignore

from app.core.types import CropStage, DemandTargets, DomainInvariantError
from app.core.units import storage_mm_to_volume_m3
from app.demand.crop_water import (
    advance_storage_mm,
    demand_targets,
    net_requirement_slot_mm,
    physical_slot_capacity_m3,
    required_slot_volume_m3,
    slot_mm_from_daily_rate,
    storage_shortfall_mm,
    total_consumptive_rate_mm_per_day,
)
from app.demand.kp01 import (
    effective_rainfall_paddy_mm,
    is_critical_stage,
    kc_for_stage,
    water_layer_replacement_mm_per_day,
    water_layer_replacement_season_mm,
)
from app.ledger.deficit import (
    DeficitBreakdown,
    adequacy_ratio,
    agricultural_deficit_m3,
    structural_deficit_m3,
)
from app.ledger.service_debt import ServiceLedgerState, advance_ledger

HECTARE_M2: Final = 10_000.0
SLOT_HOURS: Final = 6.0
STANDARD_FLOW_LPS: Final = 10.0
STANDARD_EFFICIENCY: Final = 0.9
WLR_DAILY_MM: Final = 50.0 / 30.0
CRITICAL_STAGES: Final[frozenset[CropStage]] = frozenset(
    {CropStage.PANICLE_INITIATION, CropStage.FLOWERING}
)

NON_NEGATIVE_M3: Final = st.floats(
    min_value=0.0, max_value=5_000.0, allow_nan=False, allow_infinity=False
)
GAMMAS: Final = st.floats(min_value=0.05, max_value=1.0, allow_nan=False, allow_infinity=False)
LEDGER_STATES: Final = st.builds(
    ServiceLedgerState,
    delivered_ewma_m3=NON_NEGATIVE_M3,
    target_ewma_m3=NON_NEGATIVE_M3,
    debt_m3=NON_NEGATIVE_M3,
)


def block_targets(
    *,
    etc_mm_per_day: float = 5.0,
    perc_mm_per_day: float = 2.0,
    wlr_mm_per_day: float = WLR_DAILY_MM,
    effective_rain_slot_mm: float = 0.0,
    hours: float = SLOT_HOURS,
    area_m2: float = HECTARE_M2,
    nominal_flow_lps: float = STANDARD_FLOW_LPS,
    path_efficiency: float = STANDARD_EFFICIENCY,
    critical_stage: bool = False,
) -> DemandTargets:
    return demand_targets(
        etc_mm_per_day=etc_mm_per_day,
        perc_mm_per_day=perc_mm_per_day,
        wlr_mm_per_day=wlr_mm_per_day,
        effective_rain_slot_mm=effective_rain_slot_mm,
        hours=hours,
        area_m2=area_m2,
        nominal_flow_lps=nominal_flow_lps,
        path_efficiency=path_efficiency,
        critical_stage=critical_stage,
    )


def test_slot_mm_scales_daily_rate_by_duration() -> None:
    assert slot_mm_from_daily_rate(8.0, 6.0) == pytest.approx(2.0)
    assert slot_mm_from_daily_rate(8.0, 24.0) == pytest.approx(8.0)


def test_slot_mm_rejects_negative_rate() -> None:
    with pytest.raises(DomainInvariantError):
        slot_mm_from_daily_rate(-1.0, 6.0)


def test_total_consumptive_rate_sums_components() -> None:
    assert total_consumptive_rate_mm_per_day(5.0, 2.0, WLR_DAILY_MM) == pytest.approx(
        7.0 + WLR_DAILY_MM
    )


def test_net_requirement_subtracts_effective_rain() -> None:
    demand = slot_mm_from_daily_rate(5.0 + 2.0 + WLR_DAILY_MM, SLOT_HOURS)
    net = net_requirement_slot_mm(
        etc_mm_per_day=5.0,
        perc_mm_per_day=2.0,
        wlr_mm_per_day=WLR_DAILY_MM,
        effective_rain_slot_mm=0.5,
        hours=SLOT_HOURS,
    )
    assert net == pytest.approx(demand - 0.5)


def test_net_requirement_floors_at_zero_under_full_rain_cover() -> None:
    assert (
        net_requirement_slot_mm(
            etc_mm_per_day=5.0,
            perc_mm_per_day=2.0,
            wlr_mm_per_day=WLR_DAILY_MM,
            effective_rain_slot_mm=100.0,
            hours=SLOT_HOURS,
        )
        == 0.0
    )


def test_required_slot_volume_is_the_millimetre_conversion_of_net_requirement() -> None:
    requirement_mm = net_requirement_slot_mm(
        etc_mm_per_day=5.0,
        perc_mm_per_day=2.0,
        wlr_mm_per_day=WLR_DAILY_MM,
        effective_rain_slot_mm=0.5,
        hours=SLOT_HOURS,
    )
    required_m3 = required_slot_volume_m3(
        etc_mm_per_day=5.0,
        perc_mm_per_day=2.0,
        wlr_mm_per_day=WLR_DAILY_MM,
        effective_rain_slot_mm=0.5,
        hours=SLOT_HOURS,
        area_m2=HECTARE_M2,
    )
    assert required_m3 == pytest.approx(storage_mm_to_volume_m3(requirement_mm, HECTARE_M2))


def test_physical_capacity_scales_with_path_efficiency() -> None:
    full = physical_slot_capacity_m3(nominal_flow_lps=10.0, hours=6.0, path_efficiency=1.0)
    degraded = physical_slot_capacity_m3(nominal_flow_lps=10.0, hours=6.0, path_efficiency=0.5)
    assert full == pytest.approx(216.0)
    assert degraded == pytest.approx(full * 0.5)


def test_storage_shortfall_floor_reports_millimetres_needed() -> None:
    assert storage_shortfall_mm(15.0, 25.0) == pytest.approx(10.0)
    assert storage_shortfall_mm(30.0, 25.0) == 0.0


def test_kp01_critical_stages_are_panicle_initiation_and_flowering() -> None:
    for stage in CropStage:
        assert is_critical_stage(stage) == (stage in CRITICAL_STAGES)


def test_kp01_reproductive_kc_exceeds_vegetative_kc() -> None:
    assert kc_for_stage(CropStage.FLOWERING) > kc_for_stage(CropStage.VEGETATIVE)


def test_kp01_effective_rainfall_keeps_seventy_percent_of_rain() -> None:
    assert effective_rainfall_paddy_mm(20.0) == pytest.approx(14.0)
    assert effective_rainfall_paddy_mm(0.0) == 0.0


def test_kp01_season_replacement_is_two_applications_of_fifty_millimetres() -> None:
    assert water_layer_replacement_season_mm() == pytest.approx(100.0)


def test_kp01_daily_replacement_spreads_application_over_window() -> None:
    assert water_layer_replacement_mm_per_day(30.0) == pytest.approx(50.0 / 30.0)
    assert water_layer_replacement_mm_per_day(10.0) == pytest.approx(5.0)


def test_demand_targets_fair_equals_minimum_of_required_and_physical() -> None:
    targets = block_targets()
    assert targets.target_fair_m3 == pytest.approx(
        min(targets.target_req_m3, targets.target_phys_m3)
    )
    assert targets.target_fair_m3 == pytest.approx(targets.target_req_m3)


def test_demand_targets_physical_capacity_binds_for_constrained_block() -> None:
    targets = block_targets(nominal_flow_lps=0.1)
    assert targets.target_phys_m3 < targets.target_req_m3
    assert targets.target_fair_m3 == pytest.approx(targets.target_phys_m3)
    assert targets.target_fair_m3 < targets.target_req_m3


def test_demand_targets_required_is_rain_aware() -> None:
    dry = block_targets()
    wet = block_targets(effective_rain_slot_mm=0.5)
    assert wet.target_req_m3 < dry.target_req_m3
    assert dry.target_req_m3 - wet.target_req_m3 == pytest.approx(
        storage_mm_to_volume_m3(0.5, HECTARE_M2)
    )


def test_demand_targets_required_increases_with_et0() -> None:
    low = block_targets(etc_mm_per_day=4.0)
    high = block_targets(etc_mm_per_day=8.0)
    assert high.target_req_m3 > low.target_req_m3


def test_demand_targets_critical_stage_flag_is_carried_through() -> None:
    assert block_targets(critical_stage=True).critical_stage is True
    assert block_targets().critical_stage is False


def test_demand_targets_reject_inconsistent_fair_target() -> None:
    with pytest.raises(DomainInvariantError):
        DemandTargets(target_req_m3=10.0, target_phys_m3=8.0, target_fair_m3=9.0)


def test_demand_targets_from_requirement_clamps_fair_to_physical() -> None:
    targets = DemandTargets.from_requirement(10.0, 8.0)
    assert targets.target_fair_m3 == pytest.approx(8.0)
    assert targets.target_req_m3 == pytest.approx(10.0)


def test_demand_inputs_reject_negative_rates() -> None:
    with pytest.raises(DomainInvariantError):
        net_requirement_slot_mm(
            etc_mm_per_day=-1.0,
            perc_mm_per_day=2.0,
            wlr_mm_per_day=WLR_DAILY_MM,
            effective_rain_slot_mm=0.0,
            hours=SLOT_HOURS,
        )


def test_advance_storage_interior_balance_carries_every_millimetre() -> None:
    initial, irrigation, rain = 40.0, 2.0, 0.5
    balance = advance_storage_mm(
        initial,
        hours=SLOT_HOURS,
        irrigation_slot_mm=irrigation,
        effective_rain_slot_mm=rain,
        etc_mm_per_day=5.0,
        perc_mm_per_day=2.0,
        wlr_mm_per_day=WLR_DAILY_MM,
        s_max_mm=100.0,
    )
    depletion = slot_mm_from_daily_rate(5.0 + 2.0 + WLR_DAILY_MM, SLOT_HOURS)
    assert balance.storage_mm == pytest.approx(initial + irrigation + rain - depletion)
    assert balance.spill_mm == 0.0
    assert balance.unmet_mm == 0.0


def test_advance_storage_spills_above_capacity() -> None:
    balance = advance_storage_mm(
        99.0,
        hours=SLOT_HOURS,
        irrigation_slot_mm=10.0,
        effective_rain_slot_mm=2.0,
        etc_mm_per_day=1.0,
        perc_mm_per_day=0.5,
        wlr_mm_per_day=0.0,
        s_max_mm=100.0,
    )
    raw = 99.0 + 10.0 + 2.0 - slot_mm_from_daily_rate(1.5, SLOT_HOURS)
    assert balance.storage_mm == pytest.approx(100.0)
    assert balance.spill_mm == pytest.approx(raw - 100.0)
    assert balance.unmet_mm == 0.0


def test_advance_storage_reports_unmet_when_losing_water() -> None:
    balance = advance_storage_mm(
        0.5,
        hours=SLOT_HOURS,
        irrigation_slot_mm=0.0,
        effective_rain_slot_mm=0.0,
        etc_mm_per_day=4.0,
        perc_mm_per_day=2.0,
        wlr_mm_per_day=1.0,
        s_max_mm=100.0,
    )
    raw = 0.5 - slot_mm_from_daily_rate(7.0, SLOT_HOURS)
    assert balance.storage_mm == 0.0
    assert balance.unmet_mm == pytest.approx(-raw)
    assert balance.spill_mm == 0.0


@given(
    initial_mm=st.floats(min_value=0.0, max_value=150.0, allow_nan=False, allow_infinity=False),
    irrigation_mm=st.floats(min_value=0.0, max_value=80.0, allow_nan=False, allow_infinity=False),
    rain_mm=st.floats(min_value=0.0, max_value=30.0, allow_nan=False, allow_infinity=False),
    etc_mm_per_day=st.floats(min_value=0.0, max_value=15.0, allow_nan=False, allow_infinity=False),
    perc_mm_per_day=st.floats(min_value=0.0, max_value=5.0, allow_nan=False, allow_infinity=False),
    wlr_mm_per_day=st.floats(min_value=0.0, max_value=5.0, allow_nan=False, allow_infinity=False),
    hours=st.floats(min_value=0.5, max_value=12.0, allow_nan=False, allow_infinity=False),
    s_max_mm=st.floats(min_value=20.0, max_value=150.0, allow_nan=False, allow_infinity=False),
)
def test_advance_storage_conserves_mass_and_separates_spill_from_unmet(
    initial_mm: float,
    irrigation_mm: float,
    rain_mm: float,
    etc_mm_per_day: float,
    perc_mm_per_day: float,
    wlr_mm_per_day: float,
    hours: float,
    s_max_mm: float,
) -> None:
    balance = advance_storage_mm(
        initial_mm,
        hours=hours,
        irrigation_slot_mm=irrigation_mm,
        effective_rain_slot_mm=rain_mm,
        etc_mm_per_day=etc_mm_per_day,
        perc_mm_per_day=perc_mm_per_day,
        wlr_mm_per_day=wlr_mm_per_day,
        s_max_mm=s_max_mm,
    )
    depletion = slot_mm_from_daily_rate(etc_mm_per_day + perc_mm_per_day + wlr_mm_per_day, hours)
    raw = initial_mm + irrigation_mm + rain_mm - depletion
    assert 0.0 <= balance.storage_mm <= s_max_mm
    assert balance.storage_mm + balance.spill_mm - balance.unmet_mm == pytest.approx(
        raw, rel=1e-9, abs=1e-9
    )
    assert balance.spill_mm * balance.unmet_mm == 0.0


def test_ledger_initial_state_is_zeroed_with_unit_service_ratio() -> None:
    state = ServiceLedgerState.initial()
    assert state.delivered_ewma_m3 == 0.0
    assert state.target_ewma_m3 == 0.0
    assert state.debt_m3 == 0.0
    assert state.service_ratio == pytest.approx(1.0)


def test_ledger_first_step_opens_debt_for_unmet_fair_target() -> None:
    state = advance_ledger(
        ServiceLedgerState.initial(),
        delivered_m3=20.0,
        target_fair_m3=30.0,
        gamma=0.9,
        d_max_m3=100.0,
    )
    assert state.debt_m3 == pytest.approx(10.0)
    assert state.debt_capped is False
    assert state.delivered_ewma_m3 == pytest.approx(20.0)
    assert state.target_ewma_m3 == pytest.approx(30.0)
    assert state.service_ratio == pytest.approx(20.0 / 30.0)


def test_ledger_decays_previous_state_before_adding_new_slot() -> None:
    previous = ServiceLedgerState(delivered_ewma_m3=20.0, target_ewma_m3=30.0, debt_m3=10.0)
    state = advance_ledger(
        previous,
        delivered_m3=30.0,
        target_fair_m3=30.0,
        gamma=0.9,
        d_max_m3=100.0,
    )
    assert state.debt_m3 == pytest.approx(9.0)
    assert state.delivered_ewma_m3 == pytest.approx(0.9 * 20.0 + 30.0)
    assert state.target_ewma_m3 == pytest.approx(0.9 * 30.0 + 30.0)
    assert state.service_ratio == pytest.approx(48.0 / 57.0)


def test_ledger_overdelivery_clears_debt_to_zero() -> None:
    previous = ServiceLedgerState(delivered_ewma_m3=10.0, target_ewma_m3=10.0, debt_m3=5.0)
    state = advance_ledger(
        previous,
        delivered_m3=100.0,
        target_fair_m3=10.0,
        gamma=0.9,
        d_max_m3=50.0,
    )
    assert state.debt_m3 == 0.0
    assert state.debt_capped is False


def test_ledger_marks_capped_only_when_raw_debt_exceeds_cap() -> None:
    at_cap = advance_ledger(
        ServiceLedgerState.initial(),
        delivered_m3=0.0,
        target_fair_m3=5.0,
        gamma=0.9,
        d_max_m3=5.0,
    )
    beyond_cap = advance_ledger(
        ServiceLedgerState.initial(),
        delivered_m3=0.0,
        target_fair_m3=6.0,
        gamma=0.9,
        d_max_m3=5.0,
    )
    assert at_cap.debt_m3 == pytest.approx(5.0)
    assert at_cap.debt_capped is False
    assert beyond_cap.debt_m3 == pytest.approx(5.0)
    assert beyond_cap.debt_capped is True


def test_ledger_zero_target_reports_full_service_ratio() -> None:
    state = advance_ledger(
        ServiceLedgerState.initial(),
        delivered_m3=3.0,
        target_fair_m3=0.0,
        gamma=0.9,
        d_max_m3=50.0,
    )
    assert state.service_ratio == pytest.approx(1.0)


def test_ledger_rejects_invalid_forgetting_factor() -> None:
    with pytest.raises(DomainInvariantError):
        advance_ledger(
            ServiceLedgerState.initial(),
            delivered_m3=1.0,
            target_fair_m3=1.0,
            gamma=0.0,
            d_max_m3=10.0,
        )


@given(
    state=LEDGER_STATES,
    delivered_m3=NON_NEGATIVE_M3,
    target_fair_m3=NON_NEGATIVE_M3,
    gamma=GAMMAS,
    d_max_m3=st.floats(min_value=0.0, max_value=2_000.0, allow_nan=False, allow_infinity=False),
)
def test_ledger_debt_stays_bounded_and_capped_flag_matches_raw_debt(
    state: ServiceLedgerState,
    delivered_m3: float,
    target_fair_m3: float,
    gamma: float,
    d_max_m3: float,
) -> None:
    updated = advance_ledger(
        state,
        delivered_m3=delivered_m3,
        target_fair_m3=target_fair_m3,
        gamma=gamma,
        d_max_m3=d_max_m3,
    )
    raw_debt = gamma * state.debt_m3 + target_fair_m3 - delivered_m3
    assert 0.0 <= updated.debt_m3 <= d_max_m3
    assert updated.debt_capped == (raw_debt > d_max_m3)


@given(
    state=LEDGER_STATES,
    delivered_m3=NON_NEGATIVE_M3,
    base_target_m3=NON_NEGATIVE_M3,
    extra_target_m3=st.floats(
        min_value=0.0, max_value=1_000.0, allow_nan=False, allow_infinity=False
    ),
    gamma=GAMMAS,
)
def test_ledger_debt_is_monotone_in_fair_target(
    state: ServiceLedgerState,
    delivered_m3: float,
    base_target_m3: float,
    extra_target_m3: float,
    gamma: float,
) -> None:
    low = advance_ledger(
        state,
        delivered_m3=delivered_m3,
        target_fair_m3=base_target_m3,
        gamma=gamma,
        d_max_m3=2_000.0,
    )
    high = advance_ledger(
        state,
        delivered_m3=delivered_m3,
        target_fair_m3=base_target_m3 + extra_target_m3,
        gamma=gamma,
        d_max_m3=2_000.0,
    )
    assert high.debt_m3 >= low.debt_m3 - 1e-9


def test_adequacy_is_measured_against_required_not_fair_target() -> None:
    targets = block_targets(nominal_flow_lps=0.1)
    delivered_m3 = targets.target_fair_m3
    adequacy = adequacy_ratio(targets.target_req_m3, delivered_m3)
    assert delivered_m3 == pytest.approx(targets.target_phys_m3)
    assert adequacy == pytest.approx(delivered_m3 / targets.target_req_m3)
    assert adequacy < 1.0


def test_adequacy_is_full_when_requirement_is_met() -> None:
    assert adequacy_ratio(50.0, 50.0) == pytest.approx(1.0)
    assert adequacy_ratio(50.0, 65.0) >= 1.0


def test_adequacy_without_requirement_counts_as_full() -> None:
    assert adequacy_ratio(0.0, 0.0) == pytest.approx(1.0)


def test_agricultural_deficit_measures_the_delivery_gap() -> None:
    assert agricultural_deficit_m3(100.0, 60.0) == pytest.approx(40.0)
    assert agricultural_deficit_m3(100.0, 100.0) == 0.0


def test_structural_deficit_measures_the_capacity_gap() -> None:
    assert structural_deficit_m3(100.0, 60.0) == pytest.approx(40.0)
    assert structural_deficit_m3(100.0, 100.0) == 0.0
    assert structural_deficit_m3(100.0, 130.0) == 0.0


def test_agricultural_deficit_dominates_structural_when_delivery_within_capacity() -> None:
    agricultural = agricultural_deficit_m3(100.0, 50.0)
    structural = structural_deficit_m3(100.0, 60.0)
    assert agricultural > structural
    assert agricultural_deficit_m3(100.0, 60.0) == pytest.approx(structural)


@given(
    required_m3=NON_NEGATIVE_M3,
    capacity_m3=NON_NEGATIVE_M3,
    delivered_fraction=st.floats(
        min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
    ),
)
def test_agricultural_deficit_never_understates_structural_gap(
    required_m3: float,
    capacity_m3: float,
    delivered_fraction: float,
) -> None:
    delivered_m3 = capacity_m3 * delivered_fraction
    assert (
        agricultural_deficit_m3(required_m3, delivered_m3)
        >= structural_deficit_m3(required_m3, capacity_m3) - 1e-6
    )


def test_deficit_breakdown_reports_both_gaps_and_adequacy() -> None:
    breakdown = DeficitBreakdown.from_volumes(
        required_m3=100.0,
        delivered_m3=50.0,
        physical_capacity_m3=80.0,
    )
    assert breakdown.agricultural_deficit_m3 == pytest.approx(50.0)
    assert breakdown.structural_deficit_m3 == pytest.approx(20.0)
    assert breakdown.adequacy == pytest.approx(0.5)


def test_ledger_ratio_stays_full_while_adequacy_exposes_structural_shortfall() -> None:
    targets = block_targets(nominal_flow_lps=0.1)
    state = ServiceLedgerState.initial()
    delivered_total_m3 = 0.0
    for _ in range(2):
        state = advance_ledger(
            state,
            delivered_m3=targets.target_fair_m3,
            target_fair_m3=targets.target_fair_m3,
            gamma=0.9,
            d_max_m3=50.0,
        )
        delivered_total_m3 += targets.target_fair_m3
    assert state.service_ratio == pytest.approx(1.0)
    assert state.debt_m3 == 0.0
    adequacy = adequacy_ratio(targets.target_req_m3 * 2.0, delivered_total_m3)
    assert adequacy < 1.0
    assert adequacy == pytest.approx(delivered_total_m3 / (targets.target_req_m3 * 2.0))
