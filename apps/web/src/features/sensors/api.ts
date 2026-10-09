import {
  type TelemetryReadingsQuery,
  telemetryLatestResponseSchema,
  telemetryReadingsResponseSchema,
} from "@sera/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client.ts";
import { queryKeys } from "@/lib/api/query-keys.ts";

const LATEST_STALE_MS = 10_000;
const LATEST_POLL_MS = 15_000;
const READINGS_STALE_MS = 30_000;

const defaultReadingsQuery: TelemetryReadingsQuery = {
  limit: 200,
  order: "desc",
};

function latestPath(networkId: string | null): string {
  return networkId === null
    ? "/telemetry/latest"
    : `/telemetry/latest?network_id=${encodeURIComponent(networkId)}`;
}

function readingsSearchParams(query: TelemetryReadingsQuery): string {
  const params = new URLSearchParams();
  if (query.network_id !== undefined) {
    params.set("network_id", query.network_id);
  }
  if (query.sensor_id !== undefined) {
    params.set("sensor_id", query.sensor_id);
  }
  if (query.block_id !== undefined) {
    params.set("block_id", query.block_id);
  }
  if (query.from !== undefined) {
    params.set("from", query.from);
  }
  if (query.to !== undefined) {
    params.set("to", query.to);
  }
  params.set("limit", String(query.limit));
  params.set("order", query.order);
  return params.toString();
}

export function useLatestTelemetry(networkId: string | null = null) {
  return useQuery({
    queryKey: queryKeys.telemetry.latest(networkId),
    queryFn: () => apiFetch(telemetryLatestResponseSchema, latestPath(networkId)),
    staleTime: LATEST_STALE_MS,
    refetchInterval: LATEST_POLL_MS,
  });
}

export function useTelemetryReadings(
  overrides: Partial<TelemetryReadingsQuery> = {},
  enabled = true,
) {
  const query = { ...defaultReadingsQuery, ...overrides };
  return useQuery({
    queryKey: queryKeys.telemetry.readings(query),
    queryFn: () =>
      apiFetch(
        telemetryReadingsResponseSchema,
        `/telemetry/readings?${readingsSearchParams(query)}`,
      ),
    staleTime: READINGS_STALE_MS,
    enabled,
    placeholderData: keepPreviousData,
  });
}
