import type {
  SolverNetworkBlock,
  SolverNetworkEdge,
  SolverNetworkNode,
  SolverNetworkPayload,
} from './solver.client.ts';

export interface NetworkSource {
  readonly id: string;
  readonly name: string;
  readonly topology: string;
}

export interface NetworkSourceNode {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly orderIdx: number | null;
}

export interface NetworkSourceEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly capacityLps: number;
  readonly zone: string;
  readonly lengthM: number | null;
}

export interface NetworkSourceBlock {
  readonly id: string;
  readonly nodeId: string;
  readonly name: string;
  readonly areaM2: number;
  readonly cropType: string;
  readonly nominalFlowLps: number;
  readonly distanceFromSourceM: number | null;
}

function toWireNode(node: NetworkSourceNode): SolverNetworkNode {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    order_idx: node.orderIdx,
  };
}

function toWireEdge(edge: NetworkSourceEdge): SolverNetworkEdge {
  return {
    id: edge.id,
    from_node_id: edge.fromNodeId,
    to_node_id: edge.toNodeId,
    capacity_lps: edge.capacityLps,
    zone: edge.zone,
    length_m: edge.lengthM,
  };
}

function toWireBlock(block: NetworkSourceBlock): SolverNetworkBlock {
  return {
    id: block.id,
    node_id: block.nodeId,
    name: block.name,
    area_m2: block.areaM2,
    crop_type: block.cropType,
    nominal_flow_lps: block.nominalFlowLps,
    distance_from_source_m: block.distanceFromSourceM,
  };
}

export function buildSolverNetwork(
  network: NetworkSource,
  nodes: readonly NetworkSourceNode[],
  edges: readonly NetworkSourceEdge[],
  blocks: readonly NetworkSourceBlock[],
): SolverNetworkPayload {
  return {
    id: network.id,
    name: network.name,
    topology: network.topology,
    nodes: nodes.map(toWireNode),
    edges: edges.map(toWireEdge),
    blocks: blocks.map(toWireBlock),
  };
}
