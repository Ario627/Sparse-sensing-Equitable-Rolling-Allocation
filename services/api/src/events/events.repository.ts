import { Injectable } from '@nestjs/common';
import type { SortOrder } from '@sera/contracts';
import type { AuditContext } from '../common/audit/audit-context.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import {
  ACKNOWLEDGE_AUDIT_ACTION,
  EVENT_ENTITY,
  EVENT_TYPE_ALERT,
} from './events.constants.ts';
import {
  EVENT_SELECT,
  toAlertSeverity,
  toEventRecord,
} from './events.selects.ts';
import type {
  AcknowledgeOutcome,
  EventListPage,
  EventListQuery,
  EventRecord,
  EventStats,
} from './events.types.ts';

function buildEventWhere(query: EventListQuery): Prisma.EventWhereInput {
  const createdAt =
    query.from === undefined && query.to === undefined
      ? undefined
      : {
          ...(query.from === undefined ? {} : { gte: query.from }),
          ...(query.to === undefined ? {} : { lte: query.to }),
        };
  return {
    ...(query.type === undefined ? {} : { type: query.type }),
    ...(query.severity === undefined ? {} : { severity: query.severity }),
    ...(query.acknowledged === undefined
      ? {}
      : { acknowledgedAt: query.acknowledged ? { not: null } : null }),
    ...(query.networkId === undefined ? {} : { networkId: query.networkId }),
    ...(query.planId === undefined ? {} : { planId: query.planId }),
    ...(query.code === undefined
      ? {}
      : { payload: { path: ['code'], equals: query.code } }),
    ...(query.search === undefined
      ? {}
      : { message: { contains: query.search, mode: 'insensitive' } }),
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

function buildEventOrderBy(
  order: SortOrder,
): Prisma.EventOrderByWithRelationInput[] {
  return [{ createdAt: order }, { id: order }];
}

@Injectable()
export class EventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listEvents(query: EventListQuery): Promise<EventListPage> {
    const where = buildEventWhere(query);
    const orderBy = buildEventOrderBy(query.order);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.event.count({ where }),
      this.prisma.event.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: EVENT_SELECT,
      }),
    ]);
    return { items: rows.map(toEventRecord), total };
  }

  async findEventById(id: string): Promise<EventRecord | null> {
    const row = await this.prisma.event.findUnique({
      where: { id },
      select: EVENT_SELECT,
    });
    return row === null ? null : toEventRecord(row);
  }

  async loadStats(): Promise<EventStats> {
    const rows = await this.prisma.event.groupBy({
      by: ['severity'],
      where: { type: EVENT_TYPE_ALERT, acknowledgedAt: null },
      _count: { _all: true },
    });
    const bySeverity = { info: 0, warning: 0, critical: 0 };
    let unacknowledged = 0;
    for (const row of rows) {
      const count = row._count._all;
      unacknowledged += count;
      bySeverity[toAlertSeverity(row.severity)] += count;
    }
    return { unacknowledged, bySeverity };
  }

  async acknowledgeAlert(
    id: string,
    actorId: string,
    audit: AuditContext,
    now: Date,
  ): Promise<AcknowledgeOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({
        where: { id },
        select: { id: true, type: true, acknowledgedAt: true },
      });
      if (event === null) {
        return 'missing';
      }
      if (event.type !== EVENT_TYPE_ALERT) {
        return 'not_alert';
      }
      if (event.acknowledgedAt !== null) {
        return 'already_acknowledged';
      }
      const claim = await tx.event.updateMany({
        where: { id, acknowledgedAt: null },
        data: { acknowledgedAt: now, acknowledgedByUserId: actorId },
      });
      if (claim.count !== 1) {
        return 'already_acknowledged';
      }
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: ACKNOWLEDGE_AUDIT_ACTION,
          entity: EVENT_ENTITY,
          entityId: id,
          after: { acknowledged_at: now.toISOString() },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
      return 'acknowledged';
    });
  }
}
