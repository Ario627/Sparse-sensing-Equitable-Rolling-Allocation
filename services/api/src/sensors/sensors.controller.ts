import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  createSensorRequestSchema,
  listSensorsQuerySchema,
  sensorDevicesQuerySchema,
  sensorIdSchema,
  updateSensorRequestSchema,
  type CreateSensorRequest,
  type ListSensorsQuery,
  type SensorDevicesQuery,
  type SensorDevicesResponse,
  type SensorDetailResponse,
  type SensorsListResponse,
  type SensorSummaryResponse,
  type UpdateSensorRequest,
} from '@sera/contracts';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/access-token.ts';
import { CurrentUser, Roles } from '../auth/auth.decorators.ts';
import { auditContextFrom } from '../common/audit/audit-context.ts';
import { SensorsService } from './sensors.service.ts';
import type {
  DeviceSummaryRecord,
  SensorDetailRecord,
  SensorSummaryRecord,
} from './sensors.types.ts';
import { SensorDeviceSummaryResponse } from '@sera/contracts';

const ADMIN_ROLE = 'ADMIN' as const;
const WRITE_RATE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

function toSensorResponse(record: SensorSummaryRecord): SensorSummaryResponse {
  return {
    id: record.id,
    device_id: record.deviceId,
    network_id: record.networkId,
    type: record.type,
    unit: record.unit,
    is_active: record.isActive,
    node_id: record.nodeId,
    node_name: record.nodeName,
    block_id: record.blockId,
    block_name: record.blockName,
    installed_at:
      record.installedAt === null ? null : record.installedAt.toISOString(),
    calibrated: record.calibrated,
    calibration_method: record.calibrationMethod,
    calibrated_at:
      record.calibratedAt === null ? null : record.calibratedAt.toISOString(),
    last_reading_at:
      record.lastReadingAt === null ? null : record.lastReadingAt.toISOString(),
    age_s: record.ageS,
    stale: record.stale,
  };
}

function toSensorDetailResponse(
  record: SensorDetailRecord,
): SensorDetailResponse {
  return { ...toSensorResponse(record), calibration: record.calibration };
}

function toDeviceResponse(
  record: DeviceSummaryRecord,
): SensorDeviceSummaryResponse {
  return {
    device_id: record.deviceId,
    network_ids: [...record.networkIds],
    sensor_count: record.sensorCount,
    active_sensor_count: record.activeSensorCount,
    last_seen_at:
      record.lastSeenAt === null ? null : record.lastSeenAt.toISOString(),
    age_s: record.ageS,
    stale: record.stale,
  };
}

@Controller('sensors')
export class SensorsController {
  constructor(private readonly sensorsService: SensorsService) {}

  @Get()
  async list(
    @Query({ schema: listSensorsQuerySchema }) query: ListSensorsQuery,
  ): Promise<SensorsListResponse> {
    const page = await this.sensorsService.list({
      ...(query.network_id === undefined
        ? {}
        : { networkId: query.network_id }),
      ...(query.node_id === undefined ? {} : { nodeId: query.node_id }),
      ...(query.device_id === undefined ? {} : { deviceId: query.device_id }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.is_active === undefined ? {} : { isActive: query.is_active }),
      ...(query.q === undefined ? {} : { search: query.q }),
      page: query.page,
      limit: query.limit,
    });
    return {
      items: page.items.map(toSensorResponse),
      page: query.page,
      limit: query.limit,
      total: page.total,
      total_pages: Math.max(1, Math.ceil(page.total / query.limit)),
    };
  }

  @Get('devices')
  async devices(
    @Query({ schema: sensorDevicesQuerySchema }) query: SensorDevicesQuery,
  ): Promise<SensorDevicesResponse> {
    const page = await this.sensorsService.listDevices(query.network_id);
    return {
      items: page.items.map(toDeviceResponse),
      stale_threshold_s: page.staleThresholdS,
    };
  }

  @Get(':id')
  async detail(
    @Param('id', { schema: sensorIdSchema }) id: string,
  ): Promise<SensorDetailResponse> {
    return toSensorDetailResponse(await this.sensorsService.getById(id));
  }

  @Roles(ADMIN_ROLE)
  @Post()
  @Throttle(WRITE_RATE_LIMIT)
  async create(
    @Body({ schema: createSensorRequestSchema }) body: CreateSensorRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<SensorDetailResponse> {
    const created = await this.sensorsService.create(
      actor.id,
      {
        ...(body.id === undefined ? {} : { id: body.id }),
        networkId: body.network_id,
        nodeId: body.node_id ?? null,
        deviceId: body.device_id,
        type: body.type,
        unit: body.unit,
        installedAt:
          body.installed_at === undefined || body.installed_at === null
            ? null
            : new Date(body.installed_at),
        calibration: body.calibration ?? null,
      },
      auditContextFrom(request),
    );
    return toSensorDetailResponse(created);
  }

  @Roles(ADMIN_ROLE)
  @Patch(':id')
  @Throttle(WRITE_RATE_LIMIT)
  async update(
    @Param('id', { schema: sensorIdSchema }) id: string,
    @Body({ schema: updateSensorRequestSchema }) body: UpdateSensorRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<SensorDetailResponse> {
    const updated = await this.sensorsService.update(
      actor.id,
      id,
      {
        ...(body.node_id === undefined ? {} : { nodeId: body.node_id }),
        ...(body.device_id === undefined ? {} : { deviceId: body.device_id }),
        ...(body.is_active === undefined ? {} : { isActive: body.is_active }),
        ...(body.calibration === undefined
          ? {}
          : { calibration: body.calibration }),
      },
      auditContextFrom(request),
    );
    return toSensorDetailResponse(updated);
  }
}
