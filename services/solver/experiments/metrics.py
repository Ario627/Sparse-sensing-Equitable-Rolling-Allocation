from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Final

from app.core.types import (
    DomainInvariantError,
    require_finite,
    require_identifier,
    require_non_negative,
    require_unique,
)

FULFILL_TOLERANCE: Final = 1.0e-9
DISPERSION_TOLERANCE: Final = 1.0e-12


def _require_alpha(alpha: float) -> float:
    if isinstance(alpha, bool) or not isinstance(alpha, (int, float)):
        raise DomainInvariantError("alpha must be a number")
    value = float(alpha)
    if not 0.0 < value < 1.0:
        raise DomainInvariantError("alpha must lie in (0, 1)")
    return value


def _require_slot_index(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DomainInvariantError("slot_index must be a non-negative integer")
    return value


def _require_boolean(value: bool, name: str) -> bool:
    if not isinstance(value, bool):
        raise DomainInvariantError(f"{name} must be a boolean")
    return value


def _require_counter(value: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DomainInvariantError(f"{name} must be a non-negative integer")
    return value


def _require_unit_fraction(value: float, name: str) -> float:
    number = require_finite(value, name)
    if not 0.0 <= number <= 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1]")
    return number


def _require_optional_non_negative(value: float | None, name: str) -> float | None:
    if value is None:
        return None
    return require_non_negative(value, name)


def _require_optional_finite(value: float | None, name: str) -> float | None:
    if value is None:
        return None
    return require_finite(value, name)


def _require_records(records: Sequence[SlotRecord]) -> tuple[SlotRecord, ...]:
    items = tuple(records)
    if not items:
        raise DomainInvariantError("records must not be empty")
    return items


def _require_finite_series(values: Sequence[float], name: str) -> tuple[float, ...]:
    items = tuple(require_finite(float(value), name) for value in values)
    if not items:
        raise DomainInvariantError(f"{name} must not be empty")
    return items


def _require_non_negative_series(values: Sequence[float], name: str) -> tuple[float, ...]:
    items = tuple(require_non_negative(float(value), name) for value in values)
    if not items:
        raise DomainInvariantError(f"{name} must not be empty")
    return items


@dataclass(frozen=True, slots=True)
class SlotRecord:
    block_id: str
    slot_index: int
    delivered_m3: float
    required_m3: float
    fair_target_m3: float
    gross_m3: float
    gate_open: bool

    def __post_init__(self) -> None:
        require_identifier(self.block_id, "block_id")
        _require_slot_index(self.slot_index)
        require_non_negative(self.delivered_m3, "delivered_m3")
        require_non_negative(self.required_m3, "required_m3")
        require_non_negative(self.fair_target_m3, "fair_target_m3")
        require_non_negative(self.gross_m3, "gross_m3")
        _require_boolean(self.gate_open, "gate_open")


def shortfall_m3(record: SlotRecord) -> float:
    return max(record.fair_target_m3 - record.delivered_m3, 0.0)


def agricultural_deficit_m3(record: SlotRecord) -> float:
    return max(record.required_m3 - record.delivered_m3, 0.0)


def service_ratio(record: SlotRecord) -> float:
    if record.fair_target_m3 <= 0.0:
        return 1.0
    return record.delivered_m3 / record.fair_target_m3


def _sum_by_slot(
    records: tuple[SlotRecord, ...],
    measure: Callable[[SlotRecord], float],
) -> dict[int, float]:
    totals: dict[int, float] = {}
    for record in records:
        totals[record.slot_index] = totals.get(record.slot_index, 0.0) + measure(record)
    return totals


def _sum_by_block(
    records: tuple[SlotRecord, ...],
    measure: Callable[[SlotRecord], float],
) -> dict[str, float]:
    totals: dict[str, float] = {}
    for record in records:
        totals[record.block_id] = totals.get(record.block_id, 0.0) + measure(record)
    return totals


def delivered_total_m3(records: Sequence[SlotRecord]) -> float:
    items = _require_records(records)
    return math.fsum(record.delivered_m3 for record in items)


def required_total_m3(records: Sequence[SlotRecord]) -> float:
    items = _require_records(records)
    return math.fsum(record.required_m3 for record in items)


def fair_target_total_m3(records: Sequence[SlotRecord]) -> float:
    items = _require_records(records)
    return math.fsum(record.fair_target_m3 for record in items)


def gross_total_m3(records: Sequence[SlotRecord]) -> float:
    items = _require_records(records)
    return math.fsum(record.gross_m3 for record in items)


def shortage_total_m3(records: Sequence[SlotRecord]) -> float:
    items = _require_records(records)
    return math.fsum(shortfall_m3(record) for record in items)


def adequacy(records: Sequence[SlotRecord]) -> float:
    items = _require_records(records)
    required = required_total_m3(items)
    if required <= 0.0:
        return 1.0
    return delivered_total_m3(items) / required


def efficiency(records: Sequence[SlotRecord]) -> float | None:
    items = _require_records(records)
    gross = gross_total_m3(items)
    if gross <= 0.0:
        return None
    return delivered_total_m3(items) / gross


def dependability(records: Sequence[SlotRecord]) -> float:
    items = _require_records(records)
    fulfilled = sum(
        1 for record in items if record.delivered_m3 >= record.fair_target_m3 - FULFILL_TOLERANCE
    )
    return fulfilled / len(items)


def per_block_service_ratio(records: Sequence[SlotRecord]) -> dict[str, float]:
    items = _require_records(records)
    delivered = _sum_by_block(items, lambda record: record.delivered_m3)
    target = _sum_by_block(items, lambda record: record.fair_target_m3)
    return {
        block_id: 1.0 if target[block_id] <= 0.0 else delivered[block_id] / target[block_id]
        for block_id in delivered
    }


def gini_coefficient(values: Sequence[float]) -> float:
    items = _require_non_negative_series(values, "values")
    ordered = sorted(items)
    count = len(ordered)
    total = math.fsum(ordered)
    if total <= DISPERSION_TOLERANCE:
        return 0.0
    weighted = math.fsum((index + 1) * value for index, value in enumerate(ordered))
    raw = (2.0 * weighted) / (count * total) - (count + 1.0) / count
    return min(max(raw, 0.0), 1.0)


def coefficient_of_variation(values: Sequence[float]) -> float:
    items = _require_non_negative_series(values, "values")
    count = len(items)
    mean = math.fsum(items) / count
    if mean <= DISPERSION_TOLERANCE:
        return 0.0
    variance = math.fsum((value - mean) ** 2 for value in items) / count
    return math.sqrt(variance) / mean


def spatial_equity_gini(records: Sequence[SlotRecord]) -> float:
    return gini_coefficient(tuple(per_block_service_ratio(records).values()))


def spatial_equity_cv(records: Sequence[SlotRecord]) -> float:
    return coefficient_of_variation(tuple(per_block_service_ratio(records).values()))


def worst_service_ratio(records: Sequence[SlotRecord]) -> float:
    return min(per_block_service_ratio(records).values())


def tail_deficit_m3(records: Sequence[SlotRecord], tail_block_ids: Sequence[str]) -> float:
    items = _require_records(records)
    tail = tuple(tail_block_ids)
    if not tail:
        raise DomainInvariantError("tail_block_ids must not be empty")
    for block_id in tail:
        require_identifier(block_id, "tail block_id")
    require_unique(tail, "tail block_id")
    known = {record.block_id for record in items}
    unknown = sorted(set(tail) - known)
    if unknown:
        raise DomainInvariantError(f"tail blocks missing from records: {unknown}")
    selected = frozenset(tail)
    return math.fsum(
        agricultural_deficit_m3(record) for record in items if record.block_id in selected
    )


def _cvar_of_values(values: tuple[float, ...], alpha: float) -> float:
    tail_mass = 1.0 - alpha
    weight = 1.0 / len(values)
    remaining = tail_mass
    total = 0.0
    for value in sorted(values, reverse=True):
        if remaining <= 0.0:
            break
        take = min(weight, remaining)
        total += take * value
        remaining -= take
    return total / tail_mass


def cvar_shortage_m3(records: Sequence[SlotRecord], *, alpha: float) -> float:
    level = _require_alpha(alpha)
    totals = _sum_by_slot(_require_records(records), shortfall_m3)
    series = tuple(totals[slot] for slot in sorted(totals))
    return _cvar_of_values(series, level)


def rmse(truth: Sequence[float], estimate: Sequence[float]) -> float:
    actual = _require_finite_series(truth, "truth")
    predicted = _require_finite_series(estimate, "estimate")
    if len(actual) != len(predicted):
        raise DomainInvariantError("truth and estimate series must share one length")
    squared = math.fsum((left - right) ** 2 for left, right in zip(actual, predicted, strict=True))
    return math.sqrt(squared / len(actual))


def gate_switch_count(records: Sequence[SlotRecord]) -> int:
    items = _require_records(records)
    by_block: dict[str, list[SlotRecord]] = {}
    for record in items:
        by_block.setdefault(record.block_id, []).append(record)
    switches = 0
    for block_records in by_block.values():
        ordered = sorted(block_records, key=lambda record: record.slot_index)
        switches += sum(
            1 for previous, current in pairwise(ordered) if previous.gate_open != current.gate_open
        )
    return switches


@dataclass(frozen=True, slots=True)
class SolverTelemetry:
    solve_seconds_total: float
    n_resolves: int
    mip_gap: float | None = None

    def __post_init__(self) -> None:
        require_non_negative(self.solve_seconds_total, "solve_seconds_total")
        _require_counter(self.n_resolves, "n_resolves")
        _require_optional_non_negative(self.mip_gap, "mip_gap")


@dataclass(frozen=True, slots=True)
class RunMetrics:
    adequacy: float
    efficiency: float | None
    dependability: float
    equity: float
    worst_sr: float
    shortage_total_m3: float
    tail_deficit_m3: float | None
    cvar_shortage_m3: float
    state_rmse: float | None
    solve_time_ms: float
    mip_gap: float | None
    n_resolves: int
    gate_switches: int
    fallback_used: bool
    decision_regret: float | None = None

    def __post_init__(self) -> None:
        require_non_negative(self.adequacy, "adequacy")
        _require_optional_non_negative(self.efficiency, "efficiency")
        _require_unit_fraction(self.dependability, "dependability")
        _require_unit_fraction(self.equity, "equity")
        require_non_negative(self.worst_sr, "worst_sr")
        require_non_negative(self.shortage_total_m3, "shortage_total_m3")
        _require_optional_non_negative(self.tail_deficit_m3, "tail_deficit_m3")
        require_non_negative(self.cvar_shortage_m3, "cvar_shortage_m3")
        _require_optional_non_negative(self.state_rmse, "state_rmse")
        require_non_negative(self.solve_time_ms, "solve_time_ms")
        _require_optional_non_negative(self.mip_gap, "mip_gap")
        _require_counter(self.n_resolves, "n_resolves")
        _require_counter(self.gate_switches, "gate_switches")
        _require_boolean(self.fallback_used, "fallback_used")
        _require_optional_finite(self.decision_regret, "decision_regret")


def compute_run_metrics(
    records: Sequence[SlotRecord],
    telemetry: SolverTelemetry,
    *,
    cvar_alpha: float,
    tail_block_ids: Sequence[str] | None = None,
    truth_storage_mm: Sequence[float] | None = None,
    estimate_storage_mm: Sequence[float] | None = None,
    fallback_used: bool = False,
) -> RunMetrics:
    items = _require_records(records)
    if not isinstance(telemetry, SolverTelemetry):
        raise DomainInvariantError("telemetry must be a SolverTelemetry")
    if (truth_storage_mm is None) != (estimate_storage_mm is None):
        raise DomainInvariantError("truth and estimate series must be supplied together")
    state_error = (
        rmse(truth_storage_mm, estimate_storage_mm)
        if truth_storage_mm is not None and estimate_storage_mm is not None
        else None
    )
    tail = tail_deficit_m3(items, tail_block_ids) if tail_block_ids is not None else None
    return RunMetrics(
        adequacy=adequacy(items),
        efficiency=efficiency(items),
        dependability=dependability(items),
        equity=spatial_equity_gini(items),
        worst_sr=worst_service_ratio(items),
        shortage_total_m3=shortage_total_m3(items),
        tail_deficit_m3=tail,
        cvar_shortage_m3=cvar_shortage_m3(items, alpha=cvar_alpha),
        state_rmse=state_error,
        solve_time_ms=telemetry.solve_seconds_total * 1000.0,
        mip_gap=telemetry.mip_gap,
        n_resolves=telemetry.n_resolves,
        gate_switches=gate_switch_count(items),
        fallback_used=fallback_used,
        decision_regret=None,
    )
