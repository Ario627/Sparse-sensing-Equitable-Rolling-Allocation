import { Injectable, Logger } from '@nestjs/common';
import type { AuditContext } from '../common/audit/audit-context.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import type {
  SolverForecastEntry,
  SolverLedgerEntry,
  SolverStateEntry,
} from '../solver/solver.client.ts';
import {
  AUDIT_ENTITY,
  EXPORT_AUDIT_ACTION,
  EXPORT_MAX_ROWS,
} from './plans.constants.ts';
import { buildPlanOrderBy, buildPlanWhere } from './plans.filters.ts';
import {
  PLAN_DETAIL_SELECT,
  PLAN_EXPORT_SELECT,
  PLAN_SUMMARY_SELECT,
  toDetail,
  toExportRecord,
  toSummary,
} from './plans.selects.ts';
import type {
  FallbackPlanData,
  PlanDetailRecord,
  PlanExportQuery,
  PlanExportRecord,
  PlanListPage,
  PlanListQuery,
  PlanProposalData,
} from './plans.types.ts';

function dedupeByKey<T, K>(rows: readonly T[], keyOf: (row: T) => K): T[] {
  const seen = new Set<K>();
  const result: T[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(row);
    }
  }
  return result;
}

@Injectable()
export class PlansRepository {
  private readonly logger = new Logger(PlansRepository.name);
  constructor(private readonly prisma: PrismaService) {}

  async listPlans(query: PlanListQuery): Promise<PlanListPage> {
    const where = buildPlanWhere(query);
    const orderBy = buildPlanOrderBy(query.sort, query.order);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.plan.count({ where }),
      this.prisma.plan.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: PLAN_SUMMARY_SELECT,
      }),
    ]);
    return { items: rows.map(toSummary), total };
  }

  async findPlanDetail(id: string): Promise<PlanDetailRecord | null> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      select: PLAN_DETAIL_SELECT,
    });
    return plan === null ? null : toDetail(plan);
  }

  async loadProposalData(
    networkId: string,
    from: Date,
    horizonTo: Date,
  ): Promise<PlanProposalData | null> {
    const network = await this.prisma.irrigationNetwork.findUnique({
      where: { id: networkId },
      select: { id: true, name: true, topology: true },
    });
    if (network === null) {
      return null;
    }
    const [nodes, edges, blocks] = await Promise.all([
      this.prisma.node.findMany({
        where: { networkId },
        select: { id: true, type: true, name: true, orderIdx: true },
        orderBy: [{ orderIdx: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.edge.findMany({
        where: { networkId },
        select: {
          id: true,
          fromNodeId: true,
          toNodeId: true,
          capacityLps: true,
          zone: true,
          lengthM: true,
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.block.findMany({
        where: { networkId },
        select: {
          id: true,
          nodeId: true,
          name: true,
          areaM2: true,
          cropType: true,
          nominalFlowLps: true,
          distanceFromSourceM: true,
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    const [ledger, forecasts, state] = await Promise.all([
      this.loadLedger(networkId),
      this.loadForecasts(networkId, from, horizonTo),
      this.loadLatestState(networkId),
    ]);
    return { network, nodes, edges, blocks, ledger, forecasts, state };
  }

  async findFallbackPlan(networkId: string): Promise<FallbackPlanData | null> {
    const source = await this.prisma.plan.findFirst({
      where: { networkId, status: { in: ['APPROVED', 'EXECUTED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        items: {
          select: {
            blockId: true,
            slotStart: true,
            slotEnd: true,
            gateOpen: true,
            volumeDelM3: true,
            volumeGrossM3: true,
            serviceRatioEst: true,
            reasonJson: true,
          },
          orderBy: [{ slotStart: 'asc' }, { blockId: 'asc' }],
        },
      },
    });
    const first = source?.items[0];
    if (source === null || first === undefined) {
      return null;
    }
    return { sourcePlanId: source.id, items: source.items };
  }

  async findExportRows(query: PlanExportQuery): Promise<PlanExportRecord[]> {
    const rows = await this.prisma.plan.findMany({
      where: buildPlanWhere(query),
      orderBy: buildPlanOrderBy(query.sort, query.order),
      take: EXPORT_MAX_ROWS,
      select: PLAN_EXPORT_SELECT,
    });
    return rows.map(toExportRecord);
  }

  async recordExportAudit(
    actorId: string,
    audit: AuditContext,
    query: PlanExportQuery,
    rowCount: number,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: EXPORT_AUDIT_ACTION,
          entity: AUDIT_ENTITY,
          entityId: null,
          after: {
            rows: rowCount,
            filters: {
              network_id: query.networkId ?? null,
              status: query.status ?? null,
              profile: query.profile ?? null,
              block_id: query.blockId ?? null,
              from: query.from?.toISOString() ?? null,
              to: query.to?.toISOString() ?? null,
              sort: query.sort,
              order: query.order,
            },
          },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
    } catch (error) {
      this.logger.warn(`failed to persist export audit: ${String(error)}`);
    }
  }

  private async loadLedger(networkId: string): Promise<SolverLedgerEntry[]> {
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
      return [];
    }
    const rows = await this.prisma.serviceLedger.findMany({
      where: { networkId, OR: pairs },
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      select: {
        blockId: true,
        periodStart: true,
        periodEnd: true,
        targetFairM3: true,
        targetReqM3: true,
        deliveredM3: true,
        serviceRatio: true,
        debtM3: true,
        debtCapped: true,
      },
    });
    return dedupeByKey(rows, (row) => row.blockId).map((row) => ({
      block_id: row.blockId,
      period_start: row.periodStart.toISOString(),
      period_end: row.periodEnd.toISOString(),
      target_fair_m3: row.targetFairM3,
      target_req_m3: row.targetReqM3,
      delivered_m3: row.deliveredM3,
      service_ratio: row.serviceRatio,
      debt_m3: row.debtM3,
      debt_capped: row.debtCapped,
    }));
  }

  private async loadForecasts(
    networkId: string,
    from: Date,
    horizonTo: Date,
  ): Promise<SolverForecastEntry[]> {
    const rows = await this.prisma.weatherForecast.findMany({
      where: {
        networkId,
        validFrom: { lte: horizonTo },
        validTo: { gte: from },
      },
      orderBy: { validFrom: 'asc' },
      take: 48,
      select: {
        validFrom: true,
        validTo: true,
        source: true,
        rainfallMm: true,
        et0Mm: true,
        tempC: true,
      },
    });
    return rows.map((row) => ({
      valid_from: row.validFrom.toISOString(),
      valid_to: row.validTo.toISOString(),
      source: row.source,
      rainfall_mm: row.rainfallMm,
      et0_mm: row.et0Mm,
      temp_c: row.tempC,
    }));
  }

  private async loadLatestState(
    networkId: string,
  ): Promise<SolverStateEntry[] | null> {
    const grouped = await this.prisma.stateEstimate.groupBy({
      by: ['blockId'],
      where: { networkId, blockId: { not: null } },
      _max: { ts: true },
    });
    const pairs = grouped.flatMap((row) =>
      row.blockId === null || row._max.ts === null
        ? []
        : [{ blockId: row.blockId, ts: row._max.ts }],
    );
    if (pairs.length === 0) {
      return null;
    }
    const rows = await this.prisma.stateEstimate.findMany({
      where: { OR: pairs },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      select: {
        blockId: true,
        ts: true,
        confidence: true,
        stateVector: true,
        covariance: true,
        method: true,
      },
    });
    return dedupeByKey(rows, (row) => row.blockId).flatMap((row) =>
      row.blockId === null
        ? []
        : [
            {
              block_id: row.blockId,
              ts: row.ts.toISOString(),
              confidence: row.confidence,
              state: row.stateVector,
              covariance: row.covariance,
              method: row.method,
            },
          ],
    );
  }
}
