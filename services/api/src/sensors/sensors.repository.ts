import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { SENSOR_ENTITY } from './sensors.constants.ts';
import {
  SENSOR_SELECT,
  toDeviceSummary,
  toSensorDetail,
  toSensorSummary,
} from './sensors.selects.ts';
import type {
  DeviceAccumulatorRecord,
  DeviceSummaryRecord,
  SensorCreateWrite,
  SensorDetailRecord,
  SensorListPage,
  SensorListQuery,
  SensorUpdateWrite,
  SensorWriteOutcome,
} from './sensors.types.ts';

function buildSensorWhere(query: SensorListQuery): Prisma.SensorWhereInput {
  const search = query.search;
  return {
    ...(query.networkId === undefined ? {} : { networkId: query.networkId }),
    ...(query.nodeId === undefined ? {} : { nodeId: query.nodeId }),
    ...(query.deviceId === undefined ? {} : { deviceId: query.deviceId }),
    ...(query.type === undefined ? {} : { type: query.type }),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(search === undefined
      ? {}
      : {
          OR: [
            { id: { contains: search } },
            { deviceId: { contains: search } },
          ],
        }),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}

@Injectable()
export class SensorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async networkExists(networkId: string): Promise<boolean> {
    const network = await this.prisma.irrigationNetwork.findUnique({
      where: { id: networkId },
      select: { id: true },
    });
    return network !== null;
  }

  async findNodeNetworkId(nodeId: string): Promise<string | null> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { networkId: true },
    });
    return node?.networkId ?? null;
  }

  async listSensors(
    query: SensorListQuery,
    nowMs: number,
    staleMs: number,
  ): Promise<SensorListPage> {
    const where = buildSensorWhere(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sensor.count({ where }),
      this.prisma.sensor.findMany({
        where,
        orderBy: [{ deviceId: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: SENSOR_SELECT,
      }),
    ]);
    const lastBySensor = await this.loadLastReadings(rows.map((row) => row.id));
    return {
      items: rows.map((row) =>
        toSensorSummary(row, lastBySensor.get(row.id) ?? null, nowMs, staleMs),
      ),
      total,
    };
  }

  async findSensorDetail(
    id: string,
    nowMs: number,
    staleMs: number,
  ): Promise<SensorDetailRecord | null> {
    const row = await this.prisma.sensor.findUnique({
      where: { id },
      select: SENSOR_SELECT,
    });
    if (row === null) {
      return null;
    }
    const lastBySensor = await this.loadLastReadings([id]);
    return toSensorDetail(row, lastBySensor.get(id) ?? null, nowMs, staleMs);
  }

  async listDevices(
    networkId: string | undefined,
    nowMs: number,
    staleMs: number,
  ): Promise<DeviceSummaryRecord[]> {
    const sensors = await this.prisma.sensor.findMany({
      where: networkId === undefined ? {} : { networkId },
      select: { id: true, deviceId: true, networkId: true, isActive: true },
      orderBy: [{ deviceId: 'asc' }, { id: 'asc' }],
    });
    if (sensors.length === 0) {
      return [];
    }
    const lastBySensor = await this.loadLastReadings(
      sensors.map((sensor) => sensor.id),
    );
    const accumulators = new Map<string, DeviceAccumulatorRecord>();
    for (const sensor of sensors) {
      const entry = accumulators.get(sensor.deviceId) ?? {
        deviceId: sensor.deviceId,
        networkIds: new Set<string>(),
        sensorCount: 0,
        activeSensorCount: 0,
        lastSeenMs: null,
      };
      entry.networkIds.add(sensor.networkId);
      entry.sensorCount += 1;
      if (sensor.isActive) {
        entry.activeSensorCount += 1;
      }
      const lastSeen = lastBySensor.get(sensor.id);
      if (lastSeen !== undefined) {
        const ms = lastSeen.getTime();
        if (entry.lastSeenMs === null || ms > entry.lastSeenMs) {
          entry.lastSeenMs = ms;
        }
      }
      accumulators.set(sensor.deviceId, entry);
    }
    return [...accumulators.values()]
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId))
      .map((entry) => toDeviceSummary(entry, nowMs, staleMs));
  }

  async createSensor(write: SensorCreateWrite): Promise<SensorWriteOutcome> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.sensor.create({ data: write.data });
        await tx.auditLog.create({
          data: {
            userId: write.actorId,
            action: write.auditAction,
            entity: SENSOR_ENTITY,
            entityId: write.data.id ?? null,
            after: write.auditAfter,
            ip: write.audit.ip,
            userAgent: write.audit.userAgent,
          },
        });
      });
      return 'applied';
    } catch (error) {
      if (isUniqueViolation(error)) {
        return 'duplicate';
      }
      throw error;
    }
  }

  async applyUpdate(write: SensorUpdateWrite): Promise<SensorWriteOutcome> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.sensor.update({
          where: { id: write.sensorId },
          data: write.data,
        });
        await tx.auditLog.create({
          data: {
            userId: write.actorId,
            action: write.auditAction,
            entity: SENSOR_ENTITY,
            entityId: write.sensorId,
            before: write.auditBefore,
            after: write.auditAfter,
            ip: write.audit.ip,
            userAgent: write.audit.userAgent,
          },
        });
      });
      return 'applied';
    } catch (error) {
      if (isRecordNotFound(error)) {
        return 'missing';
      }
      throw error;
    }
  }

  private async loadLastReadings(
    sensorIds: readonly string[],
  ): Promise<Map<string, Date>> {
    if (sensorIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.sensorReading.groupBy({
      by: ['sensorId'],
      where: { sensorId: { in: [...sensorIds] } },
      _max: { ts: true },
    });
    const result = new Map<string, Date>();
    for (const row of rows) {
      if (row._max.ts !== null) {
        result.set(row.sensorId, row._max.ts);
      }
    }
    return result;
  }
}
