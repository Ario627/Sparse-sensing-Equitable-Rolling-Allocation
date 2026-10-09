import {
  type CreateExperimentRequest,
  type ExperimentStatus,
  experimentDetailSchema,
  experimentRunsResponseSchema,
  experimentsListResponseSchema,
  type ListExperimentRunsQuery,
  type ListExperimentsQuery,
} from "@sera/contracts";
import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client.ts";
import { queryKeys, queryRoot } from "@/lib/api/query-keys.ts";

const LIST_STALE_MS = 15_000;
const RUNS_STALE_MS = 30_000;
const PROGRESS_POLL_MS = 10_000;

const defaultListQuery: ListExperimentsQuery = { page: 1, limit: 20 };
const defaultRunsQuery: ListExperimentRunsQuery = { page: 1, limit: 20 };

function isLive(status: ExperimentStatus | undefined): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

function listSearchParams(query: ListExperimentsQuery): string {
  const params = new URLSearchParams();
  if (query.status !== undefined) {
    params.set("status", query.status);
  }
  if (query.network_id !== undefined) {
    params.set("network_id", query.network_id);
  }
  params.set("page", String(query.page));
  params.set("limit", String(query.limit));
  return params.toString();
}

function runsSearchParams(query: ListExperimentRunsQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("limit", String(query.limit));
  return params.toString();
}

function invalidateExperiments(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: [...queryRoot, "experiments"] });
}

export function useExperiments(overrides: Partial<ListExperimentsQuery> = {}) {
  const query = { ...defaultListQuery, ...overrides };
  return useQuery({
    queryKey: queryKeys.experiments.list(query),
    queryFn: () =>
      apiFetch(experimentsListResponseSchema, `/experiments?${listSearchParams(query)}`),
    staleTime: LIST_STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export function useExperiment(experimentId: string | null) {
  return useQuery({
    queryKey: queryKeys.experiments.detail(experimentId ?? ""),
    queryFn: () =>
      apiFetch(
        experimentDetailSchema,
        `/experiments/${encodeURIComponent(experimentId ?? "")}`,
      ),
    enabled: experimentId !== null,
    staleTime: LIST_STALE_MS,
    refetchInterval: (query) =>
      isLive(query.state.data?.status) ? PROGRESS_POLL_MS : false,
  });
}

export function useExperimentRuns(
  experimentId: string,
  overrides: Partial<ListExperimentRunsQuery> = {},
  enabled = true,
) {
  const query = { ...defaultRunsQuery, ...overrides };
  return useQuery({
    queryKey: queryKeys.experiments.runs(experimentId, query),
    queryFn: () =>
      apiFetch(
        experimentRunsResponseSchema,
        `/experiments/${encodeURIComponent(experimentId)}/runs?${runsSearchParams(query)}`,
      ),
    staleTime: RUNS_STALE_MS,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCreateExperiment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateExperimentRequest) =>
      apiFetch(experimentDetailSchema, "/experiments", {
        method: "POST",
        body: request,
      }),
    onSuccess: (experiment) => {
      client.setQueryData(queryKeys.experiments.detail(experiment.id), experiment);
      invalidateExperiments(client);
    },
  });
}

export function useCancelExperiment(experimentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(
        experimentDetailSchema,
        `/experiments/${encodeURIComponent(experimentId)}/cancel`,
        { method: "POST" },
      ),
    onSuccess: (experiment) => {
      client.setQueryData(queryKeys.experiments.detail(experiment.id), experiment);
      invalidateExperiments(client);
    },
  });
}
