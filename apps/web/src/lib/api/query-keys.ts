import type {
  ListAuditQuery,
  ListEventsQuery,
  ListExperimentRunsQuery,
  ListExperimentsQuery,
  ListNetworksQuery,
  ListPlansQuery,
  ListUsersQuery,
  TelemetryReadingsQuery,
} from "@sera/contracts";

const root = ["sera"] as const;
export const queryRoot = root;

export const queryKeys = {
  auth: {
    me: () => [...root, "auth", "me"] as const,
  },
  networks: {
    list: (query: ListNetworksQuery) => [...root, "networks", "list", query] as const,
    detail: (networkId: string) => [...root, "networks", "detail", networkId] as const,
  },
  telemetry: {
    latest: (networkId: string | null) =>
      [...root, "telemetry", "latest", networkId] as const,
    readings: (query: TelemetryReadingsQuery) =>
      [...root, "telemetry", "readings", query] as const,
  },
  estimates: {
    latest: (networkId: string | null) =>
      [...root, "estimates", "latest", networkId] as const,
  },
  plans: {
    list: (query: ListPlansQuery) => [...root, "plans", "list", query] as const,
    detail: (planId: string) => [...root, "plans", "detail", planId] as const,
    commands: (planId: string) => [...root, "plans", "commands", planId] as const,
  },
  events: {
    list: (query: ListEventsQuery) => [...root, "events", "list", query] as const,
    stats: () => [...root, "events", "stats"] as const,
  },
  experiments: {
    list: (query: ListExperimentsQuery) =>
      [...root, "experiments", "list", query] as const,
    detail: (experimentId: string) =>
      [...root, "experiments", "detail", experimentId] as const,
    runs: (experimentId: string, query: ListExperimentRunsQuery) =>
      [...root, "experiments", "runs", experimentId, query] as const,
  },
  users: {
    list: (query: ListUsersQuery) => [...root, "users", "list", query] as const,
  },
  p3a: {
    list: () => [...root, "p3a", "list"] as const,
  },
  audit: {
    list: (query: ListAuditQuery) => [...root, "audit", "list", query] as const,
  },
} as const;
