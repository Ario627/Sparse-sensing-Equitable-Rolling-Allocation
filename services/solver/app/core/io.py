from __future__ import annotations

import dataclasses
import hashlib
import json
import math
import os
import platform
import re
import subprocess
import tempfile
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from enum import Enum
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Final, cast

import numpy as np  # type: ignore
from pydantic import BaseModel  # type: ignore

from app.core.types import DomainInvariantError, require_identifier, require_utc

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]

SCHEMA_VERSION: Final = 1

DEPENDENCY_DISTRIBUTIONS: Final[tuple[str, ...]] = (
    "sera-solver",
    "fastapi",
    "uvicorn",
    "pydantic",
    "pydantic-settings",
    "structlog",
    "numpy",
    "scipy",
    "pandas",
    "pyarrow",
    "pyyaml",
    "ortools",
    "highspy",
    "pykalman",
)

_PATH_SAFE_PATTERN: Final = re.compile(r"[^A-Za-z0-9._-]")


def iso_utc(timestamp: datetime) -> str:
    return require_utc(timestamp, "timestamp").astimezone(UTC).isoformat().replace("+00:00", "Z")


def _sanitize_component(value: str | int) -> str:
    raw = str(value).strip()
    if not raw:
        raise DomainInvariantError("path component must not be empty")
    return _PATH_SAFE_PATTERN.sub("_", raw).lower()


def to_jsonable(value: object) -> JsonValue:
    if isinstance(value, Enum):
        return to_jsonable(value.value)
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise DomainInvariantError("non-finite floats cannot be canonicalized")
        return value
    if isinstance(value, np.generic):
        return to_jsonable(cast(np.generic, value).item())
    if isinstance(value, np.ndarray):
        return to_jsonable(cast(np.ndarray, value).tolist())
    if isinstance(value, BaseModel):
        return to_jsonable(cast(BaseModel, value).model_dump(mode="json"))
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return to_jsonable(dataclasses.asdict(value))
    if isinstance(value, datetime):
        return iso_utc(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        raise DomainInvariantError("binary payloads are not supported in canonical serialization")
    if isinstance(value, Mapping):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, Sequence):
        return [to_jsonable(item) for item in value]
    raise DomainInvariantError(f"values of type {type(value).__name__} are not serializable")


def canonical_json(payload: object) -> str:
    return json.dumps(
        to_jsonable(payload),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def config_hash(payload: object) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def read_json(path: Path) -> JsonValue:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, payload: object) -> Path:
    document = (
        json.dumps(
            to_jsonable(payload),
            sort_keys=True,
            indent=2,
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    )
    target = path if path.is_absolute() else path.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        dir=target.parent,
        prefix=f".{target.name}.",
        suffix=".tmp",
        encoding="utf-8",
        newline="\n",
        delete=False,
    ) as handle:
        handle.write(document)
        handle.flush()
        os.fsync(handle.fileno())
        temporary = Path(handle.name)
    try:
        os.replace(temporary, target)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise
    return target


@dataclasses.dataclass(frozen=True, slots=True)
class GitState:
    commit: str | None
    dirty: bool | None


def _run_git(working_dir: Path, *arguments: str) -> str | None:
    try:
        completed = subprocess.run(
            ("git", *arguments),
            cwd=working_dir,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout.strip()


def git_state(repo: Path) -> GitState:
    commit = _run_git(repo, "rev-parse", "HEAD")
    if commit is None or not commit:
        return GitState(commit=None, dirty=None)
    status = _run_git(repo, "status", "--porcelain", "--untracked-files=no")
    return GitState(commit=commit, dirty=bool(status))


def dependency_versions() -> dict[str, str]:
    resolved: dict[str, str] = {}
    for distribution in DEPENDENCY_DISTRIBUTIONS:
        try:
            resolved[distribution] = version(distribution)
        except PackageNotFoundError:
            continue
    return resolved


def build_meta(
    config: Mapping[str, object],
    *,
    repo: Path,
    created_at: datetime | None = None,
) -> dict[str, JsonValue]:
    timestamp = created_at if created_at is not None else datetime.now(UTC)
    state = git_state(repo)
    return {
        "schema_version": SCHEMA_VERSION,
        "created_at": iso_utc(timestamp),
        "config_hash": config_hash(config),
        "git_commit": state.commit,
        "git_dirty": state.dirty,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "dependencies": to_jsonable(dependency_versions()),
        "config": to_jsonable(config),
    }


def experiment_dir(results_root: Path, experiment_id: str) -> Path:
    identifier = require_identifier(experiment_id, "experiment_id")
    return results_root / _sanitize_component(identifier)


def timeseries_file_path(
    results_root: Path,
    experiment_id: str,
    *,
    method: str,
    sensor_count: int,
    scenario_id: str,
    seed: int,
) -> Path:
    if not isinstance(sensor_count, int) or isinstance(sensor_count, bool) or sensor_count < 0:
        raise DomainInvariantError("sensor_count must be a non-negative integer")
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        raise DomainInvariantError("seed must be a non-negative integer")
    return (
        experiment_dir(results_root, experiment_id)
        / "timeseries"
        / f"method={_sanitize_component(method)}"
        / f"sensor={sensor_count}"
        / f"scenario={_sanitize_component(scenario_id)}"
        / f"seed={seed}.parquet"
    )
