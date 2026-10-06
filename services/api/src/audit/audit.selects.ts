import type { Prisma } from '../generated/prisma/client.ts';
import type { AuditActorRecord, AuditLogRecord } from './audit.types.ts';

export const AUDIT_SELECT = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  before: true,
  after: true,
  ip: true,
  userAgent: true,
  createdAt: true,
  user: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.AuditLogSelect;

export type AuditRow = Prisma.AuditLogGetPayload<{
  select: typeof AUDIT_SELECT;
}>;

function toActorRecord(row: {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
}): AuditActorRecord {
  return { id: row.id, fullName: row.fullName, email: row.email };
}

export function toAuditLogRecord(row: AuditRow): AuditLogRecord {
  return {
    id: row.id,
    actor: row.user === null ? null : toActorRecord(row.user),
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}
