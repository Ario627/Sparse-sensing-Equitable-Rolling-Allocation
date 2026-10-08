import { Controller, Get, Query } from '@nestjs/common';
import {
  estimatesHistoryQuerySchema,
  estimatesLatestQuerySchema,
  type EstimatesHistoryQuery,
  type EstimatesHistoryResponse,
  type EstimatesLatestQuery,
  type EstimatesLatestResponse,
} from '@sera/contracts';
import {
  EstimatorReadService,
  type BlockStateRecord,
  type EstimatesHistoryRecord,
  type LossStateRecord,
} from './estimator-read.service.ts';

function toStateResponse(
  record: BlockStateRecord,
): EstimatesLatestResponse['items'][number] {
  return {
    block_id: record.blockId,
    block_name: record.blockName,
    storage_mm: record.storageMm,
    level_mm: record.levelMm,
    confidence: record.confidence,
    method: record.method,
    ts: record.ts === null ? null : record.ts.toISOString(),
    age_s: record.ageS,
    stale: record.stale,
    state: record.state,
    covariance: record.covariance,
  };
}

function toLossResponse(
  record: LossStateRecord,
): EstimatesLatestResponse['losses'][number] {
  return {
    zone: record.zone,
    eta_mean: record.etaMean,
    eta_lower: record.etaLower,
    eta_upper: record.etaUpper,
    identified: record.identified,
    valid_from: record.validFrom.toISOString(),
    age_s: record.ageS,
  };
}

function toHistoryResponse(
  record: EstimatesHistoryRecord,
): EstimatesHistoryResponse {
  return {
    items: record.items.map((item) => ({
      block_id: item.blockId,
      ts: item.ts.toISOString(),
      storage_mm: item.storageMm,
      confidence: item.confidence,
    })),
    from: record.from.toISOString(),
    to: record.to.toISOString(),
    limit: record.limit,
  };
}

@Controller('estimates')
export class EstimatorController {
  constructor(private readonly estimatorRead: EstimatorReadService) {}

  @Get('latest')
  async latest(
    @Query({ schema: estimatesLatestQuerySchema })
    query: EstimatesLatestQuery,
  ): Promise<EstimatesLatestResponse> {
    const latest = await this.estimatorRead.listLatest(query.network_id);
    return {
      items: latest.items.map(toStateResponse),
      losses: latest.losses.map(toLossResponse),
      stale_threshold_s: latest.staleThresholdS,
    };
  }

  @Get('history')
  async history(
    @Query({ schema: estimatesHistoryQuerySchema })
    query: EstimatesHistoryQuery,
  ): Promise<EstimatesHistoryResponse> {
    const page = await this.estimatorRead.listHistory({
      ...(query.network_id === undefined
        ? {}
        : { networkId: query.network_id }),
      ...(query.block_id === undefined ? {} : { blockId: query.block_id }),
      ...(query.from === undefined ? {} : { from: new Date(query.from) }),
      ...(query.to === undefined ? {} : { to: new Date(query.to) }),
      limit: query.limit,
      order: query.order,
    });
    return toHistoryResponse(page);
  }
}
