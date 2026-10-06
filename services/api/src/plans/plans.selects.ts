import { Prisma } from '../generated/prisma/client.ts';
import type {
  PlanApprovalRecord,
  PlanApprovalSummaryRecord,
  PlanDetailRecord,
  PlanExportRecord,
  PlanItemRecord,
  PlanOverrideRecord,
  PlanOverrideSummaryRecord,
  PlanSummaryRecord,
} from './plans.types.ts';

export function toJsonInput(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null
    ? Prisma.DbNull
    : (value as Prisma.InputJsonValue);
}

interface NewestCandidate {
  readonly id: string;
  readonly createdAt: Date;
}

function isNewer(
  candidate: NewestCandidate,
  current: NewestCandidate,
): boolean {
  const delta = candidate.createdAt.getTime() - current.createdAt.getTime();
  return delta > 0 || (delta === 0 && candidate.id > current.id);
}

function pickNewest<T extends NewestCandidate>(rows: readonly T[]): T | null {
  let newest: T | null = null;
  for (const row of rows) {
    if (newest === null || isNewer(row, newest)) {
      newest = row;
    }
  }
  return newest;
}

const APPROVAL_SUMMARY_SELECT = {
  id: true,
  action: true,
  reason: true,
  createdAt: true,
  user: { select: { fullName: true } },
} satisfies Prisma.ApprovalSelect;

type ApprovalSummaryRow = Prisma.ApprovalGetPayload<{
  select: typeof APPROVAL_SUMMARY_SELECT;
}>;

const OVERRIDE_SUMMARY_SELECT = {
  id: true,
  reason: true,
  createdAt: true,
  user: { select: { fullName: true } },
} satisfies Prisma.OverrideSelect;

type OverrideSummaryRow = Prisma.OverrideGetPayload<{
  select: typeof OVERRIDE_SUMMARY_SELECT;
}>;

export const PLAN_SUMMARY_SELECT = {
  id: true,
  networkId: true,
  status: true,
  profile: true,
  horizonFrom: true,
  horizonTo: true,
  solverName: true,
  solverTimeMs: true,
  mipGap: true,
  createdAt: true,
  updatedAt: true,
  network: { select: { name: true } },
  approvals: {
    select: APPROVAL_SUMMARY_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
  },
  overrides: {
    select: OVERRIDE_SUMMARY_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
  },
  _count: { select: { items: true, overrides: true } },
} satisfies Prisma.PlanSelect;

export type PlanSummaryRow = Prisma.PlanGetPayload<{
  select: typeof PLAN_SUMMARY_SELECT;
}>;

function toApprovalSummary(row: ApprovalSummaryRow): PlanApprovalSummaryRecord {
  return {
    action: row.action,
    userName: row.user.fullName,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function toOverrideSummary(row: OverrideSummaryRow): PlanOverrideSummaryRecord {
  return {
    userName: row.user.fullName,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export function toSummary(row: PlanSummaryRow): PlanSummaryRecord {
  const lastApproval = pickNewest(row.approvals);
  const lastOverride = pickNewest(row.overrides);
  return {
    id: row.id,
    networkId: row.networkId,
    networkName: row.network.name,
    status: row.status,
    profile: row.profile,
    horizonFrom: row.horizonFrom,
    horizonTo: row.horizonTo,
    solverName: row.solverName,
    solverTimeMs: row.solverTimeMs,
    mipGap: row.mipGap,
    itemCount: row._count.items,
    overrideCount: row._count.overrides,
    lastApproval:
      lastApproval === null ? null : toApprovalSummary(lastApproval),
    lastOverride:
      lastOverride === null ? null : toOverrideSummary(lastOverride),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const PLAN_ITEM_SELECT = {
  id: true,
  blockId: true,
  slotStart: true,
  slotEnd: true,
  gateOpen: true,
  volumeDelM3: true,
  volumeGrossM3: true,
  serviceRatioEst: true,
  reasonJson: true,
  block: { select: { name: true } },
} satisfies Prisma.PlanItemSelect;

export type PlanItemRow = Prisma.PlanItemGetPayload<{
  select: typeof PLAN_ITEM_SELECT;
}>;

export function toItemRecord(row: PlanItemRow): PlanItemRecord {
  return {
    id: row.id,
    blockId: row.blockId,
    blockName: row.block.name,
    slotStart: row.slotStart,
    slotEnd: row.slotEnd,
    gateOpen: row.gateOpen,
    volumeDelM3: row.volumeDelM3,
    volumeGrossM3: row.volumeGrossM3,
    serviceRatioEst: row.serviceRatioEst,
    reasonJson: row.reasonJson,
  };
}

export const APPROVAL_SELECT = {
  id: true,
  userId: true,
  action: true,
  reason: true,
  createdAt: true,
  user: { select: { fullName: true, email: true } },
} satisfies Prisma.ApprovalSelect;

export type ApprovalRow = Prisma.ApprovalGetPayload<{
  select: typeof APPROVAL_SELECT;
}>;

export function toApprovalRecord(row: ApprovalRow): PlanApprovalRecord {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.fullName,
    userEmail: row.user.email,
    action: row.action,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export const OVERRIDE_SELECT = {
  id: true,
  userId: true,
  reason: true,
  changesJson: true,
  createdAt: true,
  user: { select: { fullName: true } },
} satisfies Prisma.OverrideSelect;

export type OverrideRow = Prisma.OverrideGetPayload<{
  select: typeof OVERRIDE_SELECT;
}>;

export function toOverrideRecord(row: OverrideRow): PlanOverrideRecord {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.fullName,
    reason: row.reason,
    changes: row.changesJson,
    createdAt: row.createdAt,
  };
}

export const PLAN_DETAIL_SELECT = {
  ...PLAN_SUMMARY_SELECT,
  objectiveJson: true,
  bindingFactors: true,
  items: {
    select: PLAN_ITEM_SELECT,
    orderBy: [{ slotStart: 'asc' }, { blockId: 'asc' }],
  },
  approvals: {
    select: APPROVAL_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  overrides: {
    select: OVERRIDE_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.PlanSelect;

export type PlanDetailRow = Prisma.PlanGetPayload<{
  select: typeof PLAN_DETAIL_SELECT;
}>;

export function toDetail(row: PlanDetailRow): PlanDetailRecord {
  return {
    ...toSummary(row),
    items: row.items.map(toItemRecord),
    approvals: row.approvals.map(toApprovalRecord),
    overrides: row.overrides.map(toOverrideRecord),
    objective: row.objectiveJson,
    bindingFactors: row.bindingFactors,
  };
}

const PLAN_EXPORT_SELECT = {
  id: true,
  status: true,
  profile: true,
  horizonFrom: true,
  horizonTo: true,
  solverName: true,
  solverTimeMs: true,
  mipGap: true,
  createdAt: true,
  updatedAt: true,
  network: { select: { name: true } },
  _count: { select: { items: true, overrides: true } },
} satisfies Prisma.PlanSelect;

type PlanExportRow = Prisma.PlanGetPayload<{
  select: typeof PLAN_EXPORT_SELECT;
}>;

export { PLAN_EXPORT_SELECT };

export function toExportRecord(row: PlanExportRow): PlanExportRecord {
  return {
    id: row.id,
    networkName: row.network.name,
    status: row.status,
    profile: row.profile,
    horizonFrom: row.horizonFrom,
    horizonTo: row.horizonTo,
    itemCount: row._count.items,
    overrideCount: row._count.overrides,
    solverName: row.solverName,
    solverTimeMs: row.solverTimeMs,
    mipGap: row.mipGap,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
