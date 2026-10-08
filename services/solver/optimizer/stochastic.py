from __future__ import annotations

import math
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Final

import numpy as np  # type: ignore

from app.core.types import DomainInvariantError, require_non_negative, require_positive
from optimizer.model import PlanningScenario

PROBABILITY_TOLERANCE: Final = 1.0e-6
TAIL_MASS_TOLERANCE: Final = 1.0e-9


class RiskMode(StrEnum):
    STOCHASTIC = "STOCHASTIC"
    ROBUST = "ROBUST"


@dataclass(frozen=True, slots=True)
class ScenarioConfig:
    n_scenarios: int = 10
    supply_sigma_log: float = 0.12
    demand_sigma_log: float = 0.10
    rain_sigma_mm: float = 1.5
    min_factor: float = 0.4
    max_factor: float = 1.8

    def __post_init__(self) -> None:
        if isinstance(self.n_scenarios, bool) or not isinstance(self.n_scenarios, int):
            raise DomainInvariantError("n_scenarios must be an integer")
        if self.n_scenarios < 1:
            raise DomainInvariantError("n_scenarios must be positive")
        require_non_negative(self.supply_sigma_log, "supply_sigma_log")
        require_non_negative(self.demand_sigma_log, "demand_sigma_log")
        require_non_negative(self.rain_sigma_mm, "rain_sigma_mm")
        require_positive(self.min_factor, "min_factor")
        require_positive(self.max_factor, "max_factor")
        if self.max_factor < self.min_factor:
            raise DomainInvariantError("max_factor must be >= min_factor")


@dataclass(frozen=True, slots=True)
class ScenarioEnsembleSummary:
    n_scenarios: int
    supply_ratio_min: float
    supply_ratio_max: float
    demand_ratio_min: float
    demand_ratio_max: float
    uniform_probability: bool
    cvar_tail_mass: float | None = None


def _clip_factor(factor: float, config: ScenarioConfig) -> float:
    return min(max(factor, config.min_factor), config.max_factor)


def _scale_matrix(
    matrix: tuple[tuple[float, ...], ...],
    factor: float,
) -> tuple[tuple[float, ...], ...]:
    return tuple(tuple(value * factor for value in row) for row in matrix)


def _scenario_id(index: int) -> str:
    return f"sc{index:02d}"


def _supply_total(scenario: PlanningScenario) -> float:
    return math.fsum(scenario.supply_lps)


def _demand_total(scenario: PlanningScenario) -> float:
    return math.fsum(math.fsum(row) for row in scenario.target_fair_m3)


def _require_unit_probability(scenario: PlanningScenario) -> None:
    if abs(scenario.probability - 1.0) > PROBABILITY_TOLERANCE:
        raise DomainInvariantError("central forecast must carry unit probability")


def shortage_pressure(scenario: PlanningScenario) -> float:
    return _demand_total(scenario) / max(_supply_total(scenario), 1.0e-9)


def _perturb(
    central: PlanningScenario,
    config: ScenarioConfig,
    index: int,
    supply_roll: float,
    demand_roll: float,
    rain_roll: float,
) -> PlanningScenario:
    supply_factor = _clip_factor(math.exp(config.supply_sigma_log * supply_roll), config)
    demand_factor = _clip_factor(math.exp(config.demand_sigma_log * demand_roll), config)
    rain_shift = config.rain_sigma_mm * rain_roll
    return PlanningScenario(
        scenario_id=_scenario_id(index),
        probability=1.0 / config.n_scenarios,
        supply_lps=tuple(value * supply_factor for value in central.supply_lps),
        etc_mm=_scale_matrix(central.etc_mm, demand_factor),
        perc_mm=central.perc_mm,
        wlr_mm=central.wlr_mm,
        rain_effective_mm=tuple(
            tuple(max(0.0, value + rain_shift) for value in row)
            for row in central.rain_effective_mm
        ),
        target_fair_m3=_scale_matrix(central.target_fair_m3, demand_factor),
    )


def generate_scenarios(
    central: PlanningScenario,
    config: ScenarioConfig,
    rng: np.random.Generator,
) -> tuple[PlanningScenario, ...]:
    _require_unit_probability(central)
    if config.n_scenarios == 1:
        return (central,)
    scenarios = [
        _perturb(
            central,
            config,
            index,
            float(rng.standard_normal()),
            float(rng.standard_normal()),
            float(rng.standard_normal()),
        )
        for index in range(config.n_scenarios)
    ]
    return tuple(scenarios)


def stress_scenario(scenarios: tuple[PlanningScenario, ...]) -> PlanningScenario:
    if not scenarios:
        raise DomainInvariantError("scenarios must not be empty")
    return min(
        scenarios,
        key=lambda scenario: (-shortage_pressure(scenario), scenario.scenario_id),
    )


def robust_ensemble(
    scenarios: tuple[PlanningScenario, ...],
) -> tuple[PlanningScenario, ...]:
    stress = stress_scenario(scenarios)
    others = (
        replace(scenario, probability=0.0)
        for scenario in scenarios
        if scenario.scenario_id != stress.scenario_id
    )
    return (replace(stress, probability=1.0), *others)


def require_cvar_support(n_scenarios: int, alpha: float) -> float:
    if isinstance(n_scenarios, bool) or not isinstance(n_scenarios, int):
        raise DomainInvariantError("n_scenarios must be an integer")
    if n_scenarios < 1:
        raise DomainInvariantError("n_scenarios must be positive")
    if not 0.0 < alpha < 1.0:
        raise DomainInvariantError("alpha must lie in (0, 1)")
    tail_mass = n_scenarios * (1.0 - alpha)
    if tail_mass < 1.0 - TAIL_MASS_TOLERANCE:
        raise DomainInvariantError("too few scenarios for cvar tail estimation")
    return tail_mass


def ensemble_summary(
    scenarios: tuple[PlanningScenario, ...],
    central: PlanningScenario,
    *,
    cvar_alpha: float | None = None,
) -> ScenarioEnsembleSummary:
    if not scenarios:
        raise DomainInvariantError("scenarios must not be empty")
    supply_reference = max(_supply_total(central), 1.0e-9)
    demand_reference = max(_demand_total(central), 1.0e-9)
    supply_ratios = tuple(_supply_total(item) / supply_reference for item in scenarios)
    demand_ratios = tuple(_demand_total(item) / demand_reference for item in scenarios)
    probabilities = tuple(item.probability for item in scenarios)
    uniform = max(probabilities) - min(probabilities) <= PROBABILITY_TOLERANCE
    tail_mass = require_cvar_support(len(scenarios), cvar_alpha) if cvar_alpha is not None else None
    return ScenarioEnsembleSummary(
        n_scenarios=len(scenarios),
        supply_ratio_min=min(supply_ratios),
        supply_ratio_max=max(supply_ratios),
        demand_ratio_min=min(demand_ratios),
        demand_ratio_max=max(demand_ratios),
        uniform_probability=uniform,
        cvar_tail_mass=tail_mass,
    )


def build_ensemble(
    central: PlanningScenario,
    config: ScenarioConfig,
    mode: RiskMode,
    rng: np.random.Generator,
    *,
    cvar_alpha: float | None = None,
) -> tuple[tuple[PlanningScenario, ...], ScenarioEnsembleSummary]:
    ensemble = generate_scenarios(central, config, rng)
    if mode is RiskMode.ROBUST:
        ensemble = robust_ensemble(ensemble)
    summary = ensemble_summary(ensemble, central, cvar_alpha=cvar_alpha)
    return ensemble, summary
