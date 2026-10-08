import {
  networkDetailSchema,
  networksListResponseSchema,
  type ListNetworksQuery,
} from "@sera/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client.ts";
import { queryKeys } from "@/lib/api/query-keys.ts";

const NETWORK_STALE_MS = 60_000;

const defaultListQuery: ListNetworksQuery = {
  q: undefined,
  page: 1,
  limit: 50,
  sort: "created_at",
  order: "desc",
};

function listSearchParams(query: ListNetworksQuery): string {
  const params = new URLSearchParams();
  if (query.q !== undefined) {
    params.set("q", query.q);
  }
  if (query.topology !== undefined) {
    params.set("topology", query.topology);
  }
  params.set("page", String(query.page));
  params.set("limit", String(query.limit));
  params.set("sort", query.sort);
  params.set("order", query.order);
  return params.toString();
}

export function useNetworks(overrides: Partial<ListNetworksQuery> = {}) {
  const query = { ...defaultListQuery, ...overrides };
  return useQuery({
    queryKey: queryKeys.networks.list(query),
    queryFn: () =>
      apiFetch(
        networksListResponseSchema,
        `/networks?${listSearchParams(query)}`,
      ),
    staleTime: NETWORK_STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export function useNetwork(networkId: string | null) {
  return useQuery({
    queryKey: queryKeys.networks.detail(networkId ?? ""),
    queryFn: () =>
      apiFetch(
        networkDetailSchema,
        `/networks/${encodeURIComponent(networkId ?? "")}`,
      ),
    enabled: networkId !== null,
    staleTime: NETWORK_STALE_MS,
  });
}
