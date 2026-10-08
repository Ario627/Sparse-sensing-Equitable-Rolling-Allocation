from __future__ import annotations

import datetime
from pathlib import Path
from typing import Final

import pytest

from sera.baselines.base import BaselineMethod
from sera.core.io import canonical_json, config_hash
from sera.core.rng import generator_for, stream_key
from sera.core.types import DomainInvariantError, TopologyKind
from sera.experiments.config import ExperimentConfig, experiment_config_from_mapping
from sera.experiments.executors import ExperimentExecutor
from sera.experiments.runner import ExperimentPlan, GridFactors, plan_experiment, run_experiment
from sera.simulator.engine import SimulationConfig, SimulationResult, run_simulation
from sera.simulator.scenarios import ScenarioSpec, scenario_from_preset

SEED_BASE: Final = 7
OTHER_SEED: Final = 8
SLOT_HOURS: Final = 6.0
N_BLOCKS: Final = 6
HORIZON_DAYS: Final = 2
START_TIME: Final = datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC)
PROBE_CONFIG: Final = {"methods": ["proportional", "rotation"], "probe": True}
PRODUCTION_GRID: Final = {
    "seed_base": SEED_BASE,
    "methods": ["proportional"],
    "scenarios": ["nominal"],
    "block_counts": [N_BLOCKS],
    "topologies": ["CHAIN"],
    "k_factors": [1.0],
    "sensor_sets": [[]],
    "replicates": 1,
}


def production_config(experiment_id: str) -> ExperimentConfig:
    return experiment_config_from_mapping({"experiment_id": experiment_id, **PRODUCTION_GRID})


def small_factors(k_factor: float = 1.0) -> GridFactors:
    return GridFactors(
        methods=(BaselineMethod.PROPORTIONAL, BaselineMethod.ROTATION),
        scenario_ids=("nominal",),
        block_counts=(N_BLOCKS,),
        topologies=(TopologyKind.CHAIN,),
        k_factors=(k_factor,),
        sensor_sets=((),),
        replicates=1,
    )


def small_plan(experiment_id: str) -> ExperimentPlan:
    return plan_experiment(
        experiment_id,
        seed_base=SEED_BASE,
        config=PROBE_CONFIG,
        factors=small_factors(),
    )


def run_open_loop(spec: ScenarioSpec, seed: int) -> SimulationResult:
    return run_simulation(
        SimulationConfig(
            scenario=spec,
            seed=seed,
            start_time=START_TIME,
            slot_hours=SLOT_HOURS,
        )
    )


def short_spec() -> ScenarioSpec:
    return scenario_from_preset("nominal", n_blocks=N_BLOCKS, horizon_days=HORIZON_DAYS)


def test_canonical_json_is_order_insensitive() -> None:
    left = {"b": 1, "a": {"y": 2, "x": 3}}
    right = {"a": {"x": 3, "y": 2}, "b": 1}
    assert canonical_json(left) == canonical_json(right)
    assert config_hash(left) == config_hash(right)


def test_canonical_json_rejects_non_finite_floats() -> None:
    with pytest.raises(DomainInvariantError):
        canonical_json({"value": float("nan")})
    with pytest.raises(DomainInvariantError):
        canonical_json({"value": float("inf")})


def test_stream_key_is_stable_and_label_sensitive() -> None:
    first = stream_key(SEED_BASE, "weather", "nominal")
    second = stream_key(SEED_BASE, "weather", "nominal")
    other_label = stream_key(SEED_BASE, "weather", "drought")
    other_seed = stream_key(OTHER_SEED, "weather", "nominal")
    assert first == second
    assert first != other_label
    assert first != other_seed


def test_generator_for_replays_identical_draws() -> None:
    first = generator_for(SEED_BASE, "tests", "replay")
    second = generator_for(SEED_BASE, "tests", "replay")
    assert list(first.standard_normal(8)) == list(second.standard_normal(8))
    other = generator_for(SEED_BASE, "tests", "other")
    assert list(other.standard_normal(8)) != list(second.standard_normal(8))


def test_simulator_replay_is_bit_identical() -> None:
    spec = short_spec()
    first = run_open_loop(spec, SEED_BASE)
    second = run_open_loop(spec, SEED_BASE)
    assert first.final_storage_mm == second.final_storage_mm
    assert first.loss_history == second.loss_history
    for outcome_a, outcome_b in zip(first.outcomes, second.outcomes, strict=True):
        assert outcome_a.delivered_m3 == outcome_b.delivered_m3
        assert outcome_a.storage_mm == outcome_b.storage_mm
        samples_a = [(sample.sensor_id, sample.value) for sample in outcome_a.observations]
        samples_b = [(sample.sensor_id, sample.value) for sample in outcome_b.observations]
        assert samples_a == samples_b


def test_simulator_seed_change_perturbs_the_world() -> None:
    spec = short_spec()
    first = run_open_loop(spec, SEED_BASE)
    other = run_open_loop(spec, OTHER_SEED)
    assert first.loss_history[0] != other.loss_history[0]
    assert first.final_storage_mm != other.final_storage_mm


def test_plan_hash_tracks_grid_not_experiment_label() -> None:
    first = small_plan("repro-hash")
    second = small_plan("repro-hash")
    renamed = small_plan("repro-hash-renamed")
    other_grid = plan_experiment(
        "repro-hash",
        seed_base=SEED_BASE,
        config=PROBE_CONFIG,
        factors=small_factors(k_factor=0.6),
    )
    assert first.config_hash == second.config_hash
    assert first.config_hash == renamed.config_hash
    assert first.config_hash != other_grid.config_hash


def test_production_config_hash_tracks_experiment_label() -> None:
    first = production_config("repro-label-a")
    repeated = production_config("repro-label-a")
    renamed = production_config("repro-label-b")
    assert first.config_hash == repeated.config_hash
    assert first.config_hash != renamed.config_hash


def test_expanded_specs_are_ordered_and_seeded_deterministically() -> None:
    first = small_plan("repro-specs")
    second = small_plan("repro-specs")
    assert [spec.run_index for spec in first.specs] == list(range(first.run_count))
    for left, right in zip(first.specs, second.specs, strict=True):
        assert left == right
        assert left.seed == right.seed
    seeds = [spec.seed for spec in first.specs]
    assert len(set(seeds)) >= 1


def test_run_seeds_are_stable_across_grid_positions() -> None:
    first = small_plan("repro-seeds-a")
    second = small_plan("repro-seeds-b")
    assert [spec.seed for spec in first.specs] == [spec.seed for spec in second.specs]


def test_experiment_replay_produces_identical_metrics(tmp_path: Path) -> None:
    plan = small_plan("repro-replay")
    executor = ExperimentExecutor()
    first = run_experiment(plan, executor, checkpoint_path=tmp_path / "first.jsonl")
    second = run_experiment(plan, executor, checkpoint_path=tmp_path / "second.jsonl")
    assert first.records
    assert second.records
    assert len(first.records) == len(second.records) == plan.run_count
    for left, right in zip(first.records, second.records, strict=True):
        assert left.spec == right.spec
        assert left.metrics == right.metrics
        assert left.extras == right.extras


def test_experiment_checkpoint_resume_skips_completed_runs(tmp_path: Path) -> None:
    plan = small_plan("repro-resume")
    executor = ExperimentExecutor()
    checkpoint = tmp_path / "resume.jsonl"
    first = run_experiment(plan, executor, checkpoint_path=checkpoint)
    assert first.skipped == 0
    second = run_experiment(plan, executor, checkpoint_path=checkpoint)
    assert second.skipped == plan.run_count
    for left, right in zip(first.records, second.records, strict=True):
        assert left.spec == right.spec
        assert left.metrics == right.metrics
