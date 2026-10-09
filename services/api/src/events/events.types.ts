import type {
  AlertCode,
  AlertSeverity,
  EventType,
  SortOrder,
} from '@sera/contracts';
import type { Prisma } from '../generated/prisma/client.ts';

export interface EventActorRecord {
  readonly id: string;
  readonly fullName: string;
}

export interface EventRecord {
  readonly id: string;
  readonly type: EventType;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly networkId: string | null;
  readonly planId: string | null;
  readonly payload: Prisma.JsonValue | null;
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedBy: EventActorRecord | null;
  readonly createdAt: Date;
}

export interface EventListQuery {
  readonly type?: EventType;
  readonly severity?: AlertSeverity;
  readonly code?: AlertCode;
  readonly acknowledged?: boolean;
  readonly networkId?: string;
  readonly planId?: string;
  readonly search?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly page: number;
  readonly limit: number;
  readonly order: SortOrder;
}

export interface EventListPage {
  readonly items: readonly EventRecord[];
  readonly total: number;
}

export interface EventStats {
  readonly unacknowledged: number;
  readonly bySeverity: {
    readonly info: number;
    readonly warning: number;
    readonly critical: number;
  };
}

export type AcknowledgeOutcome =
  | 'missing'
  | 'not_alert'
  | 'acknowledged'
  | 'already_acknowledged';
