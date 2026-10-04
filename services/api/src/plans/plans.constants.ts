import type { PlanStatus } from '../generated/prisma/client.ts';

export const HOUR_MS = 3_600_000;
export const FALLBACK_WINDOW_H = 6;
export const FALLBACK_SOLVER_NAME = 'fallback-last-feasible';
export const FALLBACK_ALERT_CODE = 'fallback_active';
export const FALLBACK_PLAN_MESSAGE =
  'Solver unavailable; replaying the last approved schedule';
export const FALLBACK_EVENT_MESSAGE =
  'optimizer unavailable, fallback to the last approved schedule';

export const EVENT_TYPE_ALERT = 'alert';
export const EVENT_TYPE_SYSTEM = 'system';
export const SEVERITY_WARNING = 'warning';

export const AUDIT_ENTITY = 'Plan';
export const PROPOSE_AUDIT_ACTION = 'plan.propose';
export const DECIDE_AUDIT_ACTION = 'plan.decide';
export const OVERRIDE_AUDIT_ACTION = 'plan.override';
export const EXECUTE_AUDIT_ACTION = 'plan.execute';

export const STATUS_PROPOSED: PlanStatus = 'PROPOSED';
export const STATUS_FALLBACK: PlanStatus = 'FALLBACK';
export const STATUS_APPROVED: PlanStatus = 'APPROVED';
export const STATUS_EXECUTED: PlanStatus = 'EXECUTED';
export const STATUS_SUPERSEDED: PlanStatus = 'SUPERSEDED';

export const PENDING_STATUSES: readonly PlanStatus[] = [
  STATUS_PROPOSED,
  STATUS_FALLBACK,
];

export const FALLBACK_SOURCE_STATUSES: readonly PlanStatus[] = [
  STATUS_APPROVED,
  STATUS_EXECUTED,
];

export const PLAN_MESSAGES = {
  networkNotFound: 'Network not found',
  planNotFound: 'Plan not found',
  networkEmpty: 'Network has no blocks to allocate',
  solverUnavailable:
    'Solver is unavailable and no last approved plan exists for fallback',
  solverRejected: 'Solver rejected the plan request',
  solverContract: 'Solver returned an invalid plan',
  planDecided: 'Plan has already been decided',
  planExpired: 'Plan horizon has already passed',
  decisionRaced: 'Plan was decided by another request',
  executeStatus: 'Only approved plans can be executed',
  slotsPassed: 'All plan slots are already in the past',
  noDevice: 'Network has no active device to receive commands',
  noRoute: 'Some blocks have no device that can reach their gate',
  unknownItems: 'Override references unknown plan items',
} as const;
