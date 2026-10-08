from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

import numpy as np  # type: ignore

from app.core.types import (
    DomainInvariantError,
    require_non_negative,
    require_positive,
)


def _require_probability(value: float, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"{name} must be a number")
    number = float(value)
    if not 0.0 <= number <= 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1]")
    return number


class SeasonKind(StrEnum):
    WET = "WET"
    DRY = "DRY"


class ForecastGrade(StrEnum):
    ACCURATE = "ACCURATE"
    MODERATE = "MODERATE"
    BAD = "BAD"


@dataclass(frozen=True, slots=True)
class DailyWeather:
    day_index: int
    rainfall_mm: float
    et0_mm_per_day: float
    temp_c: float

    def __post_init__(self) -> None:
        if (
            isinstance(self.day_index, bool)
            or not isinstance(self.day_index, int)
            or self.day_index < 0
        ):
            raise DomainInvariantError("day_index must be a non-negative integer")
        require_non_negative(self.rainfall_mm, "rainfall_mm")
        require_non_negative(self.et0_mm_per_day, "et0_mm_per_day")


@dataclass(frozen=True, slots=True)
class WeatherRegime:
    rain_continuation_prob: float
    rain_onset_prob: float
    rain_shape: float
    rain_scale_mm: float
    et0_mean_mm_per_day: float
    et0_sigma_mm_per_day: float
    temp_mean_c: float
    temp_sigma_c: float

    def __post_init__(self) -> None:
        _require_probability(self.rain_continuation_prob, "rain_continuation_prob")
        _require_probability(self.rain_onset_prob, "rain_onset_prob")
        require_positive(self.rain_shape, "rain_shape")
        require_positive(self.rain_scale_mm, "rain_scale_mm")
        require_non_negative(self.et0_mean_mm_per_day, "et0_mean_mm_per_day")
        require_non_negative(self.et0_sigma_mm_per_day, "et0_sigma_mm_per_day")
        require_non_negative(self.temp_sigma_c, "temp_sigma_c")


WET_SEASON_REGIME: Final = WeatherRegime(
    rain_continuation_prob=0.55,
    rain_onset_prob=0.35,
    rain_shape=1.6,
    rain_scale_mm=8.0,
    et0_mean_mm_per_day=4.0,
    et0_sigma_mm_per_day=0.8,
    temp_mean_c=27.0,
    temp_sigma_c=1.5,
)

DRY_SEASON_REGIME: Final = WeatherRegime(
    rain_continuation_prob=0.30,
    rain_onset_prob=0.10,
    rain_shape=1.2,
    rain_scale_mm=5.0,
    et0_mean_mm_per_day=5.0,
    et0_sigma_mm_per_day=1.0,
    temp_mean_c=28.0,
    temp_sigma_c=1.5,
)


@dataclass(frozen=True, slots=True)
class ForecastErrorSpec:
    et0_sigma_rel: float
    rain_miss_prob: float
    rain_false_alarm_prob: float
    rain_amount_sigma_rel: float
    temp_sigma_c: float
    false_alarm_mean_mm: float
    lead_growth: float

    def __post_init__(self) -> None:
        require_non_negative(self.et0_sigma_rel, "et0_sigma_rel")
        _require_probability(self.rain_miss_prob, "rain_miss_prob")
        _require_probability(self.rain_false_alarm_prob, "rain_false_alarm_prob")
        require_non_negative(self.rain_amount_sigma_rel, "rain_amount_sigma_rel")
        require_non_negative(self.temp_sigma_c, "temp_sigma_c")
        require_positive(self.false_alarm_mean_mm, "false_alarm_mean_mm")
        require_non_negative(self.lead_growth, "lead_growth")


@dataclass(frozen=True, slots=True)
class ForecastDay:
    day_index: int
    rainfall_mm: float
    et0_mm_per_day: float
    temp_c: float

    def __post_init__(self) -> None:
        if (
            isinstance(self.day_index, bool)
            or not isinstance(self.day_index, int)
            or self.day_index < 0
        ):
            raise DomainInvariantError("day_index must be a non-negative integer")
        require_non_negative(self.rainfall_mm, "rainfall_mm")
        require_non_negative(self.et0_mm_per_day, "et0_mm_per_day")


FORECAST_ERROR_SPECS: Final[dict[ForecastGrade, ForecastErrorSpec]] = {
    ForecastGrade.ACCURATE: ForecastErrorSpec(
        et0_sigma_rel=0.05,
        rain_miss_prob=0.05,
        rain_false_alarm_prob=0.05,
        rain_amount_sigma_rel=0.15,
        temp_sigma_c=1.0,
        false_alarm_mean_mm=4.0,
        lead_growth=0.05,
    ),
    ForecastGrade.MODERATE: ForecastErrorSpec(
        et0_sigma_rel=0.15,
        rain_miss_prob=0.25,
        rain_false_alarm_prob=0.20,
        rain_amount_sigma_rel=0.40,
        temp_sigma_c=1.8,
        false_alarm_mean_mm=5.0,
        lead_growth=0.10,
    ),
    ForecastGrade.BAD: ForecastErrorSpec(
        et0_sigma_rel=0.30,
        rain_miss_prob=0.50,
        rain_false_alarm_prob=0.40,
        rain_amount_sigma_rel=0.70,
        temp_sigma_c=3.0,
        false_alarm_mean_mm=6.0,
        lead_growth=0.20,
    ),
}


def regime_for(season: SeasonKind | str) -> WeatherRegime:
    try:
        kind = SeasonKind(season)
    except ValueError as error:
        raise DomainInvariantError(f"unknown season kind: {season!r}") from error
    return WET_SEASON_REGIME if kind is SeasonKind.WET else DRY_SEASON_REGIME


def forecast_error_for(grade: ForecastGrade | str) -> ForecastErrorSpec:
    try:
        kind = ForecastGrade(grade)
    except ValueError as error:
        raise DomainInvariantError(f"unknown forecast grade: {grade!r}") from error
    return FORECAST_ERROR_SPECS[kind]


def _rain_probability(regime: WeatherRegime, *, was_wet: bool) -> float:
    return regime.rain_continuation_prob if was_wet else regime.rain_onset_prob


def sample_truth_day(
    rng: np.random.Generator,
    regime: WeatherRegime,
    *,
    day_index: int,
    was_wet: bool,
) -> tuple[DailyWeather, bool]:
    if isinstance(day_index, bool) or not isinstance(day_index, int) or day_index < 0:
        raise DomainInvariantError("day_index must be a non-negative integer")
    wet_roll = float(rng.random())
    amount_roll = float(rng.gamma(regime.rain_shape, regime.rain_scale_mm))
    et0_roll = float(rng.standard_normal())
    temp_roll = float(rng.standard_normal())
    is_wet = wet_roll < _rain_probability(regime, was_wet=was_wet)
    rainfall = amount_roll if is_wet else 0.0
    et0 = max(
        0.0,
        regime.et0_mean_mm_per_day + regime.et0_sigma_mm_per_day * et0_roll,
    )
    temperature = regime.temp_mean_c + regime.temp_sigma_c * temp_roll
    return (
        DailyWeather(
            day_index=day_index,
            rainfall_mm=rainfall,
            et0_mm_per_day=et0,
            temp_c=temperature,
        ),
        is_wet,
    )


def sample_truth_series(
    rng: np.random.Generator,
    regime: WeatherRegime,
    *,
    days: int,
    initial_wet: bool = False,
) -> tuple[DailyWeather, ...]:
    if isinstance(days, bool) or not isinstance(days, int) or days < 1:
        raise DomainInvariantError("days must be a positive integer")
    series: list[DailyWeather] = []
    was_wet = initial_wet
    for day_index in range(days):
        day, was_wet = sample_truth_day(rng, regime, day_index=day_index, was_wet=was_wet)
        series.append(day)
    return tuple(series)


def forecast_horizon(
    rng: np.random.Generator,
    truth: Sequence[DailyWeather],
    *,
    start_index: int,
    horizon: int,
    spec: ForecastErrorSpec,
) -> tuple[ForecastDay, ...]:
    if isinstance(start_index, bool) or not isinstance(start_index, int) or start_index < 0:
        raise DomainInvariantError("start_index must be a non-negative integer")
    if isinstance(horizon, bool) or not isinstance(horizon, int) or horizon < 1:
        raise DomainInvariantError("horizon must be a positive integer")
    if start_index + horizon > len(truth):
        raise DomainInvariantError("forecast horizon exceeds available truth series")
    forecast: list[ForecastDay] = []
    for lead in range(horizon):
        day = truth[start_index + lead]
        scale = 1.0 + spec.lead_growth * lead
        et0_roll = float(rng.standard_normal())
        temp_roll = float(rng.standard_normal())
        amount_roll = float(rng.standard_normal())
        miss_roll = float(rng.random())
        alarm_roll = float(rng.random())
        et0 = day.et0_mm_per_day * float(np.exp(spec.et0_sigma_rel * scale * et0_roll))
        temperature = day.temp_c + spec.temp_sigma_c * scale * temp_roll
        if day.rainfall_mm > 0.0:
            rainfall = (
                0.0
                if miss_roll < spec.rain_miss_prob
                else day.rainfall_mm
                * float(np.exp(spec.rain_amount_sigma_rel * scale * amount_roll))
            )
        else:
            rainfall = (
                spec.false_alarm_mean_mm * float(np.exp(0.5 * scale * amount_roll))
                if alarm_roll < spec.rain_false_alarm_prob
                else 0.0
            )
        forecast.append(
            ForecastDay(
                day_index=day.day_index,
                rainfall_mm=rainfall,
                et0_mm_per_day=et0,
                temp_c=temperature,
            )
        )
    return tuple(forecast)
