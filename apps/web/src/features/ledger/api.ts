import {
  type LedgerEntryResponse,
  type LedgerHistoryQuery,
  ledgerCurrentResponseSchema,
  ledgerHistoryResponseSchema,
} from "@sera/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client.ts";
import { queryKeys } from "@/lib/api/query-keys.ts";

const LEDGER_STALE_MS = 30_000;
const LEDGER_POLL_MS = 60_000;

const defaultHistoryQuery: LedgerHistoryQuery = {
  limit: 240,
  order: "desc",
};

function currentPath(networkId: string | null): string {
  return networkId === null
    ? "/ledger/current"
    : `/ledger/current?network_id=${encodeURIComponent(networkId)}`;
}

function historySearchParams(query: LedgerHistoryQuery): string {
  const params = new URLSearchParams();
  if (query.network_id !== undefined) {
    params.set("network_id", query.network_id);
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

export function useLedgerCurrent(networkId: string | null) {
  return useQuery({
    queryKey: queryKeys.ledger.current(networkId),
    queryFn: () => apiFetch(ledgerCurrentResponseSchema, currentPath(networkId)),
    staleTime: LEDGER_STALE_MS,
    refetchInterval: LEDGER_POLL_MS,
  });
}

export function useLedgerHistory(overrides: Partial<LedgerHistoryQuery> = {}) {
  const query = { ...defaultHistoryQuery, ...overrides };
  return useQuery({
    queryKey: queryKeys.ledger.history(query),
    queryFn: () =>
      apiFetch(
        ledgerHistoryResponseSchema,
        `/ledger/history?${historySearchParams(query)}`,
      ),
    staleTime: LEDGER_STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export interface LedgerPeriodPoint {
  readonly periodEnd: string;
  readonly debtM3: number;
  readonly meanServiceRatio: number;
  readonly blocks: number;
  readonly cappedBlocks: number;
}

export function periodPoints(
  entries: readonly LedgerEntryResponse[],
  limit: number,
): readonly LedgerPeriodPoint[] {
  const byPeriod = new Map<
    string,
    { debt: number; ratio: number; blocks: number; capped: number }
  >();
  for (const entry of entries) {
    const current = byPeriod.get(entry.period_end) ?? {
      debt: 0,
      ratio: 0,
      blocks: 0,
      capped: 0,
    };
    byPeriod.set(entry.period_end, {
      debt: current.debt + entry.debt_m3,
      ratio: current.ratio + entry.service_ratio,
      blocks: current.blocks + 1,
      capped: current.capped + (entry.debt_capped ? 1 : 0),
    });
  }
  return [...byPeriod.entries()]
    .map(([periodEnd, value]) => ({
      periodEnd,
      debtM3: value.debt,
      meanServiceRatio: value.blocks === 0 ? 0 : value.ratio / value.blocks,
      blocks: value.blocks,
      cappedBlocks: value.capped,
    }))
    .sort((a, b) => Date.parse(a.periodEnd) - Date.parse(b.periodEnd))
    .slice(-limit);
}
