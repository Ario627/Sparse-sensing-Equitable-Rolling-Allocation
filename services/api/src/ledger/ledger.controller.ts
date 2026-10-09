import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ledgerCurrentQuerySchema,
  ledgerHistoryQuerySchema,
  settleLedgerRequestSchema,
  type LedgerCurrentQuery,
  type LedgerCurrentResponse,
  type LedgerEntryResponse,
  type LedgerHistoryQuery,
  type LedgerHistoryResponse,
  type SettleLedgerRequest,
  type SettleLedgerResponse,
} from '@sera/contracts';
import type { Request } from 'express';
import { CurrentUser, Roles } from '../auth/auth.decorators.ts';
import { auditContextFrom } from '../common/audit/audit-context.ts';
import { LedgerService } from './ledger.service.ts';
import type { LedgerEntryRecord } from './ledger.types.ts';
import type { AuthenticatedUser } from '../auth/access-token.ts';

const READ_ROLES = ['OPERATOR', 'RESEARCHER'] as const;
const ADMIN_ROLE = 'ADMIN' as const;
const SETTLE_RATE_LIMIT = { default: { limit: 5, ttl: 60_000 } };

function toEntryResponse(record: LedgerEntryRecord): LedgerEntryResponse {
  return {
    block_id: record.blockId,
    block_name: record.blockName,
    period_start: record.periodStart.toISOString(),
    period_end: record.periodEnd.toISOString(),
    target_req_m3: record.targetReqM3,
    target_fair_m3: record.targetFairM3,
    delivered_m3: record.deliveredM3,
    service_ratio: record.serviceRatio,
    debt_m3: record.debtM3,
    debt_capped: record.debtCapped,
    created_at: record.createdAt.toISOString(),
  };
}

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Roles(...READ_ROLES)
  @Get('current')
  async current(
    @Query({ schema: ledgerCurrentQuerySchema }) query: LedgerCurrentQuery,
  ): Promise<LedgerCurrentResponse> {
    const current = await this.ledgerService.current({
      ...(query.network_id === undefined
        ? {}
        : { networkId: query.network_id }),
    });
    return {
      items: current.items.map(toEntryResponse),
      summary: {
        block_count: current.summary.blockCount,
        worst_sr: current.summary.worstSr,
        mean_sr: current.summary.meanSr,
        total_debt_m3: current.summary.totalDebtM3,
        capped_blocks: current.summary.cappedBlocks,
      },
      period_end:
        current.periodEnd === null ? null : current.periodEnd.toISOString(),
      stale: current.stale,
      stale_threshold_s: current.staleThresholdS,
    };
  }

  @Roles(...READ_ROLES)
  @Get('history')
  async history(
    @Query({ schema: ledgerHistoryQuerySchema }) query: LedgerHistoryQuery,
  ): Promise<LedgerHistoryResponse> {
    const history = await this.ledgerService.history({
      ...(query.network_id === undefined
        ? {}
        : { networkId: query.network_id }),
      ...(query.block_id === undefined ? {} : { blockId: query.block_id }),
      ...(query.from === undefined ? {} : { from: new Date(query.from) }),
      ...(query.to === undefined ? {} : { to: new Date(query.to) }),
      limit: query.limit,
      order: query.order,
    });
    return {
      items: history.items.map(toEntryResponse),
      from: history.from.toISOString(),
      to: history.to.toISOString(),
      limit: history.limit,
    };
  }

  @Roles(ADMIN_ROLE)
  @Post('settle')
  @Throttle(SETTLE_RATE_LIMIT)
  async settle(
    @Body({ schema: settleLedgerRequestSchema }) body: SettleLedgerRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<SettleLedgerResponse> {
    const result = await this.ledgerService.settle(
      actor.id,
      body.network_id,
      auditContextFrom(request),
    );
    return {
      networks: result.networks,
      periods_settled: result.periodsSettled,
      rows_written: result.rowsWritten,
    };
  }
}
