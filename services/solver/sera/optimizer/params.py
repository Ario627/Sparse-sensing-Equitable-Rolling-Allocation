from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from sera.core.types import DomainInvariantError, require_finite, require_identifier

GAMMA_DEFAULT = 0.90
EPSILON_LEXICOGRAPHIC_DEFAULT = 0.01
CVAR_ALPHA_DEFAULT = 0.90
SHORTAGE_LAMBDA_DEFAULT = 0.0
TAU_SUPPLY_DRIFT_DEFAULT = 0.15
TAU_SERVICE_FLOOR_DEFAULT = 0.05
TAU_FORECAST_DEFAULT = 0.20
HEARTBEAT_INTERVAL_MIN_DEFAULT = 1440.0
KC_PADDY_VEGETATIVE_DEFAULT = 1.10
KC_PADDY_REPRODUCTIVE_DEFAULT = 1.27
PERCOLATION_MM_PER_DAY_DEFAULT = 2.0
WLR_MM_PER_APPLICATION_DEFAULT = 50.0


class ParameterStatus(StrEnum):
    DESIGN = "DESIGN"
    FACT = "FACT"
    HYPOTHESIS = "HYPOTHESIS"


@dataclass(frozen=True, slots=True)
class ParameterEntry:
    key: str
    value: float | None
    lower: float | None
    upper: float | None
    unit: str | None
    status: ParameterStatus
    source: str

    def __post_init__(self) -> None:
        require_identifier(self.key, "key")
        require_identifier(self.source, "source")
        resolved_value = _optional_finite(self.value, "value")
        resolved_lower = _optional_finite(self.lower, "lower")
        resolved_upper = _optional_finite(self.upper, "upper")
        if (
            resolved_lower is not None
            and resolved_upper is not None
            and resolved_upper < resolved_lower
        ):
            raise DomainInvariantError("upper bound must be >= lower bound")
        if resolved_value is not None:
            if resolved_lower is not None and resolved_value < resolved_lower:
                raise DomainInvariantError("value lies below the lower bound")
            if resolved_upper is not None and resolved_value > resolved_upper:
                raise DomainInvariantError("value lies above the upper bound")


def _optional_finite(value: float | None, name: str) -> float | None:
    if value is None:
        return None
    return require_finite(value, name)


DEFAULT_CATALOG: tuple[ParameterEntry, ...] = (
    ParameterEntry(
        key="gamma",
        value=GAMMA_DEFAULT,
        lower=0.80,
        upper=0.95,
        unit=None,
        status=ParameterStatus.DESIGN,
        source="docs 04 section 7.5; sweep in E3",
    ),
    ParameterEntry(
        key="debt_max_m3",
        value=None,
        lower=None,
        upper=None,
        unit="m3",
        status=ParameterStatus.DESIGN,
        source="docs 04 section 7.2; uniform vs per-block open question section 16.2",
    ),
    ParameterEntry(
        key="epsilon_lexicographic",
        value=EPSILON_LEXICOGRAPHIC_DEFAULT,
        lower=None,
        upper=None,
        unit=None,
        status=ParameterStatus.DESIGN,
        source="docs 04 section 8.7 nominal; per-stage tolerances live in StageTolerances",
    ),
    ParameterEntry(
        key="cvar_alpha",
        value=CVAR_ALPHA_DEFAULT,
        lower=0.90,
        upper=0.95,
        unit=None,
        status=ParameterStatus.DESIGN,
        source="docs 04 section 15; tail-mass guard in stochastic.require_cvar_support",
    ),
    ParameterEntry(
        key="shortage_lambda",
        value=None,
        lower=None,
        upper=None,
        unit=None,
        status=ParameterStatus.DESIGN,
        source="runtime default 0.0 until E5 tunes the cvar weight",
    ),
    ParameterEntry(
        key="k_safe",
        value=None,
        lower=None,
        upper=None,
        unit="confidence",
        status=ParameterStatus.DESIGN,
        source="docs 04 section 11.3 active probing gate; E6",
    ),
    ParameterEntry(
        key="tau_supply_drift",
        value=TAU_SUPPLY_DRIFT_DEFAULT,
        lower=None,
        upper=None,
        unit=None,
        status=ParameterStatus.DESIGN,
        source="TriggerPolicy default in optimizer.event_trigger; tuned in E7",
    ),
    ParameterEntry(
        key="tau_service_floor",
        value=TAU_SERVICE_FLOOR_DEFAULT,
        lower=None,
        upper=None,
        unit=None,
        status=ParameterStatus.DESIGN,
        source="TriggerPolicy default in optimizer.event_trigger; tuned in E7",
    ),
    ParameterEntry(
        key="tau_forecast",
        value=TAU_FORECAST_DEFAULT,
        lower=None,
        upper=None,
        unit=None,
        status=ParameterStatus.DESIGN,
        source="TriggerPolicy default in optimizer.event_trigger; tuned in E7",
    ),
    ParameterEntry(
        key="heartbeat_interval_min",
        value=HEARTBEAT_INTERVAL_MIN_DEFAULT,
        lower=None,
        upper=None,
        unit="min",
        status=ParameterStatus.DESIGN,
        source="docs 04 section 9.1 max 24 h; also the periodic baseline for E7",
    ),
    ParameterEntry(
        key="kc_paddy_vegetative",
        value=KC_PADDY_VEGETATIVE_DEFAULT,
        lower=None,
        upper=None,
        unit=None,
        status=ParameterStatus.FACT,
        source="KP-01 paddy table half-months 1-4; verify against printed KP-01",
    ),
    ParameterEntry(
        key="kc_paddy_reproductive",
        value=KC_PADDY_REPRODUCTIVE_DEFAULT,
        lower=None,
        upper=None,
        unit=None,
        status=ParameterStatus.FACT,
        source="KP-01 paddy table half-months 5-8; verify against printed KP-01",
    ),
    ParameterEntry(
        key="percolation_mm_per_day",
        value=PERCOLATION_MM_PER_DAY_DEFAULT,
        lower=1.0,
        upper=3.0,
        unit="mm/day",
        status=ParameterStatus.FACT,
        source="KP-01 range 1-3; mid-range default",
    ),
    ParameterEntry(
        key="wlr_mm_per_application",
        value=WLR_MM_PER_APPLICATION_DEFAULT,
        lower=None,
        upper=None,
        unit="mm",
        status=ParameterStatus.FACT,
        source="KP-01; two applications per season",
    ),
    ParameterEntry(
        key="sensor_noise_sigma_mm",
        value=None,
        lower=None,
        upper=None,
        unit="mm",
        status=ParameterStatus.HYPOTHESIS,
        source="pending HIL; simulator presets LOW/MEDIUM/HIGH = 1/3/8 mm",
    ),
    ParameterEntry(
        key="link_velocity_m_per_s",
        value=None,
        lower=None,
        upper=None,
        unit="m/s",
        status=ParameterStatus.HYPOTHESIS,
        source="pending HIL calibration; docs 04 section 12.7",
    ),
    ParameterEntry(
        key="loss_eta_reference",
        value=None,
        lower=None,
        upper=None,
        unit=None,
        status=ParameterStatus.HYPOTHESIS,
        source="zone bases in simulator.scenarios; validated via the E4 mismatch test",
    ),
)


def validate_catalog(entries: Sequence[ParameterEntry]) -> None:
    if not entries:
        raise DomainInvariantError("parameter catalog must not be empty")
    seen: set[str] = set()
    for entry in entries:
        if entry.key in seen:
            raise DomainInvariantError(f"duplicate parameter key: {entry.key!r}")
        seen.add(entry.key)


def catalog_entry(key: str) -> ParameterEntry:
    for entry in DEFAULT_CATALOG:
        if entry.key == key:
            return entry
    raise DomainInvariantError(f"unknown parameter key: {key!r}")


def required_value(key: str) -> float:
    entry = catalog_entry(key)
    if entry.value is None:
        raise DomainInvariantError(
            f"parameter {key!r} has no default value and must be driven by experiments"
        )
    return entry.value


def sensitivity_values(key: str, *, points: int = 5) -> tuple[float, ...]:
    if isinstance(points, bool) or not isinstance(points, int) or points < 2:
        raise DomainInvariantError("points must be an integer >= 2")
    entry = catalog_entry(key)
    if entry.lower is None or entry.upper is None:
        raise DomainInvariantError(f"parameter {key!r} has no search range")
    step = (entry.upper - entry.lower) / (points - 1)
    return tuple(entry.lower + step * index for index in range(points))


validate_catalog(DEFAULT_CATALOG)
