import { estimatesLatestResponseSchema } from "@sera/contracts";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client.ts";
import { queryKeys } from "@/lib/api/query-keys.ts";

const ESTIMATE_STALE_MS = 30_000;
const ESTIMATE_POLL_MS = 60_000;

function latestPath(networkId: string | null): string {
  return networkId === null
    ? "/estimates/latest"
    : `/estimates/latest?network_id=${encodeURIComponent(networkId)}`;
}

export function useLatestEstimates(networkId: string | null = null) {
  return useQuery({
    queryKey: queryKeys.estimates.latest(networkId),
    queryFn: () => apiFetch(estimatesLatestResponseSchema, latestPath(networkId)),
    staleTime: ESTIMATE_STALE_MS,
    refetchInterval: ESTIMATE_POLL_MS,
  });
}

export function meanConfidence(
  items: readonly { readonly confidence: number | null }[],
): number | null {
  let total = 0;
  let count = 0;
  for (const item of items) {
    if (item.confidence === null) {
      continue;
    }
    total += item.confidence;
    count += 1;
  }
  return count === 0 ? null : total / count;
}
