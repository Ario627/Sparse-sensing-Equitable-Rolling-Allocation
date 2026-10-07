from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from app.core.types import DomainInvariantError, require_identifier
from baselines.base import BaselineMethod, BaselineStrategy
from baselines.fixed_rotation import FixedRotationStrategy
from baselines.ledger_greedy import LedgerGreedyStrategy
from baselines.oracle import OracleStrategy
from baselines.proportional import ProportionalStrategy

BaselineFactory = Callable[[], BaselineStrategy]

SERA_PIPELINE_MODULE: Final = "optimizer.rolling"

_SERA_MESSAGE: Final = (
    f"SERA runs through {SERA_PIPELINE_MODULE} and is not a baseline strategy"
)


def parse_method(value: str) -> BaselineMethod:
    require_identifier(value, "method")
    try:
        return BaselineMethod(value.strip().lower())
    except ValueError as error:
        raise DomainInvariantError(f"unknown method: {value!r}") from error


def _proportional_factory() -> BaselineStrategy:
    return ProportionalStrategy()


def _rotation_factory() -> BaselineStrategy:
    return FixedRotationStrategy()


def _greedy_factory() -> BaselineStrategy:
    return LedgerGreedyStrategy()


def _oracle_factory() -> BaselineStrategy:
    return OracleStrategy()


BASELINE_FACTORIES: Final[Mapping[BaselineMethod, BaselineFactory]] = MappingProxyType(
    {
        BaselineMethod.PROPORTIONAL: _proportional_factory,
        BaselineMethod.ROTATION: _rotation_factory,
        BaselineMethod.GREEDY: _greedy_factory,
        BaselineMethod.ORACLE: _oracle_factory,
    }
)


@dataclass(frozen=True, slots=True)
class BaselineRegistry:
    factories: Mapping[BaselineMethod, BaselineFactory] = BASELINE_FACTORIES

    def __post_init__(self) -> None:
        if not self.factories:
            raise DomainInvariantError("registry must register at least one strategy")
        for method, factory in self.factories.items():
            if not isinstance(method, BaselineMethod):
                raise DomainInvariantError(f"registry key is not a BaselineMethod: {method!r}")
            if method is BaselineMethod.SERA:
                raise DomainInvariantError(_SERA_MESSAGE)
            if not callable(factory):
                raise DomainInvariantError(f"factory for {method} must be callable")

    def __contains__(self, method: BaselineMethod) -> bool:
        return method in self.factories

    def create(self, method: BaselineMethod) -> BaselineStrategy:
        if method is BaselineMethod.SERA:
            raise DomainInvariantError(_SERA_MESSAGE)
        factory = self.factories.get(method)
        if factory is None:
            raise DomainInvariantError(f"no strategy registered for method: {method.value}")
        return factory()

    def baseline_methods(self) -> tuple[BaselineMethod, ...]:
        return tuple(method for method in BaselineMethod if method in self.factories)

    def experiment_methods(self) -> tuple[BaselineMethod, ...]:
        return tuple(
            method
            for method in BaselineMethod
            if method is BaselineMethod.SERA or method in self.factories
        )


DEFAULT_REGISTRY: Final = BaselineRegistry()