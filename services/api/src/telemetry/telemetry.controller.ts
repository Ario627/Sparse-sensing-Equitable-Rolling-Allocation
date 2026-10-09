import { Controller, Get, Query } from '@nestjs/common';
import {
  telemetryLatestQuerySchema,
  telemetryReadingsQuerySchema,
  type TelemetryLatestQuery,
  type TelemetryReadingsQuery,
  type TelemetryLatestResponse,
  type TelemetryReadingsResponse,
} from '@sera/contracts';

import {
  TelemetryReadService,
  type LatestSensorState,
  type TelemetryReadingItem,
} from './telemetry-read.service.ts';

function toReadingResponse(
  item: TelemetryReadingItem,
): TelemetryReadingsResponse['items'][number] {
  return {
    id: item.id,
    sensor_id: item.sensorId,
    block_id: item.blockId,
    ts: item.ts.toISOString(),
    value: item.value,
    quality: item.quality,
    seq: item.seq,
    received_at: item.receivedAt.toISOString(),
  };
}

function toLatestResponse(
  state: LatestSensorState,
): TelemetryLatestResponse['items'][number] {
  return {
    sensor_id: state.sensorId,
    device_id: state.deviceId,
    type: state.type,
    unit: state.unit,
    node_id: state.nodeId,
    node_name: state.nodeName,
    block_id: state.blockId,
    value: state.value,
    quality: state.quality,
    ts: state.ts === null ? null : state.ts.toISOString(),
    age_s: state.ageS,
    stale: state.stale,
  };
}

@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetryRead: TelemetryReadService) {}

  @Get('readings')
  async readings(
    @Query({ schema: telemetryReadingsQuerySchema })
    query: TelemetryReadingsQuery,
  ): Promise<TelemetryReadingsResponse> {
    const page = await this.telemetryRead.listReadings({
      ...(query.network_id === undefined
        ? {}
        : { networkId: query.network_id }),
      ...(query.sensor_id === undefined ? {} : { sensorId: query.sensor_id }),
      ...(query.block_id === undefined ? {} : { blockId: query.block_id }),
      ...(query.from === undefined ? {} : { from: new Date(query.from) }),
      ...(query.to === undefined ? {} : { to: new Date(query.to) }),
      limit: query.limit,
      order: query.order,
    });
    return {
      items: page.items.map(toReadingResponse),
      from: page.from.toISOString(),
      to: page.to.toISOString(),
      limit: page.limit,
    };
  }

  @Get('latest')
  async latest(
    @Query({ schema: telemetryLatestQuerySchema })
    query: TelemetryLatestQuery,
  ): Promise<TelemetryLatestResponse> {
    const page = await this.telemetryRead.listLatest(query.network_id);
    return {
      items: page.items.map(toLatestResponse),
      stale_threshold_s: page.staleThresholdS,
    };
  }
}