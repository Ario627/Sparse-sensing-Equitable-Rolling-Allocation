import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuditContext } from '../common/audit/audit-context.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import {
  MEMBERSHIP_ASSIGN_AUDIT_ACTION,
  MEMBERSHIP_NOT_FOUND_MESSAGE,
  MEMBERSHIP_REMOVE_AUDIT_ACTION,
  P3A_NOT_FOUND_MESSAGE,
  USER_ENTITY,
  USER_NOT_FOUND_MESSAGE,
} from './users.constant.ts';

export interface MembershipRecord {
  readonly p3aId: string;
  readonly p3aName: string;
  readonly region: string | null;
  readonly role: string;
}

const MEMBERSHIP_SELECT = {
  role: true,
  p3a: { select: { id: true, name: true, region: true } },
} satisfies Prisma.MembershipSelect;

type MembershipRow = Prisma.MembershipGetPayload<{
  select: typeof MEMBERSHIP_SELECT;
}>;

const P3A_TARGET_SELECT = {
  id: true,
  name: true,
  region: true,
} satisfies Prisma.P3ASelect;

type P3aTargetRow = Prisma.P3AGetPayload<{ select: typeof P3A_TARGET_SELECT }>;

function toMembershipRecord(row: MembershipRow): MembershipRecord {
  return {
    p3aId: row.p3a.id,
    p3aName: row.p3a.name,
    region: row.p3a.region,
    role: row.role,
  };
}

function toMembershipFromTarget(
  p3a: P3aTargetRow,
  role: string,
): MembershipRecord {
  return { p3aId: p3a.id, p3aName: p3a.name, region: p3a.region, role };
}

@Injectable()
export class UsersMembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  async assign(
    actorId: string,
    userId: string,
    p3aId: string,
    role: string,
    audit: AuditContext,
  ): Promise<MembershipRecord> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (user === null) {
        throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
      }
      const p3a = await tx.p3A.findUnique({
        where: { id: p3aId },
        select: P3A_TARGET_SELECT,
      });
      if (p3a === null) {
        throw new NotFoundException(P3A_NOT_FOUND_MESSAGE);
      }
      const existing = await tx.membership.findUnique({
        where: { userId_p3aId: { userId, p3aId } },
        select: { role: true },
      });
      if (existing !== null && existing.role === role) {
        return toMembershipFromTarget(p3a, role);
      }
      const membership = await tx.membership.upsert({
        where: { userId_p3aId: { userId, p3aId } },
        create: { userId, p3aId, role },
        update: { role },
        select: MEMBERSHIP_SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: MEMBERSHIP_ASSIGN_AUDIT_ACTION,
          entity: USER_ENTITY,
          entityId: userId,
          ...(existing === null
            ? {}
            : { before: { p3a_id: p3aId, role: existing.role } }),
          after: { p3a_id: p3aId, p3a_name: p3a.name, role },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
      return toMembershipRecord(membership);
    });
  }

  async remove(
    actorId: string,
    userId: string,
    p3aId: string,
    audit: AuditContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findUnique({
        where: { userId_p3aId: { userId, p3aId } },
        select: MEMBERSHIP_SELECT,
      });
      if (existing === null) {
        throw new NotFoundException(MEMBERSHIP_NOT_FOUND_MESSAGE);
      }
      await tx.membership.delete({
        where: { userId_p3aId: { userId, p3aId } },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: MEMBERSHIP_REMOVE_AUDIT_ACTION,
          entity: USER_ENTITY,
          entityId: userId,
          before: {
            p3a_id: p3aId,
            p3a_name: existing.p3a.name,
            role: existing.role,
          },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
    });
  }
}
