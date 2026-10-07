from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Final

from app.core.types import (
    DomainInvariantError,
    require_identifier,
    require_non_negative,
    require_utc,
)
from experiments.runner import ExperimentPlan, RunFailure, RunRecord

type ProgressListener = Callable[[ProgressSnapshot], None]


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class ProgressCancelled(Exception):
    pass


@dataclass(frozen=True, slots=True)
class ProgressSnapshot:
    experiment_id: str
    status: JobStatus
    runs_total: int
    runs_done: int
    runs_failed: int
    runs_skipped: int
    current_run_index: int | None
    wall_seconds: float
    updated_at: datetime
    error: str | None = None

    def __post_init__(self) -> None:
        require_identifier(self.experiment_id, "experiment_id")
        if not isinstance(self.status, JobStatus):
            raise DomainInvariantError("status must be a JobStatus")
        for name in ("runs_total", "runs_done", "runs_failed", "runs_skipped"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise DomainInvariantError(f"{name} must be a non-negative integer")
        if self.runs_done + self.runs_failed > self.runs_total:
            raise DomainInvariantError("finished runs must not exceed runs_total")
        if self.current_run_index is not None:
            if (
                isinstance(self.current_run_index, bool)
                or not isinstance(self.current_run_index, int)
                or not 0 <= self.current_run_index < self.runs_total
            ):
                raise DomainInvariantError("current_run_index must lie in [0, runs_total)")
        require_non_negative(self.wall_seconds, "wall_seconds")
        require_utc(self.updated_at, "updated_at")
        if self.error is not None and not isinstance(self.error, str):
            raise DomainInvariantError("error must be a string or None")

    @property
    def runs_finished(self) -> int:
        return self.runs_done + self.runs_failed


def result_run_index(item: RunRecord | RunFailure) -> int:
    if isinstance(item, RunFailure):
        return item.run_index
    if isinstance(item, RunRecord):
        return item.spec.run_index
    raise DomainInvariantError("item must be a RunRecord or RunFailure")


class ProgressTracker:
    def __init__(self, plan: ExperimentPlan) -> None:
        if not isinstance(plan, ExperimentPlan):
            raise DomainInvariantError("plan must be an ExperimentPlan")
        self._plan = plan
        self._lock = threading.Lock()
        self._status = JobStatus.QUEUED
        self._done = 0
        self._failed = 0
        self._skipped = 0
        self._current: int | None = None
        self._started_at: datetime | None = None
        self._updated_at = datetime.now(UTC)
        self._error: str | None = None
        self._cancel_requested = False
        self._listeners: list[ProgressListener] = []

    @property
    def experiment_id(self) -> str:
        return self._plan.experiment_id

    @property
    def runs_total(self) -> int:
        return self._plan.run_count

    @property
    def cancel_requested(self) -> bool:
        with self._lock:
            return self._cancel_requested

    def subscribe(self, listener: ProgressListener) -> None:
        if not callable(listener):
            raise DomainInvariantError("listener must be callable")
        with self._lock:
            self._listeners.append(listener)

    def unsubscribe(self, listener: ProgressListener) -> None:
        with self._lock:
            if listener in self._listeners:
                self._listeners.remove(listener)

    def _notify_locked(self, snapshot: ProgressSnapshot) -> tuple[ProgressListener, ...]:
        return tuple(self._listeners)

    def _notify(self, listeners: tuple[ProgressListener, ...], snapshot: ProgressSnapshot) -> None:
        for listener in listeners:
            try:
                listener(snapshot)
            except Exception:
                continue

    def _snapshot_locked(self) -> ProgressSnapshot:
        wall = (
            (self._updated_at - self._started_at).total_seconds()
            if self._started_at is not None
            else 0.0
        )
        return ProgressSnapshot(
            experiment_id=self._plan.experiment_id,
            status=self._status,
            runs_total=self._plan.run_count,
            runs_done=self._done,
            runs_failed=self._failed,
            runs_skipped=self._skipped,
            current_run_index=self._current,
            wall_seconds=wall,
            updated_at=self._updated_at,
            error=self._error,
        )

    def snapshot(self) -> ProgressSnapshot:
        with self._lock:
            return self._snapshot_locked()

    def start(self) -> ProgressSnapshot:
        with self._lock:
            if self._status is not JobStatus.QUEUED:
                raise DomainInvariantError("tracker has already started")
            self._status = JobStatus.RUNNING
            self._started_at = datetime.now(UTC)
            self._updated_at = self._started_at
            snapshot = self._snapshot_locked()
            listeners = self._notify_locked(snapshot)
        self._notify(listeners, snapshot)
        return snapshot

    def mark_skipped(self, count: int) -> ProgressSnapshot:
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise DomainInvariantError("count must be a non-negative integer")
        with self._lock:
            if self._done + self._failed + self._skipped + count > self._plan.run_count:
                raise DomainInvariantError("skipped runs must not exceed runs_total")
            self._skipped += count
            self._updated_at = datetime.now(UTC)
            snapshot = self._snapshot_locked()
            listeners = self._notify_locked(snapshot)
        self._notify(listeners, snapshot)
        return snapshot

    def begin_run(self, run_index: int) -> ProgressSnapshot:
        if (
            isinstance(run_index, bool)
            or not isinstance(run_index, int)
            or not 0 <= run_index < self._plan.run_count
        ):
            raise DomainInvariantError("run_index must lie in [0, runs_total)")
        with self._lock:
            self._current = run_index
            self._updated_at = datetime.now(UTC)
            snapshot = self._snapshot_locked()
            listeners = self._notify_locked(snapshot)
        self._notify(listeners, snapshot)
        return snapshot

    def complete_run(self, run_index: int, *, failed: bool = False) -> ProgressSnapshot:
        if (
            isinstance(run_index, bool)
            or not isinstance(run_index, int)
            or not 0 <= run_index < self._plan.run_count
        ):
            raise DomainInvariantError("run_index must lie in [0, runs_total)")
        if not isinstance(failed, bool):
            raise DomainInvariantError("failed must be a boolean")
        with self._lock:
            if failed:
                self._failed += 1
            else:
                self._done += 1
            self._current = None
            self._updated_at = datetime.now(UTC)
            snapshot = self._snapshot_locked()
            listeners = self._notify_locked(snapshot)
            cancelled = self._cancel_requested
        self._notify(listeners, snapshot)
        if cancelled:
            raise ProgressCancelled("experiment cancelled by request")
        return snapshot

    def fail(self, message: str) -> ProgressSnapshot:
        if not isinstance(message, str) or not message:
            raise DomainInvariantError("message must be a non-empty string")
        with self._lock:
            self._status = JobStatus.FAILED
            self._error = message
            self._updated_at = datetime.now(UTC)
            snapshot = self._snapshot_locked()
            listeners = self._notify_locked(snapshot)
        self._notify(listeners, snapshot)
        return snapshot

    def complete(self) -> ProgressSnapshot:
        with self._lock:
            self._status = JobStatus.COMPLETED
            self._current = None
            self._updated_at = datetime.now(UTC)
            snapshot = self._snapshot_locked()
            listeners = self._notify_locked(snapshot)
        self._notify(listeners, snapshot)
        return snapshot

    def mark_cancelled(self) -> ProgressSnapshot:
        with self._lock:
            self._status = JobStatus.CANCELLED
            self._current = None
            self._updated_at = datetime.now(UTC)
            snapshot = self._snapshot_locked()
            listeners = self._notify_locked(snapshot)
        self._notify(listeners, snapshot)
        return snapshot

    def request_cancel(self) -> None:
        with self._lock:
            self._cancel_requested = True