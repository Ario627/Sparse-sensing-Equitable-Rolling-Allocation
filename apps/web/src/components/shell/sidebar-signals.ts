import { usePlans } from "@/features/scheduling/api.ts";
import { useLatestTelemetry } from "@/features/sensors/api.ts";

export interface SidebarSignals {
  readonly sensorCount: number;
  readonly staleCount: number;
  readonly pendingPlans: number;
}

export function useSidebarSignals(): SidebarSignals {
  const latest = useLatestTelemetry(null);
  const plans = usePlans({ status: "PROPOSED", limit: 1 });
  const items = latest.data?.items ?? [];
  let stale = 0;
  for (const item of items) {
    if (item.stale) {
      stale += 1;
    }
  }
  return {
    sensorCount: items.length,
    staleCount: stale,
    pendingPlans: plans.data?.total ?? 0,
  };
}
