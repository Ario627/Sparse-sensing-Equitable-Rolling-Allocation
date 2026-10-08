from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import fields
from datetime import datetime, timedelta
from typing import Final, cast

import numpy as np  # type: ignore
import pandas as pd  # type: ignore
from fastapi import APIRouter, HTTPException, status  # type: ignore

from api.deps import ManagedJob, RuntimeDep, SolverRuntime
from api.schemas import (
    MAX_RUNS_PER_POLL,
    ExperimentCancelResponse,
    ExperimentMetricsResponse,
    ExperimentRun,
    ExperimentRunStatus,
    ExperimentStartRequest,
    ExperimentStartResponse,
    ExperimentStatusResponse,
    IntervalPayload,
    MetricAggregate,
    RunMetricValue,
)
from app.core.io import timeseries_file_path
from app.core.types import DomainInvariantError
from experiments.config import experiment_config_from_mapping, load_experiment_config_text
from experiments.metrics import RunMetrics
from experiments.progress import JobStatus, ProgressSnapshot
from experiments.reporting import experiment_paths
from experiments.runner import CheckpointContents, RunFailure, RunRecord, load_checkpoint
from experiments.stats import DEFAULT_LEVEL, summarize
from experiments.summary import known_metrics, metric_value

METRIC_RESAMPLES: Final = 1000
MAX_EXPERIMENT_ID_LENGTH: Final = 64
TERMINAL_STATUSES: Final = (
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
)


def _run_metric_payload(metrics: RunMetrics) -> dict[str, RunMetricValue]:
    payload: dict[str, RunMetricValue] = {}
    for field in fields(metrics):
        value = getattr(metrics, field.name)
        if value is None:
            continue
        payload[field.name] = float(cast(float, value))
    return payload


def _parquet_path(job: ManagedJob, record: RunRecord) -> str | None:
    path = timeseries_file_path(
        job.results_root,
        job.experiment_id,
        method=record.spec.method.value,
        sensor_count=record.spec.sensor_count,
        scenario_id=record.spec.scenario_id,
        seed=record.spec.seed,
    )
    return str(path) if path.is_file() else None


def _completed_run(job: ManagedJob, record: RunRecord) -> ExperimentRun:
    spec = record.spec
    return ExperimentRun(
        run_index=spec.run_index,
        scenario_id=spec.scenario_id,
        seed=spec.seed,
        method=spec.method,
        sensor_count=spec.sensor_count,
        topology=spec.topology,
        k_factor=spec.k_factor,
        status=ExperimentRunStatus.COMPLETED,
        parquet_path=_parquet_path(job, record),
        metrics=_run_metric_payload(record.metrics),
    )


def _failed_run(failure: RunFailure) -> ExperimentRun:
    spec = failure.spec
    return ExperimentRun(
        run_index=spec.run_index,
        scenario_id=spec.scenario_id,
        seed=spec.seed,
        method=spec.method,
        sensor_count=spec.sensor_count,
        topology=spec.topology,
        k_factor=spec.k_factor,
        status=ExperimentRunStatus.FAILED,
        parquet_path=None,
        metrics={},
    )


def _poll_runs(
    job: ManagedJob,
    checkpoint: CheckpointContents,
) -> list[ExperimentRun]:
    entries = [
        (record.spec.run_index, _completed_run(job, record)) for record in checkpoint.records
    ] + [(failure.spec.run_index, _failed_run(failure)) for failure in checkpoint.failures]
    entries.sort(key=lambda entry: entry[0])
    return [payload for _, payload in entries[:MAX_RUNS_PER_POLL]]


def _started_at(snapshot: ProgressSnapshot) -> datetime | None:
    if snapshot.status is JobStatus.QUEUED:
        return None
    return snapshot.updated_at - timedelta(seconds=snapshot.wall_seconds)


def _finished_at(snapshot: ProgressSnapshot) -> datetime | None:
    return snapshot.updated_at if snapshot.status in TERMINAL_STATUSES else None


def _artifact_stats(job: ManagedJob) -> tuple[float | None, float | None]:
    path = experiment_paths(job.results_root, job.experiment_id).runs_path
    if not path.is_file():
        return None, None
    try:
        frame = pd.read_parquet(path, columns=["decision_regret", "worst_sr"])
    except Exception:
        return None, None
    regret = np.asarray(frame["decision_regret"].dropna(), dtype=float)
    worst = np.asarray(frame["worst_sr"].dropna(), dtype=float)
    median_regret = None if regret.size == 0 else float(np.median(regret))
    worst_sr = None if worst.size == 0 else float(np.min(worst))
    return median_regret, worst_sr


def _metric_series(records: Sequence[RunRecord], metric: str) -> tuple[float, ...]:
    values = (metric_value(metric, record.metrics) for record in records)
    return tuple(value for value in values if value is not None)


def _aggregates(
    records: Sequence[RunRecord],
    *,
    seed: int,
) -> dict[str, MetricAggregate]:
    aggregates: dict[str, MetricAggregate] = {}
    for metric in known_metrics():
        series = _metric_series(records, metric)
        if not series:
            continue
        summary = summarize(
            series,
            level=DEFAULT_LEVEL,
            resamples=METRIC_RESAMPLES,
            seed=seed,
        )
        aggregates[metric] = MetricAggregate(
            n=summary.n,
            mean=summary.mean,
            median=summary.median,
            ci=IntervalPayload(lower=summary.ci.lower, upper=summary.ci.upper),
        )
    return aggregates


def _grouped_aggregates(
    records: Sequence[RunRecord],
    key: Callable[[RunRecord], str],
    *,
    seed: int,
) -> dict[str, dict[str, MetricAggregate]]:
    groups: dict[str, list[RunRecord]] = {}
    for record in records:
        groups.setdefault(key(record), []).append(record)
    return {name: _aggregates(items, seed=seed) for name, items in sorted(groups.items())}


def _require_job(runtime: SolverRuntime, experiment_id: str) -> ManagedJob:
    try:
        return runtime.registry.get(experiment_id)
    except DomainInvariantError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


router = APIRouter(tags=["experiments"])


@router.post(
    "/v1/experiments",
    response_model=ExperimentStartResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_experiment(
    request: ExperimentStartRequest,
    runtime: RuntimeDep,
) -> ExperimentStartResponse:
    settings = runtime.settings
    default_seed_base = settings.seed_base if request.seed_base is None else request.seed_base
    if request.config_yaml is not None:
        config = load_experiment_config_text(
            request.config_yaml, default_seed_base=default_seed_base
        )
    else:
        document = request.config
        if document is None:
            raise DomainInvariantError("config is required when config_yaml is absent")
        config = experiment_config_from_mapping(document, default_seed_base=default_seed_base)
    if len(config.experiment_id) > MAX_EXPERIMENT_ID_LENGTH:
        raise DomainInvariantError("experiment_id must be at most 64 characters")
    plan = config.build_plan()
    if request.max_runs is not None and plan.run_count > request.max_runs:
        raise DomainInvariantError(
            f"experiment needs {plan.run_count} runs but max_runs is {request.max_runs}"
        )
    job = runtime.registry.submit(config)
    snapshot = job.tracker.snapshot()
    return ExperimentStartResponse(
        request_id=request.request_id,
        experiment_id=config.experiment_id,
        status=snapshot.status,
        runs_total=plan.run_count,
        config_hash=config.config_hash,
    )


@router.get("/v1/experiments/{experiment_id}", response_model=ExperimentStatusResponse)
def experiment_status(
    experiment_id: str,
    runtime: RuntimeDep,
) -> ExperimentStatusResponse:
    job = _require_job(runtime, experiment_id)
    snapshot = job.tracker.snapshot()
    checkpoint = load_checkpoint(job.checkpoint_path)
    median_regret, worst_sr = _artifact_stats(job)
    return ExperimentStatusResponse(
        experiment_id=experiment_id,
        status=snapshot.status,
        runs_done=len(checkpoint.records) + len(checkpoint.failures),
        runs_total=snapshot.runs_total,
        median_regret=median_regret,
        worst_sr=worst_sr,
        started_at=_started_at(snapshot),
        finished_at=_finished_at(snapshot),
        runs=_poll_runs(job, checkpoint),
    )


@router.post(
    "/v1/experiments/{experiment_id}/cancel",
    response_model=ExperimentCancelResponse,
)
def cancel_experiment(
    experiment_id: str,
    runtime: RuntimeDep,
) -> ExperimentCancelResponse:
    _require_job(runtime, experiment_id)
    snapshot = runtime.registry.cancel(experiment_id)
    return ExperimentCancelResponse(experiment_id=experiment_id, status=snapshot.status)


@router.get(
    "/v1/experiments/{experiment_id}/metrics",
    response_model=ExperimentMetricsResponse,
)
def experiment_metrics(
    experiment_id: str,
    runtime: RuntimeDep,
) -> ExperimentMetricsResponse:
    job = _require_job(runtime, experiment_id)
    checkpoint = load_checkpoint(job.checkpoint_path)
    records = checkpoint.records
    seed = job.plan.seed_base
    return ExperimentMetricsResponse(
        experiment_id=experiment_id,
        status=job.tracker.snapshot().status,
        failures_total=len(checkpoint.failures),
        aggregates=_aggregates(records, seed=seed),
        per_method=_grouped_aggregates(records, lambda record: record.spec.method.value, seed=seed),
        per_sensor_count=_grouped_aggregates(
            records, lambda record: str(record.spec.sensor_count), seed=seed
        ),
    )
