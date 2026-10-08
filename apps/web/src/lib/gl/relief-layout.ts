import type {
  NetworkDetailResponse,
  NetworkNodeResponse,
} from "@sera/contracts";
import type { TerrainBlock, TerrainFlowPoint, TerrainTone } from "./terrain.ts";

export interface ReliefLayoutOptions {
  readonly blockHeights?: ReadonlyMap<string, number>;
  readonly blockTones?: ReadonlyMap<string, TerrainTone>;
}

export interface ReliefLayout {
  readonly blocks: readonly TerrainBlock[];
  readonly flow: readonly TerrainFlowPoint[];
}

export interface NodePlacement {
  readonly x: number;
  readonly z: number;
}

interface DepthResult {
  readonly depthById: ReadonlyMap<string, number>;
  readonly parentById: ReadonlyMap<string, string>;
  readonly reachable: readonly string[];
  readonly maxDepth: number;
}

const DEPTH_SPACING = 1;
const LEVEL_SPACING = 0.62;
const DEFAULT_TONE: TerrainTone = "neutral";
const EMPTY_DEPTHS: DepthResult = {
  depthById: new Map(),
  parentById: new Map(),
  reachable: [],
  maxDepth: 0,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function findRoot(
  nodes: readonly NetworkNodeResponse[],
): NetworkNodeResponse | null {
  const source = nodes.find((node) => node.type === "SOURCE");
  return source ?? nodes.at(0) ?? null;
}

function buildChildren(
  detail: NetworkDetailResponse,
): ReadonlyMap<string, readonly string[]> {
  const children = new Map<string, string[]>();
  for (const edge of detail.edges) {
    const list = children.get(edge.from_node_id);
    if (list === undefined) {
      children.set(edge.from_node_id, [edge.to_node_id]);
      continue;
    }
    list.push(edge.to_node_id);
  }
  return children;
}

function computeDepths(detail: NetworkDetailResponse): DepthResult {
  const root = findRoot(detail.nodes);
  if (root === null) {
    return EMPTY_DEPTHS;
  }
  const children = buildChildren(detail);
  const depthById = new Map<string, number>([[root.id, 0]]);
  const parentById = new Map<string, string>();
  const reachable: string[] = [root.id];
  const queue: string[] = [root.id];
  let maxDepth = 0;
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === undefined) {
      continue;
    }
    const depth = (depthById.get(current) ?? 0) + 1;
    for (const childId of children.get(current) ?? []) {
      if (depthById.has(childId)) {
        continue;
      }
      depthById.set(childId, depth);
      parentById.set(childId, current);
      reachable.push(childId);
      queue.push(childId);
      maxDepth = Math.max(maxDepth, depth);
    }
  }
  return { depthById, parentById, reachable, maxDepth };
}

function assignPlacements(
  detail: NetworkDetailResponse,
  depths: DepthResult,
): ReadonlyMap<string, NodePlacement> {
  const orphanDepth = depths.maxDepth + 1;
  const byLevel = new Map<number, string[]>();
  for (const node of detail.nodes) {
    const depth = depths.depthById.get(node.id) ?? orphanDepth;
    const level = byLevel.get(depth);
    if (level === undefined) {
      byLevel.set(depth, [node.id]);
      continue;
    }
    level.push(node.id);
  }
  const placements = new Map<string, NodePlacement>();
  for (const [depth, ids] of byLevel) {
    const offset = (ids.length - 1) / 2;
    ids.forEach((id, index) => {
      placements.set(id, {
        x: (index - offset) * LEVEL_SPACING,
        z: depth * DEPTH_SPACING,
      });
    });
  }
  return placements;
}

function centerPlacements(
  placements: ReadonlyMap<string, NodePlacement>,
): ReadonlyMap<string, NodePlacement> {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const { x, z } of placements.values()) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) {
    return placements;
  }
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const centered = new Map<string, NodePlacement>();
  for (const [id, placement] of placements) {
    centered.set(id, {
      x: placement.x - centerX,
      z: placement.z - centerZ,
    });
  }
  return centered;
}

function trunkPath(depths: DepthResult): readonly string[] {
  let candidate: string | null = null;
  let bestDepth = -1;
  for (const id of depths.reachable) {
    const depth = depths.depthById.get(id) ?? 0;
    if (depth > bestDepth) {
      bestDepth = depth;
      candidate = id;
    }
  }
  const path: string[] = [];
  let cursor = candidate;
  while (cursor !== null) {
    path.push(cursor);
    cursor = depths.parentById.get(cursor) ?? null;
  }
  return path.reverse();
}

function toTerrainBlocks(
  detail: NetworkDetailResponse,
  placements: ReadonlyMap<string, NodePlacement>,
  options: ReliefLayoutOptions,
): TerrainBlock[] {
  const maxNominal = detail.blocks.reduce(
    (max, block) => Math.max(max, block.nominal_flow_lps),
    0,
  );
  const blocks: TerrainBlock[] = [];
  for (const block of detail.blocks) {
    const placement = placements.get(block.node_id);
    if (placement === undefined) {
      continue;
    }
    const explicitHeight = options.blockHeights?.get(block.id);
    const height =
      explicitHeight !== undefined
        ? clamp01(explicitHeight)
        : maxNominal > 0
          ? clamp01(block.nominal_flow_lps / maxNominal)
          : 0;
    blocks.push({
      id: block.id,
      x: placement.x,
      z: placement.z,
      height,
      tone: options.blockTones?.get(block.id) ?? DEFAULT_TONE,
    });
  }
  return blocks;
}

export function buildReliefLayout(
  detail: NetworkDetailResponse,
  options: ReliefLayoutOptions = {},
): ReliefLayout {
  const depths = computeDepths(detail);
  const placements = centerPlacements(assignPlacements(detail, depths));
  const flow: TerrainFlowPoint[] = [];
  for (const id of trunkPath(depths)) {
    const placement = placements.get(id);
    if (placement !== undefined) {
      flow.push({ x: placement.x, z: placement.z });
    }
  }
  return { blocks: toTerrainBlocks(detail, placements, options), flow };
}

export function layoutNetworkNodes(
  detail: NetworkDetailResponse,
): ReadonlyMap<string, NodePlacement> {
  return centerPlacements(assignPlacements(detail, computeDepths(detail)));
}