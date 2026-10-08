from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final, cast

import pandas as pd  # type: ignore

from app.core.io import (
    build_meta,
    canonical_json,
    experiment_dir,
    read_json,
    timeseries_file_path,
    to_jsonable,
    write_json_atomic,
)
from app.core.types import DomainInvariantError, require_identifier
from experiments.metrics import RunMetrics
from experiments.policies import SignalSnapshot, TargetTable
from experiments.runner import ExperimentPlan, RunRecord, RunSpec, load_checkpoint
from experiments.summary import ExperimentSummary
from simulator.engine import SimulationResult
from simulator.recorder import TIMESERIES_COLUMNS, TrajectoryRecorder

META_FILENAME: Final = "meta.json"
RUNS_FILENAME: Final = "runs.parquet"
SUMMARY_FILENAME: Final = "summary.json"
CHECKPOINT_FILENAME: Final = "checkpoint.jsonl"

EXTRAS_COLUMNS: Final[tuple[str, ...]] = (
    "policy_profile",
    "full_sensing",
    "n_fallbacks",
    "review_required",
    "nis_violations",
    "dropouts",
    "mean_confidence",
    "storage_coverage",
    "storage_calibration_error",
)


@dataclass(frozen=True, slots=True)
class ExperimentPaths:
    directory: Path
    meta_path: Path
    runs_path: Path
    summary_path: Path
    checkpoint_path: Path


def experiment_paths(results_root: Path, experiment_id: str) -> ExperimentPaths:
    directory = experiment_dir(results_root, experiment_id)
    return ExperimentPaths(
        directory=directory,
        meta_path=directory / META_FILENAME,
        runs_path=directory / RUNS_FILENAME,
        summary_path=directory / SUMMARY_FILENAME,
        checkpoint_path=directory / CHECKPOINT_FILENAME,
    )


def _sensor_set_text(spec: RunSpec) -> str:
    return canonical_json(list(spec.sensor_set))


def _spec_cells(spec: RunSpec) -> dict[str, object]:
    return {
        "run_index": spec.run_index,
        "method": spec.method.value,
        "scenario_id": spec.scenario_id,
        "n_blocks": spec.n_blocks,
        "topology": spec.topology.value,
        "k_factor": spec.k_factor,
        "replicate": spec.replicate,
        "sensor_count": spec.sensor_count,
        "sensor_set": _sensor_set_text(spec),
        "seed": spec.seed,
    }


def _metric_cells(metrics: RunMetrics) -> dict[str, object]:
    return {
        "adequacy": metrics.adequacy,
        "efficiency": metrics.efficiency,
        "dependability": metrics.dependability,
        "equity": metrics.equity,
        "worst_sr": metrics.worst_sr,
        "shortage_total_m3": metrics.shortage_total_m3,
        "tail_deficit_m3": metrics.tail_deficit_m3,
        "cvar_shortage_m3": metrics.cvar_shortage_m3,
        "state_rmse": metrics.state_rmse,
        "solve_time_ms": metrics.solve_time_ms,
        "mip_gap": metrics.mip_gap,
        "n_resolves": metrics.n_resolves,
        "gate_switches": metrics.gate_switches,
        "fallback_used": metrics.fallback_used,
        "decision_regret": metrics.decision_regret,
    }


def _extras_cells(extras: Mapping[str, object]) -> dict[str, object]:
    return {name: extras.get(name) for name in EXTRAS_COLUMNS}


def runs_frame(records: Sequence[RunRecord]) -> pd.DataFrame:
    items = tuple(records)
    if not items:
        raise DomainInvariantError("records must not be empty")
    rows = [
        {
            **_spec_cells(record.spec),
            **_metric_cells(record.metrics),
            **_extras_cells(record.extras),
        }
        for record in items
    ]
    return pd.DataFrame(rows)


def write_runs_file(paths: ExperimentPaths, records: Sequence[RunRecord]) -> Path:
    frame = runs_frame(records)
    paths.directory.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(paths.runs_path, index=False)
    return paths.runs_path


def write_meta_file(paths: ExperimentPaths, plan: ExperimentPlan, *, repo: Path) -> Path:
    payload = build_meta(
        {"config": plan.config, "factors": to_jsonable(plan.factors)},
        repo=repo,
    )
    return write_json_atomic(paths.meta_path, payload)


def write_summary_file(paths: ExperimentPaths, summary: ExperimentSummary) -> Path:
    return write_json_atomic(paths.summary_path, summary)


@dataclass(frozen=True, slots=True)
class ReportArtifacts:
    directory: Path
    meta_path: Path
    runs_path: Path
    summary_path: Path


def write_experiment_report(
    results_root: Path,
    plan: ExperimentPlan,
    *,
    records: Sequence[RunRecord],
    summary: ExperimentSummary,
    repo: Path,
) -> ReportArtifacts:
    if not isinstance(plan, ExperimentPlan):
        raise DomainInvariantError("plan must be an ExperimentPlan")
    if not isinstance(summary, ExperimentSummary):
        raise DomainInvariantError("summary must be an ExperimentSummary")
    if summary.config_hash != plan.config_hash:
        raise DomainInvariantError("summary does not belong to the plan being reported")
    paths = experiment_paths(results_root, plan.experiment_id)
    paths.directory.mkdir(parents=True, exist_ok=True)
    write_meta_file(paths, plan, repo=repo)
    write_runs_file(paths, records)
    write_summary_file(paths, summary)
    return ReportArtifacts(
        directory=paths.directory,
        meta_path=paths.meta_path,
        runs_path=paths.runs_path,
        summary_path=paths.summary_path,
    )


def timeseries_frame(
    simulation: SimulationResult,
    snapshots: Sequence[SignalSnapshot],
    target_table: TargetTable,
) -> pd.DataFrame:
    if not isinstance(simulation, SimulationResult):
        raise DomainInvariantError("simulation must be a SimulationResult")
    if not isinstance(target_table, TargetTable):
        raise DomainInvariantError("target_table must be a TargetTable")
    capture = tuple(snapshots)
    if capture and len(capture) != len(simulation.outcomes):
        raise DomainInvariantError("snapshots must align with the simulated slots")
    recorder = TrajectoryRecorder(simulation.scenario_id)
    for outcome in simulation.outcomes:
        recorder.record_slot(outcome)
    if capture:
        for outcome, snapshot in zip(simulation.outcomes, capture, strict=True):
            for block_id in outcome.gate_open:
                ledger = snapshot.ledger[block_id]
                recorder.annotate(
                    outcome.slot_index,
                    block_id,
                    target_m3=target_table.fair_of(block_id, outcome.slot_index),
                    service_ratio=ledger.service_ratio,
                    debt_m3=ledger.debt_m3,
                    eta_est=snapshot.path_efficiency[block_id],
                )
    else:
        for outcome in simulation.outcomes:
            for block_id in outcome.gate_open:
                recorder.annotate(
                    outcome.slot_index,
                    block_id,
                    target_m3=target_table.fair_of(block_id, outcome.slot_index),
                )
    return pd.DataFrame(recorder.to_dicts(), columns=list(TIMESERIES_COLUMNS))


@dataclass(frozen=True, slots=True)
class ParquetTimeseriesSink:
    results_root: Path
    experiment_id: str

    def __post_init__(self) -> None:
        require_identifier(self.experiment_id, "experiment_id")

    def record(
        self,
        spec: RunSpec,
        simulation: SimulationResult,
        snapshots: tuple[SignalSnapshot, ...],
        target_table: TargetTable,
    ) -> None:
        if not isinstance(spec, RunSpec):
            raise DomainInvariantError("spec must be a RunSpec")
        frame = timeseries_frame(simulation, snapshots, target_table)
        path = timeseries_file_path(
            self.results_root,
            self.experiment_id,
            method=spec.method.value,
            sensor_count=spec.sensor_count,
            scenario_id=spec.scenario_id,
            seed=spec.seed,
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        frame.to_parquet(path, index=False)


@dataclass(frozen=True, slots=True)
class ArtifactVerification:
    experiment_id: str
    checkpoint_records: int
    checkpoint_failures: int
    runs_rows: int
    issues: tuple[str, ...]

    def __post_init__(self) -> None:
        require_identifier(self.experiment_id, "experiment_id")

    @property
    def is_consistent(self) -> bool:
        return not self.issues


def _read_mapping(path: Path) -> Mapping[str, object] | None:
    if not path.exists():
        return None
    payload = read_json(path)
    if not isinstance(payload, Mapping):
        return None
    return cast(Mapping[str, object], payload)


def _read_runs_frame(path: Path) -> pd.DataFrame | None:
    if not path.exists():
        return None
    return pd.read_parquet(path)


def _hashes_of(
    meta: Mapping[str, object] | None,
    summary: Mapping[str, object] | None,
    checkpoint_hash: str | None,
) -> dict[str, object]:
    candidates = (
        ("meta", None if meta is None else meta.get("config_hash")),
        ("summary", None if summary is None else summary.get("config_hash")),
        ("checkpoint", checkpoint_hash),
    )
    return {source: value for source, value in candidates if isinstance(value, str)}


def _summary_methods(summary: Mapping[str, object]) -> frozenset[str]:
    entries = summary.get("methods")
    if not isinstance(entries, Sequence):
        return frozenset()
    names: set[str] = set()
    for entry in entries:
        if isinstance(entry, Mapping):
            name = cast(Mapping[str, object], entry).get("method")
            if isinstance(name, str):
                names.add(name)
    return frozenset(names)


def _frame_methods(frame: pd.DataFrame) -> frozenset[str]:
    return frozenset(str(value) for value in frame["method"].tolist())


def verify_artifacts(results_root: Path, experiment_id: str) -> ArtifactVerification:
    paths = experiment_paths(results_root, experiment_id)
    issues: list[str] = []
    meta = _read_mapping(paths.meta_path)
    summary = _read_mapping(paths.summary_path)
    frame = _read_runs_frame(paths.runs_path)
    checkpoint = load_checkpoint(paths.checkpoint_path)
    if meta is None:
        issues.append(f"missing artifact: {META_FILENAME}")
    if summary is None:
        issues.append(f"missing artifact: {SUMMARY_FILENAME}")
    if frame is None:
        issues.append(f"missing artifact: {RUNS_FILENAME}")
    if checkpoint.experiment_id is None:
        issues.append(f"missing artifact: {CHECKPOINT_FILENAME}")
    hashes = _hashes_of(meta, summary, checkpoint.config_hash)
    if len(set(hashes.values())) > 1:
        issues.append(f"config hash mismatch across artifacts: {dict(sorted(hashes.items()))}")
    if checkpoint.experiment_id is not None and checkpoint.experiment_id != experiment_id:
        issues.append(f"checkpoint belongs to experiment {checkpoint.experiment_id!r}")
    rows = 0 if frame is None else int(frame.shape[0])
    if frame is not None and rows != len(checkpoint.records):
        issues.append(
            f"{RUNS_FILENAME} holds {rows} rows but the checkpoint holds {len(checkpoint.records)}"
        )
    if summary is not None:
        failures_total = summary.get("failures_total")
        if isinstance(failures_total, int) and failures_total != len(checkpoint.failures):
            issues.append(
                f"summary reports {failures_total} failures "
                f"but the checkpoint holds {len(checkpoint.failures)}"
            )
        if frame is not None and _summary_methods(summary) != _frame_methods(frame):
            issues.append("method coverage differs between runs.parquet and summary.json")
    return ArtifactVerification(
        experiment_id=experiment_id,
        checkpoint_records=len(checkpoint.records),
        checkpoint_failures=len(checkpoint.failures),
        runs_rows=rows,
        issues=tuple(issues),
    )
