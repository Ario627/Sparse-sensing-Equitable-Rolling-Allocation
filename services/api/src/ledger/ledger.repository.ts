import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.ts';
import {
  CROP_DEMAND_SELECT,
  LEDGER_BLOCK_SELECT,
  LEDGER_ENTRY_SELECT,
  LEDGER_PREV_SELECT,
  toLedgerEntryRecord,
  type CropDemandRow,
  type LedgerBlockDbRow,
  type LedgerEntryRow,
  type LedgerPrevRow,
} from './ledger.selects.ts';
import type {
  LedgerBlockRow,
  LedgerEntryRecord,
  LedgerHistoryQuery,
  LedgerNetworkRow,
  SettlementWrite,
} from './ledger.types.ts';
import type { CropDemandInput } from './ledger.targets.ts';
import { LEDGER_AUDIT_ACTION, LEDGER_ENTITY } from './ledger.constants.ts';

function dedupeLatestByKey<T, K>(
  rows: readonly T[],
  keyOf: (row: T) => K,
): Map<K, T> {
  const result = new Map<K, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!result.has(key)) {
      result.set(key, row);
    }
  }
  return result;
}

@Injectable()
export class LedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listNetworks(): Promise<LedgerNetworkRow[]> {
    return this.prisma.irrigationNetwork.findMany({
      where: { blocks: { some: {} } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
  }

  async findNetwork(id: string): Promise<LedgerNetworkRow | null> {
    return this.prisma.irrigationNetwork.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
  }

  async loadBlocks(networkId: string): Promise<LedgerBlockRow[]> {
    const rows: LedgerBlockDbRow[] = await this.prisma.block.findMany({
      where: { networkId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: LEDGER_BLOCK_SELECT,
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      nominalFlowLps: row.nominalFlowLps,
      areaM2: row.areaM2,
      node: row.node === null ? null : { orderIdx: row.node.orderIdx },
    }));
  }

  async loadCropDemands(
    blockIds: readonly string[],
  ): Promise<Map<string, CropDemandInput>> {
    if (blockIds.length === 0) {
      return new Map();
    }
    const grouped = await this.prisma.cropState.groupBy({
      by: ['blockId'],
      where: { blockId: { in: [...blockIds] } },
      _max: { ts: true },
    });
    const pairs = grouped.flatMap((row) =>
      row._max.ts === null ? [] : [{ blockId: row.blockId, ts: row._max.ts }],
    );
    if (pairs.length === 0) {
      return new Map();
    }
    const rows: CropDemandRow[] = await this.prisma.cropState.findMany({
      where: { OR: pairs },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      select: CROP_DEMAND_SELECT,
    });
    const byBlock = dedupeLatestByKey(rows, (row) => row.blockId);
    const result = new Map<string, CropDemandInput>();
    for (const [blockId, row] of byBlock) {
      result.set(blockId, {
        blockId,
        etcMmPerDay: row.etcMmPerDay,
        percMmPerDay: row.percMmPerDay,
      });
    }
    return result;
  }

  async findLastSettledEnd(networkId: string): Promise<Date | null> {
    const result = await this.prisma.serviceLedger.aggregate({
      where: { networkId },
      _max: { periodEnd: true },
    });
    return result._max.periodEnd;
  }

  async loadPreviousDebts(networkId: string): Promise<Map<string, number>> {
    const grouped = await this.prisma.serviceLedger.groupBy({
      by: ['blockId'],
      where: { networkId },
      _max: { periodStart: true },
    });
    const pairs = grouped.flatMap((row) =>
      row._max.periodStart === null
        ? []
        : [{ blockId: row.blockId, periodStart: row._max.periodStart }],
    );
    if (pairs.length === 0) {
      return new Map();
    }
    const rows: LedgerPrevRow[] = await this.prisma.serviceLedger.findMany({
      where: { networkId, OR: pairs },
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      select: LEDGER_PREV_SELECT,
    });
    const byBlock = dedupeLatestByKey(rows, (row) => row.blockId);
    return new Map(
      [...byBlock.entries()].map(([blockId, row]) => [blockId, row.debtM3]),
    );
  }

  async sumDeliveredByBlock(
    networkId: string,
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    const grouped = await this.prisma.planItem.groupBy({
      by: ['blockId'],
      where: {
        gateOpen: true,
        slotStart: { gte: from, lt: to },
        plan: { networkId, status: 'EXECUTED' },
      },
      _sum: { volumeDelM3: true },
    });
    return new Map(
      grouped.map((row) => [row.blockId, row._sum.volumeDelM3 ?? 0]),
    );
  }


  async writeSettlement(write: SettlementWrite): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceLedger.createMany({
        data: [...write.rows],
        skipDuplicates: true,
      });
      if (created.count > 0) {
        await tx.auditLog.create({
          data: {
            userId: write.actorId,
            action: LEDGER_AUDIT_ACTION,
            entity: LEDGER_ENTITY,
            entityId: write.networkId,
            after: write.auditAfter,
            ip: write.audit.ip,
            userAgent: write.audit.userAgent,
          },
        });
      }
      return created.count;
    });
  }

  async listLatestEntries(networkId?: string): Promise<LedgerEntryRecord[]> {
    const grouped = await this.prisma.serviceLedger.groupBy({
      by: ['networkId', 'blockId'],
      where: networkId === undefined ? {} : { networkId },
      _max: { periodStart: true },
    });
    const pairs = grouped.flatMap((row) =>
      row._max.periodStart === null
        ? []
        : [
            {
              networkId: row.networkId,
              blockId: row.blockId,
              periodStart: row._max.periodStart,
            },
          ],
    );
    if (pairs.length === 0) {
      return [];
    }
    const rows: LedgerEntryRow[] = await this.prisma.serviceLedger.findMany({
      where: { OR: pairs },
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      select: LEDGER_ENTRY_SELECT,
    });
    const byBlock = dedupeLatestByKey(
      rows,
      (row) => `${row.blockId}:${row.periodStart.toISOString()}`,
    );
    return [...byBlock.values()].map(toLedgerEntryRecord);
  }

  async listHistory(query: LedgerHistoryQuery): Promise<LedgerEntryRecord[]> {
    const rows: LedgerEntryRow[] = await this.prisma.serviceLedger.findMany({
      where: {
        ...(query.networkId === undefined
          ? {}
          : { networkId: query.networkId }),
        ...(query.blockId === undefined ? {} : { blockId: query.blockId }),
        ...(query.from === undefined && query.to === undefined
          ? {}
          : {
              periodStart: {
                ...(query.from === undefined ? {} : { gte: query.from }),
                ...(query.to === undefined ? {} : { lte: query.to }),
              },
            }),
      },
      orderBy: [{ periodStart: query.order }, { id: query.order }],
      take: query.limit,
      select: LEDGER_ENTRY_SELECT,
    });
    return rows.map(toLedgerEntryRecord);
  }
}
