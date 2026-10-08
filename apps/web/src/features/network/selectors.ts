import type {
  LossZone,
  NetworkBlockResponse,
  NetworkDetailResponse,
  NodeType,
  PlanItemResponse,
  ReadingQuality,
  TelemetryLatestItemResponse,
} from "@sera/contracts";
import { layoutNetworkNodes } from "@/lib/gl/relief-layout.ts";
import { serviceRatioBand, type StatusBand } from "./status.ts";

const CANVAS_X_SCALE = 260;
const CANVAS_Y_SCALE = 190;
const NO_PLAN_BAND: StatusBand = {
  tone: "neutral",
  label: "Belum ada rencana",
};

const QUALITY_RANK: Record<ReadingQuality, number> = {
  GOOD: 0,
  SUSPECT: 1,
  BAD: 2,
  STALE: 3,
};

const ZONE_LABELS: Record<LossZone, string> = {
  HEAD: "Hulu",
  MIDDLE: "Tengah",
  TAIL: "Hilir",
};

const KIND_BY_NODE_TYPE: Record<NodeType, NetworkNodeKind> = {
  SOURCE: "source",
  JUNCTION: "junction",
  GATE: "gate",
  BLOCK_TERMINAL: "block",
};

const NO_SENSORS: BlockSensorSummary = {
  sensorCount: 0,
  staleCount: 0,
  worstQuality: null,
};

export type NetworkNodeKind = "source" | "junction" | "gate" | "block";

export type BlockSensorSummary = {
  readonly sensorCount: number;
  readonly staleCount: number;
  readonly worstQuality: ReadingQuality | null;
};

export type BlockSlot = {
  readonly slotStart: string;
  readonly slotEnd: string;
  readonly gateOpen: boolean;
  readonly serviceRatio: number | null;
  readonly upcoming: boolean;
};

export type BlockSummary = {
  readonly blockId: string;
  readonly nodeId: string;
  readonly name: string;
  readonly areaM2: number;
  readonly nominalFlowLps: number;
  readonly zone: LossZone | null;
  readonly serviceRatio: number | null;
  readonly band: StatusBand;
  readonly sensors: BlockSensorSummary;
  readonly slot: BlockSlot | null;
};

export type NetworkNodeData = {
  readonly name: string;
  readonly role: string;
  readonly block: BlockSummary | null;
};

export type NetworkFlowNode = {
  readonly id: string;
  readonly kind: NetworkNodeKind;
  readonly x: number;
  readonly y: number;
  readonly data: NetworkNodeData;
};

export type NetworkFlowEdge = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly zone: LossZone;
};

export type NetworkFlowModel = {
  readonly nodes: readonly NetworkFlowNode[];
  readonly edges: readonly NetworkFlowEdge[];
};

export type NetworkViewSummary = {
  readonly blockCount: number;
  readonly sensorCount: number;
  readonly staleSensorCount: number;
  readonly worstSensorQuality: ReadingQuality | null;
  readonly averageServiceRatio: number | null;
  readonly weakestBlockName: string | null;
  readonly weakestServiceRatio: number | null;
};

export type NetworkView = {
  readonly blocks: readonly BlockSummary[];
  readonly flow: NetworkFlowModel;
  readonly summary: NetworkViewSummary;
};

export interface BuildNetworkViewInput {
  readonly detail: NetworkDetailResponse;
  readonly telemetry: readonly TelemetryLatestItemResponse[];
  readonly planItems?: readonly PlanItemResponse[];
  readonly now?: number;
}

function worseQuality(
  a: ReadingQuality | null,
  b: ReadingQuality | null,
): ReadingQuality | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return QUALITY_RANK[a] >= QUALITY_RANK[b] ? a : b;
}

function zoneByNodeId(
  detail: NetworkDetailResponse,
): ReadonlyMap<string, LossZone> {
  const zones = new Map<string, LossZone>();
  for (const edge of detail.edges) {
    if (!zones.has(edge.to_node_id)) {
      zones.set(edge.to_node_id, edge.zone);
    }
  }
  return zones;
}

function sensorsByBlock(
  items: readonly TelemetryLatestItemResponse[],
): ReadonlyMap<string, BlockSensorSummary> {
  const map = new Map<string, BlockSensorSummary>();
  for (const item of items) {
    if (item.block_id === null) {
      continue;
    }
    const current = map.get(item.block_id) ?? NO_SENSORS;
    map.set(item.block_id, {
      sensorCount: current.sensorCount + 1,
      staleCount: current.staleCount + (item.stale ? 1 : 0),
      worstQuality: worseQuality(current.worstQuality, item.quality),
    });
  }
  return map;
}

function planSlotByBlock(
  items: readonly PlanItemResponse[],
  now: number,
): ReadonlyMap<string, BlockSlot> {
  const upcoming = new Map<string, PlanItemResponse>();
  const latest = new Map<string, PlanItemResponse>();
  for (const item of items) {
    const start = Date.parse(item.slot_start);
    const currentLatest = latest.get(item.block_id);
    if (
      currentLatest === undefined ||
      Date.parse(currentLatest.slot_start) < start
    ) {
      latest.set(item.block_id, item);
    }
    if (start < now) {
      continue;
    }
    const currentUpcoming = upcoming.get(item.block_id);
    if (
      currentUpcoming === undefined ||
      Date.parse(currentUpcoming.slot_start) > start
    ) {
      upcoming.set(item.block_id, item);
    }
  }
  const slots = new Map<string, BlockSlot>();
  for (const blockId of new Set([...upcoming.keys(), ...latest.keys()])) {
    const chosen = upcoming.get(blockId) ?? latest.get(blockId);
    if (chosen === undefined) {
      continue;
    }
    slots.set(blockId, {
      slotStart: chosen.slot_start,
      slotEnd: chosen.slot_end,
      gateOpen: chosen.gate_open,
      serviceRatio: chosen.service_ratio_est,
      upcoming: upcoming.has(blockId),
    });
  }
  return slots;
}

function roleForNode(kind: NetworkNodeKind, zone: LossZone | null): string {
  if (kind === "source") {
    return "Sumber";
  }
  if (kind === "gate") {
    return "Pintu air";
  }
  const base = kind === "block" ? "Blok" : "Pertemuan";
  return zone === null ? base : `${base} · ${ZONE_LABELS[zone]}`;
}

function composeBlock(
  block: NetworkBlockResponse,
  zone: LossZone | null,
  sensors: BlockSensorSummary,
  slot: BlockSlot | null,
): BlockSummary {
  const ratio = slot?.serviceRatio ?? null;
  return {
    blockId: block.id,
    nodeId: block.node_id,
    name: block.name,
    areaM2: block.area_m2,
    nominalFlowLps: block.nominal_flow_lps,
    zone,
    serviceRatio: ratio,
    band: ratio === null ? NO_PLAN_BAND : serviceRatioBand(ratio),
    sensors,
    slot,
  };
}

function buildFlow(
  detail: NetworkDetailResponse,
  blockByNodeId: ReadonlyMap<string, BlockSummary>,
  zones: ReadonlyMap<string, LossZone>,
): NetworkFlowModel {
  const placements = layoutNetworkNodes(detail);
  const nodes: NetworkFlowNode[] = detail.nodes.map((node) => {
    const placement = placements.get(node.id) ?? { x: 0, z: 0 };
    const block = blockByNodeId.get(node.id) ?? null;
    const mapped = KIND_BY_NODE_TYPE[node.type];
    const kind: NetworkNodeKind =
      mapped === "block" && block === null ? "junction" : mapped;
    return {
      id: node.id,
      kind,
      x: placement.x * CANVAS_X_SCALE,
      y: placement.z * CANVAS_Y_SCALE,
      data: {
        name: node.name,
        role: roleForNode(kind, zones.get(node.id) ?? null),
        block,
      },
    };
  });
  const edges: NetworkFlowEdge[] = detail.edges.map((edge) => ({
    id: edge.id,
    from: edge.from_node_id,
    to: edge.to_node_id,
    zone: edge.zone,
  }));
  return { nodes, edges };
}

function buildSummary(
  blocks: readonly BlockSummary[],
  telemetry: readonly TelemetryLatestItemResponse[],
): NetworkViewSummary {
  let worst: ReadingQuality | null = null;
  let staleCount = 0;
  for (const item of telemetry) {
    worst = worseQuality(worst, item.quality);
    if (item.stale) {
      staleCount += 1;
    }
  }
  let ratioSum = 0;
  let ratioCount = 0;
  let weakestName: string | null = null;
  let weakestRatio: number | null = null;
  for (const block of blocks) {
    const ratio = block.serviceRatio;
    if (ratio === null) {
      continue;
    }
    ratioSum += ratio;
    ratioCount += 1;
    if (weakestRatio === null || ratio < weakestRatio) {
      weakestRatio = ratio;
      weakestName = block.name;
    }
  }
  return {
    blockCount: blocks.length,
    sensorCount: telemetry.length,
    staleSensorCount: staleCount,
    worstSensorQuality: worst,
    averageServiceRatio: ratioCount === 0 ? null : ratioSum / ratioCount,
    weakestBlockName: weakestName,
    weakestServiceRatio: weakestRatio,
  };
}

export function buildNetworkView(input: BuildNetworkViewInput): NetworkView {
  const now = input.now ?? Date.now();
  const zones = zoneByNodeId(input.detail);
  const sensors = sensorsByBlock(input.telemetry);
  const slots = planSlotByBlock(input.planItems ?? [], now);
  const blocks = input.detail.blocks.map((block) =>
    composeBlock(
      block,
      zones.get(block.node_id) ?? null,
      sensors.get(block.id) ?? NO_SENSORS,
      slots.get(block.id) ?? null,
    ),
  );
  const blockByNodeId = new Map<string, BlockSummary>();
  for (const block of blocks) {
    blockByNodeId.set(block.nodeId, block);
  }
  return {
    blocks,
    flow: buildFlow(input.detail, blockByNodeId, zones),
    summary: buildSummary(blocks, input.telemetry),
  };
}
