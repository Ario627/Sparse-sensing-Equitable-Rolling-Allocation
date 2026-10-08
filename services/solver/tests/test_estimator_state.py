from __future__ import annotations

from typing import Final

import numpy as np  # type: ignore
import pytest

from app.core.rng import generator_for
from app.core.types import DomainInvariantError, ReadingQuality
from app.demand.crop_water import slot_mm_from_daily_rate
from estimator.confidence import (
    calibration_error,
    coverage_rate,
    gaussian_interval,
    storage_intervals,
)
from estimator.observations import MeasurementBatch
from estimator.state import (
    DEFAULT_INITIAL_SIGMA_MM,
    DEFAULT_INITIAL_STORAGE_MM,
    StorageDynamicsParams,
    StorageEstimate,
    StorageForecastInput,
    correct_storage,
    delivery_mm_by_block,
    inflate_variance,
    initial_storage_estimate,
    predict_storage,
)

RNG_SEED: Final = 20_261_008
HECTARE_M2: Final = 10_000.0
PRIOR_MEAN_MM: Final = 50.0
PRIOR_VAR_MM2: Final = 225.0
MEASUREMENT_VAR_MM2: Final = 9.0
CALIBRATION_SAMPLES: Final = 600
COVERAGE_TOLERANCE: Final = 0.045


def estimate_with(
    means: list[float],
    variances: list[float],
    *,
    block_ids: tuple[str, ...] = ("b1",),
    slot_index: int = 0,
) -> StorageEstimate:
    return StorageEstimate(
        block_ids=block_ids,
        means_mm=np.array(means, dtype=float),
        variances_mm2=np.array(variances, dtype=float),
        slot_index=slot_index,
    )


def batch_with(
    value_mm: float,
    variance_mm2: float,
    *,
    block_id: str = "b1",
) -> MeasurementBatch:
    return MeasurementBatch(
        block_ids=(block_id,),
        values_mm=np.array([value_mm], dtype=float),
        variances_mm2=np.array([variance_mm2], dtype=float),
        qualities=(ReadingQuality.GOOD,),
    )


def forecast_with(
    *,
    delivered_mm: float = 0.0,
    etc_mm: float = 0.0,
    effective_rain_mm: float = 0.0,
    hours: float = 6.0,
) -> StorageForecastInput:
    return StorageForecastInput(
        delivered_mm_by_block={"b1": delivered_mm},
        etc_mm_by_block={"b1": etc_mm},
        effective_rain_mm=effective_rain_mm,
        hours=hours,
    )


def gains() -> tuple[float, float]:
    gain = PRIOR_VAR_MM2 / (PRIOR_VAR_MM2 + MEASUREMENT_VAR_MM2)
    return gain, (1.0 - gain) * PRIOR_VAR_MM2


def test_initial_storage_estimate_uses_default_prior() -> None:
    estimate = initial_storage_estimate(("b1", "b2"))
    assert len(estimate) == 2
    for block_id in estimate.block_ids:
        assert estimate.mean_of(block_id) == pytest.approx(DEFAULT_INITIAL_STORAGE_MM)
        assert estimate.std_of(block_id) == pytest.approx(DEFAULT_INITIAL_SIGMA_MM)
    assert estimate.slot_index == 0


def test_initial_storage_estimate_accepts_custom_prior() -> None:
    estimate = initial_storage_estimate(("b1",), initial_mm=30.0, initial_sigma_mm=5.0)
    assert estimate.mean_of("b1") == pytest.approx(30.0)
    assert estimate.variance_of("b1") == pytest.approx(25.0)


def test_storage_estimate_lookup_rejects_unknown_block() -> None:
    estimate = estimate_with([50.0], [225.0])
    with pytest.raises(DomainInvariantError):
        estimate.position_of("b9")


def test_storage_estimate_rejects_misaligned_arrays() -> None:
    with pytest.raises(DomainInvariantError):
        StorageEstimate(
            block_ids=("b1", "b2"),
            means_mm=np.array([50.0]),
            variances_mm2=np.array([225.0, 225.0]),
        )
    with pytest.raises(DomainInvariantError):
        estimate_with([50.0], [-1.0])


def test_storage_estimate_rejects_duplicate_blocks() -> None:
    with pytest.raises(DomainInvariantError):
        estimate_with([50.0, 50.0], [225.0, 225.0], block_ids=("b1", "b1"))


def test_storage_dynamics_defaults_follow_kp01_range() -> None:
    params = StorageDynamicsParams()
    assert params.percolation_mm_per_day == pytest.approx(2.0)
    assert params.s_max_mm == pytest.approx(100.0)
    assert params.process_sigma_mm_per_slot == pytest.approx(1.0)


def test_storage_dynamics_reject_invalid_bounds() -> None:
    with pytest.raises(DomainInvariantError):
        StorageDynamicsParams(percolation_mm_per_day=-1.0)
    with pytest.raises(DomainInvariantError):
        StorageDynamicsParams(s_max_mm=0.0)
    with pytest.raises(DomainInvariantError):
        StorageDynamicsParams(min_variance_mm2=0.0)


def test_delivery_mm_by_block_converts_gross_with_efficiency() -> None:
    delivery = delivery_mm_by_block(
        {"b1": 100.0},
        {"b1": 0.9},
        {"b1": HECTARE_M2},
    )
    assert delivery["b1"] == pytest.approx(9.0)


def test_delivery_mm_by_block_requires_efficiency_and_area() -> None:
    with pytest.raises(DomainInvariantError):
        delivery_mm_by_block({"b1": 100.0}, {}, {"b1": HECTARE_M2})
    with pytest.raises(DomainInvariantError):
        delivery_mm_by_block({"b1": 100.0}, {"b1": 0.9}, {})


def test_correct_storage_with_empty_batch_is_identity() -> None:
    estimate = estimate_with([50.0], [225.0])
    corrected = correct_storage(estimate, MeasurementBatch.empty(), StorageDynamicsParams())
    assert corrected is estimate


def test_correct_storage_blends_prior_and_measurement() -> None:
    estimate = estimate_with([PRIOR_MEAN_MM], [PRIOR_VAR_MM2])
    corrected = correct_storage(
        estimate,
        batch_with(60.0, MEASUREMENT_VAR_MM2),
        StorageDynamicsParams(),
    )
    gain, posterior_variance = gains()
    assert corrected.mean_of("b1") == pytest.approx(PRIOR_MEAN_MM + gain * 10.0)
    assert corrected.variance_of("b1") == pytest.approx(posterior_variance)
    assert corrected.std_of("b1") == pytest.approx(np.sqrt(posterior_variance))


def test_correct_storage_clips_above_field_capacity() -> None:
    estimate = estimate_with([99.0], [225.0])
    corrected = correct_storage(
        estimate,
        batch_with(500.0, MEASUREMENT_VAR_MM2),
        StorageDynamicsParams(),
    )
    assert corrected.mean_of("b1") == pytest.approx(100.0)


def test_correct_storage_never_increases_variance() -> None:
    estimate = estimate_with([50.0], [225.0])
    corrected = correct_storage(
        estimate,
        batch_with(55.0, MEASUREMENT_VAR_MM2),
        StorageDynamicsParams(),
    )
    assert corrected.variance_of("b1") < estimate.variance_of("b1")


def test_correct_storage_updates_only_measured_blocks() -> None:
    estimate = estimate_with([50.0, 40.0], [225.0, 100.0], block_ids=("b1", "b2"))
    corrected = correct_storage(
        estimate,
        batch_with(60.0, MEASUREMENT_VAR_MM2, block_id="b2"),
        StorageDynamicsParams(),
    )
    assert corrected.mean_of("b1") == pytest.approx(50.0)
    assert corrected.variance_of("b1") == pytest.approx(225.0)
    assert corrected.mean_of("b2") > 40.0


def test_inflate_variance_multiplies_spread_of_dropouts() -> None:
    estimate = estimate_with([50.0], [225.0])
    inflated = inflate_variance(estimate, factor=4.0)
    assert inflated.variance_of("b1") == pytest.approx(900.0)
    assert inflated.std_of("b1") == pytest.approx(30.0)
    assert inflated.mean_of("b1") == pytest.approx(50.0)


def test_inflate_variance_rejects_factor_below_one() -> None:
    estimate = estimate_with([50.0], [225.0])
    with pytest.raises(DomainInvariantError):
        inflate_variance(estimate, factor=0.5)


def test_predict_storage_balance_anchor() -> None:
    params = StorageDynamicsParams()
    estimate = estimate_with([40.0], [225.0])
    forecast = forecast_with(delivered_mm=5.0, etc_mm=5.0, effective_rain_mm=2.0)
    predicted = predict_storage(estimate, params, forecast)
    percolation_slot = slot_mm_from_daily_rate(params.percolation_mm_per_day, 6.0)
    wlr_slot = slot_mm_from_daily_rate(params.wlr_mm_per_day, 6.0)
    expected = 40.0 + 5.0 + 2.0 - 1.25 - percolation_slot - wlr_slot
    assert predicted.mean_of("b1") == pytest.approx(expected)
    assert predicted.slot_index == 1


def test_predict_storage_adds_process_variance() -> None:
    params = StorageDynamicsParams(process_sigma_mm_per_slot=2.0)
    estimate = estimate_with([40.0], [225.0])
    predicted = predict_storage(estimate, params, forecast_with())
    assert predicted.variance_of("b1") == pytest.approx(225.0 + 4.0)


def test_predict_storage_clips_to_storage_bounds() -> None:
    params = StorageDynamicsParams()
    high = predict_storage(
        estimate_with([99.0], [225.0]),
        params,
        forecast_with(delivered_mm=50.0, effective_rain_mm=10.0),
    )
    low = predict_storage(
        estimate_with([1.0], [225.0]),
        params,
        forecast_with(etc_mm=20.0),
    )
    assert high.mean_of("b1") == pytest.approx(100.0)
    assert low.mean_of("b1") == pytest.approx(0.0)


def test_predict_storage_requires_forecast_for_every_block() -> None:
    estimate = estimate_with([40.0, 40.0], [225.0, 225.0], block_ids=("b1", "b2"))
    with pytest.raises(DomainInvariantError):
        predict_storage(estimate, StorageDynamicsParams(), forecast_with())


def test_storage_intervals_wrap_means_and_spreads() -> None:
    estimate = estimate_with([50.0, 30.0], [225.0, 25.0], block_ids=("b1", "b2"))
    intervals = storage_intervals(estimate)
    assert set(intervals) == {"b1", "b2"}
    assert intervals["b1"].midpoint == pytest.approx(50.0)
    assert intervals["b1"].width == pytest.approx(2.0 * 1.959964 * 15.0, rel=1e-5)
    assert intervals["b2"].width < intervals["b1"].width


def test_coverage_helpers_validate_inputs() -> None:
    interval = gaussian_interval(50.0, 15.0)
    with pytest.raises(DomainInvariantError):
        coverage_rate([interval], [50.0, 51.0])
    with pytest.raises(DomainInvariantError):
        coverage_rate([], [])


def test_interval_coverage_calibrates_on_prior_draws() -> None:
    rng = generator_for(RNG_SEED, "calibration", "prior-95")
    truths = (PRIOR_MEAN_MM + 15.0 * rng.standard_normal(CALIBRATION_SAMPLES)).tolist()
    intervals = (gaussian_interval(PRIOR_MEAN_MM, 15.0, 0.95),) * CALIBRATION_SAMPLES
    coverage = coverage_rate(intervals, truths)
    assert abs(coverage - 0.95) < COVERAGE_TOLERANCE
    assert calibration_error(intervals, truths, 0.95) == pytest.approx(abs(coverage - 0.95))


def test_interval_coverage_calibrates_at_ninety_percent() -> None:
    rng = generator_for(RNG_SEED, "calibration", "prior-90")
    truths = (PRIOR_MEAN_MM + 15.0 * rng.standard_normal(CALIBRATION_SAMPLES)).tolist()
    intervals = (gaussian_interval(PRIOR_MEAN_MM, 15.0, 0.90),) * CALIBRATION_SAMPLES
    coverage = coverage_rate(intervals, truths)
    assert abs(coverage - 0.90) < COVERAGE_TOLERANCE


def test_interval_coverage_falls_when_spread_is_understated() -> None:
    rng = generator_for(RNG_SEED, "calibration", "narrow")
    truths = (PRIOR_MEAN_MM + 15.0 * rng.standard_normal(CALIBRATION_SAMPLES)).tolist()
    intervals = (gaussian_interval(PRIOR_MEAN_MM, 7.5, 0.95),) * CALIBRATION_SAMPLES
    coverage = coverage_rate(intervals, truths)
    assert coverage < 0.80
    assert calibration_error(intervals, truths, 0.95) > 0.10


def test_posterior_interval_calibrates_after_sensor_correction() -> None:
    rng = generator_for(RNG_SEED, "calibration", "posterior")
    truths = PRIOR_MEAN_MM + 15.0 * rng.standard_normal(CALIBRATION_SAMPLES)
    noise = 3.0 * rng.standard_normal(CALIBRATION_SAMPLES)
    params = StorageDynamicsParams()
    covered = 0
    for truth, disturbance in zip(truths.tolist(), noise.tolist(), strict=True):
        corrected = correct_storage(
            estimate_with([PRIOR_MEAN_MM], [PRIOR_VAR_MM2]),
            batch_with(truth + disturbance, MEASUREMENT_VAR_MM2),
            params,
        )
        interval = gaussian_interval(corrected.mean_of("b1"), corrected.std_of("b1"), 0.95)
        covered += int(interval.contains(truth))
    coverage = covered / CALIBRATION_SAMPLES
    assert abs(coverage - 0.95) < COVERAGE_TOLERANCE
