import { hexToRgb01, mixRgb, palette } from "@/lib/palette.ts";

export type TerrainTone =
  | "ok"
  | "warn"
  | "crit"
  | "fallback"
  | "water"
  | "neutral";

export interface TerrainBlock {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly tone: TerrainTone;
}

export interface TerrainFlowPoint {
  readonly x: number;
  readonly z: number;
}

export interface TerrainGeometry {
  readonly padPositions: Float32Array;
  readonly padColors: Float32Array;
  readonly padVertexCount: number;
  readonly flowPositions: Float32Array;
  readonly flowArcs: Float32Array;
  readonly flowVertexCount: number;
}

const PAD_HALF = 0.17;
const PAD_MIN_HEIGHT = 0.06;
const PAD_HEIGHT_SPAN = 0.52;
const FLOW_Y = 0.02;
const FLOW_LENGTH_EPSILON = 1e-6;
const POST_MIX = 0.55;
const BASE_MIX = 0.78;
const EDGE_SEGMENTS = 4;

const toneRgb: Record<TerrainTone, readonly [number, number, number]> = {
  ok: hexToRgb01(palette.ok),
  warn: hexToRgb01(palette.warn),
  crit: hexToRgb01(palette.crit),
  fallback: hexToRgb01(palette.fallback),
  water: hexToRgb01(palette.water),
  neutral: hexToRgb01(palette.ink3),
};

const inkRgb = hexToRgb01(palette.ink);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function padHeight(height: number): number {
  return PAD_MIN_HEIGHT + PAD_HEIGHT_SPAN * clamp01(height);
}

function pushVertex(
  positions: number[],
  colors: number[],
  point: [number, number, number],
  rgb: readonly [number, number, number],
): void {
  positions.push(point[0], point[1], point[2]);
  colors.push(rgb[0], rgb[1], rgb[2]);
}

function pushSegment(
  positions: number[],
  colors: number[],
  from: [number, number, number],
  to: [number, number, number],
  rgb: readonly [number, number, number],
): void {
  pushVertex(positions, colors, from, rgb);
  pushVertex(positions, colors, to, rgb);
}

function pushPad(
  positions: number[],
  colors: number[],
  block: TerrainBlock,
): void {
  const tone = toneRgb[block.tone];
  const edgeRgb = tone;
  const postRgb = mixRgb(tone, inkRgb, POST_MIX);
  const baseRgb = mixRgb(tone, inkRgb, BASE_MIX);
  const top = padHeight(block.height);
  const corners: [number, number][] = [
    [block.x - PAD_HALF, block.z - PAD_HALF],
    [block.x + PAD_HALF, block.z - PAD_HALF],
    [block.x + PAD_HALF, block.z + PAD_HALF],
    [block.x - PAD_HALF, block.z + PAD_HALF],
  ];
  for (let index = 0; index < EDGE_SEGMENTS; index += 1) {
    const current = corners[index] ?? [0, 0];
    const next = corners[(index + 1) % EDGE_SEGMENTS] ?? [0, 0];
    pushSegment(
      positions,
      colors,
      [current[0], top, current[1]],
      [next[0], top, next[1]],
      edgeRgb,
    );
    pushSegment(
      positions,
      colors,
      [current[0], 0, current[1]],
      [next[0], 0, next[1]],
      baseRgb,
    );
    pushSegment(
      positions,
      colors,
      [current[0], 0, current[1]],
      [current[0], top, current[1]],
      postRgb,
    );
  }
}

function flowStrip(points: readonly TerrainFlowPoint[]): TerrainFlowPoint[] {
  return points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.z),
  );
}

function segmentLength(a: TerrainFlowPoint, b: TerrainFlowPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function buildFlowArcs(points: readonly TerrainFlowPoint[]): number[] {
  const cumulative: number[] = [];
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous !== undefined && current !== undefined) {
      total += segmentLength(previous, current);
    }
    cumulative.push(total);
  }
  if (total < FLOW_LENGTH_EPSILON) {
    return points.map(() => 0);
  }
  return cumulative.map((value) => value / total);
}

export function buildTerrainGeometry(
  blocks: readonly TerrainBlock[],
  flow: readonly TerrainFlowPoint[],
): TerrainGeometry {
  const padPositions: number[] = [];
  const padColors: number[] = [];
  for (const block of blocks) {
    pushPad(padPositions, padColors, block);
  }
  const points = flowStrip(flow);
  const flowPositions: number[] = [];
  const flowArcs: number[] = [];
  if (points.length >= 2) {
    const arcs = buildFlowArcs(points);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (point === undefined) {
        continue;
      }
      flowPositions.push(point.x, FLOW_Y, point.z);
      flowArcs.push(arcs[index] ?? 0);
    }
  }
  return {
    padPositions: new Float32Array(padPositions),
    padColors: new Float32Array(padColors),
    padVertexCount: padPositions.length / 3,
    flowPositions: new Float32Array(flowPositions),
    flowArcs: new Float32Array(flowArcs),
    flowVertexCount: flowPositions.length / 3,
  };
}
