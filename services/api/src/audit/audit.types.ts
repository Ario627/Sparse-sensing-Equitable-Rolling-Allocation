import type { SortOrder } from '@sera/contracts';
import type { Prisma } from '../generated/prisma/client.ts';

export interface AuditActorRecord {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
}

export interface AuditLogRecord {
  readonly id: string;
  readonly actor: AuditActorRecord | null;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string | null;
  readonly before: Prisma.JsonValue | null;
  readonly after: Prisma.JsonValue | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
}

export interface AuditListQuery {
  readonly action?: string;
  readonly entity?: string;
  readonly entityId?: string;
  readonly userId?: string;
  readonly search?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly page: number;
  readonly limit: number;
  readonly order: SortOrder;
}

export interface AuditListPage {
  readonly items: readonly AuditLogRecord[];
  readonly total: number;
}

export interface AuditFacetRecord {
  readonly value: string;
  readonly count: number;
}

export interface AuditFacetsRecord {
  readonly actions: readonly AuditFacetRecord[];
  readonly entities: readonly AuditFacetRecord[];
}
