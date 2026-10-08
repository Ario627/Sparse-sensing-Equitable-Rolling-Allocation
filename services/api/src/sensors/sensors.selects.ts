import type { Prisma } from '../generated/prisma/client.ts';
import type {
  DeviceAccumulatorRecord,
  DeviceSummaryRecord,
  NormalizedCalibrationRecord,
  SensorDetailRecord,
  SensorSummaryRecord,
} from './sensors.types.ts';

const MILLISECONDS_PER_SECOND = 1_000;

export const SENSOR_SELECT = {
  id: true,
  deviceId: true,
  networkId: true,
  type: true,
  unit: true,
  isActive: true,
  installedAt: true,
  calibration: true,
  node: {
    select: {
      id: true,
      name: true,
      block: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.SensorSelect;

export type SensorRow = Prisma.SensorGetPayload<{
  select: typeof SENSOR_SELECT;
}>;

function isJsonObject(
  value: Prisma.JsonValue | null,
): value is Record<string, Prisma.JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIsoOrNull(value: string): Date | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function toCalibrationSummary(value: Prisma.JsonValue | null): {
  calibrated: boolean;
  method: string | null;
  calibratedAt: Date | null;
} {
  if (!isJsonObject(value)) {
    return { calibrated: false, method: null, calibratedAt: null };
  }
  const method = typeof value.method === 'string' ? value.method : null;
  const raw = value.calibrated_at;
  const calibratedAt = typeof raw === 'string' ? parseIsoOrNull(raw) : null;
  return { calibrated: true, method, calibratedAt };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function normalizeCalibration(
  input: {
    readonly method: NormalizedCalibrationRecord['method'];
    readonly params: Record<string, number>;
    readonly fit: NormalizedCalibrationRecord['fit'];
    readonly calibrated_at: string | null;
    readonly operator: string | null;
    readonly notes: string | null;
  },
  now: Date,
): NormalizedCalibrationRecord {
  return {
    method: input.method,
    params: input.params,
    fit: input.fit,
    calibrated_at: input.calibrated_at ?? now.toISOString(),
    operator: input.operator,
    notes: input.notes,
  };
}

export function toSensorSummary(
  row: SensorRow,
  lastReadingAt: Date | null,
  nowMs: number,
  staleMs: number,
): SensorSummaryRecord {
  const calibration = toCalibrationSummary(row.calibration);
  const ageMs =
    lastReadingAt === null
      ? null
      : Math.max(0, nowMs - lastReadingAt.getTime());
  return {
    id: row.id,
    deviceId: row.deviceId,
    networkId: row.networkId,
    type: row.type,
    unit: row.unit,
    isActive: row.isActive,
    installedAt: row.installedAt,
    nodeId: row.node?.id ?? null,
    nodeName: row.node?.name ?? null,
    blockId: row.node?.block?.id ?? null,
    blockName: row.node?.block?.name ?? null,
    calibrated: calibration.calibrated,
    calibrationMethod: calibration.method,
    calibratedAt: calibration.calibratedAt,
    lastReadingAt,
    ageS: ageMs === null ? null : Math.round(ageMs / MILLISECONDS_PER_SECOND),
    stale: ageMs === null || ageMs > staleMs,
  };
}

export function toSensorDetail(
  row: SensorRow,
  lastReadingAt: Date | null,
  nowMs: number,
  staleMs: number,
): SensorDetailRecord {
  return {
    ...toSensorSummary(row, lastReadingAt, nowMs, staleMs),
    calibration: row.calibration,
  };
}

export function toDeviceSummary(
  entry: DeviceAccumulatorRecord,
  nowMs: number,
  staleMs: number,
): DeviceSummaryRecord {
  const ageMs =
    entry.lastSeenMs === null ? null : Math.max(0, nowMs - entry.lastSeenMs);
  return {
    deviceId: entry.deviceId,
    networkIds: [...entry.networkIds].sort(),
    sensorCount: entry.sensorCount,
    activeSensorCount: entry.activeSensorCount,
    lastSeenAt: entry.lastSeenMs === null ? null : new Date(entry.lastSeenMs),
    ageS: ageMs === null ? null : Math.round(ageMs / MILLISECONDS_PER_SECOND),
    stale: ageMs === null || ageMs > staleMs,
  };
}
