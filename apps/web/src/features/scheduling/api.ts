import {
  planCommandLogResponseSchema,
  planDetailSchema,
  plansListResponseSchema,
  type ExportPlansQuery,
  type ListPlansQuery,
  type PlanDecisionRequest,
  type PlanDetailResponse,
  type PlanOverrideRequest,
  type ProposePlanRequest,
} from "@sera/contracts";
import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch, apiText } from "@/lib/api/client.ts";
import { queryKeys, queryRoot } from "@/lib/api/query-keys.ts";
import { downloadBlob } from "@/lib/csv.ts";

const PLAN_STALE_MS = 15_000;
const COMMAND_POLL_MS = 5_000;
const CSV_MIME = "text/csv;charset=utf-8";
const DEFAULT_EXPORT_FILENAME = "sera-plans.csv";
const BOM = "\uFEFF";

const defaultListQuery: ListPlansQuery = {
  page: 1,
  limit: 20,
  sort: "created_at",
  order: "desc",
};

const defaultExportQuery: ExportPlansQuery = {
  sort: "created_at",
  order: "desc",
};

function appendCommonFilters(
  params: URLSearchParams,
  query: ExportPlansQuery,
): void {
  if (query.network_id !== undefined) {
    params.set("network_id", query.network_id);
  }
  if (query.status !== undefined) {
    params.set("status", query.status);
  }
  if (query.profile !== undefined) {
    params.set("profile", query.profile);
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
  params.set("sort", query.sort);
  params.set("order", query.order);
}

function listSearchParams(query: ListPlansQuery): string {
  const params = new URLSearchParams();
  appendCommonFilters(params, query);
  params.set("page", String(query.page));
  params.set("limit", String(query.limit));
  return params.toString();
}

function exportSearchParams(query: ExportPlansQuery): string {
  const params = new URLSearchParams();
  appendCommonFilters(params, query);
  return params.toString();
}

function invalidatePlans(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: [...queryRoot, "plans"] });
}

function cachePlanDetail(client: QueryClient, plan: PlanDetailResponse): void {
  client.setQueryData(queryKeys.plans.detail(plan.id), plan);
}

export function usePlans(overrides: Partial<ListPlansQuery> = {}) {
  const query = { ...defaultListQuery, ...overrides };
  return useQuery({
    queryKey: queryKeys.plans.list(query),
    queryFn: () =>
      apiFetch(plansListResponseSchema, `/plans?${listSearchParams(query)}`),
    staleTime: PLAN_STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export function usePlan(planId: string) {
  return useQuery({
    queryKey: queryKeys.plans.detail(planId),
    queryFn: () =>
      apiFetch(planDetailSchema, `/plans/${encodeURIComponent(planId)}`),
    staleTime: PLAN_STALE_MS,
  });
}

export function usePlanCommands(planId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.plans.commands(planId),
    queryFn: () =>
      apiFetch(
        planCommandLogResponseSchema,
        `/plans/${encodeURIComponent(planId)}/commands`,
      ),
    enabled,
    refetchInterval: enabled ? COMMAND_POLL_MS : false,
  });
}

export function useProposePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: ProposePlanRequest) =>
      apiFetch(planDetailSchema, "/plans", { method: "POST", body: request }),
    onSuccess: (plan) => {
      cachePlanDetail(client, plan);
      invalidatePlans(client);
    },
  });
}

export function usePlanDecision(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: PlanDecisionRequest) =>
      apiFetch(
        planDetailSchema,
        `/plans/${encodeURIComponent(planId)}/decision`,
        { method: "POST", body: request },
      ),
    onSuccess: (plan) => {
      cachePlanDetail(client, plan);
      invalidatePlans(client);
    },
  });
}

export function usePlanOverride(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: PlanOverrideRequest) =>
      apiFetch(
        planDetailSchema,
        `/plans/${encodeURIComponent(planId)}/override`,
        { method: "POST", body: request },
      ),
    onSuccess: (plan) => {
      cachePlanDetail(client, plan);
      invalidatePlans(client);
    },
  });
}

export function usePlanExecute(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(
        planDetailSchema,
        `/plans/${encodeURIComponent(planId)}/execute`,
        { method: "POST" },
      ),
    onSuccess: (plan) => {
      cachePlanDetail(client, plan);
      invalidatePlans(client);
    },
  });
}

export async function downloadPlansCsv(
  query: ExportPlansQuery,
  filename: string = DEFAULT_EXPORT_FILENAME,
): Promise<void> {
  const merged = { ...defaultExportQuery, ...query };
  const csv = await apiText(`/plans/export?${exportSearchParams(merged)}`);
  const payload = csv.startsWith(BOM) ? csv : `${BOM}${csv}`;
  downloadBlob(filename, new Blob([payload], { type: CSV_MIME }));
}
