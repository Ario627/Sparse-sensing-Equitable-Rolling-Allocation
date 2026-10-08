from __future__ import annotations

from typing import Final

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.core.rng import generator_for
from app.core.types import DomainInvariantError, ReadingQuality, SensorKind
from simulator.sensors import (
    LevelRating,
    LevelSensorSpec,
    SensorNoiseLevel,
    create_level_sensor,
    fail_sensor,
    flow_lps_from_level,
    observe_level,
    recover_sensor,
)

RNG_SEED: Final = 20_261_008
STALE_AFTER: Final = 3
TRUTH_MM: Final = 50.0


def clean_spec(
    *,
    noise_sigma_mm: float = 0.0,
    bias_drift_sigma_mm: float = 0.0,
    bias_limit_mm: float = 10.0,
    dropout_prob: float = 0.0,
    stuck_prob: float = 0.0,
    unstuck_prob: float = 1.0,
    stale_after_samples: int = STALE_AFTER,
) -> LevelSensorSpec:
    return LevelSensorSpec(
        noise_sigma_mm=noise_sigma_mm,
        bias_drift_sigma_mm=bias_drift_sigma_mm,
        bias_limit_mm=bias_limit_mm,
        dropout_prob=dropout_prob,
        stuck_prob=stuck_prob,
        unstuck_prob=unstuck_prob,
        stale_after_samples=stale_after_samples,
    )


def test_noise_presets_follow_the_documented_grades() -> None:
    low = LevelSensorSpec.from_noise_level(SensorNoiseLevel.LOW)
    medium = LevelSensorSpec.from_noise_level(SensorNoiseLevel.MEDIUM)
    high = LevelSensorSpec.from_noise_level(SensorNoiseLevel.HIGH)
    assert low.noise_sigma_mm == pytest.approx(1.0)
    assert medium.noise_sigma_mm == pytest.approx(3.0)
    assert high.noise_sigma_mm == pytest.approx(8.0)
    assert low.dropout_prob == 0.0
    assert high.dropout_prob > medium.dropout_prob > low.dropout_prob


def test_noise_preset_lookup_accepts_names_and_rejects_unknown() -> None:
    assert LevelSensorSpec.from_noise_level("LOW") == LevelSensorSpec.from_noise_level(
        SensorNoiseLevel.LOW
    )
    with pytest.raises(DomainInvariantError):
        LevelSensorSpec.from_noise_level("low")
    with pytest.raises(DomainInvariantError):
        LevelSensorSpec.from_noise_level("EXTREME")


def test_noise_free_sensor_reports_exact_truth() -> None:
    spec = clean_spec()
    state = create_level_sensor("lvl-b1", spec)
    next_state, sample = observe_level(
        state, TRUTH_MM, sample_index=0, rng=generator_for(RNG_SEED, "sensors", "clean")
    )
    assert sample is not None
    assert sample.sensor_id == "lvl-b1"
    assert sample.kind is SensorKind.WATER_LEVEL
    assert sample.sample_index == 0
    assert sample.value == pytest.approx(TRUTH_MM)
    assert sample.quality is ReadingQuality.GOOD
    assert next_state.bias_mm == 0.0
    assert next_state.stuck is False


def test_dropout_returns_no_sample_and_keeps_state() -> None:
    spec = clean_spec(dropout_prob=1.0)
    state = create_level_sensor("lvl-b1", spec)
    next_state, sample = observe_level(
        state, TRUTH_MM, sample_index=0, rng=generator_for(RNG_SEED, "sensors", "dropout")
    )
    assert sample is None
    assert next_state == state


def test_failed_sensor_suppresses_samples_until_expiry() -> None:
    spec = clean_spec()
    state = create_level_sensor("lvl-b1", spec)
    state = fail_sensor(state, until_index=3)
    rng = generator_for(RNG_SEED, "sensors", "failure")
    for index in range(3):
        state, sample = observe_level(state, TRUTH_MM, sample_index=index, rng=rng)
        assert sample is None
    state, sample = observe_level(state, TRUTH_MM, sample_index=3, rng=rng)
    assert sample is not None
    assert state.failed_until_index is None


def test_recover_sensor_clears_failure_immediately() -> None:
    spec = clean_spec()
    state = create_level_sensor("lvl-b1", spec)
    state = recover_sensor(fail_sensor(state, until_index=10))
    _, sample = observe_level(
        state, TRUTH_MM, sample_index=0, rng=generator_for(RNG_SEED, "sensors", "recover")
    )
    assert sample is not None


def test_fail_sensor_rejects_negative_index() -> None:
    state = create_level_sensor("lvl-b1", clean_spec())
    with pytest.raises(DomainInvariantError):
        fail_sensor(state, until_index=-1)


def test_stuck_sensor_holds_value_and_degrades_quality() -> None:
    spec = clean_spec(stuck_prob=1.0, unstuck_prob=0.0)
    state = create_level_sensor("lvl-b1", spec)
    rng = generator_for(RNG_SEED, "sensors", "stuck")
    qualities: list[ReadingQuality] = []
    values: list[float] = []
    for index in range(STALE_AFTER + 3):
        state, sample = observe_level(state, TRUTH_MM, sample_index=index, rng=rng)
        assert sample is not None
        qualities.append(sample.quality)
        values.append(sample.value)
    assert qualities[0] is ReadingQuality.SUSPECT
    assert all(quality is ReadingQuality.SUSPECT for quality in qualities[: STALE_AFTER + 1])
    assert all(quality is ReadingQuality.STALE for quality in qualities[STALE_AFTER + 1 :])
    assert len(set(values)) == 1


def test_stuck_sensor_returns_to_fresh_readings_when_unstuck() -> None:
    spec = clean_spec(stuck_prob=1.0, unstuck_prob=1.0)
    state = create_level_sensor("lvl-b1", spec)
    rng = generator_for(RNG_SEED, "sensors", "unstuck")
    state, first = observe_level(state, TRUTH_MM, sample_index=0, rng=rng)
    assert first is not None
    assert first.quality is ReadingQuality.SUSPECT
    _, second = observe_level(state, TRUTH_MM, sample_index=1, rng=rng)
    assert second is not None
    assert second.quality is ReadingQuality.GOOD
    assert second.value == pytest.approx(TRUTH_MM)


def test_sample_sequence_is_seed_deterministic() -> None:
    spec = clean_spec(noise_sigma_mm=2.0, bias_drift_sigma_mm=0.1)

    def run(labels: tuple[str, ...]) -> list[float]:
        state = create_level_sensor("lvl-b1", spec)
        rng = generator_for(RNG_SEED, "sensors", "sequence", *labels)
        values: list[float] = []
        for index in range(25):
            state, sample = observe_level(state, 42.0, sample_index=index, rng=rng)
            assert sample is not None
            values.append(sample.value)
        return values

    assert run(("a",)) == run(("a",))
    assert run(("a",)) != run(("b",))


def test_observe_rejects_negative_truth() -> None:
    state = create_level_sensor("lvl-b1", clean_spec())
    with pytest.raises(DomainInvariantError):
        observe_level(state, -1.0, sample_index=0, rng=generator_for(RNG_SEED, "sensors", "neg"))


def test_rating_curve_follows_power_law_in_metres() -> None:
    rating = LevelRating(coefficient_lps_per_m_pow=100.0, exponent=1.5)
    assert flow_lps_from_level(200.0, rating) == pytest.approx(100.0 * 0.2**1.5)
    assert flow_lps_from_level(0.0, rating) == 0.0


def test_rating_curve_rejects_negative_level() -> None:
    rating = LevelRating(coefficient_lps_per_m_pow=100.0, exponent=1.5)
    with pytest.raises(DomainInvariantError):
        flow_lps_from_level(-5.0, rating)


def test_rating_rejects_degenerate_coefficients() -> None:
    with pytest.raises(DomainInvariantError):
        LevelRating(coefficient_lps_per_m_pow=0.0, exponent=1.0)
    with pytest.raises(DomainInvariantError):
        LevelRating(coefficient_lps_per_m_pow=1.0, exponent=0.0)


@given(
    bias_sigma=st.floats(min_value=0.01, max_value=2.0, allow_nan=False, allow_infinity=False),
    bias_limit=st.floats(min_value=0.5, max_value=5.0, allow_nan=False, allow_infinity=False),
)
def test_sensor_bias_stays_within_configured_limit(bias_sigma: float, bias_limit: float) -> None:
    spec = clean_spec(bias_drift_sigma_mm=bias_sigma, bias_limit_mm=bias_limit)
    state = create_level_sensor("lvl-b1", spec)
    rng = generator_for(RNG_SEED, "sensors", "bias", bias_sigma, bias_limit)
    for index in range(120):
        state, sample = observe_level(state, TRUTH_MM, sample_index=index, rng=rng)
        assert sample is not None
        assert abs(state.bias_mm) <= bias_limit + 1e-9
