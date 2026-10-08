import type { AlertSeverity, EventType } from '@sera/contracts';
import type { Prisma } from '../generated/prisma/client.ts';
import type { EventActorRecord, EventRecord } from './events.types.ts';

const EVENT_TYPES: ReadonlySet<string> = new Set([
  'trigger',
  'fallback',
  'alert',
  'system',
]);

const ALERT_SEVERITIES: ReadonlySet<string> = new Set([
  'info',
  'warning',
  'critical',
]);

export const EVENT_SELECT = {
  id: true,
  type: true,
  severity: true,
  message: true,
  networkId: true,
  planId: true,
  payload: true,
  acknowledgedAt: true,
  createdAt: true,
  acknowledgedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.EventSelect;

export type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;

function isEventType(value: string): value is EventType {
  return EVENT_TYPES.has(value);
}

function isAlertSeverity(value: string): value is AlertSeverity {
  return ALERT_SEVERITIES.has(value);
}

export function toEventType(value: string): EventType {
  return isEventType(value) ? value : 'system';
}

export function toAlertSeverity(value: string): AlertSeverity {
  return isAlertSeverity(value) ? value : 'info';
}

function toEventActorRecord(row: {
  readonly id: string;
  readonly fullName: string;
}): EventActorRecord {
  return { id: row.id, fullName: row.fullName };
}

export function toEventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    type: toEventType(row.type),
    severity: toAlertSeverity(row.severity),
    message: row.message,
    networkId: row.networkId,
    planId: row.planId,
    payload: row.payload,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedBy:
      row.acknowledgedBy === null
        ? null
        : toEventActorRecord(row.acknowledgedBy),
    createdAt: row.createdAt,
  };
}
