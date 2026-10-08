import {
  experimentDetailSchema,
  experimentsListResponseSchema,
  type ExperimentProgressPayload,
  type ServerEvent,
} from "@sera/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useSyncExternalStore,
} from "react";
import { queryKeys, queryRoot } from "@/lib/api/query-keys.ts";
import { useSessionStore } from "@/lib/auth/session-store.ts";
import {
  closeSocket,
  openSocket,
  socketState,
  subscribeServerEvents,
  subscribeSocketState,
  type SocketState,
} from "./socket.ts";

function patchExperimentDetail(
  current: unknown,
  payload: ExperimentProgressPayload,
): unknown {
  const parsed = experimentDetailSchema.safeParse(current);
  if (!parsed.success) {
    return current;
  }
  return {
    ...parsed.data,
    status: payload.status,
    runs_done: payload.runs_done,
    runs_total: payload.runs_total,
    median_regret: payload.median_regret,
    worst_sr: payload.worst_sr,
  };
}

function patchExperimentList(
  current: unknown,
  payload: ExperimentProgressPayload,
): unknown {
  const parsed = experimentsListResponseSchema.safeParse(current);
  if (!parsed.success) {
    return current;
  }
  return {
    ...parsed.data,
    items: parsed.data.items.map((item) =>
      item.id === payload.experiment_id
        ? {
            ...item,
            status: payload.status,
            runs_done: payload.runs_done,
            runs_total: payload.runs_total,
            median_regret: payload.median_regret,
            worst_sr: payload.worst_sr,
          }
        : item,
    ),
  };
}

function applyExperimentProgress(
  client: QueryClient,
  payload: ExperimentProgressPayload,
): void {
  client.setQueryData<unknown>(
    queryKeys.experiments.detail(payload.experiment_id),
    (current: unknown) => patchExperimentDetail(current, payload),
  );
  client.setQueriesData<unknown>(
    { queryKey: [...queryRoot, "experiments", "list"] },
    (current: unknown) => patchExperimentList(current, payload),
  );
}

function handleServerEvent(client: QueryClient, event: ServerEvent): void {
  switch (event.type) {
    case "telemetry.updated":
      void client.invalidateQueries({
        queryKey: [...queryRoot, "telemetry", "latest"],
      });
      return;
    case "plan.proposed":
    case "plan.approved":
    case "plan.executed":
      void client.invalidateQueries({ queryKey: [...queryRoot, "plans"] });
      return;
    case "alert.raised":
      void client.invalidateQueries({ queryKey: [...queryRoot, "events"] });
      return;
    case "experiment.progress":
      applyExperimentProgress(client, event.payload);
      return;
  }
}

export function useRealtimeState(): SocketState {
  return useSyncExternalStore(subscribeSocketState, socketState, socketState);
}

export function useServerEvent(handler: (event: ServerEvent) => void): void {
  const onEvent = useEffectEvent(handler);
  useEffect(() => subscribeServerEvents((event) => onEvent(event)), []);
}

export function RealtimeProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const client = useQueryClient();
  const authenticated = useSessionStore((snapshot) => snapshot.user !== null);
  const dispatch = useEffectEvent((event: ServerEvent) => {
    handleServerEvent(client, event);
  });

  useEffect(() => {
    if (!authenticated) {
      closeSocket();
      return;
    }
    openSocket();
    return () => {
      closeSocket();
    };
  }, [authenticated]);

  useEffect(() => subscribeServerEvents((event) => dispatch(event)), []);

  return children;
}