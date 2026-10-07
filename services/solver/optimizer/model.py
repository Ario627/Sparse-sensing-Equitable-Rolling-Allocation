from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from ortools.math_opt.python import mathopt # type: ignore

from app.core.types import (
    DomainInvariantError,
    require_efficiency,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
)
from app.core.units import flow_hours_to_volume_m3
from optimizer.solver import SolveOutcome

MM_PER_M3_FACTOR: Final = 1000.0
PROBABILITY_TOLERANCE: Final = 1.0e-6


def _require_simplex_probability(value: float, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"{name} must be a number")
    number = float(value)
    if not 0.0 <= number <= 1.0:
        raise DomainInvariantError(f"{name} must lie in [0, 1]")
    return number

def _require_vector(values: Sequence[float], expected: int, name: str) -> tuple[float, ...]:
    if len(values) != expected:
        raise DomainInvariantError(f"{name} must have length {expected}")
    return tuple(float(value) for value in values)


def _require_matrix(
    rows: Sequence[Sequence[float]],
    block_count: int,
    slot_count: int,
    name: str,
) -> tuple[tuple[float, ...], ...]:
    if len(rows) != block_count:
        raise DomainInvariantError(f"{name} must have {block_count} rows")
    return tuple(_require_vector(row, slot_count, f"{name}[{index}]") for index, row in enumerate(rows))


def _variable_name(prefix: str, *parts: object) -> str:
    return "|".join((prefix, *(str(part) for part in parts)))


@dataclass(frozen=True, slots=True)
class PlanningBlockSpec:
    block_id: str
    area_m2: float
    nominal_flow_lps: float
    path_efficiency: float
    min_storage_mm: float
    max_storage_mm: float
    initial_storage_mm: float
    ledger_delivered_m3: float
    ledger_target_m3: float
    debt_m3: float

    def __post_init__(self) -> None:
        require_identifier(self.block_id, "block_id")
        require_positive(self.area_m2, "area_m2")
        require_positive(self.nominal_flow_lps, "nominal_flow_lps")
        require_efficiency(self.path_efficiency, "path_efficiency")
        require_non_negative(self.min_storage_mm, "min_storage_mm")
        require_positive(self.max_storage_mm, "max_storage_mm")
        if self.max_storage_mm <= self.min_storage_mm:
            raise DomainInvariantError("max_storage_mm must exceed min_storage_mm")
        require_non_negative(self.initial_storage_mm, "initial_storage_mm")
        require_non_negative(self.ledger_delivered_m3, "ledger_delivered_m3")
        require_non_negative(self.ledger_target_m3, "ledger_target_m3")
        require_non_negative(self.debt_m3, "debt_m3")

    @property
    def storage_mm_per_m3(self) -> float:
        return MM_PER_M3_FACTOR / self.area_m2

    @property
    def gross_per_net(self) -> float:
        return 1.0 / self.path_efficiency


@dataclass(frozen=True, slots=True)
class PlanningScenario:
    scenario_id: str
    probability: float
    supply_lps: tuple[float, ...]
    etc_mm: tuple[tuple[float, ...], ...]
    perc_mm: tuple[tuple[float, ...], ...]
    wlr_mm: tuple[tuple[float, ...], ...]
    rain_effective_mm: tuple[tuple[float, ...], ...]
    target_fair_m3: tuple[tuple[float, ...], ...]

    def __post_init__(self) -> None:
        require_identifier(self.scenario_id, "scenario_id")
        _require_simplex_probability(self.probability, "probability")
        for value in self.supply_lps:
            require_non_negative(value, "supply_lps")


@dataclass(frozen=True, slots=True)
class PlanningProblem:
    blocks: tuple[PlanningBlockSpec, ...]
    scenarios: tuple[PlanningScenario, ...]
    slot_hours: float
    edge_capacity_lps: Mapping[str, float]
    edge_downstream_blocks: Mapping[str, tuple[str, ...]]
    previous_gate_open: tuple[bool, ...]
    commit_slots: int = 1
    debt_service_fraction: float = 0.0

    def __post_init__(self) -> None:
        if not self.blocks:
            raise DomainInvariantError("blocks must not be empty")
        if not self.scenarios:
            raise DomainInvariantError("scenarios must not be empty")
        require_unique((block.block_id for block in self.blocks), "block_id")
        require_unique((scenario.scenario_id for scenario in self.scenarios), "scenario_id")
        require_positive(self.slot_hours, "slot_hours")
        slot_count = len(self.scenarios[0].supply_lps)
        if slot_count < 1:
            raise DomainInvariantError("scenarios must span at least one slot")
        for scenario in self.scenarios:
            _require_vector(scenario.supply_lps, slot_count, f"supply_lps[{scenario.scenario_id}]")
            _require_matrix(scenario.etc_mm, len(self.blocks), slot_count, f"etc_mm[{scenario.scenario_id}]")
            _require_matrix(scenario.perc_mm, len(self.blocks), slot_count, f"perc_mm[{scenario.scenario_id}]")
            _require_matrix(scenario.wlr_mm, len(self.blocks), slot_count, f"wlr_mm[{scenario.scenario_id}]")
            _require_matrix(
                scenario.rain_effective_mm,
                len(self.blocks),
                slot_count,
                f"rain_effective_mm[{scenario.scenario_id}]",
            )
            _require_matrix(
                scenario.target_fair_m3,
                len(self.blocks),
                slot_count,
                f"target_fair_m3[{scenario.scenario_id}]",
            )
        total_probability = sum(scenario.probability for scenario in self.scenarios)
        if abs(total_probability - 1.0) > PROBABILITY_TOLERANCE:
            raise DomainInvariantError("scenario probabilities must sum to one")
        if len(self.previous_gate_open) != len(self.blocks):
            raise DomainInvariantError("previous_gate_open must align with blocks")
        if self.commit_slots < 0 or self.commit_slots > slot_count:
            raise DomainInvariantError("commit_slots must lie in [0, slot count]")
        if self.debt_service_fraction < 0.0 or self.debt_service_fraction > 1.0:
            raise DomainInvariantError("debt_service_fraction must lie in [0, 1]")
        block_ids = {block.block_id for block in self.blocks}
        for edge_id, capacity in self.edge_capacity_lps.items():
            require_identifier(edge_id, "edge_id")
            require_positive(capacity, f"edge_capacity_lps[{edge_id}]")
        for edge_id, downstream in self.edge_downstream_blocks.items():
            if edge_id not in self.edge_capacity_lps:
                raise DomainInvariantError(f"downstream defined for unknown edge: {edge_id}")
            if not downstream:
                raise DomainInvariantError(f"edge {edge_id} has empty downstream set")
            unknown = sorted(set(downstream) - block_ids)
            if unknown:
                raise DomainInvariantError(f"edge {edge_id} references unknown blocks: {unknown}")

    @property
    def slot_count(self) -> int:
        return len(self.scenarios[0].supply_lps)

    @property
    def block_ids(self) -> tuple[str, ...]:
        return tuple(block.block_id for block in self.blocks)

    @property
    def scenario_ids(self) -> tuple[str, ...]:
        return tuple(scenario.scenario_id for scenario in self.scenarios)


@dataclass(frozen=True, slots=True)
class PlanDecision:
    scenario_ids: tuple[str, ...]
    open_by_slot: tuple[tuple[bool, ...], ...]
    delivered_m3_by_slot: tuple[tuple[float, ...], ...]
    switching_total_expected: float
    gross_withdrawal_expected_m3: float
    safety_slack_total_expected: float
    shortage_total_expected_m3: float
    service_floor_z: float
    terminal_storage_mm: tuple[float, ...]
    variable_values: Mapping[str, float]


class PlanModel:
    def __init__(self, problem: PlanningProblem) -> None:
        self._problem = problem
        self._model = mathopt.Model(name="sera_plan")
        self._flat: list[mathopt.Variable] = []
        self._y: dict[tuple[str, int, str], mathopt.Variable] = {}
        self._x: dict[tuple[str, int, str], mathopt.Variable] = {}
        self._s: dict[tuple[str, int, str], mathopt.Variable] = {}
        self._storage: dict[tuple[str, int, str], mathopt.Variable] = {}
        self._rho: dict[tuple[str, int, str], mathopt.Variable] = {}
        self._spill: dict[tuple[str, int, str], mathopt.Variable] = {}
        self._short: dict[tuple[str, int, str], mathopt.Variable] = {}
        self._d: dict[tuple[int, int, str], mathopt.Variable] = {}
        self._z = self._model.add_variable(lb=0.0, ub=1.0, name="z")
        self._flat.append(self._z)
        self._cvar_enabled = False
        self._cvar_alpha = 0.0
        self._cvar_theta: mathopt.Variable | None = None
        self._cvar_psi: dict[str, mathopt.Variable] = {}
        self._declare_variables()
        self._add_gate_link_constraints()
        self._add_supply_constraints()
        self._add_capacity_constraints()
        self._add_storage_constraints()
        self._add_safety_constraints()
        self._add_fairness_constraints()
        self._add_dispersion_constraints()
        self._add_stability_constraints()
        self._add_debt_floor_constraints()
        self._add_nonanticipativity_constraints()

    @property
    def problem(self) -> mathopt.Model:
        return self._model

    @property
    def planning(self) -> PlanningProblem:
        return self._problem

    @property
    def flat_variables(self) -> tuple[mathopt.Variable, ...]:
        return tuple(self._flat)

    @property
    def cvar_enabled(self) -> bool:
        return self._cvar_enabled

    @property
    def y_variables(self) -> Mapping[tuple[str, int, str], mathopt.Variable]:
        return self._y

    @property
    def x_variables(self) -> Mapping[tuple[str, int, str], mathopt.Variable]:
        return self._x

    @property
    def s_variables(self) -> Mapping[tuple[str, int, str], mathopt.Variable]:
        return self._s

    @property
    def rho_variables(self) -> Mapping[tuple[str, int, str], mathopt.Variable]:
        return self._rho

    @property
    def short_variables(self) -> Mapping[tuple[str, int, str], mathopt.Variable]:
        return self._short

    @property
    def dispersion_variables(self) -> Mapping[tuple[int, int, str], mathopt.Variable]:
        return self._d

    @property
    def service_floor_variable(self) -> mathopt.Variable:
        return self._z

    def block(self, block_id: str) -> PlanningBlockSpec:
        for candidate in self._problem.blocks:
            if candidate.block_id == block_id:
                return candidate
        raise DomainInvariantError(f"unknown block: {block_id}")

    def scenario(self, scenario_id: str) -> PlanningScenario:
        for candidate in self._problem.scenarios:
            if candidate.scenario_id == scenario_id:
                return candidate
        raise DomainInvariantError(f"unknown scenario: {scenario_id}")

    def _declare_variables(self) -> None:
        slot_count = self._problem.slot_count
        for block in self._problem.blocks:
            potential_net = flow_hours_to_volume_m3(
                block.nominal_flow_lps, self._problem.slot_hours
            ) * block.path_efficiency
            for scenario in self._problem.scenarios:
                for slot in range(slot_count + 1):
                    upper = block.initial_storage_mm if slot == 0 else block.max_storage_mm
                    lower = block.initial_storage_mm if slot == 0 else 0.0
                    variable = self._model.add_variable(
                        lb=lower,
                        ub=upper,
                        name=_variable_name("store", block.block_id, slot, scenario.scenario_id),
                    )
                    self._storage[(block.block_id, slot, scenario.scenario_id)] = variable
                    self._flat.append(variable)
                for slot in range(slot_count):
                    gate = self._model.add_binary_variable(
                        name=_variable_name("y", block.block_id, slot, scenario.scenario_id)
                    )
                    self._y[(block.block_id, slot, scenario.scenario_id)] = gate
                    self._flat.append(gate)
                    delivered = self._model.add_variable(
                        lb=0.0,
                        ub=potential_net,
                        name=_variable_name("x", block.block_id, slot, scenario.scenario_id),
                    )
                    self._x[(block.block_id, slot, scenario.scenario_id)] = delivered
                    self._flat.append(delivered)
                    switching = self._model.add_binary_variable(
                        name=_variable_name("s", block.block_id, slot, scenario.scenario_id)
                    )
                    self._s[(block.block_id, slot, scenario.scenario_id)] = switching
                    self._flat.append(switching)
                    slack = self._model.add_variable(
                        lb=0.0,
                        name=_variable_name("rho", block.block_id, slot, scenario.scenario_id),
                    )
                    self._rho[(block.block_id, slot, scenario.scenario_id)] = slack
                    self._flat.append(slack)
                    spill = self._model.add_variable(
                        lb=0.0,
                        name=_variable_name("spill", block.block_id, slot, scenario.scenario_id),
                    )
                    self._spill[(block.block_id, slot, scenario.scenario_id)] = spill
                    self._flat.append(spill)
                    short = self._model.add_variable(
                        lb=0.0,
                        name=_variable_name("short", block.block_id, slot, scenario.scenario_id),
                    )
                    self._short[(block.block_id, slot, scenario.scenario_id)] = short
                    self._flat.append(short)
        block_ids = self._problem.block_ids
        for scenario in self._problem.scenarios:
            for left in range(1, len(block_ids)):
                for right in range(left + 1, len(block_ids)):
                    pair = self._model.add_variable(
                        lb=0.0,
                        name=_variable_name("d", left, right, scenario.scenario_id),
                    )
                    self._d[(left, right, scenario.scenario_id)] = pair
                    self._flat.append(pair)

    def _add_gate_link_constraints(self) -> None:
        for block in self._problem.blocks:
            potential_net = flow_hours_to_volume_m3(
                block.nominal_flow_lps, self._problem.slot_hours
            ) * block.path_efficiency
            for scenario in self._problem.scenarios:
                for slot in range(self._problem.slot_count):
                    delivered = self._x[(block.block_id, slot, scenario.scenario_id)]
                    gate = self._y[(block.block_id, slot, scenario.scenario_id)]
                    self._model.add_linear_constraint(
                        delivered - potential_net * gate <= 0.0,
                        name=_variable_name("link", block.block_id, slot, scenario.scenario_id),
                    )

    def _gross_expression(self, block: PlanningBlockSpec, slot: int, scenario_id: str):
        return self._x[(block.block_id, slot, scenario_id)] * block.gross_per_net

    def _add_supply_constraints(self) -> None:
        for scenario in self._problem.scenarios:
            for slot in range(self._problem.slot_count):
                capacity = flow_hours_to_volume_m3(
                    scenario.supply_lps[slot], self._problem.slot_hours
                )
                gross = mathopt.fast_sum(
                    self._gross_expression(block, slot, scenario.scenario_id)
                    for block in self._problem.blocks
                )
                self._model.add_linear_constraint(
                    gross <= capacity,
                    name=_variable_name("supply", slot, scenario.scenario_id),
                )

    def _add_capacity_constraints(self) -> None:
        for scenario in self._problem.scenarios:
            for slot in range(self._problem.slot_count):
                for edge_id, downstream in self._problem.edge_downstream_blocks.items():
                    capacity = flow_hours_to_volume_m3(
                        self._problem.edge_capacity_lps[edge_id], self._problem.slot_hours
                    )
                    gross = mathopt.fast_sum(
                        self._gross_expression(self.block(block_id), slot, scenario.scenario_id)
                        for block_id in downstream
                    )
                    self._model.add_linear_constraint(
                        gross <= capacity,
                        name=_variable_name("cap", edge_id, slot, scenario.scenario_id),
                    )

    def _add_storage_constraints(self) -> None:
        for block in self._problem.blocks:
            mm_per_m3 = block.storage_mm_per_m3
            for scenario in self._problem.scenarios:
                for slot in range(self._problem.slot_count):
                    balance = (
                        self._storage[(block.block_id, slot + 1, scenario.scenario_id)]
                        - self._storage[(block.block_id, slot, scenario.scenario_id)]
                        - mm_per_m3 * self._x[(block.block_id, slot, scenario.scenario_id)]
                        + self._spill[(block.block_id, slot, scenario.scenario_id)]
                    )
                    inflow_mm = scenario.rain_effective_mm[
                        self._problem.block_ids.index(block.block_id)
                    ][slot]
                    outflow_mm = (
                        scenario.etc_mm[self._problem.block_ids.index(block.block_id)][slot]
                        + scenario.perc_mm[self._problem.block_ids.index(block.block_id)][slot]
                        + scenario.wlr_mm[self._problem.block_ids.index(block.block_id)][slot]
                    )
                    deficit = outflow_mm - inflow_mm
                    name = _variable_name("balance", block.block_id, slot, scenario.scenario_id)
                    self._model.add_linear_constraint(balance <= deficit, name=f"{name}|upper")
                    self._model.add_linear_constraint(-balance <= -deficit, name=f"{name}|lower")

    def _add_safety_constraints(self) -> None:
        for block in self._problem.blocks:
            for scenario in self._problem.scenarios:
                for slot in range(1, self._problem.slot_count + 1):
                    storage = self._storage[(block.block_id, slot, scenario.scenario_id)]
                    slack = self._rho[(block.block_id, slot, scenario.scenario_id)]
                    self._model.add_linear_constraint(
                        block.min_storage_mm - storage - slack <= 0.0,
                        name=_variable_name("safety", block.block_id, slot, scenario.scenario_id),
                    )

    def _fairness_denominator(self, block: PlanningBlockSpec, scenario: PlanningScenario) -> float:
        position = self._problem.block_ids.index(block.block_id)
        target_sum = sum(scenario.target_fair_m3[position])
        return block.ledger_target_m3 + target_sum

    def _delivered_expression(self, block: PlanningBlockSpec, scenario_id: str):
        return mathopt.fast_sum(
            self._x[(block.block_id, slot, scenario_id)]
            for slot in range(self._problem.slot_count)
        )

    def _add_fairness_constraints(self) -> None:
        for block in self._problem.blocks:
            for scenario in self._problem.scenarios:
                denominator = self._fairness_denominator(block, scenario)
                delivered = self._delivered_expression(block, scenario.scenario_id)
                target_room = denominator * self._z - delivered
                self._model.add_linear_constraint(
                    target_room <= block.ledger_delivered_m3,
                    name=_variable_name("fair", block.block_id, scenario.scenario_id),
                )

    def service_ratio_expression(self, block: PlanningBlockSpec, scenario_id: str):
        scenario = self.scenario(scenario_id)
        denominator = self._fairness_denominator(block, scenario)
        delivered = self._delivered_expression(block, scenario_id)
        return (block.ledger_delivered_m3 + delivered) * (1.0 / denominator)

    def _add_dispersion_constraints(self) -> None:
        block_ids = self._problem.block_ids
        for scenario in self._problem.scenarios:
            for left in range(1, len(block_ids)):
                for right in range(left + 1, len(block_ids)):
                    first = self.block(block_ids[left])
                    second = self.block(block_ids[right])
                    first_den = self._fairness_denominator(first, scenario)
                    second_den = self._fairness_denominator(second, scenario)
                    pair = self._d[(left, right, scenario.scenario_id)]
                    spread = second_den * (
                        first.ledger_delivered_m3
                        + self._delivered_expression(first, scenario.scenario_id)
                    ) - first_den * (
                        second.ledger_delivered_m3
                        + self._delivered_expression(second, scenario.scenario_id)
                    )
                    self._model.add_linear_constraint(
                        spread - (first_den * second_den) * pair <= 0.0,
                        name=_variable_name("disp", left, right, scenario.scenario_id),
                    )
                    self._model.add_linear_constraint(
                        -spread - (first_den * second_den) * pair <= 0.0,
                        name=_variable_name("disp", left, right, scenario.scenario_id, "rev"),
                    )

    def _add_stability_constraints(self) -> None:
        for block_index, block in enumerate(self._problem.blocks):
            previous_open = 1 if self._problem.previous_gate_open[block_index] else 0
            for scenario in self._problem.scenarios:
                previous = previous_open
                for slot in range(self._problem.slot_count):
                    gate = self._y[(block.block_id, slot, scenario.scenario_id)]
                    switching = self._s[(block.block_id, slot, scenario.scenario_id)]
                    difference = gate - previous
                    name = _variable_name("stab", block.block_id, slot, scenario.scenario_id)
                    self._model.add_linear_constraint(difference - switching <= 0.0, name=f"{name}|up")
                    self._model.add_linear_constraint(-difference - switching <= 0.0, name=f"{name}|down")
                    previous = gate

    def _add_debt_floor_constraints(self) -> None:
        fraction = self._problem.debt_service_fraction
        if fraction <= 0.0:
            return
        for block in self._problem.blocks:
            for scenario in self._problem.scenarios:
                position = self._problem.block_ids.index(block.block_id)
                horizon_target = sum(scenario.target_fair_m3[position])
                floor = fraction * min(block.debt_m3, horizon_target)
                if floor <= 0.0:
                    continue
                delivered = self._delivered_expression(block, scenario.scenario_id)
                self._model.add_linear_constraint(
                    floor - delivered <= 0.0,
                    name=_variable_name("debtfloor", block.block_id, scenario.scenario_id),
                )

    def _add_nonanticipativity_constraints(self) -> None:
        if self._problem.commit_slots <= 0 or len(self._problem.scenarios) < 2:
            return
        reference = self._problem.scenarios[0].scenario_id
        for scenario in self._problem.scenarios[1:]:
            for block in self._problem.blocks:
                for slot in range(self._problem.commit_slots):
                    for variables in (self._y, self._x):
                        self._model.add_linear_constraint(
                            variables[(block.block_id, slot, scenario.scenario_id)]
                            - variables[(block.block_id, slot, reference)]
                            <= 0.0,
                            name=_variable_name(
                                "anticipate", block.block_id, slot, scenario.scenario_id, "up"
                            ),
                        )
                        self._model.add_linear_constraint(
                            variables[(block.block_id, slot, reference)]
                            - variables[(block.block_id, slot, scenario.scenario_id)]
                            <= 0.0,
                            name=_variable_name(
                                "anticipate", block.block_id, slot, scenario.scenario_id, "down"
                            ),
                        )

    def enable_cvar(self, alpha: float) -> None:
        if self._cvar_enabled:
            raise DomainInvariantError("cvar is already enabled")
        if not 0.0 < alpha < 1.0:
            raise DomainInvariantError("alpha must lie in (0, 1)")
        self._cvar_alpha = alpha
        theta = self._model.add_variable(lb=0.0, name="cvar|theta")
        self._cvar_theta = theta
        self._flat.append(theta)
        for scenario in self._problem.scenarios:
            psi = self._model.add_variable(
                lb=0.0, name=_variable_name("cvar", scenario.scenario_id)
            )
            self._cvar_psi[scenario.scenario_id] = psi
            self._flat.append(psi)
            loss = self.shortage_expression(scenario.scenario_id)
            self._model.add_linear_constraint(
                loss - theta - psi <= 0.0,
                name=_variable_name("cvarfloor", scenario.scenario_id),
            )
        self._cvar_enabled = True

    def shortage_expression(self, scenario_id: str):
        self.scenario(scenario_id)
        return mathopt.fast_sum(
            self._short[(block.block_id, slot, scenario_id)]
            for block in self._problem.blocks
            for slot in range(self._problem.slot_count)
        )

    def cvar_expression(self):
        if not self._cvar_enabled or self._cvar_theta is None:
            return None
        tail = mathopt.fast_sum(
            self.scenario(scenario_id).probability * self._cvar_psi[scenario_id]
            for scenario_id in self._problem.scenario_ids
        )
        return self._cvar_theta + (1.0 / (1.0 - self._cvar_alpha)) * tail

    def expected_switching_expression(self):
        return mathopt.fast_sum(
            self.scenario(scenario_id).probability
            * self._s[(block.block_id, slot, scenario_id)]
            for block in self._problem.blocks
            for slot in range(self._problem.slot_count)
            for scenario_id in self._problem.scenario_ids
        )

    def expected_gross_expression(self):
        return mathopt.fast_sum(
            self.scenario(scenario_id).probability
            * self._gross_expression(block, slot, scenario_id)
            for block in self._problem.blocks
            for slot in range(self._problem.slot_count)
            for scenario_id in self._problem.scenario_ids
        )

    def _add_shortage_constraints(self) -> None:
        for block in self._problem.blocks:
            position = self._problem.block_ids.index(block.block_id)
            for scenario in self._problem.scenarios:
                for slot in range(self._problem.slot_count):
                    target = scenario.target_fair_m3[position][slot]
                    shortfall = target - self._x[(block.block_id, slot, scenario.scenario_id)]
                    short = self._short[(block.block_id, slot, scenario.scenario_id)]
                    self._model.add_linear_constraint(
                        shortfall - short <= 0.0,
                        name=_variable_name("shortlink", block.block_id, slot, scenario.scenario_id),
                    )


def build_plan_model(problem: PlanningProblem) -> PlanModel:
    model = PlanModel(problem)
    model._add_shortage_constraints()
    return model


def extract_plan(model: PlanModel, outcome: SolveOutcome) -> PlanDecision:
    if not outcome.has_solution:
        raise DomainInvariantError("plan extraction requires a feasible solution")
    planning = model.planning
    scenario_ids = planning.scenario_ids
    execution = scenario_ids[0]
    opens: list[tuple[bool, ...]] = []
    delivered: list[tuple[float, ...]] = []
    for block in planning.blocks:
        opens.append(
            tuple(
                outcome.value(_variable_name("y", block.block_id, slot, execution)) > 0.5
                for slot in range(planning.slot_count)
            )
        )
        delivered.append(
            tuple(
                outcome.value(_variable_name("x", block.block_id, slot, execution))
                for slot in range(planning.slot_count)
            )
        )
    switching = 0.0
    gross = 0.0
    slack = 0.0
    shortage = 0.0
    for scenario in planning.scenarios:
        weight = scenario.probability
        for block in planning.blocks:
            for slot in range(planning.slot_count):
                switching += weight * outcome.value(
                    _variable_name("s", block.block_id, slot, scenario.scenario_id)
                )
                gross += weight * outcome.value(
                    _variable_name("x", block.block_id, slot, scenario.scenario_id)
                ) * block.gross_per_net
                slack += weight * outcome.value(
                    _variable_name("rho", block.block_id, slot, scenario.scenario_id)
                )
                shortage += weight * outcome.value(
                    _variable_name("short", block.block_id, slot, scenario.scenario_id)
                )
    terminal = tuple(
        outcome.value(_variable_name("store", block.block_id, planning.slot_count, execution))
        for block in planning.blocks
    )
    return PlanDecision(
        scenario_ids=scenario_ids,
        open_by_slot=tuple(opens),
        delivered_m3_by_slot=tuple(delivered),
        switching_total_expected=switching,
        gross_withdrawal_expected_m3=gross,
        safety_slack_total_expected=slack,
        shortage_total_expected_m3=shortage,
        service_floor_z=outcome.value("z"),
        terminal_storage_mm=terminal,
        variable_values=outcome.variable_values,
    )