import type { SensorCalibration, SensorType } from '@sera/contracts';
import type { AuditContext } from '../common/audit/audit-context.ts';
import type { Prisma } from '../generated/prisma/client.ts';

export interface SensorListQuery {
  readonly networkId?: string;
  readonly nodeId?: string;
  readonly deviceId?: string;
  readonly type?: SensorType;
  readonly isActive?: boolean;
  readonly search?: string;
  readonly page: number;
  readonly limit: number;
}

export interface SensorSummaryRecord {
  readonly id: string;
  readonly deviceId: string;
  readonly networkId: string;
  readonly type: SensorType;
  readonly unit: string;
  readonly isActive: boolean;
  readonly installedAt: Date | null;
  readonly nodeId: string | null;
  readonly nodeName: string | null;
  readonly blockId: string | null;
  readonly blockName: string | null;
  readonly calibrated: boolean;
  readonly calibrationMethod: string | null;
  readonly calibratedAt: Date | null;
  readonly lastReadingAt: Date | null;
  readonly ageS: number | null;
  readonly stale: boolean;
}

export interface SensorDetailRecord extends SensorSummaryRecord {
  readonly calibration: Prisma.JsonValue | null;
}

export interface SensorListPage {
  readonly items: readonly SensorSummaryRecord[];
  readonly total: number;
}

export interface NormalizedCalibrationRecord {
  readonly method: SensorCalibration['method'];
  readonly params: Record<string, number>;
  readonly fit: {
    readonly r2: number | null;
    readonly rmse: number | null;
    readonly points: number | null;
  };
  readonly calibrated_at: string;
  readonly operator: string | null;
  readonly notes: string | null;
}

export interface DeviceAccumulatorRecord {
  readonly deviceId: string;
  readonly networkIds: Set<string>;
  sensorCount: number;
  activeSensorCount: number;
  lastSeenMs: number | null;
}

export interface DeviceSummaryRecord {
  readonly deviceId: string;
  readonly networkIds: readonly string[];
  readonly sensorCount: number;
  readonly activeSensorCount: number;
  readonly lastSeenAt: Date | null;
  readonly ageS: number | null;
  readonly stale: boolean;
}

export interface SensorDevicesRecord {
  readonly items: readonly DeviceSummaryRecord[];
  readonly staleThresholdS: number;
}

export interface CreateSensorInput {
  readonly id?: string;
  readonly networkId: string;
  readonly nodeId: string | null;
  readonly deviceId: string;
  readonly type: SensorType;
  readonly unit: string;
  readonly installedAt: Date | null;
  readonly calibration: SensorCalibration | null;
}

export interface UpdateSensorInput {
  readonly nodeId?: string | null;
  readonly deviceId?: string;
  readonly isActive?: boolean;
  readonly calibration?: SensorCalibration | null;
}

export interface SensorCreateWrite {
  readonly data: Prisma.SensorUncheckedCreateInput;
  readonly auditAction: string;
  readonly auditAfter: Prisma.InputJsonValue;
  readonly actorId: string;
  readonly audit: AuditContext;
}

export interface SensorUpdateWrite {
  readonly sensorId: string;
  readonly data: Prisma.SensorUncheckedUpdateInput;
  readonly auditAction: string;
  readonly auditBefore: Prisma.InputJsonValue;
  readonly auditAfter: Prisma.InputJsonValue;
  readonly actorId: string;
  readonly audit: AuditContext;
}

export type SensorWriteOutcome = 'applied' | 'duplicate' | 'missing';
