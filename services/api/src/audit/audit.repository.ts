import { Injectable } from '@nestjs/common';
import type { SortOrder } from '@sera/contracts';
import type { Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { AUDIT_SELECT, toAuditLogRecord } from './audit.selects.ts';
import type {
  AuditFacetsRecord,
  AuditListPage,
  AuditListQuery,
  AuditLogRecord,
} from './audit.types.ts';

function buildAuditWhere(query: AuditListQuery): Prisma.AuditLogWhereInput {
  const createdAt =
    query.from === undefined && query.to === undefined
      ? undefined
      : {
          ...(query.from === undefined ? {} : { gte: query.from }),
          ...(query.to === undefined ? {} : { lte: query.to }),
        };
  const search = query.search;
  return {
    ...(query.action === undefined ? {} : { action: query.action }),
    ...(query.entity === undefined ? {} : { entity: query.entity }),
    ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
    ...(query.userId === undefined ? {} : { userId: query.userId }),
    ...(search === undefined
      ? {}
      : {
          OR: [
            { action: { contains: search, mode: 'insensitive' } },
            { entity: { contains: search, mode: 'insensitive' } },
            { entityId: { contains: search } },
          ],
        }),
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

function buildAuditOrderBy(
  order: SortOrder,
): Prisma.AuditLogOrderByWithRelationInput[] {
  return [{ createdAt: order }, { id: order }];
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAuditLogs(query: AuditListQuery): Promise<AuditListPage> {
    const where = buildAuditWhere(query);
    const orderBy = buildAuditOrderBy(query.order);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: AUDIT_SELECT,
      }),
    ]);
    return { items: rows.map(toAuditLogRecord), total };
  }

  async findAuditLogById(id: string): Promise<AuditLogRecord | null> {
    const row = await this.prisma.auditLog.findUnique({
      where: { id },
      select: AUDIT_SELECT,
    });
    return row === null ? null : toAuditLogRecord(row);
  }

  async loadFacets(): Promise<AuditFacetsRecord> {
    const [actions, entities] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ['action'],
        orderBy: { action: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.auditLog.groupBy({
        by: ['entity'],
        orderBy: { entity: 'asc' },
        _count: { _all: true },
      }),
    ]);
    return {
      actions: actions.map((row) => ({
        value: row.action,
        count: row._count._all,
      })),
      entities: entities.map((row) => ({
        value: row.entity,
        count: row._count._all,
      })),
    };
  }
}
