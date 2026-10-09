export type TierId = "head" | "middle" | "tail";
export type ViewpointId = "overview" | "source" | TierId;

export interface PlotSpec {
  readonly id: string;
  readonly tier: TierId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly stage: number;
}

export interface DitchSpec {
  readonly id: string;
  readonly tier: TierId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly length: number;
  readonly width: number;
  readonly alongZ: boolean;
}

export interface GateSpec {
  readonly id: string;
  readonly tier: TierId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TreeSpec {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly scale: number;
}

export interface SensorStakeSpec {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ViewpointSpec {
  readonly id: ViewpointId;
  readonly label: string;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

export const TIER_ORDER: readonly TierId[] = ["head", "middle", "tail"];

export const TIER_TOP: Record<TierId, number> = {
  head: 1.1,
  middle: 0.55,
  tail: 0.12,
};

export const TERRAIN = {
  slabWidth: 10.4,
  slabDepth: 3.0,
  baseWidth: 11.8,
  baseDepth: 11.4,
  baseHeight: 0.26,
  platformWidth: 2.9,
  platformDepth: 1.6,
  platformTop: 1.35,
} as const;

export const SOURCE = { x: 0, y: TERRAIN.platformTop, z: -5.45 } as const;

export const TIER_DEPTH = 2.4;

export const TIER_CENTER: Record<TierId, number> = {
  head: -3.1,
  middle: 0,
  tail: 3.1,
};

export const TIER_RANGE: Record<TierId, readonly [number, number]> = {
  head: [
    TIER_CENTER.head - TERRAIN.slabDepth / 2,
    TIER_CENTER.head + TERRAIN.slabDepth / 2,
  ],
  middle: [
    TIER_CENTER.middle - TERRAIN.slabDepth / 2,
    TIER_CENTER.middle + TERRAIN.slabDepth / 2,
  ],
  tail: [
    TIER_CENTER.tail - TERRAIN.slabDepth / 2,
    TIER_CENTER.tail + TERRAIN.slabDepth / 2,
  ],
};

const PLOT_WIDTHS = [3.4, 3.1, 3.5, 3.2, 3.3, 3.4] as const;
const PLOT_STAGES = [0.35, 0.72, 0.5, 0.85, 0.42, 0.64] as const;
const PLOT_OFFSET_X = 2.56;
const CHANNEL_HALF_WIDTH = 0.35;
const LATERAL_CENTER_X = 0.58;
const LATERAL_LENGTH = 0.46;
const LATERAL_WIDTH = 0.3;

function buildPlots(): PlotSpec[] {
  const plots: PlotSpec[] = [];
  let index = 0;
  for (const tier of TIER_ORDER) {
    for (const side of [-1, 1] as const) {
      plots.push({
        id: `plot-${tier}-${side < 0 ? "l" : "r"}`,
        tier,
        x: side * PLOT_OFFSET_X,
        y: TIER_TOP[tier],
        z: TIER_CENTER[tier],
        width: PLOT_WIDTHS[index] ?? 3.4,
        depth: TIER_DEPTH,
        stage: PLOT_STAGES[index] ?? 0.5,
      });
      index += 1;
    }
  }
  return plots;
}

function buildDitches(): DitchSpec[] {
  const ditches: DitchSpec[] = [];
  for (const tier of TIER_ORDER) {
    ditches.push({
      id: `spine-${tier}`,
      tier,
      x: 0,
      y: TIER_TOP[tier],
      z: TIER_CENTER[tier],
      length: TERRAIN.slabDepth,
      width: CHANNEL_HALF_WIDTH * 2,
      alongZ: true,
    });
    for (const side of [-1, 1] as const) {
      ditches.push({
        id: `lateral-${tier}-${side < 0 ? "l" : "r"}`,
        tier,
        x: side * LATERAL_CENTER_X,
        y: TIER_TOP[tier],
        z: TIER_CENTER[tier],
        length: LATERAL_LENGTH,
        width: LATERAL_WIDTH,
        alongZ: false,
      });
    }
  }
  return ditches;
}

function buildGates(): GateSpec[] {
  return [
    {
      id: "gate-source",
      tier: "head",
      x: 0,
      y: TIER_TOP.head,
      z: TIER_RANGE.head[0] - 0.15,
    },
    {
      id: "gate-head",
      tier: "middle",
      x: 0,
      y: TIER_TOP.middle,
      z: TIER_RANGE.middle[0] - 0.15,
    },
    {
      id: "gate-middle",
      tier: "tail",
      x: 0,
      y: TIER_TOP.tail,
      z: TIER_RANGE.tail[0] - 0.15,
    },
  ];
}

function buildSensorStakes(): SensorStakeSpec[] {
  return [
    { id: "stake-head", x: -4.2, y: TIER_TOP.head, z: -2.2 },
    { id: "stake-middle", x: 4.3, y: TIER_TOP.middle, z: 0.6 },
    { id: "stake-tail", x: -4.3, y: TIER_TOP.tail, z: 3.9 },
  ];
}

export const PLOTS: readonly PlotSpec[] = buildPlots();
export const DITCHES: readonly DitchSpec[] = buildDitches();
export const GATES: readonly GateSpec[] = buildGates();
export const SENSOR_STAKES: readonly SensorStakeSpec[] = buildSensorStakes();

export const TREES: readonly TreeSpec[] = [
  { id: "tree-1", x: -5.3, z: -4.6, scale: 1 },
  { id: "tree-2", x: 5.3, z: -5.2, scale: 0.85 },
  { id: "tree-3", x: -5.3, z: 3.8, scale: 1.15 },
  { id: "tree-4", x: 5.3, z: 4.6, scale: 0.95 },
];

export const VIEWPOINTS: Record<ViewpointId, ViewpointSpec> = {
  overview: {
    id: "overview",
    label: "Seluruh jaringan",
    position: [15.8, 12.4, 16.4],
    target: [0, 0.55, -0.2],
  },
  source: {
    id: "source",
    label: "Sumber",
    position: [3.4, 3.1, -8.6],
    target: [0, 1.35, -5.3],
  },
  head: {
    id: "head",
    label: "Hulu",
    position: [-6.2, 4.1, -2.6],
    target: [0, 1.0, -3.1],
  },
  middle: {
    id: "middle",
    label: "Tengah",
    position: [6.4, 3.0, 1.4],
    target: [0, 0.5, 0],
  },
  tail: {
    id: "tail",
    label: "Hilir",
    position: [-5.2, 2.7, 7.6],
    target: [0.3, 0.3, 3.1],
  },
};

export const VIEWPOINT_ORDER: readonly ViewpointId[] = [
  "overview",
  "source",
  "head",
  "middle",
  "tail",
];
