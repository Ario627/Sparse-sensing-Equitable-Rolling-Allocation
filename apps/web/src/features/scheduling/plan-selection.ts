import type {
  PlanItemResponse,
  PlanStatus,
  PlanSummaryResponse,
} from "@sera/contracts";

const ACTIONABLE_STATUSES: readonly PlanStatus[] = ["PROPOSED", "FALLBACK"];

export function isActionableStatus(status: PlanStatus): boolean {
  return ACTIONABLE_STATUSES.includes(status);
}

export function pickActionablePlan(
  items: readonly PlanSummaryResponse[],
): PlanSummaryResponse | null {
  return (
    items.find((plan) => isActionableStatus(plan.status)) ??
    items.find((plan) => plan.status === "APPROVED") ??
    items[0] ??
    null
  );
}

export function nextUpcomingItem(
  items: readonly PlanItemResponse[],
  nowMs: number,
): PlanItemResponse | null {
  let best: PlanItemResponse | null = null;
  let bestStart = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const start = Date.parse(item.slot_start);
    if (!Number.isFinite(start) || start < nowMs) {
      continue;
    }
    if (start < bestStart) {
      bestStart = start;
      best = item;
    }
  }
  return best;
}
