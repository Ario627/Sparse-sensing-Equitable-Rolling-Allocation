import type { PolicyProfile } from '../generated/prisma/client.ts';
import { buildSolverNetwork } from '../solver/network-payload.ts';
import type {
  SolverNetworkPayload,
  SolverPlanItem,
  SolverPlanRequestInput,
  SolverPlanResult,
} from '../solver/solver.client.ts';
import {
  FALLBACK_SOLVER_NAME,
  FALLBACK_WINDOW_H,
  HOUR_MS,
} from './plans.constants.ts';
import type {
  FallbackPlanData,
  FallbackPlanItem,
  PlanProposalData,
} from './plans.types.ts';

export function validatePlanItems(
  items: readonly SolverPlanItem[],
  blockIds: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!blockIds.has(item.block_id)) {
      issues.push(`plan references unknown block ${item.block_id}`);
    }
    const key = `${item.block_id}@${item.slot_start}`;
    if (seen.has(key)) {
      issues.push(`duplicate plan item for ${key}`);
    }
    seen.add(key);
  }
  return issues;
}

function toSolverItem(item: FallbackPlanItem): SolverPlanItem {
  return {
    block_id: item.blockId,
    slot_start: item.slotStart.toISOString(),
    slot_end: item.slotEnd.toISOString(),
    gate_open: item.gateOpen,
    volume_del_m3: item.volumeDelM3,
    volume_gross_m3: item.volumeGrossM3,
    service_ratio_est: item.serviceRatioEst,
    reason: item.reasonJson,
  };
}

export function shiftFallbackPlan(
  source: FallbackPlanData,
  now: Date,
): FallbackPlanData | null {
  const first = source.items[0];
  if (first === undefined) {
    return null;
  }
  const deltaMs = now.getTime() - first.slotStart.getTime();
  const windowEndMs = now.getTime() + FALLBACK_WINDOW_H * HOUR_MS;
  const items = source.items
    .map((item) => ({
      ...item,
      slotStart: new Date(item.slotStart.getTime() + deltaMs),
      slotEnd: new Date(item.slotEnd.getTime() + deltaMs),
    }))
    .filter((item) => item.slotStart.getTime() <= windowEndMs);
  return items.length === 0
    ? null
    : { sourcePlanId: source.sourcePlanId, items };
}

function assembleNetwork(data: PlanProposalData): SolverNetworkPayload {
  return buildSolverNetwork(data.network, data.nodes, data.edges, data.blocks);
}

export function buildSolverRequest(input: {
  readonly data: PlanProposalData;
  readonly profile: PolicyProfile;
  readonly horizonFrom: Date;
  readonly horizonTo: Date;
  readonly slotHours: number;
  readonly horizonHours: number;
}): SolverPlanRequestInput {
  return {
    network: assembleNetwork(input.data),
    ledger: input.data.ledger,
    forecasts: input.data.forecasts,
    state: input.data.state,
    profile: input.profile,
    horizon: {
      from: input.horizonFrom.toISOString(),
      to: input.horizonTo.toISOString(),
      slot_hours: input.slotHours,
    },
    params: {
      slot_hours: input.slotHours,
      horizon_hours: input.horizonHours,
    },
  };
}

export function buildFallbackResult(
  source: FallbackPlanData,
  reason: string,
): SolverPlanResult {
  return {
    schema_version: 1,
    request_id: `fallback-${source.sourcePlanId}`,
    plan_id: null,
    items: source.items.map(toSolverItem),
    scenarios: [],
    objective: {
      fallback: { reason, source_plan_id: source.sourcePlanId },
    },
    binding_factors: null,
    solver_stats: {
      solver: FALLBACK_SOLVER_NAME,
      time_ms: 0,
      mip_gap: null,
    },
  };
}