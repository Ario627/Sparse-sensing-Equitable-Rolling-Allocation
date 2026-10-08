from __future__ import annotations

from typing import Final

from api.schemas import NetworkPayload
from app.core.types import BlockSpec, EdgeSpec, NetworkSpec, NodeSpec

EMPTY_NAME: Final = ""


def _node_specs(payload: NetworkPayload) -> tuple[NodeSpec, ...]:
    return tuple(
        NodeSpec(node_id=node.id, kind=node.type, order_index=node.order_idx)
        for node in payload.nodes
    )


def _edge_specs(payload: NetworkPayload) -> tuple[EdgeSpec, ...]:
    return tuple(
        EdgeSpec(
            edge_id=edge.id,
            from_node_id=edge.from_node_id,
            to_node_id=edge.to_node_id,
            capacity_lps=edge.capacity_lps,
            length_m=edge.length_m,
            zone=edge.zone,
        )
        for edge in payload.edges
    )


def _block_specs(payload: NetworkPayload) -> tuple[BlockSpec, ...]:
    return tuple(
        BlockSpec(
            block_id=block.id,
            node_id=block.node_id,
            area_m2=block.area_m2,
            nominal_flow_lps=block.nominal_flow_lps,
            distance_from_source_m=block.distance_from_source_m,
            crop_type=block.crop_type,
            name=None if block.name == EMPTY_NAME else block.name,
        )
        for block in payload.blocks
    )


def network_spec_from_payload(payload: NetworkPayload) -> NetworkSpec:
    return NetworkSpec(
        network_id=payload.id,
        topology=payload.topology,
        nodes=_node_specs(payload),
        edges=_edge_specs(payload),
        blocks=_block_specs(payload),
    )