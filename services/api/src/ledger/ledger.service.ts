import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuditContext } from '../common/audit/audit-context.ts';
import type { Env } from '../common/config/env.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import {
  LEDGER_LOOKBACK_H,
  LEDGER_MAX_PERIODS_PER_TICK,
  LEDGER_MESSAGES,
  LEDGER_STALE_PERIODS,
  MILLISECONDS_PER_HOUR,
  SECONDS_PER_HOUR,
  TARGET_STRATEGY_WATER_BALANCE,
} from './ledger.constants.ts';
import { LedgerRepository } from './ledger.repository.ts';
import { sortEntriesForDisplay, summarizeLedger } from './ledger.selects.ts';
import {
  resolveTargets,
  serviceRatioOf,
  type BlockTarget,
} from './ledger.targets.ts';
import type {
  LedgerCurrentQuery,
  LedgerCurrentRecord,
  LedgerHistoryQuery,
  LedgerHistoryRecord,
  LedgerNetworkRow,
  NetworkSettlement,
  PeriodWindow,
  SettlementResult,
} from './ledger.types.ts';

const DEFAULT_HISTORY_WINDOW_MS = 7 * 24 * MILLISECONDS_PER_HOUR;

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * MILLISECONDS_PER_HOUR);
}

function hoursBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MILLISECONDS_PER_HOUR);
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);
  private readonly periodHours: number;
  private readonly gamma: number;
  private readonly debtMaxM3: number;
  private readonly periodMs: number;
  private readonly staleThresholdS: number;

  constructor(
    private readonly repository: LedgerRepository,
    config: ConfigService<Env, true>,
  ) {
    this.periodHours = config.get('LEDGER_PERIOD_H', { infer: true });
    this.gamma = config.get('LEDGER_GAMMA', { infer: true });
    this.debtMaxM3 = config.get('LEDGER_DEBT_MAX_M3', { infer: true });
    this.periodMs = this.periodHours * MILLISECONDS_PER_HOUR;
    this.staleThresholdS =
      LEDGER_STALE_PERIODS * this.periodHours * SECONDS_PER_HOUR;
  }

  async current(query: LedgerCurrentQuery): Promise<LedgerCurrentRecord> {
    const items = sortEntriesForDisplay(
      await this.repository.listLatestEntries(query.networkId),
    );
    const summary = summarizeLedger(items);
    const periodEnd = items.reduce<Date | null>(
      (latest, item) =>
        latest === null || item.periodEnd.getTime() > latest.getTime()
          ? item.periodEnd
          : latest,
      null,
    );
    const now = Date.now();
    return {
      items,
      summary,
      periodEnd,
      stale:
        periodEnd === null ||
        now - periodEnd.getTime() > this.staleThresholdS * 1_000,
      staleThresholdS: this.staleThresholdS,
    };
  }

  async history(query: LedgerHistoryQuery): Promise<LedgerHistoryRecord> {
    const to = query.to ?? new Date();
    const from =
      query.from ?? new Date(to.getTime() - DEFAULT_HISTORY_WINDOW_MS);
    const items = await this.repository.listHistory({ ...query, from, to });
    return { items, from, to, limit: query.limit };
  }

  async settle(
    actorId: string | null,
    networkId: string | undefined,
    audit: AuditContext,
  ): Promise<SettlementResult> {
    const networks =
      networkId === undefined
        ? await this.repository.listNetworks()
        : await this.resolveNetwork(networkId);
    let periodsSettled = 0;
    let rowsWritten = 0;
    for (const network of networks) {
      const outcome = await this.settleNetwork(network, actorId, audit);
      periodsSettled += outcome.periodsSettled;
      rowsWritten += outcome.rowsWritten;
    }
    return { networks: networks.length, periodsSettled, rowsWritten };
  }

  private async resolveNetwork(networkId: string): Promise<LedgerNetworkRow[]> {
    const network = await this.repository.findNetwork(networkId);
    if (network === null) {
      throw new NotFoundException(LEDGER_MESSAGES.networkNotFound);
    }
    return [network];
  }

  private async settleNetwork(
    network: LedgerNetworkRow,
    actorId: string | null,
    audit: AuditContext,
  ): Promise<NetworkSettlement> {
    const now = new Date();
    const blocks = await this.repository.loadBlocks(network.id);
    if (blocks.length === 0) {
      return {
        periodsSettled: 0,
        rowsWritten: 0,
        waterBalanceBlocks: 0,
        capacityBlocks: 0,
        gapSkippedH: 0,
      };
    }
    const lastEnd = await this.repository.findLastSettledEnd(network.id);
    const floor = addHours(now, -LEDGER_LOOKBACK_H);
    const rawStart = lastEnd ?? floor;
    const start = rawStart.getTime() < floor.getTime() ? floor : rawStart;
    const gapSkippedH =
      lastEnd !== null && rawStart.getTime() < floor.getTime()
        ? hoursBetween(lastEnd, floor)
        : 0;
    const [demands, previousDebts] = await Promise.all([
      this.repository.loadCropDemands(blocks.map((block) => block.id)),
      this.repository.loadPreviousDebts(network.id),
    ]);
    const debtByBlock = new Map(previousDebts);
    const rows: Prisma.ServiceLedgerCreateManyInput[] = [];
    let cursor = start;
    let periodsSettled = 0;
    let waterBalanceBlocks = 0;
    let capacityBlocks = 0;
    while (
      cursor.getTime() + this.periodMs <= now.getTime() &&
      periodsSettled < LEDGER_MAX_PERIODS_PER_TICK
    ) {
      const window: PeriodWindow = {
        periodStart: cursor,
        periodEnd: addHours(cursor, this.periodHours),
      };
      const targets = resolveTargets(blocks, demands, this.periodHours);
      const delivered = await this.repository.sumDeliveredByBlock(
        network.id,
        window.periodStart,
        window.periodEnd,
      );
      for (const target of targets) {
        if (target.strategy === TARGET_STRATEGY_WATER_BALANCE) {
          waterBalanceBlocks += 1;
        } else {
          capacityBlocks += 1;
        }
        rows.push(
          this.buildRow(network.id, target, window, delivered, debtByBlock),
        );
      }
      periodsSettled += 1;
      cursor = window.periodEnd;
    }
    if (rows.length === 0) {
      return {
        periodsSettled: 0,
        rowsWritten: 0,
        waterBalanceBlocks: 0,
        capacityBlocks: 0,
        gapSkippedH,
      };
    }
    const auditAfter = {
      periods: periodsSettled,
      rows: rows.length,
      water_balance_blocks: waterBalanceBlocks,
      capacity_blocks: capacityBlocks,
      gap_skipped_h: gapSkippedH,
      period_hours: this.periodHours,
      gamma: this.gamma,
      debt_max_m3: this.debtMaxM3,
    } as unknown as Prisma.InputJsonValue;
    const rowsWritten = await this.repository.writeSettlement({
      networkId: network.id,
      rows,
      actorId,
      audit,
      auditAfter,
    });
    if (rowsWritten > 0) {
      this.logger.log(
        `ledger settled for ${network.name}: ${periodsSettled} periods, ${rowsWritten} rows`,
      );
    }
    return {
      periodsSettled,
      rowsWritten,
      waterBalanceBlocks,
      capacityBlocks,
      gapSkippedH,
    };
  }

  private buildRow(
    networkId: string,
    target: BlockTarget,
    window: PeriodWindow,
    delivered: ReadonlyMap<string, number>,
    debtByBlock: Map<string, number>,
  ): Prisma.ServiceLedgerCreateManyInput {
    const deliveredM3 = delivered.get(target.blockId) ?? 0;
    const previousDebt = debtByBlock.get(target.blockId) ?? 0;
    const rawDebt =
      this.gamma * previousDebt + (target.targetFairM3 - deliveredM3);
    const debtCapped = rawDebt > this.debtMaxM3;
    const debtM3 = Math.min(Math.max(rawDebt, 0), this.debtMaxM3);
    debtByBlock.set(target.blockId, debtM3);
    return {
      networkId,
      blockId: target.blockId,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      targetReqM3: target.targetReqM3,
      targetFairM3: target.targetFairM3,
      deliveredM3,
      serviceRatio: serviceRatioOf(target.targetFairM3, deliveredM3),
      debtM3,
      debtCapped,
    };
  }
}
