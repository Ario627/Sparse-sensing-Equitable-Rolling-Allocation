from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final

from app.core.types import (
    DomainInvariantError,
    require_efficiency,
    require_identifier,
    require_non_negative,
    require_utc,
)
from simulator.engine import SlotOutcome

TIMESERIES_COLUMNS: Final[tuple[str, ...]] = (
    "ts",
    "block_id",
    "storage_mm",
    "delivered_m3",
    "target_m3",
    "service_ratio",
    "debt_m3",
    "eta_true",
    "eta_est",
    "eta_lo",
    "eta_hi",
    "gate_open",
    "scenario",
)

_ANNOTATION_FIELDS: Final[frozenset[str]] = frozenset(
    {"target_m3", "service_ratio", "debt_m3", "eta_est", "eta_lo", "eta_hi"}
)


@dataclass(frozen=True, slots=True)
class TimeseriesRow:
    ts: datetime
    block_id: str
    storage_mm: float
    delivered_m3: float
    eta_true: float
    gate_open: bool
    scenario: str
    target_m3: float | None = None
    service_ratio: float | None = None
    debt_m3: float | None = None
    eta_est: float | None = None
    eta_lo: float | None = None
    eta_hi: float | None = None

    def __post_init__(self) -> None:
        require_utc(self.ts, "ts")
        require_identifier(self.block_id, "block_id")
        require_identifier(self.scenario, "scenario")
        require_non_negative(self.storage_mm, "storage_mm")
        require_non_negative(self.delivered_m3, "delivered_m3")
        require_efficiency(self.eta_true, "eta_true")
        if self.target_m3 is not None:
            require_non_negative(self.target_m3, "target_m3")
        if self.service_ratio is not None:
            require_non_negative(self.service_ratio, "service_ratio")
        if self.debt_m3 is not None:
            require_non_negative(self.debt_m3, "debt_m3")
        if self.eta_est is not None:
            require_efficiency(self.eta_est, "eta_est")
        if self.eta_lo is not None:
            require_efficiency(self.eta_lo, "eta_lo")
        if self.eta_hi is not None:
            require_efficiency(self.eta_hi, "eta_hi")
            if self.eta_lo is not None and self.eta_hi < self.eta_lo:
                raise DomainInvariantError("eta_hi must be >= eta_lo")

    def to_dict(self) -> dict[str, object]:
        return {
            "ts": self.ts,
            "block_id": self.block_id,
            "storage_mm": self.storage_mm,
            "delivered_m3": self.delivered_m3,
            "target_m3": self.target_m3,
            "service_ratio": self.service_ratio,
            "debt_m3": self.debt_m3,
            "eta_true": self.eta_true,
            "eta_est": self.eta_est,
            "eta_lo": self.eta_lo,
            "eta_hi": self.eta_hi,
            "gate_open": self.gate_open,
            "scenario": self.scenario,
        }


class TrajectoryRecorder:
    def __init__(self, scenario_id: str) -> None:
        self._scenario_id = require_identifier(scenario_id, "scenario_id")
        self._rows: dict[tuple[int, str], TimeseriesRow] = {}
        self._order: list[tuple[int, str]] = []

    @property
    def scenario_id(self) -> str:
        return self._scenario_id

    def record_slot(self, outcome: SlotOutcome) -> None:
        for block_id, gate_open in outcome.gate_open.items():
            key = (outcome.slot_index, block_id)
            if key in self._rows:
                raise DomainInvariantError(
                    f"slot {outcome.slot_index} block {block_id} recorded twice"
                )
            self._rows[key] = TimeseriesRow(
                ts=outcome.slot_start,
                block_id=block_id,
                storage_mm=outcome.storage_mm[block_id],
                delivered_m3=outcome.delivered_m3[block_id],
                eta_true=outcome.path_efficiency[block_id],
                gate_open=gate_open,
                scenario=self._scenario_id,
            )
            self._order.append(key)

    def annotate(self, slot_index: int, block_id: str, **fields: float | None) -> None:
        unknown = sorted(set(fields) - _ANNOTATION_FIELDS)
        if unknown:
            raise DomainInvariantError(f"unknown annotation fields: {unknown}")
        key = (slot_index, block_id)
        row = self._rows.get(key)
        if row is None:
            raise DomainInvariantError(f"no row recorded for slot {slot_index} block {block_id}")
        self._rows[key] = replace(row, **fields)

    def rows(self) -> tuple[TimeseriesRow, ...]:
        return tuple(self._rows[key] for key in self._order)

    def to_dicts(self) -> list[dict[str, object]]:
        return [row.to_dict() for row in self.rows()]
