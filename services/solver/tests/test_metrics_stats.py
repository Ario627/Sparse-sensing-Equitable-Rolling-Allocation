from __future__ import annotations

import math
from typing import Final

import numpy as np  # type: ignore
import pytest

from app.core.rng import generator_for
from app.core.types import DomainInvariantError, Interval
from experiments.metrics import (
    SlotRecord,
    SolverTelemetry,
    adequacy,
    agricultural_deficit_m3,
    coefficient_of_variation,
    compute_run_metrics,
    cvar_shortage_m3,
    delivered_total_m3,
    dependability,
    efficiency,
    fair_target_total_m3,
    gate_switch_count,
    gini_coefficient,
    gross_total_m3,
    per_block_service_ratio,
    required_total_m3,
    rmse,
    service_ratio,
    shortage_total_m3,
    shortfall_m3,
    spatial_equity_cv,
    spatial_equity_gini,
    tail_deficit_m3,
    worst_service_ratio,
)
from experiments.stats import (
    SignedRankResult,
    bootstrap_ci,
    holm_adjust,
    knee_point,
    mean_statistic,
    median_statistic,
    paired_differences,
    rank_correlation,
    signed_rank,
    summarize,
)

RNG_SEED: Final = 20_261_008
BOOTSTRAP_RESAMPLES: Final = 500


def record(
    block_id: str,
    slot_index: int,
    *,
    delivered_m3: float,
    required_m3: float = 10.0,
    fair_target_m3: float = 10.0,
    gross_m3: float = 12.0,
    gate_open: bool = True,
) -> SlotRecord:
    return SlotRecord(
        block_id=block_id,
        slot_index=slot_index,
        delivered_m3=delivered_m3,
        required_m3=required_m3,
        fair_target_m3=fair_target_m3,
        gross_m3=gross_m3,
        gate_open=gate_open,
    )


def per_slot_records(block_id: str, shortfalls: list[float]) -> tuple[SlotRecord, ...]:
    return tuple(
        record(block_id, slot, delivered_m3=10.0 - shortfall, fair_target_m3=10.0)
        for slot, shortfall in enumerate(shortfalls)
    )


def test_slot_record_validates_its_fields() -> None:
    with pytest.raises(DomainInvariantError):
        record("b1", -1, delivered_m3=0.0)
    with pytest.raises(DomainInvariantError):
        record("b1", 0, delivered_m3=-0.5)
    with pytest.raises(DomainInvariantError):
        record("", 0, delivered_m3=0.0)


def test_shortfall_and_deficit_helpers_floor_at_zero() -> None:
    covered = record("b1", 0, delivered_m3=12.0)
    deficit = record("b1", 0, delivered_m3=6.0, required_m3=9.0)
    assert shortfall_m3(covered) == 0.0
    assert shortfall_m3(deficit) == pytest.approx(4.0)
    assert agricultural_deficit_m3(covered) == 0.0
    assert agricultural_deficit_m3(deficit) == pytest.approx(3.0)
    assert service_ratio(covered) == pytest.approx(1.2)
    assert service_ratio(deficit) == pytest.approx(0.6)
    assert service_ratio(record("b1", 0, delivered_m3=0.0, fair_target_m3=0.0)) == pytest.approx(
        1.0
    )


def test_totals_sum_across_records() -> None:
    records = (
        record("b1", 0, delivered_m3=5.0, required_m3=8.0, fair_target_m3=7.0, gross_m3=9.0),
        record("b2", 0, delivered_m3=3.0, required_m3=4.0, fair_target_m3=4.0, gross_m3=5.0),
    )
    assert delivered_total_m3(records) == pytest.approx(8.0)
    assert required_total_m3(records) == pytest.approx(12.0)
    assert fair_target_total_m3(records) == pytest.approx(11.0)
    assert gross_total_m3(records) == pytest.approx(14.0)
    assert shortage_total_m3(records) == pytest.approx(3.0)
    with pytest.raises(DomainInvariantError):
        delivered_total_m3(())


def test_adequacy_uses_required_target_not_fair_target() -> None:
    records = (
        record("b1", 0, delivered_m3=5.0, required_m3=10.0, fair_target_m3=5.0),
        record("b2", 0, delivered_m3=5.0, required_m3=10.0, fair_target_m3=5.0),
    )
    assert adequacy(records) == pytest.approx(0.5)
    assert adequacy((record("b1", 0, delivered_m3=0.0, required_m3=0.0),)) == pytest.approx(1.0)


def test_efficiency_reports_none_without_withdrawal() -> None:
    records = (record("b1", 0, delivered_m3=4.0, gross_m3=5.0),)
    assert efficiency(records) == pytest.approx(0.8)
    assert efficiency((record("b1", 0, delivered_m3=0.0, gross_m3=0.0),)) is None


def test_dependability_counts_fulfilled_records() -> None:
    records = (
        record("b1", 0, delivered_m3=10.0, fair_target_m3=10.0),
        record("b1", 1, delivered_m3=9.0, fair_target_m3=10.0),
        record("b1", 2, delivered_m3=11.0, fair_target_m3=10.0),
    )
    assert dependability(records) == pytest.approx(2.0 / 3.0)


def test_per_block_service_ratio_aggregates_per_block() -> None:
    records = (
        record("b1", 0, delivered_m3=5.0, fair_target_m3=10.0),
        record("b1", 1, delivered_m3=10.0, fair_target_m3=10.0),
        record("b2", 0, delivered_m3=20.0, fair_target_m3=10.0),
    )
    ratios = per_block_service_ratio(records)
    assert ratios["b1"] == pytest.approx(0.75)
    assert ratios["b2"] == pytest.approx(2.0)


def test_gini_and_variation_anchors() -> None:
    assert gini_coefficient((0.5, 0.5)) == pytest.approx(0.0)
    assert gini_coefficient((0.0, 1.0)) == pytest.approx(0.5)
    assert gini_coefficient((0.0, 0.0)) == pytest.approx(0.0)
    assert coefficient_of_variation((1.0, 1.0)) == pytest.approx(0.0)
    assert coefficient_of_variation((0.0, 2.0)) == pytest.approx(1.0)
    assert coefficient_of_variation((0.0, 0.0)) == pytest.approx(0.0)


def test_spatial_equity_uses_block_service_ratios() -> None:
    balanced = (
        record("b1", 0, delivered_m3=10.0, fair_target_m3=10.0),
        record("b2", 0, delivered_m3=10.0, fair_target_m3=10.0),
    )
    skewed = (
        record("b1", 0, delivered_m3=20.0, fair_target_m3=10.0),
        record("b2", 0, delivered_m3=0.0, fair_target_m3=10.0),
    )
    assert spatial_equity_gini(balanced) == pytest.approx(0.0)
    assert spatial_equity_gini(skewed) > 0.2
    assert spatial_equity_cv(balanced) == pytest.approx(0.0)
    assert worst_service_ratio(skewed) == pytest.approx(0.0)


def test_tail_deficit_selects_named_blocks() -> None:
    records = (
        record("b1", 0, delivered_m3=10.0, required_m3=10.0),
        record("b2", 0, delivered_m3=6.0, required_m3=10.0),
        record("b3", 0, delivered_m3=2.0, required_m3=10.0),
    )
    assert tail_deficit_m3(records, ("b2", "b3")) == pytest.approx(12.0)
    with pytest.raises(DomainInvariantError):
        tail_deficit_m3(records, ())
    with pytest.raises(DomainInvariantError):
        tail_deficit_m3(records, ("b9",))


def test_cvar_shortage_concentrates_on_worst_slots() -> None:
    records = per_slot_records("b1", [float(slot) for slot in range(10)])
    assert shortage_total_m3(records) == pytest.approx(45.0)
    assert cvar_shortage_m3(records, alpha=0.9) == pytest.approx(9.0)
    assert cvar_shortage_m3(records, alpha=0.8) == pytest.approx(8.5)
    with pytest.raises(DomainInvariantError):
        cvar_shortage_m3(records, alpha=1.0)


def test_rmse_matches_closed_form() -> None:
    truth = (1.0, 2.0, 3.0)
    estimate = (2.0, 2.0, 2.0)
    assert rmse(truth, estimate) == pytest.approx(math.sqrt(2.0 / 3.0))
    with pytest.raises(DomainInvariantError):
        rmse(truth, (1.0, 2.0))


def test_gate_switch_count_counts_transitions_per_block() -> None:
    records = (
        record("b1", 0, delivered_m3=1.0, gate_open=True),
        record("b1", 1, delivered_m3=1.0, gate_open=False),
        record("b1", 2, delivered_m3=1.0, gate_open=True),
        record("b2", 0, delivered_m3=1.0, gate_open=True),
        record("b2", 1, delivered_m3=1.0, gate_open=True),
    )
    assert gate_switch_count(records) == 2


def test_compute_run_metrics_assembles_every_field() -> None:
    records = (
        record("b1", 0, delivered_m3=8.0, required_m3=10.0, fair_target_m3=10.0, gross_m3=10.0),
        record("b1", 1, delivered_m3=10.0, required_m3=10.0, fair_target_m3=10.0, gross_m3=11.0),
    )
    metrics = compute_run_metrics(
        records,
        SolverTelemetry(solve_seconds_total=1.5, n_resolves=3, mip_gap=0.01),
        cvar_alpha=0.9,
        tail_block_ids=("b1",),
        truth_storage_mm=(50.0, 52.0),
        estimate_storage_mm=(49.0, 53.0),
        fallback_used=True,
    )
    assert metrics.adequacy == pytest.approx(0.9)
    assert metrics.efficiency == pytest.approx(18.0 / 21.0)
    assert metrics.dependability == pytest.approx(0.5)
    assert metrics.worst_sr == pytest.approx(0.9)
    assert metrics.shortage_total_m3 == pytest.approx(2.0)
    assert metrics.tail_deficit_m3 == pytest.approx(2.0)
    assert metrics.cvar_shortage_m3 == pytest.approx(2.0)
    assert metrics.state_rmse == pytest.approx(math.sqrt(1.0))
    assert metrics.solve_time_ms == pytest.approx(1500.0)
    assert metrics.mip_gap == pytest.approx(0.01)
    assert metrics.n_resolves == 3
    assert metrics.gate_switches == 0
    assert metrics.fallback_used is True
    assert metrics.decision_regret is None


def test_compute_run_metrics_rejects_partial_storage_series() -> None:
    records = (record("b1", 0, delivered_m3=1.0),)
    with pytest.raises(DomainInvariantError):
        compute_run_metrics(
            records,
            SolverTelemetry(solve_seconds_total=0.1, n_resolves=1),
            cvar_alpha=0.9,
            truth_storage_mm=(50.0,),
        )


def test_mean_and_median_statistics_reduce_the_sample_axis() -> None:
    samples = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
    assert tuple(mean_statistic(samples)) == pytest.approx((2.0, 5.0))
    assert tuple(median_statistic(samples)) == pytest.approx((2.0, 5.0))


def test_paired_differences_requires_matching_lengths() -> None:
    assert paired_differences((3.0, 5.0), (1.0, 2.0)) == pytest.approx((2.0, 3.0))
    with pytest.raises(DomainInvariantError):
        paired_differences((1.0,), (1.0, 2.0))


def test_bootstrap_ci_is_deterministic_and_level_shrinks_width() -> None:
    rng = generator_for(RNG_SEED, "stats", "samples")
    samples = tuple(1.0 + 0.5 * float(value) for value in rng.standard_normal(40))
    first = bootstrap_ci(samples, level=0.95, resamples=BOOTSTRAP_RESAMPLES, seed=RNG_SEED)
    second = bootstrap_ci(samples, level=0.95, resamples=BOOTSTRAP_RESAMPLES, seed=RNG_SEED)
    tighter = bootstrap_ci(samples, level=0.80, resamples=BOOTSTRAP_RESAMPLES, seed=RNG_SEED)
    assert first == second
    assert first.lower <= first.upper
    assert tighter.width < first.width
    assert isinstance(first, Interval)


def test_summarize_reports_mean_median_and_interval() -> None:
    samples = tuple(float(value) for value in range(10))
    summary = summarize(samples, resamples=BOOTSTRAP_RESAMPLES, seed=RNG_SEED)
    assert summary.n == 10
    assert summary.mean == pytest.approx(4.5)
    assert summary.median == pytest.approx(4.5)
    assert summary.ci.lower <= summary.ci.upper
    with pytest.raises(DomainInvariantError):
        summarize((), resamples=BOOTSTRAP_RESAMPLES, seed=RNG_SEED)
    with pytest.raises(DomainInvariantError):
        summarize(samples, resamples=10, seed=RNG_SEED)


def test_signed_rank_handles_degenerate_and_shifted_samples() -> None:
    flat = signed_rank((0.0, 0.0, 0.0))
    assert flat == SignedRankResult(statistic=0.0, p_value=1.0, n_effective=0, rank_biserial=0.0)
    rng = generator_for(RNG_SEED, "stats", "shifted")
    shifted = tuple(0.5 + 0.1 * float(value) for value in rng.standard_normal(30))
    result = signed_rank(shifted)
    assert result.p_value < 0.05
    assert result.rank_biserial > 0.0
    assert result.n_effective == 30


def test_rank_correlation_detects_monotonic_relations() -> None:
    increasing = rank_correlation((1.0, 2.0, 3.0, 4.0), (10.0, 20.0, 30.0, 40.0))
    decreasing = rank_correlation((1.0, 2.0, 3.0, 4.0), (40.0, 30.0, 20.0, 10.0))
    assert increasing.rho == pytest.approx(1.0)
    assert decreasing.rho == pytest.approx(-1.0)
    with pytest.raises(DomainInvariantError):
        rank_correlation((1.0, 1.0, 1.0), (1.0, 2.0, 3.0))
    with pytest.raises(DomainInvariantError):
        rank_correlation((1.0, 2.0), (1.0, 2.0))


def test_knee_point_finds_the_elbow() -> None:
    knee = knee_point((1.0, 2.0, 3.0, 4.0, 5.0), (0.0, 0.1, 1.0, 1.05, 1.06))
    assert knee is not None
    assert knee.index == 2
    assert knee.x == pytest.approx(3.0)
    assert knee.distance > 0.0


def test_knee_point_returns_none_for_flat_series() -> None:
    assert knee_point((1.0, 2.0, 3.0), (5.0, 5.0, 5.0)) is None
    with pytest.raises(DomainInvariantError):
        knee_point((1.0, 2.0), (1.0, 2.0))
    with pytest.raises(DomainInvariantError):
        knee_point((3.0, 2.0, 1.0), (1.0, 2.0, 3.0))


def test_holm_adjust_is_monotone_in_rank_order() -> None:
    adjusted = holm_adjust((0.01, 0.02, 0.03))
    assert adjusted == pytest.approx((0.03, 0.04, 0.04))
    assert holm_adjust(()) == ()
    capped = holm_adjust((0.5, 0.6))
    assert capped == pytest.approx((1.0, 1.0))
    with pytest.raises(DomainInvariantError):
        holm_adjust((1.5,))
