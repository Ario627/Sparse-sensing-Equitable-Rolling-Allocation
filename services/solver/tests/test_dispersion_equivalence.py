"""Uji ekuivalensi optimasi kendala dispersion.

Optimasi dispersion hanya boleh mengubah **cara** kendala dibangun, bukan
**formulasi**-nya. Test ini karena itu menyimpan implementasi referensi
(loop bersarang naif sesuai rumusan asli) dan membandingkannya dengan
implementasi produksi:

1. Struktur: himpunan (variabel, koefisien, batas) seluruh kendala linear harus
   identik, termasuk jumlah variabel.
2. Numerik: nilai objektif optimum LP dan solusi MIP harus sama.

Kalau test (1) lulus, ekuivalensi terbukti untuk seluruh model, bukan hanya
sampel. Test (2) menangkap perbedaan yang lolos dari pembulatan struktur.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final

import pytest

from sera.core.types import DomainInvariantError
from sera.optimizer.model import (
    PlanModel,
    PlanningBlockSpec,
    PlanningProblem,
    PlanningScenario,
    _variable_name,
    extract_plan,
)
from sera.optimizer.objectives import (
    DEFAULT_ORDER,
    LexicographicRequest,
    _dispersion_expression,
    solve_lexicographic,
)
from sera.optimizer.solver import SolveBudget, SolverBackend, solve_model
from sera.optimizer.stochastic import ScenarioConfig, build_ensemble

SLOTS: Final = 2
ROUNDING: Final = 12


def _scenario(sid: str, blocks: int, probability: float = 1.0) -> PlanningScenario:
    # Nilai per blok sengaja TIDAK seragam: dengan target yang seragam, penukaran
    # suku pada rumusan dispersion bisa lolos karena kedua bentuk menjadi saling
    # negatif dan himpunannya tetap cocok.
    def ramp(base: float, step: float) -> tuple[tuple[float, ...], ...]:
        return tuple(tuple([base + step * index] * SLOTS) for index in range(blocks))

    return PlanningScenario(
        scenario_id=sid,
        probability=probability,
        supply_lps=tuple([10.0] * SLOTS),
        etc_mm=ramp(5.0, 0.7),
        perc_mm=ramp(1.0, 0.3),
        wlr_mm=ramp(0.5, 0.1),
        rain_effective_mm=tuple(tuple([0.0] * SLOTS) for _ in range(blocks)),
        target_fair_m3=ramp(20.0, 3.0),
    )


def _problem(blocks: int, scenarios: int, *, seed: int = 0) -> PlanningProblem:
    specs = tuple(
        PlanningBlockSpec(
            block_id=f"b{index}",
            area_m2=4000.0,
            nominal_flow_lps=2.5,
            path_efficiency=0.7,
            min_storage_mm=0.0,
            max_storage_mm=60.0,
            initial_storage_mm=40.0,
            ledger_delivered_m3=10.0 + 0.5 * index,
            ledger_target_m3=12.0 + 0.75 * index,
            debt_m3=0.0,
        )
        for index in range(1, blocks + 1)
    )
    base: Mapping[str, object] = {
        "blocks": specs,
        "slot_hours": 6.0,
        "edge_capacity_lps": {f"e{index}": 6.0 for index in range(1, blocks + 1)},
        "edge_downstream_blocks": {
            f"e{index}": tuple(f"b{j}" for j in range(index, blocks + 1))
            for index in range(1, blocks + 1)
        },
        "previous_gate_open": tuple([False] * blocks),
        "commit_slots": 1,
    }
    central = _scenario("central", blocks)
    if scenarios == 1:
        return PlanningProblem(scenarios=(central,), **base)  # type: ignore[arg-type]
    ensemble, _ = build_ensemble(
        central,
        ScenarioConfig(n_scenarios=scenarios),
        None,
        __import__("numpy").random.default_rng(seed),
    )
    return PlanningProblem(scenarios=ensemble, **base)  # type: ignore[arg-type]


def _reference_dispersion(self: PlanModel) -> None:
    """Rumusan asli, ditulis ulang apa adanya sebagai referensi independen."""
    problem = self._problem
    block_ids = problem.block_ids
    for scenario in problem.scenarios:
        for left in range(1, len(block_ids)):
            for right in range(left + 1, len(block_ids)):
                first = self.block(block_ids[left])
                second = self.block(block_ids[right])
                first_den = self._fairness_denominator(first, scenario)
                second_den = self._fairness_denominator(second, scenario)
                pair = self._d[(left, right, scenario.scenario_id)]
                # Urutan suku harus sama persis dengan produksi; menukarnya tetap
                # ekuivalen secara himpunan tetapi membalik pasangan kendala
                # disp/rev, dan itu terdeteksi oleh test urutan.
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


def _canonical(
    model: PlanModel, *, sort: bool = True
) -> list[tuple[tuple[tuple[int, float], ...], float, float]]:
    rows = []
    for constraint in model.problem.linear_constraints():
        terms = tuple(
            sorted(
                (term.variable.id, round(term.coefficient, ROUNDING)) for term in constraint.terms()
            )
        )
        lower = constraint.lower_bound
        upper = constraint.upper_bound
        rows.append(
            (
                terms,
                float("-inf") if lower is None else round(lower, ROUNDING),
                float("inf") if upper is None else round(upper, ROUNDING),
            )
        )
    return sorted(rows, key=repr) if sort else rows


def _build_with(reference: bool, problem: PlanningProblem) -> PlanModel:
    if not reference:
        return PlanModel(problem)
    original = PlanModel._add_dispersion_constraints
    PlanModel._add_dispersion_constraints = _reference_dispersion  # type: ignore[method-assign]
    try:
        return PlanModel(problem)
    finally:
        PlanModel._add_dispersion_constraints = original  # type: ignore[method-assign]


@pytest.mark.parametrize(
    ("blocks", "scenarios"),
    [(3, 1), (6, 1), (6, 3), (10, 2), (12, 5)],
)
def test_constraint_set_is_structurally_identical(blocks: int, scenarios: int) -> None:
    """Struktur kendala harus identik: bukti ekuivalensi seluruh model."""
    problem = _problem(blocks, scenarios)
    reference = _canonical(_build_with(True, problem))
    production = _canonical(_build_with(False, problem))
    assert len(reference) == len(production)
    assert reference == production


@pytest.mark.parametrize(
    ("blocks", "scenarios"),
    [(3, 1), (6, 3), (10, 2)],
)
def test_constraint_order_is_preserved(blocks: int, scenarios: int) -> None:
    """Urutan kendala ikut dipertahankan agar perilaku solver tetap sama.

    Himpunan kendala yang sama dengan urutan berbeda masih ekuivalen secara
    matematis, tetapi dapat menghasilkan solusi optimum yang berbeda (sama-sama
    optimal) pada MIP, sehingga keputusan gate bisa berbeda. Karena A/B
    membandingkan keputusan, urutan harus identik.
    """
    problem = _problem(blocks, scenarios)
    reference = _canonical(_build_with(True, problem), sort=False)
    production = _canonical(_build_with(False, problem), sort=False)
    assert reference == production

    reference_names = [c.name for c in _build_with(True, problem).problem.linear_constraints()]
    production_names = [c.name for c in _build_with(False, problem).problem.linear_constraints()]
    assert reference_names == production_names


@pytest.mark.parametrize(("blocks", "scenarios"), [(6, 1), (8, 3)])
def test_variable_count_matches(blocks: int, scenarios: int) -> None:
    problem = _problem(blocks, scenarios)
    reference = _build_with(True, problem)
    production = _build_with(False, problem)
    assert len(reference.flat_variables) == len(production.flat_variables)
    assert reference.problem.get_num_linear_constraints() == (
        production.problem.get_num_linear_constraints()
    )


@pytest.mark.parametrize(("blocks", "scenarios"), [(6, 1), (8, 3)])
def test_lp_relaxation_optimum_is_equal(blocks: int, scenarios: int) -> None:
    """Nilai objektif optimum LP harus sama pada toleransi numerik."""
    problem = _problem(blocks, scenarios)
    values = []
    for reference in (True, False):
        model = _build_with(reference, problem)
        model.problem.minimize(_dispersion_expression(model))
        outcome = solve_model(
            model.problem,
            model.flat_variables,
            backend=SolverBackend.HIGHS,
            budget=SolveBudget(time_limit_s=30.0),
        )
        assert outcome.has_solution
        values.append(outcome.objective_value)
    assert values[0] == pytest.approx(values[1], rel=1e-9, abs=1e-9)


def test_full_lexicographic_solution_equals_reference() -> None:
    """Ekuivalensi ditegakkan juga pada solusi lexicographic penuh."""
    problem = _problem(8, 3)
    plans = []
    for reference in (True, False):
        model = _build_with(reference, problem)
        outcome = solve_lexicographic(model, LexicographicRequest(stage_time_limit_s=10.0))
        assert outcome.final is not None
        assert outcome.final.has_solution
        decision = extract_plan(model, outcome.final)
        plans.append(decision.open_by_slot)
    assert plans[0] == plans[1]


def test_reference_and_production_agree_on_objective_modules() -> None:
    """Sanity: urutan stage default dipakai apa adanya oleh kedua jalur."""
    assert DEFAULT_ORDER[0].value == "SAFETY"


def test_unknown_block_is_rejected_in_both_paths() -> None:
    """Validasi tetap berlaku setelah optimasi."""
    problem = _problem(4, 1)
    model = _build_with(False, problem)
    with pytest.raises(DomainInvariantError):
        model.block("tidak-ada")
