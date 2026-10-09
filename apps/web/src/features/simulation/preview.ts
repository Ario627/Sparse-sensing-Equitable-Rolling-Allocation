import type { Topology } from "@sera/contracts";
import type { TerrainBlock, TerrainFlowPoint } from "@/lib/gl/terrain.ts";

const SPACING = 0.55;
const ARM_X = 0.55;
const PREVIEW_HEIGHT = 0.42;
const MIXED_TRUNK_RATIO = 0.4;

export interface TerrainPreview {
  readonly blocks: readonly TerrainBlock[];
  readonly flow: readonly TerrainFlowPoint[];
}

interface PreviewPosition {
  readonly x: number;
  readonly z: number;
}

function chainPositions(count: number): PreviewPosition[] {
  const offset = ((count - 1) * SPACING) / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: 0,
    z: index * SPACING - offset,
  }));
}

function branchedPositions(count: number): PreviewPosition[] {
  const rows = Math.ceil(count / 2);
  const offset = ((rows - 1) * SPACING) / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: index % 2 === 0 ? -ARM_X : ARM_X,
    z: Math.floor(index / 2) * SPACING - offset,
  }));
}

function mixedPositions(count: number): PreviewPosition[] {
  const trunk = Math.max(1, Math.round(count * MIXED_TRUNK_RATIO));
  const branches = count - trunk;
  const offset = ((count - 1) * SPACING) / 2;
  const positions: PreviewPosition[] = [];
  for (let index = 0; index < trunk; index += 1) {
    positions.push({ x: 0, z: index * SPACING - offset });
  }
  for (let index = 0; index < branches; index += 1) {
    positions.push({
      x: index % 2 === 0 ? -ARM_X : ARM_X,
      z: (trunk + Math.floor(index / 2)) * SPACING - offset,
    });
  }
  return positions;
}

function positionsFor(topology: Topology, count: number): PreviewPosition[] {
  switch (topology) {
    case "CHAIN":
      return chainPositions(count);
    case "BRANCHED":
      return branchedPositions(count);
    case "MIXED":
      return mixedPositions(count);
  }
}

export function buildTerrainPreview(
  topology: Topology,
  blockCount: number,
): TerrainPreview {
  const count = Math.max(1, Math.round(blockCount));
  const positions = positionsFor(topology, count);
  return {
    blocks: positions.map((position, index) => ({
      id: `preview-b${index + 1}`,
      x: position.x,
      z: position.z,
      height: PREVIEW_HEIGHT,
      tone: "neutral",
    })),
    flow: positions.map((position) => ({ x: position.x, z: position.z })),
  };
}
