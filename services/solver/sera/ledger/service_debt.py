from __future__ import annotations

from dataclasses import dataclass

from sera.core.types import require_non_negative, require_unit_open_closed


@dataclass(frozen=True, slots=True)
class ServiceLedgerState:
    delivered_ewma_m3: float
    target_ewma_m3: float
    debt_m3: float
    debt_capped: bool = False

    def __post_init__(self) -> None:
        require_non_negative(self.delivered_ewma_m3, "delivered_ewma_m3")
        require_non_negative(self.target_ewma_m3, "target_ewma_m3")
        require_non_negative(self.debt_m3, "debt_m3")

    @classmethod
    def initial(cls) -> ServiceLedgerState:
        return cls(delivered_ewma_m3=0.0, target_ewma_m3=0.0, debt_m3=0.0)

    @property
    def service_ratio(self) -> float:
        if self.target_ewma_m3 <= 0.0:
            return 1.0
        return self.delivered_ewma_m3 / self.target_ewma_m3


def advance_ledger(
    state: ServiceLedgerState,
    *,
    delivered_m3: float,
    target_fair_m3: float,
    gamma: float,
    d_max_m3: float,
) -> ServiceLedgerState:
    decay = require_unit_open_closed(gamma, "gamma")
    ceiling = require_non_negative(d_max_m3, "d_max_m3")
    delivered = require_non_negative(delivered_m3, "delivered_m3")
    target = require_non_negative(target_fair_m3, "target_fair_m3")
    raw_debt = decay * state.debt_m3 + target - delivered
    return ServiceLedgerState(
        delivered_ewma_m3=decay * state.delivered_ewma_m3 + delivered,
        target_ewma_m3=decay * state.target_ewma_m3 + target,
        debt_m3=min(max(raw_debt, 0.0), ceiling),
        debt_capped=raw_debt > ceiling,
    )
