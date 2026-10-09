import { parseStoredPayload } from '../commands/commands.payload.ts';
import type { CommandLogAction, CommandLogStatus } from '@sera/contracts';
import type { StoredCommandPayload } from '../commands/commands.types.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import type {
  CommandLogBaseRecord,
  FeedbackCandidateRecord,
  PlanItemBlockRecord,
} from './plans.command-log.types.ts';

const LOG_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'accepted',
  'rejected',
  'expired',
  'unanswered',
]);

function isLogStatus(value: string): value is CommandLogStatus {
  return LOG_STATUSES.has(value);
}

function isLogAction(value: string): value is CommandLogAction {
  return value === 'open' || value === 'close' || value === 'set_position';
}

export function toCommandLogStatus(value: string): CommandLogStatus {
  return isLogStatus(value) ? value : 'unknown';
}

export function toCommandLogAction(value: string): CommandLogAction | null {
  return isLogAction(value) ? value : null;
}

function toExpiresAt(stored: StoredCommandPayload | null): Date | null {
  if (stored === null) {
    return null;
  }
  const ms = Date.parse(stored.command.expires_at);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export const PLAN_ITEM_BLOCK_SELECT = {
  id: true,
  blockId: true,
  block: { select: { name: true } },
} satisfies Prisma.PlanItemSelect;

export type PlanItemBlockRow = Prisma.PlanItemGetPayload<{
  select: typeof PLAN_ITEM_BLOCK_SELECT;
}>;

export function toPlanItemBlock(row: PlanItemBlockRow): PlanItemBlockRecord {
  return { itemId: row.id, blockId: row.blockId, blockName: row.block.name };
}

export const GATE_COMMAND_LOG_SELECT = {
  commandId: true,
  planItemId: true,
  action: true,
  status: true,
  payload: true,
  issuedAt: true,
  ackedAt: true,
  attempts: true,
  lastAttemptAt: true,
} satisfies Prisma.GateCommandSelect;

export type GateCommandLogRow = Prisma.GateCommandGetPayload<{
  select: typeof GATE_COMMAND_LOG_SELECT;
}>;

export function toCommandLogBase(row: GateCommandLogRow): CommandLogBaseRecord {
  const stored = parseStoredPayload(row.payload);
  return {
    commandId: row.commandId,
    planItemId: row.planItemId,
    action: toCommandLogAction(row.action),
    status: toCommandLogStatus(row.status),
    issuedAt: row.issuedAt,
    ackedAt: row.ackedAt,
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt,
    deviceId: stored?.device_id ?? null,
    expiresAt: toExpiresAt(stored),
    target: stored?.command.target ?? null,
  };
}

export const GATE_FEEDBACK_LOG_SELECT = {
  id: true,
  commandId: true,
  positionPct: true,
  flowLps: true,
  ts: true,
} satisfies Prisma.GateFeedbackSelect;

export type GateFeedbackLogRow = Prisma.GateFeedbackGetPayload<{
  select: typeof GATE_FEEDBACK_LOG_SELECT;
}>;

export function toFeedbackCandidate(
  row: GateFeedbackLogRow,
): FeedbackCandidateRecord | null {
  return row.commandId === null
    ? null
    : {
        id: row.id,
        commandId: row.commandId,
        positionPct: row.positionPct,
        flowLps: row.flowLps,
        ts: row.ts,
      };
}