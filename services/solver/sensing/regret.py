from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from app.core.types import require_finite, require_non_negative
from sensing.voi import (
    ScenarioEvaluation,
    align_paired,
    cvar_shortage,
    expected_shortage,
    service_floor,
)

REGRET_TOLERANCE: Final = 1.0e-9


@dataclass(frozen=True, slots=True)
class RegretVector:
    shortage_m3: float
    equity: float
    cvar_shortage_m3: float

    def __post_init__(self) -> None:
        require_finite(self.shortage_m3, "shortage_m3")
        require_finite(self.equity, "equity")
        require_finite(self.cvar_shortage_m3, "cvar_shortage_m3")


def regret_vector(
    oracle: Sequence[ScenarioEvaluation],
    candidate: Sequence[ScenarioEvaluation],
    *,
    cvar_alpha: float,
) -> RegretVector:
    align_paired(oracle, candidate)
    return RegretVector(
        shortage_m3=expected_shortage(candidate) - expected_shortage(oracle),
        equity=service_floor(oracle) - service_floor(candidate),
        cvar_shortage_m3=cvar_shortage(candidate, alpha=cvar_alpha)
        - cvar_shortage(oracle, alpha=cvar_alpha),
    )


def regret_key(vector: RegretVector) -> tuple[float, float, float]:
    return (vector.shortage_m3, vector.equity, vector.cvar_shortage_m3)


def dominates(
    first: RegretVector,
    second: RegretVector,
    *,
    tolerance: float = REGRET_TOLERANCE,
) -> bool:
    slack = require_non_negative(tolerance, "tolerance")
    within = (
        first.shortage_m3 <= second.shortage_m3 + slack
        and first.equity <= second.equity + slack
        and first.cvar_shortage_m3 <= second.cvar_shortage_m3 + slack
    )
    improves = (
        second.shortage_m3 - first.shortage_m3 > slack
        or second.equity - first.equity > slack
        or second.cvar_shortage_m3 - first.cvar_shortage_m3 > slack
    )
    return within and improves