import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReadingQuality, SensorType, SortOrder } from '@sera/contracts';
import type { Env } from '../common/config/env.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';

const DEFAULT_WINDOW_MS = 24 * 3_600_000;
const MILLISECONDS_PER_SECOND = 1_000;

const SENSOR_SELECT = {
  id: true,
  deviceId: true,
  type: true,
  unit: true,
  node: {
    select: {
      id: true,
      name: true,
      orderIdx: true,
      block: { select: { id: true } },
    },
  },
} satisfies Prisma.SensorSelect;

const READING_SELECT = {
  id: true,
  sensorId: true,
  blockId: true,
  ts: true,
  value: true,
  quality: true,
  seq: true,
  receivedAt: true,
} satisfies Prisma.SensorReadingSelect;

type SensorRow = Prisma.SensorGetPayload<{ select: typeof SENSOR_SELECT }>;
type ReadingRow = Prisma.SensorReadingGetPayload<{
  select: typeof READING_SELECT;
}>;

interface LatestReadingRow {
  readonly sensorId: string;
  readonly ts: Date;
  readonly value: number;
  readonly quality: ReadingQuality;
  readonly seq: number | null;
}

export interface ReadingsQuery {
  readonly networkId?: string;
  readonly sensorId?: string;
  readonly blockId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly order: SortOrder;
}

export interface TelemetryReadingItem {
  readonly id: string;
  readonly sensorId: string;
  readonly blockId: string | null;
  readonly ts: Date;
  readonly value: number;
  readonly quality: ReadingQuality;
  readonly seq: number | null;
  readonly receivedAt: Date;
}

export interface TelemetryReadingsPage {
  readonly items: readonly TelemetryReadingItem[];
  readonly from: Date;
  readonly to: Date;
  readonly limit: number;
}

export interface LatestSensorState {
  readonly sensorId: string;
  readonly deviceId: string;
  readonly type: SensorType;
  readonly unit: string;
  readonly nodeId: string | null;
  readonly nodeName: string | null;
  readonly blockId: string | null;
  readonly value: number | null;
  readonly quality: ReadingQuality | null;
  readonly ts: Date | null;
  readonly ageS: number | null;
  readonly stale: boolean;
}

export interface TelemetryLatestPage {
  readonly items: readonly LatestSensorState[];
  readonly staleThresholdS: number;
}

function toReadingItem(row: ReadingRow): TelemetryReadingItem {
  return {
    id: row.id.toString(),
    sensorId: row.sensorId,
    blockId: row.blockId,
    ts: row.ts,
    value: row.value,
    quality: row.quality,
    seq: row.seq,
    receivedAt: row.receivedAt,
  };
}

function toLatestState(
    sensor: SensorRow,
    reading: LatestReadingRow | null,
    nowMs: number,
    staleMs: number,
): LatestSensorState {
    const ts = reading?.ts ?? null;
    const ageMs = ts === null ? null : Math.max(0, nowMs - ts.getTime());
    return {
      sensorId: sensor.id,
      deviceId: sensor.deviceId,
      type: sensor.type,
      unit: sensor.unit,
      nodeId: sensor.node?.id ?? null,
      nodeName: sensor.node?.name ?? null,
      blockId: sensor.node?.block?.id ?? null,
      value: reading?.value ?? null,
      quality: reading?.quality ?? null,
      ts,
      ageS: ageMs === null ? null : Math.round(ageMs / MILLISECONDS_PER_SECOND),
      stale: ageMs === null || ageMs > staleMs,
    };
}


function compareSensorRows(a: SensorRow, b: SensorRow): number {
  const aIndex = a.node?.orderIdx ?? Number.MAX_SAFE_INTEGER;
  const bIndex = b.node?.orderIdx ?? Number.MAX_SAFE_INTEGER;
  if (aIndex !== bIndex) {
    return aIndex - bIndex;
  }
  const deviceOrder = a.deviceId.localeCompare(b.deviceId);
  return deviceOrder !== 0 ? deviceOrder : a.id.localeCompare(b.id);
}


@Injectable()
export class TelemetryReadService {
  private readonly staleThresholdS: number;
  private readonly staleMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.staleThresholdS = config.get('TELEMETRY_STALE_S', { infer: true });
    this.staleMs = this.staleThresholdS * MILLISECONDS_PER_SECOND;
  }

  async listReadings(query: ReadingsQuery): Promise<TelemetryReadingsPage> {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_WINDOW_MS);
    const scope = await this.resolveScope(query);
    const rows = await this.prisma.sensorReading.findMany({
      where: {
        ...scope,
        ...(query.blockId === undefined ? {} : { blockId: query.blockId }),
        ts: { gte: from, lte: to },
      },
      orderBy: [{ ts: query.order }, { id: query.order }],
      take: query.limit,
      select: READING_SELECT,
    });
    return {
      items: rows.map(toReadingItem),
      from,
      to,
      limit: query.limit,
    };
  }

  async listLatest(networkId?: string): Promise<TelemetryLatestPage> {
    const sensors = await this.prisma.sensor.findMany({
      where: {
        isActive: true,
        ...(networkId === undefined ? {} : { networkId }),
      },
      select: SENSOR_SELECT,
    });
    const latestBySensor = await this.loadLatestReadings(
      sensors.map((sensor) => sensor.id),
    );
    const nowMs = Date.now();
    const items = [...sensors]
      .sort(compareSensorRows)
      .map((sensor) =>
        toLatestState(
          sensor,
          latestBySensor.get(sensor.id) ?? null,
          nowMs,
          this.staleMs,
        ),
      );
    return { items, staleThresholdS: this.staleThresholdS };
  }

  private async resolveScope(
    query: ReadingsQuery,
  ): Promise<Prisma.SensorReadingWhereInput> {
    if (query.sensorId !== undefined) {
      return query.networkId === undefined
        ? { sensorId: query.sensorId }
        : { sensorId: query.sensorId, sensor: { networkId: query.networkId } };
    }
    if (query.networkId === undefined) {
      return {};
    }
    const sensors = await this.prisma.sensor.findMany({
      where: { networkId: query.networkId },
      select: { id: true },
    });
    return { sensorId: { in: sensors.map((sensor) => sensor.id) } };
  }

  private async loadLatestReadings(
    sensorIds: readonly string[],
  ): Promise<Map<string, LatestReadingRow>> {
    if (sensorIds.length === 0) {
      return new Map();
    }
    const grouped = await this.prisma.sensorReading.groupBy({
      by: ['sensorId'],
      where: { sensorId: { in: [...sensorIds] } },
      _max: { ts: true },
    });
    const pairs = grouped.flatMap((row) =>
      row._max.ts === null ? [] : [{ sensorId: row.sensorId, ts: row._max.ts }],
    );
    if (pairs.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.sensorReading.findMany({
      where: { OR: pairs },
      orderBy: [{ seq: { sort: 'desc', nulls: 'last' } }],
      select: {
        sensorId: true,
        ts: true,
        value: true,
        quality: true,
        seq: true,
      },
    });
    const bySensor = new Map<string, LatestReadingRow>();
    for (const row of rows) {
      if (!bySensor.has(row.sensorId)) {
        bySensor.set(row.sensorId, row);
      }
    }
    return bySensor;
  }
}