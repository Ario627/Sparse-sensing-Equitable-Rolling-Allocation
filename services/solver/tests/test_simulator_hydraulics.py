from __future__ import annotations

import math
from dataclasses import replace
from typing import Final

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sera.core.rng import generator_for
from sera.core.types import DomainInvariantError, LossZone, NetworkSpec
from sera.core.units import LPS_HOUR_TO_M3
from sera.simulator.hydraulics import (
    TransportPipe,
    advance_loss_logit,
    apply_capacity_limit,
    arrival_slot_index,
    build_true_losses,
    edge_latency_h,
    expit,
    latency_by_block,
    logit,
)
from sera.simulator.network import NetworkIndex, chain_network

RNG_SEED: Final = 20_261_008
EDGE_LENGTH_M: Final = 100.0
VELOCITY_M_PER_S: Final = 0.25
SLOT_HOURS: Final = 6.0
DEFAULT_FLOW_LPS: Final = 10.0
BIG_CAPACITY_LPS: Final = 1.0e6
LOSS_LOWER: Final = 0.5
LOSS_UPPER: Final = 0.99
ZONE_BASE: Final = {LossZone.HEAD: 0.95, LossZone.MIDDLE: 0.90, LossZone.TAIL: 0.85}


def build_chain_index() -> NetworkIndex:
    return NetworkIndex.from_spec(chain_network(6, network_id="hydraulics-chain"))


def rezone_chain(spec: NetworkSpec) -> NetworkIndex:
    last = len(spec.edges) - 1
    edges = tuple(
        replace(
            edge,
            zone=(
                LossZone.HEAD
                if position == 0
                else LossZone.TAIL
                if position == last
                else LossZone.MIDDLE
            ),
        )
        for position, edge in enumerate(spec.edges)
    )
    return NetworkIndex.from_spec(replace(spec, edges=edges))


def edge_capacity_volume(capacity_lps: float, hours: float = SLOT_HOURS) -> float:
    return LPS_HOUR_TO_M3 * capacity_lps * hours


def default_volumes(index: NetworkIndex) -> dict[str, float]:
    volume = edge_capacity_volume(DEFAULT_FLOW_LPS)
    return dict.fromkeys(index.block_ids, volume)


def full_capacities(index: NetworkIndex, **overrides: float) -> dict[str, float]:
    capacities = dict.fromkeys(index.edge_order, BIG_CAPACITY_LPS)
    capacities.update(overrides)
    return capacities


def test_logit_expit_round_trip() -> None:
    for probability in (0.05, 0.5, 0.8, 0.99):
        assert expit(logit(probability)) == pytest.approx(probability, rel=1e-12)


def test_expit_saturates_at_extremes() -> None:
    assert expit(0.0) == pytest.approx(0.5)
    assert expit(1000.0) == 1.0
    assert expit(-1000.0) == 0.0


def test_logit_rejects_values_outside_open_unit_interval() -> None:
    for value in (0.0, 1.0, -0.2, 1.2):
        with pytest.raises(DomainInvariantError):
            logit(value)


def test_expit_rejects_non_finite_arguments() -> None:
    with pytest.raises(DomainInvariantError):
        expit(math.nan)
    with pytest.raises(DomainInvariantError):
        expit(math.inf)


def test_edge_latency_converts_metres_per_second_to_hours() -> None:
    assert edge_latency_h(EDGE_LENGTH_M, VELOCITY_M_PER_S) == pytest.approx(
        EDGE_LENGTH_M / VELOCITY_M_PER_S / 3600.0
    )


def test_edge_latency_rejects_invalid_inputs() -> None:
    with pytest.raises(DomainInvariantError):
        edge_latency_h(-1.0, VELOCITY_M_PER_S)
    with pytest.raises(DomainInvariantError):
        edge_latency_h(EDGE_LENGTH_M, 0.0)


def test_arrival_slot_index_keeps_zero_latency_in_slot() -> None:
    assert arrival_slot_index(4, 0.0, SLOT_HOURS) == 4


def test_arrival_slot_index_rounds_partial_slots_up() -> None:
    assert arrival_slot_index(0, 0.25, SLOT_HOURS) == 1
    assert arrival_slot_index(0, SLOT_HOURS, SLOT_HOURS) == 1
    assert arrival_slot_index(0, SLOT_HOURS + 0.001, SLOT_HOURS) == 2
    assert arrival_slot_index(0, 2.0 * SLOT_HOURS, SLOT_HOURS) == 2


def test_arrival_slot_index_offsets_from_the_release_slot() -> None:
    assert arrival_slot_index(7, 0.5, SLOT_HOURS) == 8


def test_arrival_slot_index_rejects_invalid_inputs() -> None:
    with pytest.raises(DomainInvariantError):
        arrival_slot_index(-1, 0.0, SLOT_HOURS)
    with pytest.raises(DomainInvariantError):
        arrival_slot_index(0, -0.1, SLOT_HOURS)
    with pytest.raises(DomainInvariantError):
        arrival_slot_index(0, 0.0, 0.0)


def test_latency_by_block_sums_path_edges(chain_index: NetworkIndex) -> None:
    latencies = latency_by_block(chain_index, velocity_m_per_s=VELOCITY_M_PER_S)
    single_edge = edge_latency_h(EDGE_LENGTH_M, VELOCITY_M_PER_S)
    for position, block_id in enumerate(chain_index.block_ids):
        assert latencies[block_id] == pytest.approx(single_edge * (position + 1))


def test_latency_by_block_requires_edge_lengths(chain_spec: NetworkSpec) -> None:
    edges = tuple(replace(edge, length_m=None) for edge in chain_spec.edges)
    index = NetworkIndex.from_spec(replace(chain_spec, edges=edges))
    with pytest.raises(DomainInvariantError):
        latency_by_block(index, velocity_m_per_s=VELOCITY_M_PER_S)


def test_build_true_losses_without_spread_returns_zone_bases(chain_spec: NetworkSpec) -> None:
    index = rezone_chain(chain_spec)
    losses = build_true_losses(
        index,
        generator_for(RNG_SEED, "losses", "anchor"),
        zone_base=ZONE_BASE,
        spread=0.0,
    )
    assert losses[index.edge_order[0]] == pytest.approx(ZONE_BASE[LossZone.HEAD], rel=1e-12)
    assert losses[index.edge_order[-1]] == pytest.approx(ZONE_BASE[LossZone.TAIL], rel=1e-12)
    for edge_id in index.edge_order[1:-1]:
        assert losses[edge_id] == pytest.approx(ZONE_BASE[LossZone.MIDDLE], rel=1e-12)


def test_build_true_losses_is_seed_deterministic(chain_index: NetworkIndex) -> None:
    first = build_true_losses(
        chain_index,
        generator_for(RNG_SEED, "losses", "repeat"),
        zone_base=ZONE_BASE,
        spread=0.2,
    )
    second = build_true_losses(
        chain_index,
        generator_for(RNG_SEED, "losses", "repeat"),
        zone_base=ZONE_BASE,
        spread=0.2,
    )
    other = build_true_losses(
        chain_index,
        generator_for(RNG_SEED, "losses", "different"),
        zone_base=ZONE_BASE,
        spread=0.2,
    )
    assert first == second
    assert first != other


def test_build_true_losses_rejects_missing_zone(chain_spec: NetworkSpec) -> None:
    index = rezone_chain(chain_spec)
    partial = {LossZone.HEAD: 0.95, LossZone.MIDDLE: 0.90}
    with pytest.raises(DomainInvariantError):
        build_true_losses(index, generator_for(RNG_SEED, "losses", "partial"), zone_base=partial)


def test_build_true_losses_rejects_degenerate_zone_base(chain_spec: NetworkSpec) -> None:
    index = rezone_chain(chain_spec)
    invalid = {LossZone.HEAD: 1.0, LossZone.MIDDLE: 0.90, LossZone.TAIL: 0.85}
    with pytest.raises(DomainInvariantError):
        build_true_losses(index, generator_for(RNG_SEED, "losses", "degenerate"), zone_base=invalid)


def test_build_true_losses_rejects_unit_upper_bound(chain_index: NetworkIndex) -> None:
    with pytest.raises(DomainInvariantError):
        build_true_losses(
            chain_index,
            generator_for(RNG_SEED, "losses", "unit-upper"),
            zone_base=ZONE_BASE,
            upper=1.0,
        )


def test_advance_loss_logit_with_zero_sigma_is_identity(chain_index: NetworkIndex) -> None:
    losses = build_true_losses(
        chain_index, generator_for(RNG_SEED, "losses", "identity"), zone_base=ZONE_BASE
    )
    updated = advance_loss_logit(losses, generator_for(RNG_SEED, "losses", "drift"), sigma=0.0)
    assert updated == losses


def test_advance_loss_logit_moves_values_within_bounds(chain_index: NetworkIndex) -> None:
    losses = build_true_losses(
        chain_index,
        generator_for(RNG_SEED, "losses", "moved"),
        zone_base=ZONE_BASE,
        spread=0.0,
    )
    updated = advance_loss_logit(
        losses, generator_for(RNG_SEED, "losses", "moved-drift"), sigma=1.0
    )
    assert set(updated) == set(losses)
    assert updated != losses
    for value in updated.values():
        assert LOSS_LOWER <= value <= LOSS_UPPER


def test_advance_loss_logit_rejects_out_of_domain_current() -> None:
    with pytest.raises(DomainInvariantError):
        advance_loss_logit({"e1": 1.0}, generator_for(RNG_SEED, "losses", "invalid"), sigma=0.1)


def test_transport_pipe_applies_path_efficiency_on_arrival(chain_index: NetworkIndex) -> None:
    pipe = TransportPipe.for_blocks(chain_index.block_ids)
    pipe.release("b1", 216.0, arrival_index=3, path_efficiency=0.9)
    delivered = pipe.collect(3)
    assert delivered["b1"] == pytest.approx(216.0 * 0.9)


def test_transport_pipe_accumulates_releases_into_one_arrival(chain_index: NetworkIndex) -> None:
    pipe = TransportPipe.for_blocks(chain_index.block_ids)
    pipe.release("b2", 100.0, arrival_index=2, path_efficiency=0.8)
    pipe.release("b2", 50.0, arrival_index=2, path_efficiency=1.0)
    delivered = pipe.collect(2)
    assert delivered["b2"] == pytest.approx(100.0 * 0.8 + 50.0)


def test_transport_pipe_withholds_volume_until_arrival_slot(chain_index: NetworkIndex) -> None:
    pipe = TransportPipe.for_blocks(chain_index.block_ids)
    pipe.release("b1", 100.0, arrival_index=5, path_efficiency=1.0)
    assert pipe.collect(4) == {}
    delivered = pipe.collect(5)
    assert delivered["b1"] == pytest.approx(100.0)
    assert pipe.collect(5) == {}


def test_transport_pipe_skips_zero_delivery_releases(chain_index: NetworkIndex) -> None:
    pipe = TransportPipe.for_blocks(chain_index.block_ids)
    pipe.release("b1", 0.0, arrival_index=0, path_efficiency=0.9)
    assert pipe.collect(0) == {}


def test_transport_pipe_rejects_unknown_block(chain_index: NetworkIndex) -> None:
    pipe = TransportPipe.for_blocks(chain_index.block_ids)
    with pytest.raises(DomainInvariantError):
        pipe.release("b999", 10.0, arrival_index=0, path_efficiency=0.9)


def test_transport_pipe_requires_blocks() -> None:
    with pytest.raises(DomainInvariantError):
        TransportPipe.for_blocks(())


def test_apply_capacity_limit_passes_through_unconstrained_releases(
    chain_index: NetworkIndex,
) -> None:
    volumes = default_volumes(chain_index)
    result = apply_capacity_limit(
        chain_index, volumes, capacity_lps=full_capacities(chain_index), hours=SLOT_HOURS
    )
    assert result.binding_edge_ids == ()
    for block_id, volume in result.gross_m3_by_block.items():
        assert volume == pytest.approx(volumes[block_id], rel=1e-12)


def test_apply_capacity_limit_does_not_scale_exact_capacity_fit(chain_index: NetworkIndex) -> None:
    volumes = default_volumes(chain_index)
    result = apply_capacity_limit(
        chain_index,
        volumes,
        capacity_lps=full_capacities(chain_index, e6=DEFAULT_FLOW_LPS),
        hours=SLOT_HOURS,
    )
    assert result.binding_edge_ids == ()
    assert result.gross_m3_by_block["b6"] == pytest.approx(volumes["b6"], rel=1e-12)


def test_apply_capacity_limit_scales_downstream_before_upstream(
    chain_index: NetworkIndex,
) -> None:
    volumes = default_volumes(chain_index)
    capacities = full_capacities(chain_index, e6=5.0, e4=30.0, e2=25.0)
    result = apply_capacity_limit(chain_index, volumes, capacity_lps=capacities, hours=SLOT_HOURS)
    downstream_volume = edge_capacity_volume(5.0)
    upstream_total = 4.0 * volumes["b2"] + downstream_volume
    scale = edge_capacity_volume(25.0) / upstream_total
    assert result.binding_edge_ids == ("e6", "e2")
    assert result.gross_m3_by_block["b1"] == pytest.approx(volumes["b1"], rel=1e-12)
    for block_id in ("b2", "b3", "b4", "b5"):
        assert result.gross_m3_by_block[block_id] == pytest.approx(
            volumes[block_id] * scale, rel=1e-12
        )
    assert result.gross_m3_by_block["b6"] == pytest.approx(downstream_volume * scale, rel=1e-12)


def test_apply_capacity_limit_rejects_missing_release(chain_index: NetworkIndex) -> None:
    volumes = default_volumes(chain_index)
    volumes.pop("b3")
    with pytest.raises(DomainInvariantError):
        apply_capacity_limit(
            chain_index, volumes, capacity_lps=full_capacities(chain_index), hours=SLOT_HOURS
        )


def test_apply_capacity_limit_rejects_unknown_block(chain_index: NetworkIndex) -> None:
    volumes = default_volumes(chain_index)
    volumes["b99"] = 1.0
    with pytest.raises(DomainInvariantError):
        apply_capacity_limit(
            chain_index, volumes, capacity_lps=full_capacities(chain_index), hours=SLOT_HOURS
        )


def test_apply_capacity_limit_rejects_missing_capacity(chain_index: NetworkIndex) -> None:
    capacities = full_capacities(chain_index)
    capacities.pop("e4")
    with pytest.raises(DomainInvariantError):
        apply_capacity_limit(
            chain_index, default_volumes(chain_index), capacity_lps=capacities, hours=SLOT_HOURS
        )


def test_apply_capacity_limit_rejects_non_positive_capacity(chain_index: NetworkIndex) -> None:
    with pytest.raises(DomainInvariantError):
        apply_capacity_limit(
            chain_index,
            default_volumes(chain_index),
            capacity_lps=full_capacities(chain_index, e1=0.0),
            hours=SLOT_HOURS,
        )


def test_apply_capacity_limit_rejects_negative_volume(chain_index: NetworkIndex) -> None:
    volumes = default_volumes(chain_index)
    volumes["b1"] = -1.0
    with pytest.raises(DomainInvariantError):
        apply_capacity_limit(
            chain_index, volumes, capacity_lps=full_capacities(chain_index), hours=SLOT_HOURS
        )


@given(spread=st.floats(min_value=0.0, max_value=5.0, allow_nan=False, allow_infinity=False))
def test_build_true_losses_stays_within_bounds(spread: float) -> None:
    index = build_chain_index()
    losses = build_true_losses(
        index,
        generator_for(RNG_SEED, "losses", spread),
        zone_base=ZONE_BASE,
        spread=spread,
    )
    for value in losses.values():
        assert LOSS_LOWER <= value <= LOSS_UPPER


@given(
    volumes=st.lists(
        st.floats(min_value=0.0, max_value=500.0, allow_nan=False, allow_infinity=False),
        min_size=6,
        max_size=6,
    ),
    capacities=st.lists(
        st.floats(min_value=1.0, max_value=200.0, allow_nan=False, allow_infinity=False),
        min_size=6,
        max_size=6,
    ),
)
def test_apply_capacity_limit_never_exceeds_edge_capacity(
    volumes: list[float],
    capacities: list[float],
) -> None:
    index = build_chain_index()
    volume_by_block = dict(zip(index.block_ids, volumes, strict=True))
    capacity_by_edge = dict(zip(index.edge_order, capacities, strict=True))
    result = apply_capacity_limit(
        index, volume_by_block, capacity_lps=capacity_by_edge, hours=SLOT_HOURS
    )
    for block_id, volume in result.gross_m3_by_block.items():
        assert 0.0 <= volume <= volume_by_block[block_id] + 1e-9
    for edge_id in index.edge_order:
        capacity_volume = edge_capacity_volume(capacity_by_edge[edge_id])
        served = math.fsum(
            result.gross_m3_by_block[block_id] for block_id in index.downstream[edge_id]
        )
        assert served <= capacity_volume * (1.0 + 1e-9) + 1e-9
