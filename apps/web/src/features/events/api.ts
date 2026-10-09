import {
  eventSchema,
  eventsListResponseSchema,
  eventsStatsResponseSchema,
  type ListEventsQuery,
} from "@sera/contracts";
import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client.ts";
import { queryKeys, queryRoot } from "@/lib/api/query-keys.ts";

const EVENTS_STALE_MS = 10_000;
const STATS_POLL_MS = 30_000;

type EventsFeedQuery = Omit<ListEventsQuery, "page">;

const defaultFeedQuery: EventsFeedQuery = { limit: 20, order: "desc", q: undefined };

function appendFilters(params: URLSearchParams, query: EventsFeedQuery): void {
  if (query.type !== undefined) {
    params.set("type", query.type);
  }
  if (query.severity !== undefined) {
    params.set("severity", query.severity);
  }
  if (query.code !== undefined) {
    params.set("code", query.code);
  }
  if (query.acknowledged !== undefined) {
    params.set("acknowledged", String(query.acknowledged));
  }
  if (query.network_id !== undefined) {
    params.set("network_id", query.network_id);
  }
  if (query.plan_id !== undefined) {
    params.set("plan_id", query.plan_id);
  }
  if (query.q !== undefined) {
    params.set("q", query.q);
  }
  if (query.from !== undefined) {
    params.set("from", query.from);
  }
  if (query.to !== undefined) {
    params.set("to", query.to);
  }
}

function feedPath(query: EventsFeedQuery, page: number): string {
  const params = new URLSearchParams();
  appendFilters(params, query);
  params.set("page", String(page));
  params.set("limit", String(query.limit));
  params.set("order", query.order);
  return `/events?${params.toString()}`;
}

function invalidateEvents(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: [...queryRoot, "events"] });
}

export function useEventsFeed(overrides: Partial<ListEventsQuery> = {}, enabled = true) {
  const { page: initialPage = 1, ...filters } = overrides;
  const query: EventsFeedQuery = { ...defaultFeedQuery, ...filters };
  return useInfiniteQuery({
    queryKey: queryKeys.events.list({ ...query, page: initialPage }),
    queryFn: ({ pageParam }) =>
      apiFetch(eventsListResponseSchema, feedPath(query, pageParam)),
    initialPageParam: initialPage,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    staleTime: EVENTS_STALE_MS,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useEventsStats(enabled = true) {
  return useQuery({
    queryKey: queryKeys.events.stats(),
    queryFn: () => apiFetch(eventsStatsResponseSchema, "/events/stats"),
    refetchInterval: STATS_POLL_MS,
    enabled,
  });
}

export function useAcknowledgeEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) =>
      apiFetch(eventSchema, `/events/${encodeURIComponent(eventId)}/acknowledge`, {
        method: "POST",
      }),
    onSuccess: () => {
      invalidateEvents(client);
    },
  });
}
