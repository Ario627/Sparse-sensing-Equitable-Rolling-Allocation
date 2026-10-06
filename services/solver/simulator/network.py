from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Final

import numpy as np # type: ignore

from app.core.types import (
    BlockSpec,
    DomainInvariantError,
    EdgeSpec,
    LossZone,
    NetworkSpec,
    NodeKind,
    NodeSpec,
    TopologyKind,
    require_non_negative,
    require_positive,
)
from app.core.units import combined_path_efficiency

_DEFAULT_AREA_M2: Final = 10_000.0
_DEFAULT_NOMINAL_FLOW_LPS: Final = 10.0
_DEFAULT_EDGE_LENGTH_M: Final = 100.0
_DEFAULT_EDGE_CAPACITY_LPS: Final = 60.0
_BUILDER_CAPACITY_SLACK: Final = 1.2
_M2_PER_HA: Final = 10_000.0
_ZONE_BOUNDARY: Final = 1.0 / 3.0


def _require_block_count(n_blocks: int) -> int:
    if not isinstance(n_blocks, int) or isinstance(n_blocks, bool):
        raise DomainInvariantError("n_blocks must be an integer")
    if n_blocks < 1:
        raise DomainInvariantError("n_blocks must be positive")
    return n_blocks


def _walk_path(parent_edge: Mapping[str, EdgeSpec], node_id: str) -> tuple[str, ...]:
    edge_ids: list[str] = []
    current = node_id
    while current in parent_edge:
        edge = parent_edge[current]
        edge_ids.append(edge.edge_id)
        current = edge.from_node_id
    edge_ids.reverse()
    return tuple(edge_ids)



@dataclass(frozen=True, slots=True)
class NetworkIndex:
    network: NetworkSpec
    source_id: str
    node_order: tuple[str, ...]
    edge_order: tuple[str, ...]
    reverse_edge_order: tuple[str, ...]
    children: dict[str, tuple[EdgeSpec, ...]]
    edge_by_id: dict[str, EdgeSpec]
    block_by_id: dict[str, BlockSpec]
    depth: dict[str, int]
    path_edges: dict[str, tuple[str, ...]]
    downstream: dict[str, tuple[str, ...]]
    block_ids: tuple[str, ...]

    @classmethod
    def from_spec(cls, network: NetworkSpec) -> NetworkIndex:
        source_id = next(
            node.node_id for node in network.nodes if node.kind is NodeKind.SOURCE
        )
        children: dict[str, list[EdgeSpec]] = {node.node_id: [] for node in network.nodes}
        parent_edge: dict[str, EdgeSpec] = {}
        for edge in network.edges:
            children[edge.from_node_id].append(edge)
            parent_edge[edge.to_node_id] = edge
        node_order: list[str] = [source_id]
        edge_order: list[str] = []
        depth: dict[str, int] = {source_id: 0}
        cursor = 0
        while cursor < len(node_order):
            node_id = node_order[cursor]
            cursor += 1
            for edge in children[node_id]:
                node_order.append(edge.to_node_id)
                edge_order.append(edge.edge_id)
                depth[edge.to_node_id] = depth[node_id] + 1
        block_ids = tuple(block.block_id for block in network.blocks)
        block_by_id = {block.block_id: block for block in network.blocks}
        block_at_node = {block.node_id: block.block_id for block in network.blocks}
        subtree: dict[str, list[str]] = {node_id: [] for node_id in node_order}
        for node_id in reversed(node_order):
            collected = subtree[node_id]
            own_block = block_at_node.get(node_id)
            if own_block is not None:
                collected.append(own_block)
            for edge in children[node_id]:
                collected.extend(subtree[edge.to_node_id])
        edge_by_id = {edge.edge_id: edge for edge in network.edges}
        downstream = {
            edge_id: tuple(subtree[edge_by_id[edge_id].to_node_id])
            for edge_id in edge_order
        }
        path_edges = {
            block_id: _walk_path(parent_edge, block_by_id[block_id].node_id)
            for block_id in block_ids
        }
        return cls(
            network=network,
            source_id=source_id,
            node_order=tuple(node_order),
            edge_order=tuple(edge_order),
            reverse_edge_order=tuple(reversed(edge_order)),
            children={node_id: tuple(edges) for node_id, edges in children.items()},
            edge_by_id=edge_by_id,
            block_by_id=block_by_id,
            depth=depth,
            path_edges=path_edges,
            downstream=downstream,
            block_ids=block_ids,
        )
        
        
        
def zone_for_distance(distance_m: float, max_distance_m: float) -> LossZone:
    distance = require_non_negative(distance_m, "distance_m")
    span = require_positive(max_distance_m, "max_distance_m")
    ratio = min(distance / span, 1.0)
    if ratio <= _ZONE_BOUNDARY:
        return LossZone.HEAD
    if ratio <= 2.0 * _ZONE_BOUNDARY:
        return LossZone.MIDDLE
    return LossZone.TAIL



def path_efficiency_map(
    index: NetworkIndex,
    eta_by_edge: Mapping[str, float],
) -> dict[str, float]:
    missing = sorted(
        edge_id for edge_id in index.edge_order if edge_id not in eta_by_edge
    )
    if missing:
        raise DomainInvariantError(f"missing loss parameters for edges: {missing}")
    return {
        block_id: combined_path_efficiency(
            eta_by_edge[edge_id] for edge_id in index.path_edges[block_id]
        )
        for block_id in index.block_ids
    }

    

@dataclass(slots=True)
class _Draft:
    nodes: list[NodeSpec]
    edges: list[EdgeSpec]
    blocks: list[BlockSpec]
    node_seq: int
    edge_seq: int
    block_seq: int

    @classmethod
    def create(cls) -> _Draft:
        return cls(
            nodes=[NodeSpec(node_id="src", kind=NodeKind.SOURCE, order_index=0)],
            edges=[],
            blocks=[],
            node_seq=0,
            edge_seq=0,
            block_seq=0,
        )

    def add_block_terminal(self) -> str:
        self.node_seq += 1
        node_id = f"n{self.node_seq}"
        self.block_seq += 1
        self.nodes.append(
            NodeSpec(
                node_id=node_id,
                kind=NodeKind.BLOCK_TERMINAL,
                order_index=self.node_seq,
            )
        )
        self.blocks.append(
            BlockSpec(
                block_id=f"b{self.block_seq}",
                node_id=node_id,
                area_m2=_DEFAULT_AREA_M2,
                nominal_flow_lps=_DEFAULT_NOMINAL_FLOW_LPS,
            )
        )
        return node_id

    def add_junction(self) -> str:
        self.node_seq += 1
        node_id = f"n{self.node_seq}"
        self.nodes.append(
            NodeSpec(node_id=node_id, kind=NodeKind.JUNCTION, order_index=self.node_seq)
        )
        return node_id

    def connect(self, from_node_id: str, to_node_id: str) -> None:
        self.edge_seq += 1
        self.edges.append(
            EdgeSpec(
                edge_id=f"e{self.edge_seq}",
                from_node_id=from_node_id,
                to_node_id=to_node_id,
                capacity_lps=_DEFAULT_EDGE_CAPACITY_LPS,
                length_m=_DEFAULT_EDGE_LENGTH_M,
                zone=LossZone.MIDDLE,
            )
        )

    def build(self, network_id: str, topology: TopologyKind) -> NetworkSpec:
        provisional = NetworkSpec(
            network_id=network_id,
            topology=topology,
            nodes=tuple(self.nodes),
            edges=tuple(self.edges),
            blocks=tuple(self.blocks),
        )
        index = NetworkIndex.from_spec(provisional)
        nominal_flow = {
            block.block_id: block.nominal_flow_lps for block in provisional.blocks
        }
        capacities = {
            edge_id: sum(
                nominal_flow[block_id] for block_id in index.downstream[edge_id]
            )
            * _BUILDER_CAPACITY_SLACK
            for edge_id in index.edge_order
        }
        edges = tuple(
            replace(edge, capacity_lps=capacities[edge.edge_id])
            for edge in provisional.edges
        )
        return NetworkSpec(
            network_id=network_id,
            topology=topology,
            nodes=provisional.nodes,
            edges=edges,
            blocks=provisional.blocks,
        )


def _grow_branch(draft: _Draft, parent_node_id: str, count: int) -> None:
    root = draft.add_block_terminal()
    draft.connect(parent_node_id, root)
    if count == 1:
        return
    left = count // 2
    _grow_branch(draft, root, left)
    _grow_branch(draft, root, count - left)


def chain_network(n_blocks: int, *, network_id: str = "chain") -> NetworkSpec:
    n = _require_block_count(n_blocks)
    draft = _Draft.create()
    previous = draft.nodes[0].node_id
    for _ in range(n):
        terminal = draft.add_block_terminal()
        draft.connect(previous, terminal)
        previous = terminal
    return draft.build(network_id, TopologyKind.CHAIN)


def branched_network(n_blocks: int, *, network_id: str = "branched") -> NetworkSpec:
    n = _require_block_count(n_blocks)
    draft = _Draft.create()
    junction = draft.add_junction()
    draft.connect(draft.nodes[0].node_id, junction)
    left = max(1, n // 2)
    right = n - left
    _grow_branch(draft, junction, left)
    if right > 0:
        _grow_branch(draft, junction, right)
    return draft.build(network_id, TopologyKind.BRANCHED)


def mixed_network(n_blocks: int, *, network_id: str = "mixed") -> NetworkSpec:
    n = _require_block_count(n_blocks)
    head = max(1, n // 3)
    draft = _Draft.create()
    previous = draft.nodes[0].node_id
    for _ in range(head):
        terminal = draft.add_block_terminal()
        draft.connect(previous, terminal)
        previous = terminal
    remainder = n - head
    if remainder > 0:
        junction = draft.add_junction()
        draft.connect(previous, junction)
        left = max(1, remainder // 2)
        right = remainder - left
        _grow_branch(draft, junction, left)
        if right > 0:
            _grow_branch(draft, junction, right)
    return draft.build(network_id, TopologyKind.MIXED)


@dataclass(frozen=True, slots=True)
class NetworkParameterSpec:
    area_m2_min: float = 4_000.0
    area_m2_max: float = 12_000.0
    nominal_flow_duty_lps_per_ha: float = 1.5
    edge_length_m_min: float = 40.0
    edge_length_m_max: float = 120.0
    capacity_slack: float = 1.15

    def __post_init__(self) -> None:
        require_positive(self.area_m2_min, "area_m2_min")
        require_positive(self.area_m2_max, "area_m2_max")
        if self.area_m2_max < self.area_m2_min:
            raise DomainInvariantError("area_m2_max must be >= area_m2_min")
        require_positive(self.nominal_flow_duty_lps_per_ha, "nominal_flow_duty_lps_per_ha")
        require_positive(self.edge_length_m_min, "edge_length_m_min")
        require_positive(self.edge_length_m_max, "edge_length_m_max")
        if self.edge_length_m_max < self.edge_length_m_min:
            raise DomainInvariantError("edge_length_m_max must be >= edge_length_m_min")
        require_positive(self.capacity_slack, "capacity_slack")


def parameterize_network(
    spec: NetworkSpec,
    rng: np.random.Generator,
    params: NetworkParameterSpec | None = None,
) -> NetworkSpec:
    settings = params if params is not None else NetworkParameterSpec()
    index = NetworkIndex.from_spec(spec)
    areas = {
        block.block_id: float(rng.uniform(settings.area_m2_min, settings.area_m2_max))
        for block in spec.blocks
    }
    nominal_flow = {
        block_id: area / _M2_PER_HA * settings.nominal_flow_duty_lps_per_ha
        for block_id, area in areas.items()
    }
    lengths = {
        edge_id: float(
            rng.uniform(settings.edge_length_m_min, settings.edge_length_m_max)
        )
        for edge_id in index.edge_order
    }
    node_distance = {index.source_id: 0.0}
    for node_id in index.node_order:
        base = node_distance[node_id]
        for edge in index.children[node_id]:
            node_distance[edge.to_node_id] = base + lengths[edge.edge_id]
    span = max(node_distance.values())
    edges = tuple(
        replace(
            edge,
            capacity_lps=sum(
                nominal_flow[block_id] for block_id in index.downstream[edge.edge_id]
            )
            * settings.capacity_slack,
            length_m=lengths[edge.edge_id],
            zone=zone_for_distance(node_distance[edge.to_node_id], span),
        )
        for edge in spec.edges
    )
    blocks = tuple(
        replace(
            block,
            area_m2=areas[block.block_id],
            nominal_flow_lps=nominal_flow[block.block_id],
            distance_from_source_m=node_distance[block.node_id],
        )
        for block in spec.blocks
    )
    return NetworkSpec(
        network_id=spec.network_id,
        topology=spec.topology,
        nodes=spec.nodes,
        edges=edges,
        blocks=blocks,
    )