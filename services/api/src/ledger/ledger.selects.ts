import type { Prisma } from '../generated/prisma/client.ts';
import type { LedgerEntryRecord, LedgerSummaryRecord } from './ledger.types.ts';
import { DEFAULT_SERVICE_RATIO } from './ledger.constants.ts';

export const LEDGER_ENTRY_SELECT = {
  blockId: true,
  periodStart: true,
  periodEnd: true,
  targetReqM3: true,
  targetFairM3: true,
  deliveredM3: true,
  serviceRatio: true,
  debtM3: true,
  debtCapped: true,
  createdAt: true,
  block: { select: { name: true } },
} satisfies Prisma.ServiceLedgerSelect;

export type LedgerEntryRow = Prisma.ServiceLedgerGetPayload<{
  select: typeof LEDGER_ENTRY_SELECT;
}>;

export const LEDGER_BLOCK_SELECT = {
  id: true,
  name: true,
  nominalFlowLps: true,
  areaM2: true,
  node: { select: { orderIdx: true } },
} satisfies Prisma.BlockSelect;

export type LedgerBlockDbRow = Prisma.BlockGetPayload<{
  select: typeof LEDGER_BLOCK_SELECT;
}>;

export const LEDGER_PREV_SELECT = {
  blockId: true,
  periodStart: true,
  periodEnd: true,
  debtM3: true,
} satisfies Prisma.ServiceLedgerSelect;

export type LedgerPrevRow = Prisma.ServiceLedgerGetPayload<{
  select: typeof LEDGER_PREV_SELECT;
}>;

export const CROP_DEMAND_SELECT = {
  blockId: true,
  etcMmPerDay: true,
  percMmPerDay: true,
} satisfies Prisma.CropStateSelect;

export type CropDemandRow = Prisma.CropStateGetPayload<{
  select: typeof CROP_DEMAND_SELECT;
}>;

export function toLedgerEntryRecord(row: LedgerEntryRow): LedgerEntryRecord {
  return {
    blockId: row.blockId,
    blockName: row.block.name,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    targetReqM3: row.targetReqM3,
    targetFairM3: row.targetFairM3,
    deliveredM3: row.deliveredM3,
    serviceRatio: row.serviceRatio,
    debtM3: row.debtM3,
    debtCapped: row.debtCapped,
    createdAt: row.createdAt,
  };
}

export function summarizeLedger(
  items: readonly LedgerEntryRecord[],
): LedgerSummaryRecord {
  if (items.length === 0) {
    return {
      blockCount: 0,
      worstSr: DEFAULT_SERVICE_RATIO,
      meanSr: DEFAULT_SERVICE_RATIO,
      totalDebtM3: 0,
      cappedBlocks: 0,
    };
  }
  let worstSr = Number.POSITIVE_INFINITY;
  let totalSr = 0;
  let totalDebtM3 = 0;
  let cappedBlocks = 0;
  for (const item of items) {
    worstSr = Math.min(worstSr, item.serviceRatio);
    totalSr += item.serviceRatio;
    totalDebtM3 += item.debtM3;
    if (item.debtCapped) {
      cappedBlocks += 1;
    }
  }
  return {
    blockCount: items.length,
    worstSr,
    meanSr: totalSr / items.length,
    totalDebtM3,
    cappedBlocks,
  };
}

export function sortEntriesForDisplay(
  items: readonly LedgerEntryRecord[],
): LedgerEntryRecord[] {
  return [...items].sort((left, right) => {
    const byName = left.blockName.localeCompare(right.blockName);
    return byName !== 0 ? byName : left.blockId.localeCompare(right.blockId);
  });
}
