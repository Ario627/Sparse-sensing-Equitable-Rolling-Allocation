import type { AuditContext } from '../common/audit/audit-context.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import type { SortOrder } from '@sera/contracts';

export interface LedgerNetworkRow {
  readonly id: string;
  readonly name: string;
}

export interface LedgerBlockRow {
  readonly id: string;
  readonly name: string;
  readonly nominalFlowLps: number;
  readonly areaM2: number;
  readonly node: { readonly orderIdx: number | null } | null;
}

export interface LedgerEntryRecord {
  readonly blockId: string;
  readonly blockName: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly targetReqM3: number;
  readonly targetFairM3: number;
  readonly deliveredM3: number;
  readonly serviceRatio: number;
  readonly debtM3: number;
  readonly debtCapped: boolean;
  readonly createdAt: Date;
}

export interface LedgerSummaryRecord {
  readonly blockCount: number;
  readonly worstSr: number;
  readonly meanSr: number;
  readonly totalDebtM3: number;
  readonly cappedBlocks: number;
}

export interface LedgerCurrentRecord {
  readonly items: readonly LedgerEntryRecord[];
  readonly summary: LedgerSummaryRecord;
  readonly periodEnd: Date | null;
  readonly stale: boolean;
  readonly staleThresholdS: number;
}

export interface LedgerCurrentQuery {
  readonly networkId?: string;
}

export interface LedgerHistoryQuery {
  readonly networkId?: string;
  readonly blockId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly order: SortOrder;
}

export interface LedgerHistoryRecord {
  readonly items: readonly LedgerEntryRecord[];
  readonly from: Date;
  readonly to: Date;
  readonly limit: number;
}

export interface PeriodWindow {
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

export interface SettlementWrite {
  readonly networkId: string;
  readonly rows: readonly Prisma.ServiceLedgerCreateManyInput[];
  readonly actorId: string | null;
  readonly audit: AuditContext;
  readonly auditAfter: Prisma.InputJsonValue;
}

export interface NetworkSettlement {
  readonly periodsSettled: number;
  readonly rowsWritten: number;
  readonly waterBalanceBlocks: number;
  readonly capacityBlocks: number;
  readonly gapSkippedH: number;
}

export interface SettlementResult {
  readonly networks: number;
  readonly periodsSettled: number;
  readonly rowsWritten: number;
}
