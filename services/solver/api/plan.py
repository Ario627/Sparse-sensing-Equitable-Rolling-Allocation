from __future__ import annotations

import hashlib
import math
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from types import MappingProxyType
from typing import Final, cast

from fastapi import APIRouter  # type: ignore
from pydantic import JsonValue  # type: ignore

from api.deps import RuntimeDep
from api.network_payload import network_spec_from_payload
from api.schemas import (
    MAX_PLAN_ITEMS,
    BlockExplanationPayload,
    ForecastEntry,
    LedgerEntry,
    PlanHorizon,
    PlanItem,
    PlanObjective,
    PlanRequest,
    PlanResponse,
    PlanScenario,
    SolverStats,
    StateEntry,
)
from app.core.io import canonical_json
from app.core.rng import generator_for
from app.core.types import BlockSpec, CropStage, DomainInvariantError, LossZone
from app.core.units import combined_path_efficiency, flow_hours_to_volume_m3
from app.demand.crop_water import HOURS_PER_DAY, demand_targets, slot_mm_from_daily_rate
from app.demand.kp01 import effective_rainfall_paddy_mm, is_critical_stage, kc_for_stage
from app.settings import Settings
from experiments.policies import ZONE_EFFICIENCY_DESIGN, PolicyConfig
from experiments.runner import SEED_CEILING
from optimizer.binding_factors import (
    BlockExplanation,
    BlockSituation,
    build_block_explanation,
    deficit_level_from_ratio,
    forecast_label_from_rainfall,
)
from optimizer.fallback import FallbackDecision
from optimizer.model import (
    PlanDecision,
    PlanningBlockSpec,
    PlanningProblem,
    PlanningScenario,
)
from optimizer.objectives import DEFAULT_ORDER, LexicographicRequest
from optimizer.rolling import RollingOutcome, RollingRequest, rolling_solve
from optimizer.solver import SolveBudget, resolve_backend
from optimizer.stochastic import RiskMode, ScenarioConfig
from simulator.crop import stage_for_day
from simulator.network import NetworkIndex
from simulator.weather import DRY_SEASON_REGIME

SECONDS_PER_HOUR: Final = 3600.0
SECONDS_PER_DAY: Final = 86400.0
EFFICIENCY_CEILING: Final = 0.99
CAPACITY_TOLERANCE: Final = 1.0e-9
SAFETY_SLACK_TOLERANCE: Final = 1.0e-6
COMMIT_SLOTS_DEFAULT: Final = 1
NUMERIC_FIELD_NAMES: Final = frozenset(
    {
        "gamma",
        "debt_cap_days",
        "debt_service_fraction",
        "min_storage_mm",
        "max_storage_mm",
        "prior_storage_mm",
        "percolation_mm_per_day",
        "wlr_mm_per_day",
        "shortage_lambda",
    }
)
PARAM_KEYS: Final = NUMERIC_FIELD_NAMES | {
    "supply_lps",
    "commit_slots",
    "stage_time_limit_s",
    "cvar_alpha",
    "minimum_confidence",
    "risk_mode",
    "n_scenarios",
    "assumed_efficiency_by_zone",
    "season_day",
    "crop_stage",
    "forecast_et0_fallback_mm_per_day",
    "seed",
    "slot_hours",
    "horizon_hours",
}


def _number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainInvariantError(f"{name} must be a number")
    return float(value)


def _integer(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise DomainInvariantError(f"{name} must be an integer")
    return value


def _number_param(params: Mapping[str, JsonValue], key: str) -> float | None:
    if key not in params:
        return None
    return _number(params[key], key)


def _integer_param(params: Mapping[str, JsonValue], key: str) -> int | None:
    if key not in params:
        return None
    return _integer(params[key], key)


def _nullable_number_param(
    params: Mapping[str, JsonValue],
    key: str,
) -> tuple[bool, float | None]:
    if key not in params:
        return False, None
    raw = params[key]
    if raw is None:
        return True, None
    return True, _number(raw, key)


def _zone_efficiencies(value: object) -> Mapping[LossZone, float]:
    if not isinstance(value, Mapping):
        raise DomainInvariantError("assumed_efficiency_by_zone must be an object")
    merged = dict(ZONE_EFFICIENCY_DESIGN)
    for key, raw in value.items():
        if not isinstance(key, str):
            raise DomainInvariantError("assumed_efficiency_by_zone keys must be zone names")
        try:
            zone = LossZone(key.strip().upper())
        except ValueError as error:
            raise DomainInvariantError(f"unknown loss zone: {key!r}") from error
        efficiency = _number(raw, f"assumed_efficiency_by_zone[{key}]")
        if not 0.0 < efficiency <= 1.0:
            raise DomainInvariantError(f"assumed_efficiency_by_zone[{key}] must lie in (0, 1]")
        merged[zone] = efficiency
    return MappingProxyType(merged)


def _risk_mode(value: object) -> RiskMode:
    if not isinstance(value, str):
        raise DomainInvariantError("risk_mode must be a string")
    try:
        return RiskMode(value.strip().upper())
    except ValueError as error:
        raise DomainInvariantError(f"unknown risk_mode: {value!r}") from error


def _crop_stage(value: object) -> CropStage:
    if not isinstance(value, str):
        raise DomainInvariantError("crop_stage must be a string")
    try:
        return CropStage(value.strip().upper())
    except ValueError as error:
        raise DomainInvariantError(f"unknown crop_stage: {value!r}") from error


@dataclass(frozen=True, slots=True)
class BlockState:
    block_id: str
    storage_mm: float | None
    path_efficiency: float | None
    confidence: float | None


@dataclass(frozen=True, slots=True)
class LedgerTotals:
    delivered_m3: float
    target_m3: float
    debt_m3: float
    service_ratio: float | None


@dataclass(frozen=True, slots=True)
class DemandTables:
    etc_mm: tuple[tuple[float, ...], ...]
    perc_mm: tuple[tuple[float, ...], ...]
    wlr_mm: tuple[tuple[float, ...], ...]
    rain_effective_mm: tuple[tuple[float, ...], ...]
    target_fair_m3: tuple[tuple[float, ...], ...]
    rain_day_mm: tuple[float, ...]
    stage: tuple[CropStage, ...]


@dataclass(frozen=True, slots=True)
class PlanTuning:
    config: PolicyConfig
    supply_lps: float
    season_day: int
    crop_stage: CropStage | None
    forecast_et0_fallback_mm_per_day: float
    seed: int | None


def _cross_check_window(
    params: Mapping[str, JsonValue],
    *,
    slot_count: int,
    slot_hours: float,
) -> None:
    requested_hours = _number_param(params, "slot_hours")
    if requested_hours is not None and not math.isclose(
        requested_hours, slot_hours, rel_tol=1.0e-9
    ):
        raise DomainInvariantError("params.slot_hours disagrees with horizon.slot_hours")
    horizon_hours = _number_param(params, "horizon_hours")
    if horizon_hours is not None and not math.isclose(
        horizon_hours, slot_count * slot_hours, rel_tol=1.0e-6
    ):
        raise DomainInvariantError("params.horizon_hours disagrees with the horizon window")


def _scenario_config(params: Mapping[str, JsonValue]) -> ScenarioConfig:
    count = _integer_param(params, "n_scenarios")
    if count is None:
        return ScenarioConfig()
    return replace(ScenarioConfig(), n_scenarios=count)


def _tuning(
    params: Mapping[str, JsonValue],
    *,
    slot_count: int,
    slot_hours: float,
    supply_default: float,
    stage_seconds_default: float,
) -> PlanTuning:
    unknown = sorted(set(params) - PARAM_KEYS)
    if unknown:
        raise DomainInvariantError(f"unknown plan params: {unknown}")
    _cross_check_window(params, slot_count=slot_count, slot_hours=slot_hours)
    base = PolicyConfig()
    supply = _number_param(params, "supply_lps")
    commit = _integer_param(params, "commit_slots")
    resolved_commit = COMMIT_SLOTS_DEFAULT if commit is None else commit
    if resolved_commit < 1:
        raise DomainInvariantError("commit_slots must be positive")
    if resolved_commit > slot_count:
        resolved_commit = slot_count
    stage_seconds = _number_param(params, "stage_time_limit_s")
    cvar_present, cvar_value = _nullable_number_param(params, "cvar_alpha")
    confidence_present, confidence_value = _nullable_number_param(params, "minimum_confidence")
    overrides: dict[str, float] = {
        name: value
        for name in NUMERIC_FIELD_NAMES
        if (value := _number_param(params, name)) is not None
    }
    zones = (
        _zone_efficiencies(params["assumed_efficiency_by_zone"])
        if "assumed_efficiency_by_zone" in params
        else ZONE_EFFICIENCY_DESIGN
    )
    config = replace(
        base,
        horizon_slots=slot_count,
        commit_slots=resolved_commit,
        supply_lps=supply_default if supply is None else supply,
        assumed_efficiency_by_zone=zones,
        scenario_config=_scenario_config(params),
        stage_time_limit_s=stage_seconds_default if stage_seconds is None else stage_seconds,
        **overrides,
        **({"cvar_alpha": cvar_value} if cvar_present else {}),
        **({"minimum_confidence": confidence_value} if confidence_present else {}),
        **({"risk_mode": _risk_mode(params["risk_mode"])} if "risk_mode" in params else {}),
    )
    season_day = _integer_param(params, "season_day")
    if season_day is not None and season_day < 0:
        raise DomainInvariantError("season_day must be non-negative")
    fallback_et0 = _number_param(params, "forecast_et0_fallback_mm_per_day")
    return PlanTuning(
        config=config,
        supply_lps=config.supply_lps,
        season_day=0 if season_day is None else season_day,
        crop_stage=_crop_stage(params["crop_stage"]) if "crop_stage" in params else None,
        forecast_et0_fallback_mm_per_day=(
            DRY_SEASON_REGIME.et0_mean_mm_per_day if fallback_et0 is None else fallback_et0
        ),
        seed=_integer_param(params, "seed"),
    )


def _slot_count(horizon: PlanHorizon) -> int:
    span_hours = (horizon.to_ts - horizon.from_ts).total_seconds() / SECONDS_PER_HOUR
    raw = span_hours / horizon.slot_hours
    rounded = round(raw)
    if rounded < 1 or not math.isclose(raw, rounded, rel_tol=1.0e-9):
        raise DomainInvariantError("horizon must span a whole number of slots")
    return rounded


def _trunk_supply_lps(index: NetworkIndex) -> float:
    capacity = math.fsum(
        edge.capacity_lps for edge in index.network.edges if edge.from_node_id == index.source_id
    )
    if capacity <= 0.0:
        raise DomainInvariantError("network has no source edge capacity to anchor supply")
    return capacity


def _check_item_budget(block_count: int, slot_count: int) -> None:
    total = block_count * slot_count
    if total > MAX_PLAN_ITEMS:
        raise DomainInvariantError(
            f"plan needs {total} items but the contract caps at {MAX_PLAN_ITEMS};"
            " reduce blocks or horizon"
        )


def _parse_state_value(
    value: JsonValue,
    block_id: str,
) -> tuple[float | None, float | None]:
    if isinstance(value, bool):
        raise DomainInvariantError(f"state for block {block_id!r} must be a number or an object")
    if isinstance(value, (int, float)):
        storage = float(value)
        if storage < 0.0:
            raise DomainInvariantError(f"state for block {block_id!r} must be non-negative")
        return storage, None
    if isinstance(value, Mapping):
        storage_value = value.get("storage_mm")
        efficiency_value = value.get("path_efficiency", value.get("eta"))
        storage = (
            None
            if storage_value is None
            else _number(storage_value, f"state[{block_id}].storage_mm")
        )
        efficiency = (
            None
            if efficiency_value is None
            else _number(efficiency_value, f"state[{block_id}].path_efficiency")
        )
        if storage is None and efficiency is None:
            raise DomainInvariantError(
                f"state for block {block_id!r} must carry storage_mm or path_efficiency"
            )
        if storage is not None and storage < 0.0:
            raise DomainInvariantError(f"state for block {block_id!r} must be non-negative")
        if efficiency is not None and not 0.0 < efficiency <= 1.0:
            raise DomainInvariantError(f"state[{block_id}].path_efficiency must lie in (0, 1]")
        return storage, efficiency
    raise DomainInvariantError(f"state for block {block_id!r} must be a number or an object")


def _block_states(
    entries: Sequence[StateEntry],
    block_ids: frozenset[str],
) -> Mapping[str, BlockState]:
    states: dict[str, BlockState] = {}
    for entry in entries:
        if entry.block_id not in block_ids:
            raise DomainInvariantError(f"state references unknown block: {entry.block_id!r}")
        if entry.block_id in states:
            raise DomainInvariantError(f"duplicate state entry for block {entry.block_id!r}")
        storage, efficiency = _parse_state_value(entry.state, entry.block_id)
        states[entry.block_id] = BlockState(
            block_id=entry.block_id,
            storage_mm=storage,
            path_efficiency=efficiency,
            confidence=entry.confidence,
        )
    return MappingProxyType(states)


def _ledger_totals(
    entries: Sequence[LedgerEntry],
    block_ids: frozenset[str],
) -> Mapping[str, LedgerTotals]:
    totals: dict[str, LedgerTotals] = {}
    for entry in entries:
        if entry.block_id not in block_ids:
            raise DomainInvariantError(f"ledger references unknown block: {entry.block_id!r}")
        if entry.block_id in totals:
            raise DomainInvariantError(f"duplicate ledger entry for block {entry.block_id!r}")
        totals[entry.block_id] = LedgerTotals(
            delivered_m3=entry.delivered_m3,
            target_m3=entry.target_fair_m3,
            debt_m3=entry.debt_m3,
            service_ratio=entry.service_ratio,
        )
    return MappingProxyType(totals)


def _path_efficiencies(
    index: NetworkIndex,
    config: PolicyConfig,
    states: Mapping[str, BlockState],
) -> Mapping[str, float]:
    efficiencies: dict[str, float] = {}
    for block_id in index.block_ids:
        state = states.get(block_id)
        if state is not None and state.path_efficiency is not None:
            efficiencies[block_id] = state.path_efficiency
            continue
        efficiencies[block_id] = combined_path_efficiency(
            config.assumed_efficiency_by_zone[index.edge_by_id[edge_id].zone]
            for edge_id in index.path_edges[block_id]
        )
    return MappingProxyType(efficiencies)


def _clamp_efficiency(value: float, floor: float) -> float:
    return min(max(value, floor), EFFICIENCY_CEILING)


def _weather_at(
    ordered: Sequence[ForecastEntry],
    moment: datetime,
) -> ForecastEntry | None:
    for entry in ordered:
        if entry.valid_from <= moment < entry.valid_to:
            return entry
    return None


def _demand_tables(
    index: NetworkIndex,
    tuning: PlanTuning,
    horizon: PlanHorizon,
    slot_count: int,
    forecast: Sequence[ForecastEntry],
    efficiencies: Mapping[str, float],
) -> DemandTables:
    config = tuning.config
    hours = horizon.slot_hours
    ordered = tuple(sorted(forecast, key=lambda entry: entry.valid_from))
    etc = {block_id: [] for block_id in index.block_ids}
    perc = {block_id: [] for block_id in index.block_ids}
    wlr = {block_id: [] for block_id in index.block_ids}
    rain = {block_id: [] for block_id in index.block_ids}
    fair = {block_id: [] for block_id in index.block_ids}
    rain_days: list[float] = []
    stages: list[CropStage] = []
    wlr_slot = slot_mm_from_daily_rate(config.wlr_mm_per_day, hours)
    perc_slot = slot_mm_from_daily_rate(config.percolation_mm_per_day, hours)
    for slot in range(slot_count):
        moment = horizon.from_ts + timedelta(hours=hours * slot)
        day_offset = int((moment - horizon.from_ts).total_seconds() // SECONDS_PER_DAY)
        stage = (
            tuning.crop_stage
            if tuning.crop_stage is not None
            else stage_for_day(tuning.season_day + day_offset)
        )
        entry = _weather_at(ordered, moment)
        et0_day = (
            tuning.forecast_et0_fallback_mm_per_day
            if entry is None or entry.et0_mm is None
            else entry.et0_mm
        )
        rain_day = 0.0 if entry is None or entry.rainfall_mm is None else entry.rainfall_mm
        etc_per_day = kc_for_stage(stage) * et0_day
        etc_slot = slot_mm_from_daily_rate(etc_per_day, hours)
        rain_slot = effective_rainfall_paddy_mm(rain_day) * hours / HOURS_PER_DAY
        critical = is_critical_stage(stage)
        for block_id in index.block_ids:
            block = index.block_by_id[block_id]
            targets = demand_targets(
                etc_mm_per_day=etc_per_day,
                perc_mm_per_day=config.percolation_mm_per_day,
                wlr_mm_per_day=config.wlr_mm_per_day,
                effective_rain_slot_mm=rain_slot,
                hours=hours,
                area_m2=block.area_m2,
                nominal_flow_lps=block.nominal_flow_lps,
                path_efficiency=efficiencies[block_id],
                critical_stage=critical,
            )
            etc[block_id].append(etc_slot)
            perc[block_id].append(perc_slot)
            wlr[block_id].append(wlr_slot)
            rain[block_id].append(rain_slot)
            fair[block_id].append(targets.target_fair_m3)
        rain_days.append(rain_day)
        stages.append(stage)
    return DemandTables(
        etc_mm=tuple(tuple(etc[block_id]) for block_id in index.block_ids),
        perc_mm=tuple(tuple(perc[block_id]) for block_id in index.block_ids),
        wlr_mm=tuple(tuple(wlr[block_id]) for block_id in index.block_ids),
        rain_effective_mm=tuple(tuple(rain[block_id]) for block_id in index.block_ids),
        target_fair_m3=tuple(tuple(fair[block_id]) for block_id in index.block_ids),
        rain_day_mm=tuple(rain_days),
        stage=tuple(stages),
    )


def _planning_block(
    block: BlockSpec,
    state: BlockState | None,
    totals: LedgerTotals | None,
    config: PolicyConfig,
    efficiency: float,
) -> PlanningBlockSpec:
    storage = (
        config.prior_storage_mm if state is None or state.storage_mm is None else state.storage_mm
    )
    return PlanningBlockSpec(
        block_id=block.block_id,
        area_m2=block.area_m2,
        nominal_flow_lps=block.nominal_flow_lps,
        path_efficiency=_clamp_efficiency(efficiency, config.planning_efficiency_floor),
        min_storage_mm=config.min_storage_mm,
        max_storage_mm=config.max_storage_mm,
        initial_storage_mm=min(max(storage, 0.0), config.max_storage_mm),
        ledger_delivered_m3=0.0 if totals is None else totals.delivered_m3,
        ledger_target_m3=0.0 if totals is None else totals.target_m3,
        debt_m3=0.0 if totals is None else totals.debt_m3,
    )


def _planning_problem(
    index: NetworkIndex,
    tuning: PlanTuning,
    tables: DemandTables,
    states: Mapping[str, BlockState],
    ledger: Mapping[str, LedgerTotals],
    efficiencies: Mapping[str, float],
    slot_hours: float,
    slot_count: int,
) -> PlanningProblem:
    config = tuning.config
    blocks = tuple(
        _planning_block(
            index.block_by_id[block_id],
            states.get(block_id),
            ledger.get(block_id),
            config,
            efficiencies[block_id],
        )
        for block_id in index.block_ids
    )
    scenario = PlanningScenario(
        scenario_id="central",
        probability=1.0,
        supply_lps=(tuning.supply_lps,) * slot_count,
        etc_mm=tables.etc_mm,
        perc_mm=tables.perc_mm,
        wlr_mm=tables.wlr_mm,
        rain_effective_mm=tables.rain_effective_mm,
        target_fair_m3=tables.target_fair_m3,
    )
    return PlanningProblem(
        blocks=blocks,
        scenarios=(scenario,),
        slot_hours=slot_hours,
        edge_capacity_lps={edge.edge_id: edge.capacity_lps for edge in index.network.edges},
        edge_downstream_blocks=index.downstream,
        previous_gate_open=tuple(False for _ in index.block_ids),
        commit_slots=min(config.commit_slots, slot_count),
        debt_service_fraction=config.debt_service_fraction,
    )


def _rolling_request(tuning: PlanTuning, settings: Settings, seed: int) -> RollingRequest:
    config = tuning.config
    return RollingRequest(
        lexicographic=LexicographicRequest(
            profile=config.profile,
            backend=resolve_backend(settings.default_solver, scip_enabled=settings.scip_enabled),
            budget=SolveBudget(time_limit_s=settings.plan_time_limit_s, random_seed=seed),
            stage_time_limit_s=config.stage_time_limit_s,
            shortage_lambda=config.shortage_lambda,
        ),
        scenario_config=config.scenario_config,
        risk_mode=config.risk_mode,
        cvar_alpha=config.cvar_alpha,
        minimum_confidence=config.minimum_confidence,
    )


def _seed_payload(
    request: PlanRequest,
    tuning: PlanTuning,
    slot_count: int,
) -> dict[str, object]:
    return {
        "network_id": request.network_id,
        "network": request.network.id,
        "profile": request.profile.value,
        "slot_hours": request.horizon.slot_hours,
        "slot_count": slot_count,
        "from": request.horizon.from_ts,
        "to": request.horizon.to_ts,
        "supply_lps": tuning.supply_lps,
        "commit_slots": tuning.config.commit_slots,
    }


def _derived_seed(request: PlanRequest, tuning: PlanTuning, slot_count: int) -> int:
    digest = hashlib.sha256(
        canonical_json(_seed_payload(request, tuning, slot_count)).encode("utf-8")
    ).digest()
    return int.from_bytes(digest[:4], "big") % SEED_CEILING


def _plan_id(request: PlanRequest, tuning: PlanTuning, slot_count: int) -> str:
    return str(
        uuid.uuid5(uuid.NAMESPACE_URL, canonical_json(_seed_payload(request, tuning, slot_count)))
    )


def _non_negative(value: float) -> float:
    return max(float(value), 0.0)


def _mean(values: Sequence[float]) -> float:
    return math.fsum(values) / len(values)


def _tail_position(index: NetworkIndex, block_id: str) -> bool:
    return any(
        index.edge_by_id[edge_id].zone is LossZone.TAIL for edge_id in index.path_edges[block_id]
    )


def _committed_service_ratios(
    problem: PlanningProblem,
    outcome: RollingOutcome,
    ledger: Mapping[str, LedgerTotals],
    commit_slots: int,
) -> dict[str, float]:
    plan = outcome.plan
    scenario = problem.scenarios[0]
    ratios: dict[str, float] = {}
    for position, block in enumerate(problem.blocks):
        if plan is not None:
            target = block.ledger_target_m3 + math.fsum(
                scenario.target_fair_m3[position][:commit_slots]
            )
            delivered = block.ledger_delivered_m3 + math.fsum(
                plan.delivered_m3_by_slot[position][:commit_slots]
            )
            ratios[block.block_id] = 1.0 if target <= 0.0 else _non_negative(delivered / target)
            continue
        totals = ledger.get(block.block_id)
        if totals is None or totals.service_ratio is None:
            ratios[block.block_id] = 1.0
        else:
            ratios[block.block_id] = _non_negative(totals.service_ratio)
    return ratios


def _safety_slack_at_commit(
    plan: PlanDecision,
    block_id: str,
    commit_slots: int,
) -> float:
    prefix = f"rho|{block_id}|"
    slack = 0.0
    for name, value in plan.variable_values.items():
        if not name.startswith(prefix):
            continue
        parts = name.split("|")
        if len(parts) != 4 or not parts[2].isdigit():
            continue
        if int(parts[2]) >= commit_slots:
            continue
        slack = max(slack, float(value))
    return slack


def _switching_at_commit(
    outcome: RollingOutcome,
    position: int,
    commit_slots: int,
) -> bool:
    plan = outcome.plan
    if plan is None:
        return False
    opens = plan.open_by_slot[position]
    previous = False
    for slot in range(min(commit_slots, len(opens))):
        current = opens[slot]
        if current != previous:
            return True
        previous = current
    return False


def _supply_binding(
    problem: PlanningProblem,
    outcome: RollingOutcome,
    commit_slots: int,
) -> bool:
    plan = outcome.plan
    if plan is None:
        return False
    scenario = problem.scenarios[0]
    for slot in range(commit_slots):
        capacity = flow_hours_to_volume_m3(scenario.supply_lps[slot], problem.slot_hours)
        if capacity <= 0.0:
            continue
        gross = math.fsum(
            plan.delivered_m3_by_slot[position][slot] * block.gross_per_net
            for position, block in enumerate(problem.blocks)
        )
        if gross + CAPACITY_TOLERANCE >= capacity:
            return True
    return False


def _capacity_binding_blocks(
    problem: PlanningProblem,
    outcome: RollingOutcome,
    commit_slots: int,
) -> frozenset[str]:
    plan = outcome.plan
    if plan is None:
        return frozenset()
    binding: set[str] = set()
    for slot in range(commit_slots):
        for edge_id, downstream in problem.edge_downstream_blocks.items():
            capacity = flow_hours_to_volume_m3(
                problem.edge_capacity_lps[edge_id], problem.slot_hours
            )
            gross = math.fsum(
                plan.delivered_m3_by_slot[position][slot] * block.gross_per_net
                for position, block in enumerate(problem.blocks)
                if block.block_id in downstream
            )
            if gross + CAPACITY_TOLERANCE >= capacity:
                binding.update(downstream)
    return frozenset(binding)


def _explanation_payload(explanation: BlockExplanation) -> BlockExplanationPayload:
    return BlockExplanationPayload(
        block_id=explanation.block_id,
        service_ratio=explanation.service_ratio,
        deficit_level=explanation.deficit_level,
        crop_stage=explanation.crop_stage,
        tail_position=explanation.tail_position,
        forecast_label=explanation.forecast_label,
        sensor_confidence=explanation.sensor_confidence,
        window_slot_start=explanation.window_slot_start,
        window_slot_end=explanation.window_slot_end,
        binding_factors=list(explanation.binding_factors),
    )


def _explanations(
    problem: PlanningProblem,
    outcome: RollingOutcome,
    *,
    index: NetworkIndex,
    states: Mapping[str, BlockState],
    ledger: Mapping[str, LedgerTotals],
    tables: DemandTables,
    commit_slots: int,
) -> tuple[BlockExplanationPayload, ...]:
    ratios = _committed_service_ratios(problem, outcome, ledger, commit_slots)
    supply_binding = _supply_binding(problem, outcome, commit_slots)
    capacity_blocks = _capacity_binding_blocks(problem, outcome, commit_slots)
    floor_z = None if outcome.plan is None else outcome.plan.service_floor_z
    forecast_label = forecast_label_from_rainfall(_mean(tables.rain_day_mm))
    explanations: list[BlockExplanationPayload] = []
    for position, block in enumerate(problem.blocks):
        state = states.get(block.block_id)
        ratio = ratios[block.block_id]
        situation = BlockSituation(
            block_id=block.block_id,
            service_ratio=ratio,
            deficit_level=deficit_level_from_ratio(max(0.0, 1.0 - min(ratio, 1.0))),
            crop_stage=tables.stage[0],
            critical_stage=is_critical_stage(tables.stage[0]),
            tail_position=_tail_position(index, block.block_id),
            forecast_label=forecast_label,
            sensor_confidence=None if state is None else state.confidence,
            service_floor_z=floor_z,
            supply_binding=supply_binding,
            capacity_binding=block.block_id in capacity_blocks,
            storage_floor_binding=outcome.plan is not None
            and _safety_slack_at_commit(outcome.plan, block.block_id, commit_slots)
            > SAFETY_SLACK_TOLERANCE,
            debt_priority=problem.debt_service_fraction > 0.0 and block.debt_m3 > 0.0,
            fallback_used=outcome.used_fallback,
            switching_block=_switching_at_commit(outcome, position, commit_slots),
            window_slot_start=0,
            window_slot_end=commit_slots,
        )
        explanations.append(_explanation_payload(build_block_explanation(situation)))
    return tuple(explanations)


def _plan_objective(plan: PlanDecision) -> PlanObjective:
    return PlanObjective(
        service_floor_z=min(max(plan.service_floor_z, 0.0), 1.0),
        shortage_total_expected_m3=_non_negative(plan.shortage_total_expected_m3),
        safety_slack_total_expected=_non_negative(plan.safety_slack_total_expected),
        switching_total_expected=_non_negative(plan.switching_total_expected),
        gross_withdrawal_expected_m3=_non_negative(plan.gross_withdrawal_expected_m3),
    )


def _fallback_objective(decision: FallbackDecision) -> PlanObjective:
    return PlanObjective(
        service_floor_z=0.0,
        shortage_total_expected_m3=0.0,
        safety_slack_total_expected=0.0,
        switching_total_expected=0.0,
        gross_withdrawal_expected_m3=0.0,
        fallback_level=decision.level,
        fallback_reason=decision.reason,
    )


def _slot_bounds(
    horizon: PlanHorizon,
    slot: int,
) -> tuple[datetime, datetime]:
    start = horizon.from_ts + timedelta(hours=horizon.slot_hours * slot)
    return start, start + timedelta(hours=horizon.slot_hours)


def _plan_items(
    problem: PlanningProblem,
    plan: PlanDecision,
    explanations: Sequence[BlockExplanationPayload],
    horizon: PlanHorizon,
    slot_count: int,
) -> list[PlanItem]:
    scenario = problem.scenarios[0]
    items: list[PlanItem] = []
    for position, block in enumerate(problem.blocks):
        opens = plan.open_by_slot[position]
        delivered = plan.delivered_m3_by_slot[position]
        factors = list(explanations[position].binding_factors)
        for slot in range(slot_count):
            start, end = _slot_bounds(horizon, slot)
            target = scenario.target_fair_m3[position][slot]
            volume = _non_negative(delivered[slot])
            items.append(
                PlanItem(
                    block_id=block.block_id,
                    slot_start=start,
                    slot_end=end,
                    gate_open=bool(opens[slot]),
                    volume_del_m3=volume,
                    volume_gross_m3=_non_negative(volume * block.gross_per_net),
                    service_ratio_est=None if target <= 0.0 else _non_negative(volume / target),
                    reason=factors,
                )
            )
    return items


def _fallback_items(
    problem: PlanningProblem,
    decision: FallbackDecision,
    ledger: Mapping[str, LedgerTotals],
    explanations: Sequence[BlockExplanationPayload],
    horizon: PlanHorizon,
) -> list[PlanItem]:
    start, end = _slot_bounds(horizon, 0)
    items: list[PlanItem] = []
    for position, block in enumerate(problem.blocks):
        totals = ledger.get(block.block_id)
        items.append(
            PlanItem(
                block_id=block.block_id,
                slot_start=start,
                slot_end=end,
                gate_open=bool(decision.opens[block.block_id]),
                service_ratio_est=None if totals is None else totals.service_ratio,
                reason=list(explanations[position].binding_factors),
            )
        )
    return items


def _scenarios(outcome: RollingOutcome) -> list[PlanScenario]:
    summary = outcome.summary
    return [
        PlanScenario(
            scenario_id="ensemble",
            probability=1.0,
            payload={
                "n_scenarios": summary.n_scenarios,
                "supply_ratio_min": summary.supply_ratio_min,
                "supply_ratio_max": summary.supply_ratio_max,
                "demand_ratio_min": summary.demand_ratio_min,
                "demand_ratio_max": summary.demand_ratio_max,
                "uniform_probability": summary.uniform_probability,
                "cvar_tail_mass": summary.cvar_tail_mass,
            },
        )
    ]


def _solver_stats(outcome: RollingOutcome, settings: Settings) -> SolverStats:
    time_ms = max(0, round(outcome.total_solve_seconds * 1000.0))
    solver = "fallback" if outcome.used_fallback else settings.default_solver
    return SolverStats(solver=solver, time_ms=time_ms, mip_gap=None)


def _success_response(
    request: PlanRequest,
    outcome: RollingOutcome,
    problem: PlanningProblem,
    explanations: Sequence[BlockExplanationPayload],
    horizon: PlanHorizon,
    slot_count: int,
    tuning: PlanTuning,
    settings: Settings,
) -> PlanResponse:
    plan = outcome.plan
    if plan is None:
        raise DomainInvariantError("successful outcome must carry a plan")
    return PlanResponse(
        request_id=request.request_id,
        plan_id=_plan_id(request, tuning, slot_count),
        items=_plan_items(problem, plan, explanations, horizon, slot_count),
        scenarios=_scenarios(outcome),
        objective=_plan_objective(plan),
        binding_factors=list(explanations),
        solver_stats=_solver_stats(outcome, settings),
    )


def _fallback_response(
    request: PlanRequest,
    outcome: RollingOutcome,
    problem: PlanningProblem,
    ledger: Mapping[str, LedgerTotals],
    explanations: Sequence[BlockExplanationPayload],
    horizon: PlanHorizon,
    settings: Settings,
) -> PlanResponse:
    decision = outcome.fallback
    if decision is None:
        raise DomainInvariantError("fallback outcome must carry a decision")
    return PlanResponse(
        request_id=request.request_id,
        plan_id=None,
        items=_fallback_items(problem, decision, ledger, explanations, horizon),
        scenarios=[],
        objective=_fallback_objective(decision),
        binding_factors=list(explanations),
        solver_stats=_solver_stats(outcome, settings),
    )


router = APIRouter(tags=["plan"])


@router.post("/v1/plan", response_model=PlanResponse)
def plan(request: PlanRequest, runtime: RuntimeDep) -> PlanResponse:
    settings = runtime.settings
    index = NetworkIndex.from_spec(network_spec_from_payload(request.network))
    horizon = request.horizon
    slot_count = _slot_count(horizon)
    tuning = _tuning(
        request.params,
        slot_count=slot_count,
        slot_hours=horizon.slot_hours,
        supply_default=_trunk_supply_lps(index),
        stage_seconds_default=settings.plan_time_limit_s
        / len(cast(Sequence[object], DEFAULT_ORDER)),
    )
    _check_item_budget(len(index.block_ids), slot_count)
    seed = tuning.seed if tuning.seed is not None else _derived_seed(request, tuning, slot_count)
    states = _block_states(
        request.state if request.state is not None else (), frozenset(index.block_ids)
    )
    ledger = _ledger_totals(request.ledger, frozenset(index.block_ids))
    efficiencies = _path_efficiencies(index, tuning.config, states)
    tables = _demand_tables(index, tuning, horizon, slot_count, request.forecasts, efficiencies)
    problem = _planning_problem(
        index, tuning, tables, states, ledger, efficiencies, horizon.slot_hours, slot_count
    )
    outcome = rolling_solve(
        problem,
        _rolling_request(tuning, settings, seed),
        generator_for(seed, "plan", request.network_id),
    )
    explanations = _explanations(
        problem,
        outcome,
        index=index,
        states=states,
        ledger=ledger,
        tables=tables,
        commit_slots=problem.commit_slots,
    )
    if outcome.used_fallback:
        return _fallback_response(
            request, outcome, problem, ledger, explanations, horizon, settings
        )
    return _success_response(
        request, outcome, problem, explanations, horizon, slot_count, tuning, settings
    )
