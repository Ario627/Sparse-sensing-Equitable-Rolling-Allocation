import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.ts';
import type { AuditContext } from '../common/audit/audit-context.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import {
  P3A_CREATE_AUDIT_ACTION,
  P3A_ENTITY,
  P3A_NOT_FOUND_MESSAGE,
  P3A_UPDATE_AUDIT_ACTION,
} from './users.constant.ts';

export interface P3aRecord {
  readonly id: string;
  readonly name: string;
  readonly region: string | null;
  readonly memberCount: number;
  readonly createdAt: Date;
}

const P3A_SELECT = {
  id: true,
  name: true,
  region: true,
  createdAt: true,
  _count: { select: { memberships: true } },
} satisfies Prisma.P3ASelect;

type P3aRow = Prisma.P3AGetPayload<{ select: typeof P3A_SELECT }>;

function toP3aRecord(row: P3aRow): P3aRecord {
    return {
        id: row.id,
        name: row.name,
        region: row.region,
        memberCount: row._count.memberships,
        createdAt: row.createdAt
    }
}

export interface P3aCreateInput {
  readonly name: string;
  readonly region: string | null;
}

export interface P3aUpdateChanges {
  readonly name?: string;
  readonly region?: string | null;
}

@Injectable()
export class P3aService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrganizations(): Promise<readonly P3aRecord[]> {
    const rows = await this.prisma.p3A.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: P3A_SELECT,
    });
    return rows.map(toP3aRecord);
  }

  async create(
    actorId: string,
    input: P3aCreateInput,
    audit: AuditContext,
  ): Promise<P3aRecord> {
    return this.prisma.$transaction(async (tx) => {
      const p3a = await tx.p3A.create({
        data: { name: input.name, region: input.region },
        select: P3A_SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: P3A_CREATE_AUDIT_ACTION,
          entity: P3A_ENTITY,
          entityId: p3a.id,
          after: { name: input.name, region: input.region },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
      return toP3aRecord(p3a);
    });
  }

  async update(
    actorId: string,
    id: string,
    changes: P3aUpdateChanges,
    audit: AuditContext,
  ): Promise<P3aRecord> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.p3A.findUnique({
        where: { id },
        select: P3A_SELECT,
      });
      if (current === null) {
        throw new NotFoundException(P3A_NOT_FOUND_MESSAGE);
      }
      const nextName = changes.name ?? current.name;
      const nextRegion =
        changes.region === undefined ? current.region : changes.region;
      const nameChanged = nextName !== current.name;
      const regionChanged = nextRegion !== current.region;
      if (!nameChanged && !regionChanged) {
        return toP3aRecord(current);
      }
      const updated = await tx.p3A.update({
        where: { id },
        data: {
          ...(nameChanged ? { name: nextName } : {}),
          ...(regionChanged ? { region: nextRegion } : {}),
        },
        select: P3A_SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: P3A_UPDATE_AUDIT_ACTION,
          entity: P3A_ENTITY,
          entityId: id,
          before: {
            ...(nameChanged ? { name: current.name } : {}),
            ...(regionChanged ? { region: current.region } : {}),
          },
          after: {
            ...(nameChanged ? { name: nextName } : {}),
            ...(regionChanged ? { region: nextRegion } : {}),
          },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
      return toP3aRecord(updated);
    });
  }
}