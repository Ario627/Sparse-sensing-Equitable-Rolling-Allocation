from __future__ import annotations

import json
import os
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Final, Protocol, cast

from app.core.io import SCHEMA_VERSION, canonical_json, config_hash, to_jsonable
from app.core.rng import generator_for
from app.core.types import (
    DomainInvariantError,
    TopologyKind,
    require_identifier,
    require_non_negative,
    require_positive,
    require_unique,
)
from baselines.base import BaselineMethod
from experiments.metrics import RunMetrics

SEED_CEILING: Final = 2**31
ERROR_MESSAGE_LIMIT: Final = 500
CHECKPOINT_KIND_HEADER: Final = "header"
CHECKPOINT_KIND_OK: Final = "ok"
CHECKPOINT_KIND_FAILED: Final = "failed"

type ResultListener = Callable[[RunRecord | RunFailure], None]


def _require_seed(value: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DomainInvariantError(f"{name} must be a non-negative integer")
    if value >= SEED_CEILING:
        raise DomainInvariantError(f"{name} must stay below 2**31 for the run column")
    return value


def _require_replicates(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise DomainInvariantError("replicates must be a positive integer")
    return value


def _require_block_count(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise DomainInvariantError("n_blocks must be a positive integer")
    return value


def _require_k_factor(value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError("k_factor must be a number")
    return require_positive(float(value), "k_factor")


def _require_topology(value: TopologyKind) -> TopologyKind:
    if not isinstance(value, TopologyKind):
        raise DomainInvariantError("topology must be a TopologyKind")
    return value


def _require_sensor_set(values: Sequence[str]) -> tuple[str, ...]:
    items = tuple(values)
    for item in items:
        require_identifier(item, "sensor location")
    require_unique(items, "sensor location")
    if tuple(sorted(items)) != items:
        raise DomainInvariantError("sensor_set must be in canonical sorted order")
    return items


def _require_boolean(value: bool, name: str) -> bool:
    if not isinstance(value, bool):
        raise DomainInvariantError(f"{name} must be a boolean")
    return value


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    return float(cast(float, value))


@dataclass(frozen=True, slots=True)
class RunSpec:
    run_index: int
    method: BaselineMethod
    scenario_id: str
    n_blocks: int
    topology: TopologyKind
    k_factor: float
    replicate: int
    sensor_set: tuple[str, ...]
    seed: int

    def __post_init__(self) -> None:
        if isinstance(self.run_index, bool) or not isinstance(self.run_index, int):
            raise DomainInvariantError("run_index must be an integer")
        if self.run_index < 0:
            raise DomainInvariantError("run_index must be non-negative")
        if not isinstance(self.method, BaselineMethod):
            raise DomainInvariantError("method must be a BaselineMethod")
        require_identifier(self.scenario_id, "scenario_id")
        _require_block_count(self.n_blocks)
        _require_topology(self.topology)
        require_positive(self.k_factor, "k_factor")
        require_non_negative(self.replicate, "replicate")
        if isinstance(self.replicate, bool) or not isinstance(self.replicate, int):
            raise DomainInvariantError("replicate must be an integer")
        _require_sensor_set(self.sensor_set)
        _require_seed(self.seed, "seed")
        object.__setattr__(self, "k_factor", float(self.k_factor))

    @property
    def sensor_count(self) -> int:
        return len(self.sensor_set)

    @property
    def environment_key(self) -> tuple[str, int, str, float, int]:
        return (
            self.scenario_id,
            self.n_blocks,
            self.topology.value,
            self.k_factor,
            self.replicate,
        )


@dataclass(frozen=True, slots=True)
class GridFactors:
    methods: tuple[BaselineMethod, ...]
    scenario_ids: tuple[str, ...]
    block_counts: tuple[int, ...]
    topologies: tuple[TopologyKind, ...]
    k_factors: tuple[float, ...]
    sensor_sets: tuple[tuple[str, ...], ...] = ((),)
    replicates: int = 1

    def __post_init__(self) -> None:
        methods = tuple(self.methods)
        if not methods or not all(isinstance(item, BaselineMethod) for item in methods):
            raise DomainInvariantError("methods must be non-empty BaselineMethod values")
        require_unique(methods, "method")
        scenarios = tuple(self.scenario_ids)
        if not scenarios:
            raise DomainInvariantError("scenario_ids must not be empty")
        for item in scenarios:
            require_identifier(item, "scenario_id")
        require_unique(scenarios, "scenario_id")
        blocks = tuple(_require_block_count(item) for item in self.block_counts)
        if not blocks:
            raise DomainInvariantError("block_counts must not be empty")
        require_unique(blocks, "n_blocks")
        topologies = tuple(_require_topology(item) for item in self.topologies)
        if not topologies:
            raise DomainInvariantError("topologies must not be empty")
        require_unique(topologies, "topology")
        factors = tuple(_require_k_factor(item) for item in self.k_factors)
        if not factors:
            raise DomainInvariantError("k_factors must not be empty")
        require_unique(factors, "k_factor")
        sensor_sets = tuple(_require_sensor_set(item) for item in self.sensor_sets)
        if not sensor_sets:
            raise DomainInvariantError("sensor_sets must not be empty")
        require_unique(sensor_sets, "sensor_set")
        object.__setattr__(self, "methods", tuple(sorted(methods, key=lambda item: item.value)))
        object.__setattr__(self, "scenario_ids", tuple(sorted(scenarios)))
        object.__setattr__(self, "block_counts", tuple(sorted(blocks)))
        object.__setattr__(
            self, "topologies", tuple(sorted(topologies, key=lambda item: item.value))
        )
        object.__setattr__(self, "k_factors", tuple(sorted(factors)))
        object.__setattr__(self, "sensor_sets", tuple(sorted(sensor_sets)))
        object.__setattr__(self, "replicates", _require_replicates(self.replicates))


def derive_run_seed(
    seed_base: int,
    *,
    scenario_id: str,
    n_blocks: int,
    topology: TopologyKind,
    k_factor: float,
    replicate: int,
) -> int:
    _require_seed(seed_base, "seed_base")
    require_identifier(scenario_id, "scenario_id")
    _require_block_count(n_blocks)
    _require_topology(topology)
    factor = _require_k_factor(k_factor)
    require_non_negative(replicate, "replicate")
    rng = generator_for(seed_base, "run", scenario_id, n_blocks, topology.value, factor, replicate)
    return int(rng.integers(0, SEED_CEILING))


def expand_specs(seed_base: int, factors: GridFactors) -> tuple[RunSpec, ...]:
    _require_seed(seed_base, "seed_base")
    specs: list[RunSpec] = []
    index = 0
    for topology in factors.topologies:
        for n_blocks in factors.block_counts:
            for scenario_id in factors.scenario_ids:
                for k_factor in factors.k_factors:
                    for replicate in range(factors.replicates):
                        seed = derive_run_seed(
                            seed_base,
                            scenario_id=scenario_id,
                            n_blocks=n_blocks,
                            topology=topology,
                            k_factor=k_factor,
                            replicate=replicate,
                        )
                        for method in factors.methods:
                            for sensor_set in factors.sensor_sets:
                                specs.append(
                                    RunSpec(
                                        run_index=index,
                                        method=method,
                                        scenario_id=scenario_id,
                                        n_blocks=n_blocks,
                                        topology=topology,
                                        k_factor=k_factor,
                                        replicate=replicate,
                                        sensor_set=sensor_set,
                                        seed=seed,
                                    )
                                )
                                index += 1
    return tuple(specs)


@dataclass(frozen=True, slots=True)
class ExperimentPlan:
    experiment_id: str
    seed_base: int
    config: Mapping[str, object]
    factors: GridFactors
    specs: tuple[RunSpec, ...]
    config_hash: str = field(init=False)

    def __post_init__(self) -> None:
        require_identifier(self.experiment_id, "experiment_id")
        _require_seed(self.seed_base, "seed_base")
        if not isinstance(self.config, Mapping) or not self.config:
            raise DomainInvariantError("config must be a non-empty mapping")
        for key in self.config:
            if not isinstance(key, str):
                raise DomainInvariantError("config keys must be strings")
        if not isinstance(self.factors, GridFactors):
            raise DomainInvariantError("factors must be a GridFactors")
        specs = tuple(self.specs)
        if not specs:
            raise DomainInvariantError("specs must not be empty")
        for position, spec in enumerate(specs):
            if spec.run_index != position:
                raise DomainInvariantError("specs must be indexed contiguously from zero")
        object.__setattr__(self, "config", MappingProxyType(dict(self.config)))
        object.__setattr__(self, "specs", specs)
        object.__setattr__(
            self,
            "config_hash",
            config_hash({"config": self.config, "factors": to_jsonable(self.factors)}),
        )

    @property
    def run_count(self) -> int:
        return len(self.specs)


def plan_experiment(
    experiment_id: str,
    *,
    seed_base: int,
    config: Mapping[str, object],
    factors: GridFactors,
) -> ExperimentPlan:
    return ExperimentPlan(
        experiment_id=experiment_id,
        seed_base=seed_base,
        config=config,
        factors=factors,
        specs=expand_specs(seed_base, factors),
    )


@dataclass(frozen=True, slots=True)
class RunOutcome:
    metrics: RunMetrics
    extras: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not isinstance(self.metrics, RunMetrics):
            raise DomainInvariantError("metrics must be RunMetrics")
        if not isinstance(self.extras, Mapping):
            raise DomainInvariantError("extras must be a mapping")
        object.__setattr__(self, "extras", MappingProxyType(dict(self.extras)))


@dataclass(frozen=True, slots=True)
class RunRecord:
    spec: RunSpec
    metrics: RunMetrics
    extras: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not isinstance(self.spec, RunSpec):
            raise DomainInvariantError("spec must be a RunSpec")
        if not isinstance(self.metrics, RunMetrics):
            raise DomainInvariantError("metrics must be RunMetrics")
        if not isinstance(self.extras, Mapping):
            raise DomainInvariantError("extras must be a mapping")
        object.__setattr__(self, "extras", MappingProxyType(dict(self.extras)))


@dataclass(frozen=True, slots=True)
class RunFailure:
    spec: RunSpec
    error_type: str
    message: str

    def __post_init__(self) -> None:
        if not isinstance(self.spec, RunSpec):
            raise DomainInvariantError("spec must be a RunSpec")
        require_identifier(self.error_type, "error_type")
        if not isinstance(self.message, str):
            raise DomainInvariantError("message must be a string")

    @property
    def run_index(self) -> int:
        return self.spec.run_index


def _record_payload(record: RunRecord) -> dict[str, object]:
    return {
        "kind": CHECKPOINT_KIND_OK,
        "spec": to_jsonable(record.spec),
        "metrics": to_jsonable(record.metrics),
        "extras": to_jsonable(record.extras),
    }


def _failure_payload(failure: RunFailure) -> dict[str, object]:
    return {
        "kind": CHECKPOINT_KIND_FAILED,
        "spec": to_jsonable(failure.spec),
        "error": {"type": failure.error_type, "message": failure.message},
    }


def _spec_from_payload(payload: Mapping[str, object]) -> RunSpec:
    try:
        sensor_raw = cast(Sequence[object], payload["sensor_set"])
        return RunSpec(
            run_index=int(cast(int, payload["run_index"])),
            method=BaselineMethod(str(payload["method"])),
            scenario_id=str(payload["scenario_id"]),
            n_blocks=int(cast(int, payload["n_blocks"])),
            topology=TopologyKind(str(payload["topology"])),
            k_factor=float(cast(float, payload["k_factor"])),
            replicate=int(cast(int, payload["replicate"])),
            sensor_set=tuple(str(item) for item in sensor_raw),
            seed=int(cast(int, payload["seed"])),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise DomainInvariantError("checkpoint spec is malformed") from error


def _metrics_from_payload(payload: Mapping[str, object]) -> RunMetrics:
    try:
        return RunMetrics(
            adequacy=float(cast(float, payload["adequacy"])),
            efficiency=_optional_float(payload.get("efficiency")),
            dependability=float(cast(float, payload["dependability"])),
            equity=float(cast(float, payload["equity"])),
            worst_sr=float(cast(float, payload["worst_sr"])),
            shortage_total_m3=float(cast(float, payload["shortage_total_m3"])),
            tail_deficit_m3=_optional_float(payload.get("tail_deficit_m3")),
            cvar_shortage_m3=float(cast(float, payload["cvar_shortage_m3"])),
            state_rmse=_optional_float(payload.get("state_rmse")),
            solve_time_ms=float(cast(float, payload["solve_time_ms"])),
            mip_gap=_optional_float(payload.get("mip_gap")),
            n_resolves=int(cast(int, payload["n_resolves"])),
            gate_switches=int(cast(int, payload["gate_switches"])),
            fallback_used=bool(payload["fallback_used"]),
            decision_regret=_optional_float(payload.get("decision_regret")),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise DomainInvariantError("checkpoint metrics are malformed") from error


def _record_from_payload(payload: Mapping[str, object]) -> RunRecord:
    try:
        spec = _spec_from_payload(cast(Mapping[str, object], payload["spec"]))
        metrics = _metrics_from_payload(cast(Mapping[str, object], payload["metrics"]))
        extras_raw = payload.get("extras", {})
        extras = cast(Mapping[str, object], extras_raw if isinstance(extras_raw, Mapping) else {})
    except (KeyError, TypeError, ValueError) as error:
        raise DomainInvariantError("checkpoint record is malformed") from error
    return RunRecord(spec=spec, metrics=metrics, extras=extras)


def _failure_from_payload(payload: Mapping[str, object]) -> RunFailure:
    try:
        spec = _spec_from_payload(cast(Mapping[str, object], payload["spec"]))
        error_raw = cast(Mapping[str, object], payload["error"])
        return RunFailure(
            spec=spec,
            error_type=str(error_raw["type"]),
            message=str(error_raw["message"]),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise DomainInvariantError("checkpoint failure entry is malformed") from error


@dataclass(frozen=True, slots=True)
class CheckpointContents:
    experiment_id: str | None
    config_hash: str | None
    records: tuple[RunRecord, ...]
    failures: tuple[RunFailure, ...]

    def __post_init__(self) -> None:
        count = len(self.records) + len(self.failures)
        indexes = [record.spec.run_index for record in self.records]
        indexes.extend(failure.spec.run_index for failure in self.failures)
        if len(set(indexes)) != count:
            raise DomainInvariantError("checkpoint entries must be unique per run index")


def load_checkpoint(path: Path) -> CheckpointContents:
    target = path if path.is_absolute() else path.resolve()
    if not target.exists():
        return CheckpointContents(None, None, (), ())
    lines = [line for line in target.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines:
        return CheckpointContents(None, None, (), ())
    payloads: list[Mapping[str, object]] = []
    for position, line in enumerate(lines):
        try:
            payloads.append(cast(Mapping[str, object], json.loads(line)))
        except json.JSONDecodeError as error:
            if position == len(lines) - 1:
                break
            raise DomainInvariantError(f"checkpoint line {position + 1} is corrupt") from error
    header = payloads[0]
    if header.get("kind") != CHECKPOINT_KIND_HEADER:
        raise DomainInvariantError("checkpoint header is missing")
    raw_experiment = header.get("experiment_id")
    raw_hash = header.get("config_hash")
    experiment_id = raw_experiment if isinstance(raw_experiment, str) else None
    header_hash = raw_hash if isinstance(raw_hash, str) else None
    entries: dict[int, tuple[str, RunRecord | RunFailure]] = {}
    for payload in payloads[1:]:
        kind = payload.get("kind")
        if kind == CHECKPOINT_KIND_OK:
            record = _record_from_payload(payload)
            entries[record.spec.run_index] = (CHECKPOINT_KIND_OK, record)
        elif kind == CHECKPOINT_KIND_FAILED:
            failure = _failure_from_payload(payload)
            entries[failure.spec.run_index] = (CHECKPOINT_KIND_FAILED, failure)
        else:
            raise DomainInvariantError(f"unknown checkpoint entry kind: {kind!r}")
    records = tuple(
        cast(RunRecord, entry[1])
        for _, entry in sorted(entries.items())
        if entry[0] == CHECKPOINT_KIND_OK
    )
    failures = tuple(
        cast(RunFailure, entry[1])
        for _, entry in sorted(entries.items())
        if entry[0] == CHECKPOINT_KIND_FAILED
    )
    return CheckpointContents(experiment_id, header_hash, records, failures)


def _append_chunk(path: Path, payload: Mapping[str, object]) -> None:
    target = path if path.is_absolute() else path.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(canonical_json(payload) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _write_header(path: Path, plan: ExperimentPlan) -> None:
    target = path if path.is_absolute() else path.resolve()
    if target.exists() and target.stat().st_size > 0:
        return
    _append_chunk(
        path,
        {
            "kind": CHECKPOINT_KIND_HEADER,
            "schema_version": SCHEMA_VERSION,
            "experiment_id": plan.experiment_id,
            "config_hash": plan.config_hash,
            "seed_base": plan.seed_base,
        },
    )


class RunExecutor(Protocol):
    def execute(self, spec: RunSpec) -> RunOutcome: ...


@dataclass(frozen=True, slots=True)
class ExperimentOutcome:
    experiment_id: str
    config_hash: str
    records: tuple[RunRecord, ...]
    failures: tuple[RunFailure, ...]
    skipped: int
    wall_seconds: float

    def __post_init__(self) -> None:
        if isinstance(self.skipped, bool) or not isinstance(self.skipped, int) or self.skipped < 0:
            raise DomainInvariantError("skipped must be a non-negative integer")
        require_non_negative(self.wall_seconds, "wall_seconds")

    @property
    def completed_count(self) -> int:
        return len(self.records)

    @property
    def failure_count(self) -> int:
        return len(self.failures)

    @property
    def run_count(self) -> int:
        return len(self.records) + len(self.failures)


def _new_failure(spec: RunSpec, error: Exception) -> RunFailure:
    message = str(error)
    if len(message) > ERROR_MESSAGE_LIMIT:
        message = message[:ERROR_MESSAGE_LIMIT]
    return RunFailure(spec=spec, error_type=type(error).__name__, message=message)


def run_experiment(
    plan: ExperimentPlan,
    executor: RunExecutor,
    *,
    checkpoint_path: Path,
    resume: bool = True,
    fail_fast: bool = False,
    on_result: ResultListener | None = None,
) -> ExperimentOutcome:
    if not isinstance(plan, ExperimentPlan):
        raise DomainInvariantError("plan must be an ExperimentPlan")
    if not callable(executor):
        raise DomainInvariantError("executor must be callable")
    _require_boolean(resume, "resume")
    _require_boolean(fail_fast, "fail_fast")
    started = time.perf_counter()
    existing = load_checkpoint(checkpoint_path)
    if existing.config_hash is not None and existing.config_hash != plan.config_hash:
        raise DomainInvariantError("checkpoint belongs to a different configuration")
    if existing.experiment_id is not None and existing.experiment_id != plan.experiment_id:
        raise DomainInvariantError("checkpoint belongs to a different experiment")
    if not resume and (existing.records or existing.failures):
        raise DomainInvariantError("checkpoint already holds results; clear it or resume")
    completed = {record.spec.run_index for record in existing.records}
    skipped = sum(1 for spec in plan.specs if spec.run_index in completed)
    _write_header(checkpoint_path, plan)
    for spec in plan.specs:
        if resume and spec.run_index in completed:
            continue
        try:
            outcome = executor.execute(spec)
        except Exception as error:
            failure = _new_failure(spec, error)
            _append_chunk(checkpoint_path, _failure_payload(failure))
            if on_result is not None:
                on_result(failure)
            if fail_fast:
                raise
            continue
        record = RunRecord(spec=spec, metrics=outcome.metrics, extras=outcome.extras)
        _append_chunk(checkpoint_path, _record_payload(record))
        if on_result is not None:
            on_result(record)
    final = load_checkpoint(checkpoint_path)
    return ExperimentOutcome(
        experiment_id=plan.experiment_id,
        config_hash=plan.config_hash,
        records=final.records,
        failures=final.failures,
        skipped=skipped,
        wall_seconds=time.perf_counter() - started,
    )
