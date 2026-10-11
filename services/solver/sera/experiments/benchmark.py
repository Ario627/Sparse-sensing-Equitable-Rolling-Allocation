"""Benchmark paralel: satu grid besar, dipecah shard, digabung jadi satu artefak.

`run_experiment` berjalan sekuensial. Untuk grid dengan ratusan run — di mana
metode SERA memakan puluhan detik per run sementara baseline nyaris gratis —
sekuensial terlalu lambat. Modul ini memecah plan menjadi beberapa shard,
menjalankan tiap shard sebagai proses terpisah (isolasi memori + paralelisme
CPU), lalu menggabungkan checkpoint shard menjadi satu artefak yang utuh dan
lolos `verify_artifacts`.

Sharding dilakukan per **environment** (bukan per run), supaya semua metode yang
membandingkan kondisi yang sama berada di shard yang sama dan beban antar shard
seimbang.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

from sera.core.io import SCHEMA_VERSION, experiment_dir, to_jsonable
from sera.core.types import DomainInvariantError, require_identifier
from sera.experiments.config import load_experiment_config
from sera.experiments.reporting import (
    CHECKPOINT_FILENAME,
    ParquetTimeseriesSink,
    ReportArtifacts,
    write_experiment_report,
)
from sera.experiments.runner import (
    CHECKPOINT_KIND_FAILED,
    CHECKPOINT_KIND_HEADER,
    CHECKPOINT_KIND_OK,
    ExperimentOutcome,
    ExperimentPlan,
    RunFailure,
    RunRecord,
    RunSpec,
    load_checkpoint,
    run_experiment,
)
from sera.experiments.summary import (
    DEFAULT_SUMMARY_METRICS,
    attach_decision_regret,
    build_summary,
)

SHARD_ROOT_DIRNAME: Final = ".shards"
TIMESERIES_DIRNAME: Final = "timeseries"
DEFAULT_WORKERS: Final = 4
MAX_WORKERS: Final = 64

# Benchmark butuh KPI yang lebih lengkap daripada ringkasan `run` biasa:
# regret (untuk scorecard), efisiensi, tail deficit, dan galat estimasi.
BENCHMARK_SUMMARY_METRICS: Final[tuple[str, ...]] = (
    *DEFAULT_SUMMARY_METRICS,
    "efficiency",
    "tail_deficit_m3",
    "decision_regret",
    "state_rmse",
)


def _environment_key(spec: RunSpec) -> tuple[object, ...]:
    return (
        spec.scenario_id,
        spec.n_blocks,
        spec.topology.value,
        spec.k_factor,
        spec.replicate,
        spec.sensor_set,
    )


def _require_worker_count(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_WORKERS:
        raise DomainInvariantError(f"workers must be an integer in [1, {MAX_WORKERS}]")
    return value


def parse_shard_spec(text: str) -> tuple[int, int]:
    """Baca `INDEX/COUNT` dari argumen CLI."""
    parts = text.split("/")
    if len(parts) != 2:
        raise DomainInvariantError("shard must look like INDEX/COUNT")
    try:
        index = int(parts[0])
        count = int(parts[1])
    except ValueError as error:
        raise DomainInvariantError("shard index and count must be integers") from error
    if count < 1:
        raise DomainInvariantError("shard count must be positive")
    if not 0 <= index < count:
        raise DomainInvariantError("shard index must lie in [0, count)")
    return index, count


def environment_keys(plan: ExperimentPlan) -> tuple[tuple[object, ...], ...]:
    """Daftar environment unik dalam urutan deterministik."""
    seen = {_environment_key(spec) for spec in plan.specs}
    return tuple(sorted(seen, key=str))


def shard_plan(plan: ExperimentPlan, *, shard_index: int, shard_count: int) -> ExperimentPlan:
    """Plan baru berisi environment ke-`shard_index % shard_count`, run_index dirapikan."""
    index, count = parse_shard_spec(f"{shard_index}/{shard_count}")
    keys = environment_keys(plan)
    if count > len(keys):
        raise DomainInvariantError(
            f"shard count {count} exceeds the {len(keys)} distinct environments"
        )
    selected = {key for position, key in enumerate(keys) if position % count == index}
    specs = tuple(
        replace(spec, run_index=position)
        for position, spec in enumerate(
            spec for spec in plan.specs if _environment_key(spec) in selected
        )
    )
    if not specs:
        raise DomainInvariantError(f"shard {index}/{count} selected no runs")
    return ExperimentPlan(
        experiment_id=plan.experiment_id,
        seed_base=plan.seed_base,
        config={**plan.config, "shard_index": index, "shard_count": count},
        factors=plan.factors,
        specs=specs,
    )


@dataclass(frozen=True, slots=True)
class ShardOutcome:
    index: int
    root: Path
    wall_seconds: float
    records: int
    failures: int


@dataclass(frozen=True, slots=True)
class BenchmarkReport:
    experiment_id: str
    runs: int
    failures: int
    wall_seconds: float
    workers: int
    shards: tuple[ShardOutcome, ...]
    summary_path: Path
    runs_path: Path
    out_of_plan: int = 0


def _shard_root(root: Path, index: int, count: int) -> Path:
    return root / SHARD_ROOT_DIRNAME / f"shard{index:02d}of{count:02d}"


def _run_shard(
    config_path: Path,
    shard_root: Path,
    *,
    index: int,
    count: int,
) -> subprocess.Popen[bytes]:
    command = [
        sys.executable,
        "-m",
        "sera.app.cli",
        "run",
        "--config",
        str(config_path),
        "--out",
        str(shard_root),
        "--shard",
        f"{index}/{count}",
        "--quiet",
    ]
    return subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def _wait_for_shard(
    process: subprocess.Popen[bytes],
    *,
    index: int,
    count: int,
    experiment_id: str,
    root: Path,
    started: float,
) -> ShardOutcome:
    output, _ = process.communicate()
    text = output.decode("utf-8", errors="replace") if output else ""
    if process.returncode != 0:
        raise DomainInvariantError(
            f"shard {index} failed with exit code {process.returncode}: {text.strip()[-400:]}"
        )
    checkpoint = experiment_dir(root, experiment_id) / CHECKPOINT_FILENAME
    contents = load_checkpoint(checkpoint) if checkpoint.is_file() else None
    return ShardOutcome(
        index=index,
        root=root,
        wall_seconds=time.perf_counter() - started,
        records=0 if contents is None else len(contents.records),
        failures=0 if contents is None else len(contents.failures),
    )


def run_shards(
    config_path: Path,
    *,
    experiment_id: str,
    results_root: Path,
    workers: int,
) -> tuple[ShardOutcome, ...]:
    """Jalankan `workers` shard secara paralel, tunggu semuanya, laporkan hasilnya."""
    count = _require_worker_count(workers)
    started = time.perf_counter()
    outcomes: list[ShardOutcome] = []
    pending: list[tuple[int, subprocess.Popen[bytes], Path]] = []
    for index in range(count):
        root = _shard_root(results_root, index, count)
        process = _run_shard(config_path, root, index=index, count=count)
        pending.append((index, process, root))
    for index, process, root in pending:
        outcomes.append(
            _wait_for_shard(
                process,
                index=index,
                count=count,
                experiment_id=experiment_id,
                root=root,
                started=started,
            )
        )
    return tuple(outcomes)


def collect_shard_records(
    results_root: Path,
    *,
    experiment_id: str,
    workers: int,
    plan: ExperimentPlan | None = None,
) -> tuple[tuple[RunRecord, ...], tuple[RunFailure, ...], int]:
    """Gabungkan checkpoint semua shard.

    Duplikat environment+metode dibuang. Bila `plan` diberikan, catatan yang
    environment-nya tidak ada di plan diabaikan — ini mencegah shard dari grid
    lain (mis. config yang sudah diperbaiki) ikut tergabung dan membuat artefak
    tidak cocok dengan `meta.json`. Jumlah yang diabaikan dikembalikan sebagai
    elemen ketiga.
    """
    identifier = require_identifier(experiment_id, "experiment_id")
    allowed = None if plan is None else set(environment_keys(plan))
    seen: set[tuple[object, ...]] = set()
    records: list[RunRecord] = []
    failures: list[RunFailure] = []
    out_of_plan = 0
    for index in range(workers):
        root = _shard_root(results_root, index, workers)
        checkpoint = experiment_dir(root, identifier) / CHECKPOINT_FILENAME
        if not checkpoint.is_file():
            continue
        contents = load_checkpoint(checkpoint)
        for record in contents.records:
            key = (_environment_key(record.spec), record.spec.method.value)
            if key in seen:
                continue
            if allowed is not None and _environment_key(record.spec) not in allowed:
                out_of_plan += 1
                continue
            seen.add(key)
            records.append(record)
        for failure in contents.failures:
            key = (_environment_key(failure.spec), failure.spec.method.value)
            if key in seen:
                continue
            if allowed is not None and _environment_key(failure.spec) not in allowed:
                out_of_plan += 1
                continue
            seen.add(key)
            failures.append(failure)
    if not records and not failures:
        raise DomainInvariantError(f"no shard checkpoint found for experiment {identifier!r}")
    return tuple(records), tuple(failures), out_of_plan


def _renumber(records: Sequence[RunRecord]) -> tuple[RunRecord, ...]:
    ordered = sorted(
        records,
        key=lambda record: (
            record.spec.scenario_id,
            record.spec.n_blocks,
            record.spec.topology.value,
            record.spec.k_factor,
            record.spec.replicate,
            record.spec.sensor_set,
            record.spec.method.value,
        ),
    )
    return tuple(
        replace(record, spec=replace(record.spec, run_index=position))
        for position, record in enumerate(ordered)
    )


def _checkpoint_line(kind: str, payload: Mapping[str, object]) -> str:
    return json.dumps({"kind": kind, **payload}, ensure_ascii=False, sort_keys=True)


def write_merged_checkpoint(
    path: Path,
    plan: ExperimentPlan,
    records: Sequence[RunRecord],
    failures: Sequence[RunFailure],
) -> Path:
    """Tulis ulang checkpoint gabungan dengan hash plan penuh."""
    lines = [
        _checkpoint_line(
            CHECKPOINT_KIND_HEADER,
            {
                "schema_version": SCHEMA_VERSION,
                "experiment_id": plan.experiment_id,
                "config_hash": plan.config_hash,
                "seed_base": plan.seed_base,
            },
        )
    ]
    ordered_records = sorted(records, key=lambda item: item.spec.run_index)
    lines.extend(
        _checkpoint_line(
            CHECKPOINT_KIND_OK,
            {
                "spec": to_jsonable(record.spec),
                "metrics": to_jsonable(record.metrics),
                "extras": to_jsonable(record.extras),
            },
        )
        for record in ordered_records
    )
    ordered_failures = sorted(failures, key=lambda item: item.spec.run_index)
    lines.extend(
        _checkpoint_line(
            CHECKPOINT_KIND_FAILED,
            {
                "spec": to_jsonable(failure.spec),
                # Bentuknya harus sama dengan yang ditulis runner: error bersarang.
                "error": {"type": failure.error_type, "message": failure.message},
            },
        )
        for failure in ordered_failures
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _copy_timeseries(results_root: Path, experiment_id: str, workers: int) -> int:
    """Pindahkan artefak timeseries shard ke direktori eksperimen gabungan."""
    import shutil

    target = experiment_dir(results_root, experiment_id) / TIMESERIES_DIRNAME
    copied = 0
    for index in range(workers):
        source = (
            experiment_dir(_shard_root(results_root, index, workers), experiment_id)
            / TIMESERIES_DIRNAME
        )
        if not source.is_dir():
            continue
        for file in sorted(source.rglob("*.parquet")):
            destination = target / file.relative_to(source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, destination)
            copied += 1
    return copied


def merge_benchmark(
    results_root: Path,
    plan: ExperimentPlan,
    *,
    workers: int,
    repo: Path,
) -> tuple[ExperimentOutcome, ReportArtifacts, int, int]:
    """Gabungkan shard menjadi satu artefak lengkap + checkpoint gabungan.

    Mengembalikan (outcome, artifacts, jumlah timeseries disalin, jumlah catatan
    di luar plan yang diabaikan).
    """
    count = _require_worker_count(workers)
    records, failures, out_of_plan = collect_shard_records(
        results_root, experiment_id=plan.experiment_id, workers=count, plan=plan
    )
    records = attach_decision_regret(_renumber(records))
    # Indeks failure harus melanjutkan setelah indeks record: keduanya berbagi
    # satu ruang indeks di checkpoint, dan `load_checkpoint` memakai run_index
    # sebagai kunci unik. Kalau keduanya mulai dari 0, entri saling menimpa.
    failures = tuple(
        replace(failure, spec=replace(failure.spec, run_index=len(records) + position))
        for position, failure in enumerate(sorted(failures, key=lambda item: item.spec.run_index))
    )
    summary = build_summary(
        records,
        failures,
        experiment_id=plan.experiment_id,
        plan_hash=plan.config_hash,
        seed=plan.seed_base,
        metrics=BENCHMARK_SUMMARY_METRICS,
    )
    paths_dir = experiment_dir(results_root, plan.experiment_id)
    write_merged_checkpoint(paths_dir / CHECKPOINT_FILENAME, plan, records, failures)
    artifacts = write_experiment_report(
        results_root, plan, records=records, summary=summary, repo=repo
    )
    copied = _copy_timeseries(results_root, plan.experiment_id, count)
    outcome = ExperimentOutcome(
        experiment_id=plan.experiment_id,
        config_hash=plan.config_hash,
        records=records,
        failures=failures,
        skipped=0,
        wall_seconds=0.0,
    )
    return outcome, artifacts, copied, out_of_plan


def run_benchmark(
    config_path: Path,
    *,
    results_root: Path | None,
    workers: int,
    default_seed_base: int | None,
    repo: Path,
) -> tuple[BenchmarkReport, BenchmarkArtifacts]:
    """Jalankan grid ber-shard, gabungkan, lalu hasilkan chart."""
    count = _require_worker_count(workers)
    config = load_experiment_config(config_path, default_seed_base=default_seed_base)
    root = results_root if results_root is not None else config.results_root
    if root is None:
        raise DomainInvariantError("results_root must be provided by config or --out")
    plan = config.build_plan()
    started = time.perf_counter()
    shards = run_shards(
        config_path,
        experiment_id=plan.experiment_id,
        results_root=root,
        workers=count,
    )
    outcome, artifacts, copied, out_of_plan = merge_benchmark(root, plan, workers=count, repo=repo)
    from sera.experiments.charts import generate_all_charts

    charts = generate_all_charts(root, plan.experiment_id)
    report = BenchmarkReport(
        experiment_id=plan.experiment_id,
        runs=outcome.completed_count,
        failures=outcome.failure_count,
        wall_seconds=time.perf_counter() - started,
        workers=count,
        shards=shards,
        summary_path=artifacts.summary_path,
        runs_path=artifacts.runs_path,
        out_of_plan=out_of_plan,
    )
    return report, BenchmarkArtifacts(artifacts=artifacts, charts=charts, timeseries=copied)


@dataclass(frozen=True, slots=True)
class BenchmarkArtifacts:
    artifacts: ReportArtifacts
    charts: Mapping[str, object]
    timeseries: int


def _run_single_process(
    config_path: Path,
    *,
    results_root: Path | None,
    default_seed_base: int | None,
    repo: Path,
) -> tuple[BenchmarkReport, BenchmarkArtifacts]:
    """Jalur sekuensial: dipakai saat workers == 1, tanpa subprocess."""
    config = load_experiment_config(config_path, default_seed_base=default_seed_base)
    root = results_root if results_root is not None else config.results_root
    if root is None:
        raise DomainInvariantError("results_root must be provided by config or --out")
    plan = config.build_plan()
    checkpoint = root / plan.experiment_id / CHECKPOINT_FILENAME
    executor = config.attach_sink(ParquetTimeseriesSink(root, plan.experiment_id)).executor
    started = time.perf_counter()
    outcome = run_experiment(plan, executor, checkpoint_path=checkpoint)
    records = attach_decision_regret(outcome.records)
    summary = build_summary(
        records,
        outcome.failures,
        experiment_id=plan.experiment_id,
        plan_hash=plan.config_hash,
        seed=plan.seed_base,
        metrics=BENCHMARK_SUMMARY_METRICS,
    )
    artifacts = write_experiment_report(root, plan, records=records, summary=summary, repo=repo)
    from sera.experiments.charts import generate_all_charts

    charts = generate_all_charts(root, plan.experiment_id)
    report = BenchmarkReport(
        experiment_id=plan.experiment_id,
        runs=outcome.completed_count,
        failures=outcome.failure_count,
        wall_seconds=time.perf_counter() - started,
        workers=1,
        shards=(),
        summary_path=artifacts.summary_path,
        runs_path=artifacts.runs_path,
    )
    return report, BenchmarkArtifacts(artifacts=artifacts, charts=charts, timeseries=0)


def execute_benchmark(
    config_path: Path,
    *,
    results_root: Path | None = None,
    workers: int = DEFAULT_WORKERS,
    default_seed_base: int | None = None,
    repo: Path,
) -> tuple[BenchmarkReport, BenchmarkArtifacts]:
    count = _require_worker_count(workers)
    if count == 1:
        return _run_single_process(
            config_path,
            results_root=results_root,
            default_seed_base=default_seed_base,
            repo=repo,
        )
    return run_benchmark(
        config_path,
        results_root=results_root,
        workers=count,
        default_seed_base=default_seed_base,
        repo=repo,
    )
