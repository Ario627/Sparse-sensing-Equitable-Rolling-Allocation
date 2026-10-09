from __future__ import annotations

from sera.core.types import LossZone
from sera.estimator.loss import JointStorageLossModel, LossGroupSpec, build_joint_model
from sera.simulator.network import NetworkIndex


def _zone_layout(index: NetworkIndex) -> tuple[tuple[LossZone, ...], dict[str, LossZone]]:
    zones = tuple(dict.fromkeys(index.edge_by_id[edge_id].zone for edge_id in index.edge_order))
    edge_zone = {edge_id: index.edge_by_id[edge_id].zone for edge_id in index.edge_order}
    return zones, edge_zone


def full_sensing_model(
    index: NetworkIndex,
    *,
    s_max_mm: float,
) -> JointStorageLossModel:
    zones, edge_zone = _zone_layout(index)
    return build_joint_model(
        index.path_edges,
        edge_zone,
        block_ids=index.block_ids,
        measured_block_ids=index.block_ids,
        group_spec=LossGroupSpec.per_zone(zones),
        s_max_mm=s_max_mm,
    )
