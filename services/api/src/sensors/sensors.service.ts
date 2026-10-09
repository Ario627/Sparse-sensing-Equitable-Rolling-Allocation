import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuditContext } from '../common/audit/audit-context.ts';
import type { Env } from '../common/config/env.ts';
import { toJsonInput } from '../common/prisma/json.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import {
  SENSOR_CALIBRATE_AUDIT_ACTION,
  SENSOR_CREATE_AUDIT_ACTION,
  SENSOR_MESSAGES,
  SENSOR_UPDATE_AUDIT_ACTION,
} from './sensors.constants.ts';
import { SensorsRepository } from './sensors.repository.ts';
import { canonicalizeJson, normalizeCalibration } from './sensors.selects.ts';
import type {
  CreateSensorInput,
  NormalizedCalibrationRecord,
  SensorDetailRecord,
  SensorDevicesRecord,
  SensorListPage,
  SensorListQuery,
  UpdateSensorInput,
} from './sensors.types.ts';

const MILLISECONDS_PER_SECOND = 1_000;

interface UpdatePlan {
  readonly deviceChanged: boolean;
  readonly nodeChanged: boolean;
  readonly activeChanged: boolean;
  readonly calibrationChanged: boolean;
  readonly nextDeviceId: string;
  readonly nextNodeId: string | null;
  readonly nextIsActive: boolean;
  readonly nextCalibration: NormalizedCalibrationRecord | null;
}

function sameCalibration(
  current: Prisma.JsonValue | null,
  next: NormalizedCalibrationRecord | null,
): boolean {
  if (current === null && next === null) {
    return true;
  }
  if (current === null || next === null) {
    return false;
  }
  return canonicalizeJson(current) === canonicalizeJson(next);
}

function buildAuditBefore(
  current: SensorDetailRecord,
  plan: UpdatePlan,
): Prisma.InputJsonValue {
  return {
    ...(plan.deviceChanged ? { device_id: current.deviceId } : {}),
    ...(plan.nodeChanged ? { node_id: current.nodeId } : {}),
    ...(plan.activeChanged ? { is_active: current.isActive } : {}),
    ...(plan.calibrationChanged ? { calibration: current.calibration } : {}),
  } as Prisma.InputJsonValue;
}

function buildAuditAfter(plan: UpdatePlan): Prisma.InputJsonValue {
  return {
    ...(plan.deviceChanged ? { device_id: plan.nextDeviceId } : {}),
    ...(plan.nodeChanged ? { node_id: plan.nextNodeId } : {}),
    ...(plan.activeChanged ? { is_active: plan.nextIsActive } : {}),
    ...(plan.calibrationChanged ? { calibration: plan.nextCalibration } : {}),
  } as Prisma.InputJsonValue;
}

@Injectable()
export class SensorsService {
  private readonly staleThresholdS: number;
  private readonly staleMs: number;

  constructor(
    private readonly repository: SensorsRepository,
    config: ConfigService<Env, true>,
  ) {
    this.staleThresholdS = config.get('TELEMETRY_STALE_S', { infer: true });
    this.staleMs = this.staleThresholdS * MILLISECONDS_PER_SECOND;
  }

  list(query: SensorListQuery): Promise<SensorListPage> {
    return this.repository.listSensors(query, Date.now(), this.staleMs);
  }

  async listDevices(networkId?: string): Promise<SensorDevicesRecord> {
    const items = await this.repository.listDevices(
      networkId,
      Date.now(),
      this.staleMs,
    );
    return { items, staleThresholdS: this.staleThresholdS };
  }

  async getById(id: string): Promise<SensorDetailRecord> {
    const sensor = await this.repository.findSensorDetail(
      id,
      Date.now(),
      this.staleMs,
    );
    if (sensor === null) {
      throw new NotFoundException(SENSOR_MESSAGES.notFound);
    }
    return sensor;
  }

  async create(
    actorId: string,
    input: CreateSensorInput,
    audit: AuditContext,
  ): Promise<SensorDetailRecord> {
    if (!(await this.repository.networkExists(input.networkId))) {
      throw new NotFoundException(SENSOR_MESSAGES.networkNotFound);
    }
    if (input.nodeId !== null) {
      await this.assertNodeInNetwork(input.networkId, input.nodeId);
    }
    const now = new Date();
    const calibration: NormalizedCalibrationRecord | null =
      input.calibration === null
        ? null
        : normalizeCalibration(input.calibration, now);
    const sensorId = input.id ?? randomUUID();
    const outcome = await this.repository.createSensor({
      data: {
        id: sensorId,
        networkId: input.networkId,
        nodeId: input.nodeId,
        deviceId: input.deviceId,
        type: input.type,
        unit: input.unit,
        installedAt: input.installedAt,
        calibration: toJsonInput(calibration),
      },
      auditAction: SENSOR_CREATE_AUDIT_ACTION,
      auditAfter: {
        device_id: input.deviceId,
        network_id: input.networkId,
        type: input.type,
        unit: input.unit,
        node_id: input.nodeId,
        calibration_method: calibration?.method ?? null,
        calibrated_at: calibration?.calibrated_at ?? null,
      } as Prisma.InputJsonValue,
      actorId,
      audit,
    });
    if (outcome === 'duplicate') {
      throw new ConflictException(SENSOR_MESSAGES.duplicateId);
    }
    return this.getById(sensorId);
  }

  async update(
    actorId: string,
    sensorId: string,
    changes: UpdateSensorInput,
    audit: AuditContext,
  ): Promise<SensorDetailRecord> {
    const current = await this.repository.findSensorDetail(
      sensorId,
      Date.now(),
      this.staleMs,
    );
    if (current === null) {
      throw new NotFoundException(SENSOR_MESSAGES.notFound);
    }
    const now = new Date();
    const plan = this.buildUpdatePlan(current, changes, now);
    const changedAny =
      plan.deviceChanged ||
      plan.nodeChanged ||
      plan.activeChanged ||
      plan.calibrationChanged;
    if (!changedAny) {
      return current;
    }
    if (plan.nodeChanged && plan.nextNodeId !== null) {
      await this.assertNodeInNetwork(current.networkId, plan.nextNodeId);
    }
    const data: Prisma.SensorUncheckedUpdateInput = {
      ...(plan.deviceChanged ? { deviceId: plan.nextDeviceId } : {}),
      ...(plan.nodeChanged ? { nodeId: plan.nextNodeId } : {}),
      ...(plan.activeChanged ? { isActive: plan.nextIsActive } : {}),
      ...(plan.calibrationChanged
        ? { calibration: toJsonInput(plan.nextCalibration) }
        : {}),
    };
    const calibrationOnly =
      plan.calibrationChanged &&
      !plan.deviceChanged &&
      !plan.nodeChanged &&
      !plan.activeChanged;
    const outcome = await this.repository.applyUpdate({
      sensorId,
      data,
      auditAction: calibrationOnly
        ? SENSOR_CALIBRATE_AUDIT_ACTION
        : SENSOR_UPDATE_AUDIT_ACTION,
      auditBefore: buildAuditBefore(current, plan),
      auditAfter: buildAuditAfter(plan),
      actorId,
      audit,
    });
    if (outcome === 'missing') {
      throw new NotFoundException(SENSOR_MESSAGES.notFound);
    }
    return this.getById(sensorId);
  }

  private async assertNodeInNetwork(
    networkId: string,
    nodeId: string,
  ): Promise<void> {
    const nodeNetworkId = await this.repository.findNodeNetworkId(nodeId);
    if (nodeNetworkId === null) {
      throw new NotFoundException(SENSOR_MESSAGES.nodeNotFound);
    }
    if (nodeNetworkId !== networkId) {
      throw new BadRequestException(SENSOR_MESSAGES.nodeNetworkMismatch);
    }
  }

  private buildUpdatePlan(
    current: SensorDetailRecord,
    changes: UpdateSensorInput,
    now: Date,
  ): UpdatePlan {
    const nextCalibration: NormalizedCalibrationRecord | null | undefined =
      changes.calibration === undefined
        ? undefined
        : changes.calibration === null
          ? null
          : normalizeCalibration(changes.calibration, now);
    return {
      deviceChanged:
        changes.deviceId !== undefined && changes.deviceId !== current.deviceId,
      nodeChanged:
        changes.nodeId !== undefined &&
        (changes.nodeId ?? null) !== current.nodeId,
      activeChanged:
        changes.isActive !== undefined && changes.isActive !== current.isActive,
      calibrationChanged:
        nextCalibration !== undefined &&
        !sameCalibration(current.calibration, nextCalibration),
      nextDeviceId: changes.deviceId ?? current.deviceId,
      nextNodeId:
        changes.nodeId === undefined ? current.nodeId : changes.nodeId,
      nextIsActive: changes.isActive ?? current.isActive,
      nextCalibration: nextCalibration === undefined ? null : nextCalibration,
    };
  }
}
