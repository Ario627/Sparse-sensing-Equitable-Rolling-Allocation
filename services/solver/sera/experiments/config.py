from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, fields, replace
from datetime import datetime
from pathlib import Path
from types import MappingProxyType
from typing import Final, cast

import yaml

from sera.baselines.base import BaselineMethod
from sera.baselines.registry import parse_method
from sera.core.io import config_hash, iso_utc
from sera.core.types import (
    DomainInvariantError,
    LossZone,
    PolicyProfile,
    TopologyKind,
    require_identifier,
)
from sera.experiments.executors import DEFAULT_START_TIME, ExperimentExecutor, TimeseriesSink
from sera.experiments.policies import PolicyConfig
from sera.experiments.runner import SEED_CEILING, ExperimentPlan, GridFactors, plan_experiment
from sera.optimizer.stochastic import RiskMode, ScenarioConfig

DEFAULT_SLOT_HOURS: Final = 6.0

GRID_KEYS: Final = frozenset(
    {
        "methods",
        "scenarios",
        "block_counts",
        "topologies",
        "k_factors",
        "sensor_sets",
        "replicates",
    }
)
ROOT_KEYS: Final = (
    frozenset({"experiment_id", "seed_base", "results_root", "policy", "executor"}) | GRID_KEYS
)
POLICY_KEYS: Final = frozenset(field.name for field in fields(PolicyConfig))
POLICY_INTEGER_KEYS: Final = frozenset(
    {"horizon_slots", "commit_slots", "fallback_short_horizon_slots"}
)
EXECUTOR_KEYS: Final = frozenset(
    {"slot_hours", "start_time", "metric_cvar_alpha", "verify_streams"}
)
SCENARIO_CONFIG_KEYS: Final = frozenset(field.name for field in fields(ScenarioConfig))


def _require_mapping(value: object, name: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise DomainInvariantError(f"{name} must be a mapping")
    for key in value:
        if not isinstance(key, str):
            raise DomainInvariantError(f"{name} keys must be strings")
    return cast(Mapping[str, object], value)


def _require_keys(mapping: Mapping[str, object], allowed: frozenset[str], name: str) -> None:
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise DomainInvariantError(f"unknown {name} keys: {unknown}; allowed: {sorted(allowed)}")


def _require_present(mapping: Mapping[str, object], required: frozenset[str], name: str) -> None:
    missing = sorted(required - set(mapping))
    if missing:
        raise DomainInvariantError(f"{name} is missing required keys: {missing}")


def _require_text(value: object, name: str) -> str:
    if not isinstance(value, str):
        raise DomainInvariantError(f"{name} must be a string")
    return value


def _require_integer(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise DomainInvariantError(f"{name} must be an integer")
    return value


def _require_number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"{name} must be a number")
    return float(value)


def _require_flag(value: object, name: str) -> bool:
    if not isinstance(value, bool):
        raise DomainInvariantError(f"{name} must be a boolean")
    return value


def _require_sequence(value: object, name: str) -> tuple[object, ...]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise DomainInvariantError(f"{name} must be a sequence")
    return tuple(value)


def _optional_number(value: object, name: str) -> float | None:
    if value is None:
        return None
    return _require_number(value, name)


def _parse_identifiers(value: object, name: str) -> tuple[str, ...]:
    items = _require_sequence(value, name)
    return tuple(require_identifier(_require_text(item, name), name) for item in items)


def _parse_methods(value: object) -> tuple[BaselineMethod, ...]:
    items = _require_sequence(value, "methods")
    return tuple(parse_method(_require_text(item, "method")) for item in items)


def _parse_block_counts(value: object) -> tuple[int, ...]:
    items = _require_sequence(value, "block_counts")
    return tuple(_require_integer(item, "block count") for item in items)


def _parse_topologies(value: object) -> tuple[TopologyKind, ...]:
    items = _require_sequence(value, "topologies")
    parsed: list[TopologyKind] = []
    for item in items:
        raw = _require_text(item, "topology").strip().upper()
        try:
            parsed.append(TopologyKind(raw))
        except ValueError as error:
            raise DomainInvariantError(f"unknown topology: {item!r}") from error
    return tuple(parsed)


def _parse_k_factors(value: object) -> tuple[float, ...]:
    items = _require_sequence(value, "k_factors")
    return tuple(_require_number(item, "k factor") for item in items)


def _parse_sensor_sets(value: object) -> tuple[tuple[str, ...], ...]:
    items = _require_sequence(value, "sensor_sets")
    return tuple(tuple(sorted(_parse_identifiers(item, "sensor set"))) for item in items)


def _parse_grid(root: Mapping[str, object]) -> GridFactors:
    _require_present(root, GRID_KEYS, "config")
    return GridFactors(
        methods=_parse_methods(root["methods"]),
        scenario_ids=_parse_identifiers(root["scenarios"], "scenario"),
        block_counts=_parse_block_counts(root["block_counts"]),
        topologies=_parse_topologies(root["topologies"]),
        k_factors=_parse_k_factors(root["k_factors"]),
        sensor_sets=_parse_sensor_sets(root["sensor_sets"]),
        replicates=_require_integer(root["replicates"], "replicates"),
    )


def _parse_policy_profile(value: object) -> PolicyProfile:
    raw = _require_text(value, "profile").strip().upper()
    try:
        return PolicyProfile(raw)
    except ValueError as error:
        raise DomainInvariantError(f"unknown policy profile: {value!r}") from error


def _parse_risk_mode(value: object) -> RiskMode:
    raw = _require_text(value, "risk_mode").strip().upper()
    try:
        return RiskMode(raw)
    except ValueError as error:
        raise DomainInvariantError(f"unknown risk mode: {value!r}") from error


def _parse_zone_efficiencies(value: object) -> Mapping[LossZone, float]:
    mapping = _require_mapping(value, "assumed_efficiency_by_zone")
    parsed: dict[LossZone, float] = {}
    for key, raw in mapping.items():
        normalized = key.strip().upper()
        try:
            zone = LossZone(normalized)
        except ValueError as error:
            raise DomainInvariantError(f"unknown loss zone: {key!r}") from error
        parsed[zone] = _require_number(raw, f"assumed_efficiency[{zone.value}]")
    return MappingProxyType(parsed)


def _parse_scenario_config(value: object) -> tuple[ScenarioConfig, dict[str, object]]:
    mapping = _require_mapping(value, "scenario_config")
    _require_keys(mapping, SCENARIO_CONFIG_KEYS, "scenario_config")
    overrides: dict[str, object] = {}
    for key, raw in mapping.items():
        if key == "n_scenarios":
            overrides[key] = _require_integer(raw, key)
        else:
            overrides[key] = _require_number(raw, key)
    settings = replace(ScenarioConfig(), **overrides)
    payload = {field.name: getattr(settings, field.name) for field in fields(ScenarioConfig)}
    return settings, payload


def _parse_rotation_groups(value: object) -> tuple[tuple[str, ...], ...] | None:
    if value is None:
        return None
    items = _require_sequence(value, "fallback_rotation_groups")
    return tuple(_parse_identifiers(item, "rotation group") for item in items)


def _parse_policy(value: object | None) -> tuple[PolicyConfig, dict[str, object]]:
    if value is None:
        return PolicyConfig(), {}
    mapping = _require_mapping(value, "policy")
    _require_keys(mapping, POLICY_KEYS, "policy")
    overrides: dict[str, object] = {}
    payload: dict[str, object] = {}
    for key, raw in mapping.items():
        resolved = _resolve_policy_value(key, raw)
        overrides[key] = resolved[0]
        payload[key] = resolved[1]
    return replace(PolicyConfig(), **overrides), payload


def _resolve_policy_value(key: str, raw: object) -> tuple[object, object]:
    if key == "profile":
        profile = _parse_policy_profile(raw)
        return profile, profile.value
    if key == "risk_mode":
        mode = _parse_risk_mode(raw)
        return mode, mode.value
    if key == "assumed_efficiency_by_zone":
        zones = _parse_zone_efficiencies(raw)
        return zones, {zone.value: efficiency for zone, efficiency in zones.items()}
    if key == "scenario_config":
        settings, payload = _parse_scenario_config(raw)
        return settings, payload
    if key == "fallback_rotation_groups":
        groups = _parse_rotation_groups(raw)
        rendered = None if groups is None else [list(group) for group in groups]
        return groups, rendered
    if key in ("cvar_alpha", "minimum_confidence"):
        number = _optional_number(raw, key)
        return number, number
    if key in POLICY_INTEGER_KEYS:
        integer = _require_integer(raw, key)
        return integer, integer
    number = _require_number(raw, key)
    return number, number


def _parse_start_time(value: object) -> datetime:
    text = _require_text(value, "start_time").strip()
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        return datetime.fromisoformat(normalized)
    except ValueError as error:
        raise DomainInvariantError(f"start_time must be ISO 8601: {value!r}") from error


def _parse_executor(
    value: object | None, policy: PolicyConfig
) -> tuple[ExperimentExecutor, dict[str, object]]:
    slot_hours: float = DEFAULT_SLOT_HOURS
    start_time: datetime = DEFAULT_START_TIME
    metric_cvar_alpha: float | None = None
    verify_streams = True
    if value is not None:
        mapping = _require_mapping(value, "executor")
        _require_keys(mapping, EXECUTOR_KEYS, "executor")
        if "slot_hours" in mapping:
            slot_hours = _require_number(mapping["slot_hours"], "slot_hours")
        if "start_time" in mapping:
            start_time = _parse_start_time(mapping["start_time"])
        if "metric_cvar_alpha" in mapping:
            metric_cvar_alpha = _optional_number(mapping["metric_cvar_alpha"], "metric_cvar_alpha")
        if "verify_streams" in mapping:
            verify_streams = _require_flag(mapping["verify_streams"], "verify_streams")
    executor = ExperimentExecutor(
        start_time=start_time,
        slot_hours=slot_hours,
        policy=policy,
        metric_cvar_alpha=metric_cvar_alpha,
        verify_streams=verify_streams,
    )
    payload: dict[str, object] = {
        "slot_hours": executor.slot_hours,
        "start_time": iso_utc(executor.start_time),
        "metric_cvar_alpha": executor.metric_cvar_alpha,
        "verify_streams": executor.verify_streams,
    }
    return executor, payload


def _grid_payload(factors: GridFactors) -> dict[str, object]:
    return {
        "methods": [method.value for method in factors.methods],
        "scenarios": list(factors.scenario_ids),
        "block_counts": list(factors.block_counts),
        "topologies": [topology.value for topology in factors.topologies],
        "k_factors": list(factors.k_factors),
        "sensor_sets": [list(item) for item in factors.sensor_sets],
        "replicates": factors.replicates,
    }


@dataclass(frozen=True, slots=True, eq=False)
class ExperimentConfig:
    experiment_id: str
    seed_base: int
    factors: GridFactors
    policy: PolicyConfig
    executor: ExperimentExecutor
    results_root: Path | None
    payload: Mapping[str, object]

    def __post_init__(self) -> None:
        require_identifier(self.experiment_id, "experiment_id")
        if isinstance(self.seed_base, bool) or not isinstance(self.seed_base, int):
            raise DomainInvariantError("seed_base must be an integer")
        if not 0 <= self.seed_base < SEED_CEILING:
            raise DomainInvariantError("seed_base must lie in [0, 2**31)")
        if not isinstance(self.factors, GridFactors):
            raise DomainInvariantError("factors must be a GridFactors")
        if not isinstance(self.policy, PolicyConfig):
            raise DomainInvariantError("policy must be a PolicyConfig")
        if not isinstance(self.executor, ExperimentExecutor):
            raise DomainInvariantError("executor must be an ExperimentExecutor")
        if self.results_root is not None and not isinstance(self.results_root, Path):
            raise DomainInvariantError("results_root must be a Path or None")
        object.__setattr__(self, "payload", MappingProxyType(dict(self.payload)))

    @property
    def config_hash(self) -> str:
        return config_hash(self.payload)

    def build_plan(self) -> ExperimentPlan:
        return plan_experiment(
            self.experiment_id,
            seed_base=self.seed_base,
            config=self.payload,
            factors=self.factors,
        )

    def attach_sink(self, sink: TimeseriesSink) -> ExperimentConfig:
        return replace(self, executor=replace(self.executor, timeseries_sink=sink))


def experiment_config_from_mapping(
    document: object,
    *,
    default_seed_base: int | None = None,
    source: str = "config",
) -> ExperimentConfig:
    root = _require_mapping(document if document is not None else {}, source)
    _require_keys(root, ROOT_KEYS, source)
    _require_present(root, frozenset({"experiment_id"}), source)
    experiment_id = require_identifier(
        _require_text(root["experiment_id"], "experiment_id"), "experiment_id"
    )
    if "seed_base" in root:
        seed_base = _require_integer(root["seed_base"], "seed_base")
    else:
        if default_seed_base is None:
            raise DomainInvariantError("seed_base is required when no default is provided")
        seed_base = _require_integer(default_seed_base, "default_seed_base")
    factors = _parse_grid(root)
    policy, policy_payload = _parse_policy(root.get("policy"))
    executor, executor_payload = _parse_executor(root.get("executor"), policy)
    results_root: Path | None = None
    if root.get("results_root") is not None:
        results_root = Path(_require_text(root["results_root"], "results_root")).expanduser()
    payload: dict[str, object] = {
        "experiment_id": experiment_id,
        "seed_base": seed_base,
        "factors": _grid_payload(factors),
        "policy": policy_payload,
        "executor": executor_payload,
        "results_root": None if results_root is None else str(results_root),
    }
    return ExperimentConfig(
        experiment_id=experiment_id,
        seed_base=seed_base,
        factors=factors,
        policy=policy,
        executor=executor,
        results_root=results_root,
        payload=payload,
    )


def load_experiment_config_text(
    text: str,
    *,
    default_seed_base: int | None = None,
    source: str = "config",
) -> ExperimentConfig:
    if not isinstance(text, str) or not text.strip():
        raise DomainInvariantError(f"{source} is empty")
    try:
        document = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise DomainInvariantError(f"{source} is not valid YAML") from error
    return experiment_config_from_mapping(
        document,
        default_seed_base=default_seed_base,
        source=source,
    )


def load_experiment_config(
    path: Path,
    *,
    default_seed_base: int | None = None,
) -> ExperimentConfig:
    target = path if path.is_absolute() else path.resolve()
    if not target.exists():
        raise DomainInvariantError(f"config file not found: {target}")
    return load_experiment_config_text(
        target.read_text(encoding="utf-8"),
        default_seed_base=default_seed_base,
        source=str(target),
    )
