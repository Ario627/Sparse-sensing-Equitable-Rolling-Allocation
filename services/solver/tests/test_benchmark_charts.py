"""Test untuk sharding, penggabungan, dan chart benchmark."""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Final

import pandas as pd
import pytest  # type: ignore

from sera.baselines.base import BaselineMethod
from sera.core.types import DomainInvariantError, TopologyKind
from sera.experiments.benchmark import (
    collect_shard_records,
    environment_keys,
    merge_benchmark,
    parse_shard_spec,
    shard_plan,
    write_merged_checkpoint,
)
from sera.experiments.charts import (
    METRIC_DIRECTION,
    ExperimentArtifacts,
    chart_final_scorecard,
    chart_kpi_comparison,
    generate_all_charts,
    load_artifacts,
    method_color,
)
from sera.experiments.metrics import RunMetrics
from sera.experiments.reporting import (
    META_FILENAME,
    RUNS_FILENAME,
    SUMMARY_FILENAME,
    experiment_paths,
    runs_frame,
    write_summary_file,
)
from sera.experiments.runner import (
    ExperimentPlan,
    GridFactors,
    RunFailure,
    RunRecord,
    RunSpec,
    load_checkpoint,
)
from sera.experiments.summary import (
    DEFAULT_SUMMARY_METRICS,
    attach_decision_regret,
    build_summary,
)

METRIC_COUNT: Final = 6


def make_spec(
    index: int,
    method: BaselineMethod,
    *,
    scenario: str = "nominal",
    n_blocks: int = 6,
    k_factor: float = 0.7,
    replicate: int = 0,
    sensor_set: tuple[str, ...] = ("b2",),
    seed: int = 1000,
) -> RunSpec:
    return RunSpec(
        run_index=index,
        method=method,
        scenario_id=scenario,
        n_blocks=n_blocks,
        topology=TopologyKind.CHAIN,
        k_factor=k_factor,
        replicate=replicate,
        sensor_set=sensor_set,
        seed=seed,
    )


def make_plan(specs: Sequence[RunSpec], *, experiment_id: str = "unit_plan") -> ExperimentPlan:
    scenarios = tuple(sorted({spec.scenario_id for spec in specs}))
    return ExperimentPlan(
        experiment_id=experiment_id,
        seed_base=20261011,
        config={"experiment_id": experiment_id},
        factors=GridFactors(
            methods=tuple(BaselineMethod),
            scenario_ids=scenarios,
            block_counts=(6,),
            topologies=(TopologyKind.CHAIN,),
            k_factors=(0.4, 0.7),
            sensor_sets=(("b2",),),
            replicates=1,
        ),
        specs=tuple(specs),
    )


class TestParseShardSpec:
    def test_parses_valid_spec(self) -> None:
        assert parse_shard_spec("2/5") == (2, 5)

    @pytest.mark.parametrize("text", ["2", "2/", "/3", "a/3", "2/b", "5/5", "9/5", "1/0"])
    def test_rejects_invalid_spec(self, text: str) -> None:
        with pytest.raises(DomainInvariantError):
            parse_shard_spec(text)


class TestShardPlan:
    def _grid_specs(self) -> list[RunSpec]:
        specs: list[RunSpec] = []
        index = 0
        for scenario in ("nominal", "drought"):
            for k_factor in (0.4, 0.7):
                for method in BaselineMethod:
                    specs.append(
                        make_spec(
                            index,
                            method,
                            scenario=scenario,
                            k_factor=k_factor,
                            seed=1000 + index,
                        )
                    )
                    index += 1
        return specs

    def test_shards_partition_every_run_exactly_once(self) -> None:
        plan = make_plan(self._grid_specs())
        seen: list[tuple[object, ...]] = []
        for index in range(3):
            shard = shard_plan(plan, shard_index=index, shard_count=3)
            seen.extend(environment_keys(shard))
            assert [spec.run_index for spec in shard.specs] == list(range(len(shard.specs)))
        assert sorted(seen, key=str) == sorted(environment_keys(plan), key=str)

    def test_every_shard_keeps_all_methods_for_its_environments(self) -> None:
        plan = make_plan(self._grid_specs())
        for index in range(3):
            shard = shard_plan(plan, shard_index=index, shard_count=3)
            by_environment: dict[tuple[object, ...], set[BaselineMethod]] = {}
            for spec in shard.specs:
                key = (spec.scenario_id, spec.k_factor)
                by_environment.setdefault(key, set()).add(spec.method)
            for methods in by_environment.values():
                assert methods == set(BaselineMethod)

    def test_rejects_more_shards_than_environments(self) -> None:
        plan = make_plan(self._grid_specs())
        with pytest.raises(DomainInvariantError, match="exceeds"):
            shard_plan(plan, shard_index=0, shard_count=99)

    def test_shard_config_hash_differs_from_full_plan(self) -> None:
        plan = make_plan(self._grid_specs())
        shard = shard_plan(plan, shard_index=0, shard_count=2)
        assert shard.config_hash != plan.config_hash


def make_metrics(
    *,
    adequacy: float,
    shortage: float,
    worst_sr: float,
    dependability: float = 0.5,
    equity: float = 0.05,
    solve_time_ms: float = 100.0,
    regret: float | None = None,
) -> RunMetrics:
    return RunMetrics(
        adequacy=adequacy,
        efficiency=0.8,
        dependability=dependability,
        equity=equity,
        worst_sr=worst_sr,
        shortage_total_m3=shortage,
        tail_deficit_m3=shortage / 2.0,
        cvar_shortage_m3=shortage / 10.0,
        state_rmse=5.0,
        solve_time_ms=solve_time_ms,
        mip_gap=0.01,
        n_resolves=1,
        gate_switches=3,
        fallback_used=False,
        decision_regret=regret,
    )


def build_experiment(results_root: Path, experiment_id: str = "chart_fixture") -> Path:
    """Bangun artefak eksperimen sintetis lewat jalur kode asli (summary + parquet)."""
    quality = {
        BaselineMethod.SERA: (0.95, 100.0, 0.93),
        BaselineMethod.PROPORTIONAL: (0.80, 400.0, 0.65),
        BaselineMethod.ROTATION: (0.60, 900.0, 0.40),
        BaselineMethod.GREEDY: (0.92, 180.0, 0.88),
        BaselineMethod.ORACLE: (0.98, 60.0, 0.96),
    }
    records: list[RunRecord] = []
    # Seed harus unik per environment dan sama lintas metode di environment itu:
    # `attach_decision_regret` memasangkan metode ke oracle lewat (seed, sensor_set).
    environments = [
        ("nominal", 0.7, 0),
        ("drought", 0.4, 0),
        ("nominal", 1.0, 0),
        ("nominal", 0.7, 1),
        ("drought", 0.4, 1),
        ("nominal", 1.0, 1),
    ]
    seeds = {env: 3000 + position for position, env in enumerate(environments)}
    index = 0
    for scenario, k_factor, replicate in environments:
        for method in BaselineMethod:
            adequacy, shortage, worst_sr = quality[method]
            spec = make_spec(
                index,
                method,
                scenario=scenario,
                k_factor=k_factor,
                replicate=replicate,
                seed=seeds[(scenario, k_factor, replicate)],
            )
            records.append(
                RunRecord(
                    spec=spec,
                    metrics=make_metrics(
                        adequacy=adequacy - 0.02 * replicate,
                        shortage=shortage + 10.0 * replicate,
                        worst_sr=worst_sr,
                        solve_time_ms=500.0 if method is BaselineMethod.SERA else 1.0,
                        # Regret tidak berlaku bagi oracle: ia sendiri adalah referensinya.
                        regret=(
                            None
                            if method is BaselineMethod.ORACLE
                            else (0.0 if method is BaselineMethod.SERA else shortage / 100.0)
                        ),
                    ),
                )
            )
            index += 1

    with_regret = attach_decision_regret(tuple(records))
    summary = build_summary(
        with_regret,
        (),
        experiment_id=experiment_id,
        plan_hash="a" * 64,
        seed=20261011,
        metrics=(*DEFAULT_SUMMARY_METRICS, "decision_regret"),
    )
    paths = experiment_paths(results_root, experiment_id)
    paths.directory.mkdir(parents=True, exist_ok=True)
    runs_frame(with_regret).to_parquet(paths.runs_path, index=False)
    write_summary_file(paths, summary)
    (paths.directory / META_FILENAME).write_text(
        json.dumps({"config": {"experiment_id": experiment_id}}), encoding="utf-8"
    )
    return paths.directory


class TestMergeCheckpoint:
    def test_round_trips_through_load_checkpoint(self, tmp_path: Path) -> None:
        spec = make_spec(0, BaselineMethod.SERA)
        record = RunRecord(
            spec=spec,
            metrics=make_metrics(adequacy=0.9, shortage=120.0, worst_sr=0.8),
        )
        plan = make_plan([spec], experiment_id="round_trip")
        path = write_merged_checkpoint(tmp_path / "checkpoint.jsonl", plan, (record,), ())
        contents = load_checkpoint(path)
        assert contents.experiment_id == "round_trip"
        assert contents.config_hash == plan.config_hash
        assert len(contents.records) == 1
        assert contents.records[0].metrics.adequacy == pytest.approx(0.9)

    def test_round_trips_failures_through_load_checkpoint(self, tmp_path: Path) -> None:
        """Bentuk entri `failed` harus sama dengan yang ditulis runner."""
        spec = make_spec(0, BaselineMethod.SERA)
        plan = make_plan([spec], experiment_id="failure_round_trip")
        failure = RunFailure(
            spec=spec,
            error_type="DomainInvariantError",
            message="sensor set references unknown blocks: ['b8']",
        )
        path = write_merged_checkpoint(tmp_path / "checkpoint.jsonl", plan, (), (failure,))
        contents = load_checkpoint(path)
        assert len(contents.failures) == 1
        assert contents.failures[0].error_type == "DomainInvariantError"
        assert "unknown blocks" in contents.failures[0].message
        assert contents.failures[0].spec.run_index == 0

    def test_records_without_shard_are_reported(self, tmp_path: Path) -> None:
        with pytest.raises(DomainInvariantError, match="no shard checkpoint"):
            collect_shard_records(tmp_path, experiment_id="missing", workers=2)

    def test_records_outside_the_plan_are_dropped(self, tmp_path: Path) -> None:
        """Shard dari grid lain tidak boleh ikut tergabung."""
        spec = make_spec(0, BaselineMethod.SERA, scenario="nominal", k_factor=0.7)
        other = make_spec(1, BaselineMethod.SERA, scenario="nominal", k_factor=0.4)
        plan = make_plan([spec], experiment_id="filtered")
        shard_dir = tmp_path / ".shards" / "shard00of01" / "filtered"
        shard_dir.mkdir(parents=True)
        write_merged_checkpoint(
            shard_dir / "checkpoint.jsonl",
            make_plan([spec, other], experiment_id="filtered"),
            (
                RunRecord(
                    spec=spec,
                    metrics=make_metrics(adequacy=0.9, shortage=10.0, worst_sr=0.9),
                ),
                RunRecord(
                    spec=other,
                    metrics=make_metrics(adequacy=0.5, shortage=99.0, worst_sr=0.5),
                ),
            ),
            (),
        )
        records, failures, dropped = collect_shard_records(
            tmp_path, experiment_id="filtered", workers=1, plan=plan
        )
        assert len(records) == 1
        assert records[0].spec.k_factor == pytest.approx(0.7)
        assert failures == ()
        assert dropped == 1

    def test_without_plan_every_record_is_kept(self, tmp_path: Path) -> None:
        spec = make_spec(0, BaselineMethod.SERA)
        other = make_spec(1, BaselineMethod.GREEDY, k_factor=0.4)
        shard_dir = tmp_path / ".shards" / "shard00of01" / "unfiltered"
        shard_dir.mkdir(parents=True)
        write_merged_checkpoint(
            shard_dir / "checkpoint.jsonl",
            make_plan([spec, other], experiment_id="unfiltered"),
            (
                RunRecord(
                    spec=spec, metrics=make_metrics(adequacy=0.9, shortage=10.0, worst_sr=0.9)
                ),
                RunRecord(
                    spec=other, metrics=make_metrics(adequacy=0.5, shortage=99.0, worst_sr=0.5)
                ),
            ),
            (),
        )
        records, _, dropped = collect_shard_records(tmp_path, experiment_id="unfiltered", workers=1)
        assert len(records) == 2
        assert dropped == 0


class TestMergeBenchmark:
    def _shard_with_failure(self, tmp_path: Path) -> ExperimentPlan:
        """Tulis satu shard berisi 2 record + 1 failure, kembalikan plan-nya."""
        ok_spec = make_spec(0, BaselineMethod.SERA, scenario="nominal", k_factor=0.7)
        second_spec = make_spec(1, BaselineMethod.GREEDY, scenario="nominal", k_factor=0.7)
        failed_spec = make_spec(2, BaselineMethod.ROTATION, scenario="nominal", k_factor=0.4)
        plan = make_plan([ok_spec, second_spec, failed_spec], experiment_id="merge_fixture")
        shard_dir = tmp_path / ".shards" / "shard00of01" / "merge_fixture"
        shard_dir.mkdir(parents=True)
        write_merged_checkpoint(
            shard_dir / "checkpoint.jsonl",
            make_plan([ok_spec, second_spec, failed_spec], experiment_id="merge_fixture"),
            (
                RunRecord(
                    spec=ok_spec, metrics=make_metrics(adequacy=0.9, shortage=10.0, worst_sr=0.9)
                ),
                RunRecord(
                    spec=second_spec,
                    metrics=make_metrics(adequacy=0.8, shortage=20.0, worst_sr=0.8),
                ),
            ),
            (
                RunFailure(
                    spec=failed_spec,
                    error_type="DomainInvariantError",
                    message="sensor set references unknown blocks: ['b8']",
                ),
            ),
        )
        return plan

    def test_keeps_every_entry_and_avoids_index_collisions(self, tmp_path: Path) -> None:
        plan = self._shard_with_failure(tmp_path)
        outcome, artifacts, timeseries, out_of_plan = merge_benchmark(
            tmp_path, plan, workers=1, repo=tmp_path
        )
        assert timeseries == 0
        assert out_of_plan == 0
        assert outcome.completed_count == 2
        assert outcome.failure_count == 1
        contents = load_checkpoint(tmp_path / "merge_fixture" / "checkpoint.jsonl")
        assert len(contents.records) == 2
        assert len(contents.failures) == 1
        # Kedua kolam berbagi satu ruang indeks: tidak boleh ada yang bertabrakan.
        indexes = [record.spec.run_index for record in contents.records]
        indexes.extend(failure.spec.run_index for failure in contents.failures)
        assert len(set(indexes)) == 3
        frame = pd.read_parquet(artifacts.runs_path)
        assert len(frame) == 2

    def test_summary_records_failure_total(self, tmp_path: Path) -> None:
        plan = self._shard_with_failure(tmp_path)
        _, artifacts, _, _ = merge_benchmark(tmp_path, plan, workers=1, repo=tmp_path)
        summary = json.loads(artifacts.summary_path.read_text(encoding="utf-8"))
        assert summary["failures_total"] == 1


class TestLoadArtifacts:
    def test_reads_runs_and_summary(self, tmp_path: Path) -> None:
        build_experiment(tmp_path)
        artifacts = load_artifacts(tmp_path, "chart_fixture")
        assert len(artifacts.runs) == 30
        assert artifacts.methods == tuple(sorted(method.value for method in BaselineMethod))
        assert artifacts.summary["experiment_id"] == "chart_fixture"

    def test_missing_artifact_raises(self, tmp_path: Path) -> None:
        with pytest.raises(DomainInvariantError, match="missing runs artifact"):
            load_artifacts(tmp_path, "tidak_ada")


class TestCharts:
    @pytest.fixture
    def artifacts(self, tmp_path: Path) -> ExperimentArtifacts:
        build_experiment(tmp_path)
        return load_artifacts(tmp_path, "chart_fixture")

    def test_kpi_chart_written(self, artifacts: ExperimentArtifacts, tmp_path: Path) -> None:
        path, metrics = chart_kpi_comparison(artifacts, tmp_path / "out")
        assert path.is_file()
        assert path.stat().st_size > 0
        assert "adequacy" in metrics
        assert "dependability" in metrics

    def test_scorecard_ranks_better_method_higher(
        self, artifacts: ExperimentArtifacts, tmp_path: Path
    ) -> None:
        path, report = chart_final_scorecard(artifacts, tmp_path / "out")
        assert path.is_file()
        ranking = report["ranking"]
        assert isinstance(ranking, list)
        scores = {entry["method"]: entry["composite_score"] for entry in ranking}
        assert scores["sera"] > scores["rotation"]
        assert scores["sera"] > scores["proportional"]
        # Oracle bukan kompetitor: ia tidak boleh muncul di peringkat.
        assert "oracle" not in scores

    def test_scorecard_reports_oracle_as_reference(
        self, artifacts: ExperimentArtifacts, tmp_path: Path
    ) -> None:
        _, report = chart_final_scorecard(artifacts, tmp_path / "out")
        reference = report["oracle_reference"]
        assert isinstance(reference, dict)
        assert reference["method"] == "oracle"
        used = report["metrics_used"]
        assert isinstance(used, list)
        kpis = reference["kpis"]
        assert isinstance(kpis, int)
        assert kpis < len(used)  # regret tidak berlaku bagi oracle

    def test_scorecard_excludes_solve_time_from_ranking(
        self, artifacts: ExperimentArtifacts, tmp_path: Path
    ) -> None:
        _, report = chart_final_scorecard(artifacts, tmp_path / "out")
        used = report["metrics_used"]
        assert isinstance(used, list)
        assert "solve_time_ms" not in used
        cost = report["cost_seconds_per_run"]
        assert isinstance(cost, dict)
        # Biaya dilaporkan terpisah: SERA memang jauh lebih mahal dari heuristik.
        assert cost["sera"] > cost["proportional"]

    def test_oracle_is_flagged_as_upper_bound(
        self, artifacts: ExperimentArtifacts, tmp_path: Path
    ) -> None:
        _, report = chart_final_scorecard(artifacts, tmp_path / "out")
        assert report["oracle_is_upper_bound"] is True

    def test_generate_all_writes_index_and_charts(self, tmp_path: Path) -> None:
        directory = build_experiment(tmp_path)
        index = generate_all_charts(tmp_path, "chart_fixture")
        names = {entry["name"] for entry in index["charts"]}  # type: ignore[index]
        assert {"kpi_comparison", "final_scorecard"} <= names
        assert (directory / "charts" / "charts.json").is_file()
        for entry in index["charts"]:  # type: ignore[index]
            assert Path(entry["path"]).is_file()


class TestMetricDirection:
    def test_every_directed_metric_is_known(self) -> None:
        from sera.experiments.summary import known_metrics

        for metric in METRIC_DIRECTION:
            assert metric in known_metrics()

    def test_lower_is_better_metrics(self) -> None:
        for metric in ("shortage_total_m3", "cvar_shortage_m3", "equity", "solve_time_ms"):
            assert METRIC_DIRECTION[metric] is False

    def test_higher_is_better_metrics(self) -> None:
        for metric in ("adequacy", "dependability", "worst_sr"):
            assert METRIC_DIRECTION[metric] is True


class TestMethodColor:
    def test_sera_and_oracle_get_distinct_colors(self) -> None:
        assert method_color("sera") != method_color("oracle")

    def test_unknown_method_falls_back(self) -> None:
        assert method_color("metode-baru") == method_color("tidak-dikenal")


class TestRunsFrameColumns:
    def test_frame_exposes_factor_columns_used_by_sweeps(self, tmp_path: Path) -> None:
        directory = build_experiment(tmp_path)
        frame = pd.read_parquet(directory / RUNS_FILENAME)
        for column in ("k_factor", "n_blocks", "sensor_count", "topology", "scenario_id"):
            assert column in frame.columns
        assert frame["method"].nunique() == int(METRIC_COUNT) - 1
        assert SUMMARY_FILENAME in {path.name for path in directory.iterdir()}
