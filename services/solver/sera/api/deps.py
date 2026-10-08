from __future__ import annotations

import queue
import threading
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Annotated, Final

from fastapi import Depends, Request

from sera.app.settings import PACKAGE_ROOT, Settings, get_settings
from sera.core.io import experiment_dir
from sera.core.types import DomainInvariantError
from sera.experiments.config import ExperimentConfig
from sera.experiments.progress import (
    JobStatus,
    ProgressCancelled,
    ProgressSnapshot,
    ProgressTracker,
    result_run_index,
)
from sera.experiments.reporting import (
    CHECKPOINT_FILENAME,
    ParquetTimeseriesSink,
    write_experiment_report,
)
from sera.experiments.runner import (
    ERROR_MESSAGE_LIMIT,
    ExperimentOutcome,
    ExperimentPlan,
    RunFailure,
    RunRecord,
    load_checkpoint,
    run_experiment,
)
from sera.experiments.summary import attach_decision_regret, build_summary

FALLBACK_SOLVER_VERSION: Final = "0.0.0"
SHUTDOWN_JOIN_SECONDS: Final = 2.0
ACTIVE_STATUSES: Final = (JobStatus.QUEUED, JobStatus.RUNNING)
RUNTIME_ATTRIBUTE: Final = "runtime"


def solver_version() -> str:
    try:
        return version("sera-solver")
    except PackageNotFoundError:
        return FALLBACK_SOLVER_VERSION


def _locate_repo_root(start: Path) -> Path:
    current = start if start.is_absolute() else start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return current


def _error_message(error: Exception) -> str:
    collapsed = " ".join(str(error).split())
    if not collapsed:
        return type(error).__name__
    return f"{type(error).__name__}: {collapsed}"[:ERROR_MESSAGE_LIMIT]


def _completed_run_indexes(checkpoint_path: Path, plan: ExperimentPlan) -> frozenset[int]:
    contents = load_checkpoint(checkpoint_path)
    known = {spec.run_index for spec in plan.specs}
    return frozenset(
        record.spec.run_index for record in contents.records if record.spec.run_index in known
    )


def _all_runs_failed(outcome: ExperimentOutcome) -> str:
    if not outcome.failures:
        return "experiment produced no completed runs"
    first = outcome.failures[0]
    message = f"all {len(outcome.failures)} runs failed; first: {first.error_type}: {first.message}"
    return message[:ERROR_MESSAGE_LIMIT]


@dataclass(frozen=True, slots=True)
class ManagedJob:
    plan: ExperimentPlan
    config: ExperimentConfig
    tracker: ProgressTracker
    results_root: Path
    checkpoint_path: Path
    submitted_at: datetime

    @property
    def experiment_id(self) -> str:
        return self.plan.experiment_id


class ExperimentJobRegistry:
    def __init__(self, settings: Settings, *, repo_root: Path) -> None:
        self._settings = settings
        self._repo_root = repo_root
        self._lock = threading.Lock()
        self._jobs: dict[str, ManagedJob] = {}
        self._queue: queue.Queue[ManagedJob | None] = queue.Queue()
        self._workers: list[threading.Thread] = []

    @property
    def is_running(self) -> bool:
        with self._lock:
            return bool(self._workers)

    def start(self) -> None:
        with self._lock:
            if self._workers:
                return
            workers: list[threading.Thread] = [
                threading.Thread(
                    target=self._work_loop,
                    name=f"sera-experiment-{index}",
                    daemon=True,
                )
                for index in range(self._settings.experiment_max_concurrency)
            ]
            for worker in workers:
                worker.start()
            self._workers = workers

    def shutdown(self, timeout: float = SHUTDOWN_JOIN_SECONDS) -> None:
        with self._lock:
            workers = tuple(self._workers)
            self._workers = []
        if not workers:
            return
        for job in self.jobs():
            if job.tracker.snapshot().status in ACTIVE_STATUSES:
                job.tracker.request_cancel()
        for _ in workers:
            self._queue.put(None)
        for worker in workers:
            worker.join(timeout)

    def submit(self, config: ExperimentConfig, *, results_root: Path | None = None) -> ManagedJob:
        experiment_id = config.experiment_id
        with self._lock:
            if experiment_id in self._jobs:
                raise DomainInvariantError(f"experiment already submitted: {experiment_id!r}")
        plan = config.build_plan()
        if plan.run_count > self._settings.experiment_max_runs:
            raise DomainInvariantError(
                f"experiment exceeds the configured run budget: {plan.run_count}"
            )
        root = self._resolve_results_root(config, results_root)
        job = ManagedJob(
            plan=plan,
            config=config,
            tracker=ProgressTracker(plan),
            results_root=root,
            checkpoint_path=experiment_dir(root, experiment_id) / CHECKPOINT_FILENAME,
            submitted_at=datetime.now(UTC),
        )
        with self._lock:
            if experiment_id in self._jobs:
                raise DomainInvariantError(f"experiment already submitted: {experiment_id!r}")
            self._jobs[experiment_id] = job
        self._queue.put(job)
        return job

    def get(self, experiment_id: str) -> ManagedJob:
        with self._lock:
            job = self._jobs.get(experiment_id)
        if job is None:
            raise DomainInvariantError(f"unknown experiment: {experiment_id!r}")
        return job

    def jobs(self) -> tuple[ManagedJob, ...]:
        with self._lock:
            return tuple(self._jobs.values())

    def active_count(self) -> int:
        return sum(1 for job in self.jobs() if job.tracker.snapshot().status in ACTIVE_STATUSES)

    def cancel(self, experiment_id: str) -> ProgressSnapshot:
        tracker = self.get(experiment_id).tracker
        status = tracker.snapshot().status
        if status is JobStatus.QUEUED:
            return tracker.mark_cancelled()
        if status is JobStatus.RUNNING:
            tracker.request_cancel()
        return tracker.snapshot()

    def _resolve_results_root(self, config: ExperimentConfig, override: Path | None) -> Path:
        if override is not None:
            return override.expanduser()
        if config.results_root is not None:
            return config.results_root
        return self._settings.results_dir

    def _work_loop(self) -> None:
        while True:
            job = self._queue.get()
            if job is None:
                return
            try:
                self._run_job(job)
            except Exception as error:
                job.tracker.fail(_error_message(error))

    def _run_job(self, job: ManagedJob) -> None:
        tracker = job.tracker
        if tracker.snapshot().status is not JobStatus.QUEUED:
            return
        tracker.start()
        if tracker.cancel_requested:
            tracker.mark_cancelled()
            return
        pending = _completed_run_indexes(job.checkpoint_path, job.plan)
        if pending:
            tracker.mark_skipped(len(pending))
        executor = replace(
            job.config.executor,
            timeseries_sink=ParquetTimeseriesSink(job.results_root, job.experiment_id),
        )

        def report(item: RunRecord | RunFailure) -> None:
            tracker.complete_run(result_run_index(item), failed=isinstance(item, RunFailure))

        try:
            outcome = run_experiment(
                job.plan,
                executor,
                checkpoint_path=job.checkpoint_path,
                resume=True,
                fail_fast=False,
                on_result=report,
            )
            if not outcome.records:
                tracker.fail(_all_runs_failed(outcome))
                return
            records = attach_decision_regret(outcome.records)
            summary = build_summary(
                records,
                outcome.failures,
                experiment_id=job.experiment_id,
                plan_hash=job.plan.config_hash,
                seed=job.plan.seed_base,
            )
            write_experiment_report(
                job.results_root,
                job.plan,
                records=records,
                summary=summary,
                repo=self._repo_root,
            )
        except ProgressCancelled:
            tracker.mark_cancelled()
            return
        except Exception as error:
            tracker.fail(_error_message(error))
            return
        tracker.complete()


@dataclass(slots=True)
class SolverRuntime:
    settings: Settings
    repo_root: Path
    registry: ExperimentJobRegistry
    started_at: datetime

    @classmethod
    def create(cls, settings: Settings | None = None) -> SolverRuntime:
        resolved = get_settings() if settings is None else settings
        repo_root = _locate_repo_root(PACKAGE_ROOT)
        registry = ExperimentJobRegistry(resolved, repo_root=repo_root)
        runtime = cls(
            settings=resolved,
            repo_root=repo_root,
            registry=registry,
            started_at=datetime.now(UTC),
        )
        registry.start()
        return runtime

    def uptime_seconds(self) -> float:
        return (datetime.now(UTC) - self.started_at).total_seconds()

    def shutdown(self, timeout: float = SHUTDOWN_JOIN_SECONDS) -> None:
        self.registry.shutdown(timeout)


def get_runtime(request: Request) -> SolverRuntime:
    runtime = getattr(request.app.state, RUNTIME_ATTRIBUTE, None)
    if not isinstance(runtime, SolverRuntime):
        raise RuntimeError("solver runtime is not initialized")
    return runtime


type RuntimeDep = Annotated[SolverRuntime, Depends(get_runtime)]
