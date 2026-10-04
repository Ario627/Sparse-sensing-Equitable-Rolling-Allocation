import { Prisma } from '../generated/prisma/client.ts';
import type {
  PlanApprovalRecord,
  PlanDetailRecord,
  PlanItemRecord,
  PlanOverrideRecord,
  PlanSummaryRecord,
} from './plans.types.ts';

export function toJsonInput(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null
    ? Prisma.DbNull
    : (value as Prisma.InputJsonValue);
}

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
  _count: { select: { items: true } },
} satisfies Prisma.PlanSelect;

export type PlanSummaryRow = Prisma.PlanGetPayload<{
  select: typeof PLAN_SUMMARY_SELECT;
}>;

export function toSummary(row: PlanSummaryRow): PlanSummaryRecord {
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
