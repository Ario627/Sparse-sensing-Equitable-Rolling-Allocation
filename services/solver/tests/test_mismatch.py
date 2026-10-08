from __future__ import annotations

import datetime
import math
from typing import Final

from app.core.rng import generator_for
from app.core.types import LossZone
from app.demand.kp01 import KP01_PERC_DEFAULT_MM_PER_DAY, kc_for_stage
from experiments.policies import ObservedSignals, PolicyConfig, SignalSnapshot, TargetTable
from simulator.crop import stage_for_day
from simulator.engine import SimulationConfig, SimulationResult, SlotContext, run_simulation
from simulator.gate import GateFaultSpec
from simulator.network import NetworkIndex
from simulator.scenarios import ScenarioSpec, scenario_from_preset
from simulator.weather import forecast_error_for, forecast_horizon

SEED: Final = 20_261_008
SLOT_HOURS: Final = 6.0
HORIZON_DAYS: Final = 5
N_BLOCKS: Final = 6
SENSOR_BLOCKS: Final = ("b1",)
PRIOR_SIGMA_MM: Final = 15.0
MEASURED_RMSE_CEILING_MM: Final = 8.0
UNMEASURED_RMSE_FLOOR_MM: Final = 1.0
TAIL_ETA_TOLERANCE: Final = 0.15
START_TIME: Final = datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC)


def nominal_spec() -> ScenarioSpec:
    return scenario_from_preset("nominal", n_blocks=N_BLOCKS, horizon_days=HORIZON_DAYS)


def run_open_loop(spec: ScenarioSpec) -> SimulationResult:
    return run_simulation(
        SimulationConfig(
            scenario=spec,
            seed=SEED,
            start_time=START_TIME,
            slot_hours=SLOT_HOURS,
        )
    )


def truth_eta_by_zone(result: SimulationResult, zone: LossZone) -> float:
    index = NetworkIndex.from_spec(result.network)
    return math.fsum(
        value
        for edge_id, value in result.loss_history[-1].items()
        if index.edge_by_id[edge_id].zone is zone
    ) / sum(1 for edge_id in index.edge_order if index.edge_by_id[edge_id].zone is zone)


def build_sparse_harness(
    result: SimulationResult,
    sensor_blocks: tuple[str, ...],
) -> tuple[ObservedSignals, TargetTable]:
    index = NetworkIndex.from_spec(result.network)
    spec = nominal_spec()
    config = PolicyConfig(supply_lps=spec.supply_nominal_lps)
    forecast = forecast_horizon(
        generator_for(SEED, "forecast", spec.scenario_id),
        result.weather,
        start_index=0,
        horizon=spec.horizon_days,
        spec=forecast_error_for(spec.forecast_grade),
    )
    target_table = TargetTable.build(
        network=index,
        forecast=forecast,
        config=config,
        slot_hours=SLOT_HOURS,
    )
    signals = ObservedSignals.build(config, index, target_table, sensor_blocks, full_sensing=False)
    return signals, target_table


def replay_slots(
    result: SimulationResult,
    signals: ObservedSignals,
) -> tuple[SignalSnapshot, ...]:
    index = NetworkIndex.from_spec(result.network)
    snapshots: list[SignalSnapshot] = []
    for outcome in result.outcomes:
        context = SlotContext(
            slot_index=outcome.slot_index,
            day_index=outcome.day_index,
            slot_start=outcome.slot_start,
            slot_hours=SLOT_HOURS,
            index=index,
            observations=outcome.observations,
        )
        snapshot = signals.update(context)
        signals.account(snapshot, dict(outcome.gate_open))
        snapshots.append(snapshot)
    return tuple(snapshots)


def storage_rmse(
    result: SimulationResult,
    snapshots: tuple[SignalSnapshot, ...],
    block_id: str,
) -> float:
    errors = [
        snapshot.storage_mm[block_id] - outcome.storage_mm[block_id]
        for outcome, snapshot in zip(result.outcomes, snapshots, strict=True)
    ]
    return math.sqrt(math.fsum(error * error for error in errors) / len(errors))


def test_simulator_loss_drifts_beyond_constant_estimator_assumption() -> None:
    result = run_open_loop(nominal_spec())
    assert len(result.loss_history) == HORIZON_DAYS
    assert result.loss_history[0] != result.loss_history[-1]
    for losses in result.loss_history:
        for value in losses.values():
            assert 0.5 <= value <= 0.99


def test_crop_truth_carries_variation_the_estimator_does_not_model() -> None:
    result = run_open_loop(nominal_spec())
    kc_values = [day.kc_true for day in result.crop_days["b1"]]
    perc_values = [day.perc_true_mm for day in result.crop_days["b1"]]
    assert len(set(kc_values)) > 1
    assert len(set(perc_values)) > 1
    deviations = [
        abs(day.kc_true - kc_for_stage(stage_for_day(day.day_index)))
        for day in result.crop_days["b1"]
    ]
    assert max(deviations) > 1.0e-6
    assert any(abs(value - KP01_PERC_DEFAULT_MM_PER_DAY) > 1.0e-6 for value in perc_values)


def test_sensor_noise_moves_readings_off_truth() -> None:
    result = run_open_loop(nominal_spec())
    first = result.outcomes[0]
    deviations = [
        abs(sample.value - first.storage_mm[sample.sensor_id.removeprefix("lvl-")])
        for sample in first.observations
    ]
    assert deviations
    assert max(deviations) > 0.5


def test_gate_delay_defers_the_first_slot_release() -> None:
    spec = scenario_from_preset(
        "nominal",
        n_blocks=N_BLOCKS,
        horizon_days=1,
        gate_fault=GateFaultSpec(response_delay_min=30.0),
    )
    result = run_open_loop(spec)
    assert all(flag is False for flag in result.outcomes[0].gate_open.values())
    assert all(flag is True for flag in result.outcomes[1].gate_open.values())


def test_estimator_groups_are_coarser_than_per_edge_truth() -> None:
    result = run_open_loop(nominal_spec())
    signals, _ = build_sparse_harness(result, SENSOR_BLOCKS)
    assert signals.model.n_blocks == N_BLOCKS
    assert signals.model.n_groups < len(result.loss_history[-1])
    assert set(signals.model.group_ids) <= {zone.value for zone in LossZone}


def test_sparse_estimator_beats_prior_on_measured_block_only() -> None:
    result = run_open_loop(nominal_spec())
    signals, _ = build_sparse_harness(result, SENSOR_BLOCKS)
    snapshots = replay_slots(result, signals)
    assert len(snapshots) == len(result.outcomes)
    measured_rmse = storage_rmse(result, snapshots, "b1")
    unmeasured_rmse = storage_rmse(result, snapshots, "b6")
    assert measured_rmse < PRIOR_SIGMA_MM
    assert measured_rmse < MEASURED_RMSE_CEILING_MM
    assert unmeasured_rmse > measured_rmse
    assert unmeasured_rmse > UNMEASURED_RMSE_FLOOR_MM
    assert all(snapshot.observed_blocks == SENSOR_BLOCKS for snapshot in snapshots)


def test_estimator_never_reads_the_truth_exactly() -> None:
    result = run_open_loop(nominal_spec())
    signals, _ = build_sparse_harness(result, SENSOR_BLOCKS)
    snapshots = replay_slots(result, signals)
    final = snapshots[-1]
    truth = result.outcomes[-1].storage_mm
    exact_hits = [
        block_id
        for block_id, estimate in final.storage_mm.items()
        if abs(estimate - truth[block_id]) <= 1.0e-9
    ]
    assert exact_hits == []
    tail_truth = truth_eta_by_zone(result, LossZone.TAIL)
    tail_estimate = final.eta_by_group[LossZone.TAIL.value]
    assert abs(tail_estimate - tail_truth) > 1.0e-3
    assert abs(tail_estimate - tail_truth) < TAIL_ETA_TOLERANCE


def test_sparse_confidence_reflects_the_unmeasured_tail() -> None:
    result = run_open_loop(nominal_spec())
    signals, _ = build_sparse_harness(result, SENSOR_BLOCKS)
    snapshots = replay_slots(result, signals)
    final = snapshots[-1]
    assert 0.0 <= final.confidence <= 1.0
    assert final.confidence < 0.5
    assert final.storage_intervals["b1"].width < final.storage_intervals["b6"].width


def test_full_sensing_improves_the_unmeasured_tail() -> None:
    result = run_open_loop(nominal_spec())
    sparse, _ = build_sparse_harness(result, SENSOR_BLOCKS)
    sparse_snapshots = replay_slots(result, sparse)
    dense, _ = build_sparse_harness(result, tuple(f"b{index}" for index in range(1, N_BLOCKS + 1)))
    dense_snapshots = replay_slots(result, dense)
    sparse_tail = storage_rmse(result, sparse_snapshots, "b6")
    dense_tail = storage_rmse(result, dense_snapshots, "b6")
    assert dense_tail < sparse_tail
