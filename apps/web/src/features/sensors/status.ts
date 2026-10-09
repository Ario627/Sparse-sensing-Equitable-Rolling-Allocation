import type {
  ReadingQuality,
  SensorType,
  TelemetryLatestItemResponse,
} from "@sera/contracts";
import type { Tone } from "@/components/kit/status-pill.tsx";

export interface DeviceSummary {
  readonly deviceId: string;
  readonly sensorCount: number;
  readonly staleCount: number;
  readonly staleRatio: number;
  readonly worstQuality: ReadingQuality | null;
  readonly lastSeenIso: string | null;
  readonly types: readonly SensorType[];
  readonly nodeNames: readonly string[];
}

const QUALITY_RANK: Record<ReadingQuality, number> = {
  GOOD: 0,
  SUSPECT: 1,
  BAD: 2,
  STALE: 3,
};

const qualityTones: Record<ReadingQuality, Tone> = {
  GOOD: "ok",
  SUSPECT: "warn",
  BAD: "crit",
  STALE: "crit",
};

const qualityLabels: Record<ReadingQuality, string> = {
  GOOD: "Baik",
  SUSPECT: "Perlu dicek",
  BAD: "Rusak",
  STALE: "Basi",
};

const typeLabels: Record<SensorType, string> = {
  WATER_LEVEL: "Muka air",
  FLOW: "Debit",
  PRESSURE: "Tekanan",
  SOIL_MOISTURE: "Kelembapan tanah",
  GATE_POSITION: "Posisi pintu",
};

const TYPE_ORDER: Record<SensorType, number> = {
  WATER_LEVEL: 0,
  FLOW: 1,
  PRESSURE: 2,
  SOIL_MOISTURE: 3,
  GATE_POSITION: 4,
};

interface DeviceAccumulator {
  sensorCount: number;
  staleCount: number;
  worstQuality: ReadingQuality | null;
  lastSeenIso: string | null;
  types: Set<SensorType>;
  nodeNames: Set<string>;
}

function newAccumulator(): DeviceAccumulator {
  return {
    sensorCount: 0,
    staleCount: 0,
    worstQuality: null,
    lastSeenIso: null,
    types: new Set(),
    nodeNames: new Set(),
  };
}

function isFresher(candidate: string, current: string | null): boolean {
  return current === null || Date.parse(candidate) > Date.parse(current);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function worseQuality(
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

export function sensorQualityTone(quality: ReadingQuality | null): Tone {
  return quality === null ? "neutral" : qualityTones[quality];
}

export function sensorQualityLabel(quality: ReadingQuality | null): string {
  return quality === null ? "Belum ada data" : qualityLabels[quality];
}

export function sensorTypeLabel(type: SensorType): string {
  return typeLabels[type];
}

export function devicesFromLatest(
  items: readonly TelemetryLatestItemResponse[],
): readonly DeviceSummary[] {
  const byDevice = new Map<string, DeviceAccumulator>();
  for (const item of items) {
    const accumulator = byDevice.get(item.device_id) ?? newAccumulator();
    accumulator.sensorCount += 1;
    accumulator.staleCount += item.stale ? 1 : 0;
    accumulator.worstQuality = worseQuality(
      accumulator.worstQuality,
      item.stale ? "STALE" : item.quality,
    );
    if (item.ts !== null && isFresher(item.ts, accumulator.lastSeenIso)) {
      accumulator.lastSeenIso = item.ts;
    }
    accumulator.types.add(item.type);
    if (item.node_name !== null) {
      accumulator.nodeNames.add(item.node_name);
    }
    byDevice.set(item.device_id, accumulator);
  }
  return [...byDevice.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([deviceId, accumulator]) => ({
      deviceId,
      sensorCount: accumulator.sensorCount,
      staleCount: accumulator.staleCount,
      staleRatio: accumulator.staleCount / accumulator.sensorCount,
      worstQuality: accumulator.worstQuality,
      lastSeenIso: accumulator.lastSeenIso,
      types: [...accumulator.types].sort((a, b) => TYPE_ORDER[a] - TYPE_ORDER[b]),
      nodeNames: [...accumulator.nodeNames].sort(compareText),
    }));
}
