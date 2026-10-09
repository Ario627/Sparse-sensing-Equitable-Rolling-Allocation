import { Injectable } from '@nestjs/common';
import type { AuditContext } from '../common/audit/audit-context.ts';
import type { ExperimentStatus, Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import {
  ACTIVE_EXPERIMENT_STATUSES,
  CANCEL_AUDIT_ACTION,
  EXPERIMENT_ENTITY,
  START_AUDIT_ACTION,
} from './experiments.constant.ts';
import {
  EXPERIMENT_DETAIL_SELECT,
  EXPERIMENT_RUN_SELECT,
  EXPERIMENT_SELECT,
  toExperimentDetailRecord,
  toExperimentRecord,
  toMetricRows,
  toProgressJsonInput,
  toRunPersistData,
  toRunRecord,
} from './experiments.selects.ts';
import type {
  ActiveExperimentRecord,
  ExperimentCreateData,
  ExperimentDetailRecord,
  ExperimentListPage,
  ExperimentListQuery,
  ExperimentPollUpdate,
  ExperimentRecord,
  ExperimentRunListPage,
  ExperimentRunListQuery,
} from './experiments.types.ts';

function buildExperimentWhere(
  query: ExperimentListQuery,
): Prisma.ExperimentWhereInput {
  return {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.networkId === undefined ? {} : { networkId: query.networkId }),
  };
}

@Injectable()
export class ExperimentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listExperiments(
    query: ExperimentListQuery,
  ): Promise<ExperimentListPage> {
    const where = buildExperimentWhere(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.experiment.count({ where }),
      this.prisma.experiment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: EXPERIMENT_SELECT,
      }),
    ]);
    return { items: rows.map(toExperimentRecord), total };
  }

  async findExperimentById(id: string): Promise<ExperimentRecord | null> {
    const row = await this.prisma.experiment.findUnique({
      where: { id },
      select: EXPERIMENT_SELECT,
    });
    return row === null ? null : toExperimentRecord(row);
  }

  async findExperimentDetail(
    id: string,
  ): Promise<ExperimentDetailRecord | null> {
    const row = await this.prisma.experiment.findUnique({
      where: { id },
      select: EXPERIMENT_DETAIL_SELECT,
    });
    return row === null ? null : toExperimentDetailRecord(row);
  }

  async listRuns(
    experimentId: string,
    query: ExperimentRunListQuery,
  ): Promise<ExperimentRunListPage> {
    const where: Prisma.ExperimentRunWhereInput = { experimentId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.experimentRun.count({ where }),
      this.prisma.experimentRun.findMany({
        where,
        orderBy: [{ runIndex: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: EXPERIMENT_RUN_SELECT,
      }),
    ]);
    return { items: rows.map(toRunRecord), total };
  }

  async findActiveExperiments(
    limit: number,
  ): Promise<ActiveExperimentRecord[]> {
    const rows = await this.prisma.experiment.findMany({
      where: {
        status: { in: [...ACTIVE_EXPERIMENT_STATUSES] },
        solverExperimentId: { not: null },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        solverExperimentId: true,
        networkId: true,
        status: true,
        runsTotal: true,
        progressJson: true,
      },
    });
    return rows.flatMap((row): ActiveExperimentRecord[] =>
      row.solverExperimentId === null
        ? []
        : [
            {
              id: row.id,
              solverExperimentId: row.solverExperimentId,
              networkId: row.networkId,
              status: row.status,
              runsTotal: row.runsTotal,
              progress: toProgressOf(row.progressJson),
            },
          ],
    );
  }

  async networkExists(networkId: string): Promise<boolean> {
    const network = await this.prisma.irrigationNetwork.findUnique({
      where: { id: networkId },
      select: { id: true },
    });
    return network !== null;
  }

  async createExperiment(data: ExperimentCreateData): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const experiment = await tx.experiment.create({
        data: {
          name: data.name,
          description: data.description,
          networkId: data.networkId,
          configYaml: data.configYaml,
          configHash: data.configHash,
          seedBase: data.seedBase,
          status: data.status,
          solverExperimentId: data.solverExperimentId,
          runsTotal: data.runsTotal,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: data.actorId,
          action: START_AUDIT_ACTION,
          entity: EXPERIMENT_ENTITY,
          entityId: experiment.id,
          after: {
            solver_experiment_id: data.solverExperimentId,
            status: data.status,
            runs_total: data.runsTotal,
            seed_base: data.seedBase,
          },
          ip: data.audit.ip,
          userAgent: data.audit.userAgent,
        },
      });
      return experiment.id;
    });
  }

  async applyPollUpdate(
    experimentId: string,
    update: ExperimentPollUpdate,
    finishedAtFallback: Date | null,
  ): Promise<number> {
    const finishedAt = update.finishedAt ?? finishedAtFallback;
    return this.prisma.$transaction(async (tx) => {
      await tx.experiment.update({
        where: { id: experimentId },
        data: {
          status: update.status,
          ...(update.startedAt === null ? {} : { startedAt: update.startedAt }),
          ...(finishedAt === null ? {} : { finishedAt }),
          ...(update.runsTotal === null ? {} : { runsTotal: update.runsTotal }),
          progressJson: toProgressJsonInput(update),
        },
      });
      for (const run of update.runs) {
        const runData = toRunPersistData(run);
        const runWrite = {
          ...runData,
          status: runData.status as NonNullable<
            Prisma.ExperimentRunUncheckedCreateInput['status']
          >,
        };
        const saved = await tx.experimentRun.upsert({
          where: {
            experimentId_runIndex: { experimentId, runIndex: run.runIndex },
          },
          create: {
            experimentId,
            runIndex: run.runIndex,
            ...runWrite,
          },
          update: runWrite,
          select: { id: true },
        });
        await tx.experimentMetric.deleteMany({ where: { runId: saved.id } });
        const metricRows = toMetricRows(saved.id, run.metrics);
        if (metricRows.length > 0) {
          await tx.experimentMetric.createMany({ data: metricRows });
        }
      }
      return tx.experimentRun.count({ where: { experimentId } });
    });
  }

  async markCancelled(
    experimentId: string,
    actorId: string,
    audit: AuditContext,
    statusBefore: ExperimentStatus,
    solverOutcome: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.experiment.updateMany({
        where: {
          id: experimentId,
          status: { in: [...ACTIVE_EXPERIMENT_STATUSES] },
        },
        data: { status: 'CANCELLED' },
      });
      if (claim.count !== 1) {
        return false;
      }
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: CANCEL_AUDIT_ACTION,
          entity: EXPERIMENT_ENTITY,
          entityId: experimentId,
          before: { status: statusBefore },
          after: { status: 'CANCELLED', solver_outcome: solverOutcome },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
      return true;
    });
  }
}

function toProgressOf(value: Prisma.JsonValue | null) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const runsDone = record.runs_done;
  const polledAt = record.polled_at;
  if (typeof runsDone !== 'number' || typeof polledAt !== 'string') {
    return null;
  }
  const ms = Date.parse(polledAt);
  if (Number.isNaN(ms)) {
    return null;
  }
  return {
    runsDone,
    medianRegret:
      typeof record.median_regret === 'number' ? record.median_regret : null,
    worstSr: typeof record.worst_sr === 'number' ? record.worst_sr : null,
    polledAt: new Date(ms),
  };
}