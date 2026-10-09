import {
  auditFacetsResponseSchema,
  auditListResponseSchema,
  type ListAuditQuery,
  type ListUsersQuery,
  usersListResponseSchema,
} from "@sera/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client.ts";
import { queryKeys } from "@/lib/api/query-keys.ts";

const ADMIN_STALE_MS = 30_000;

const defaultUsersQuery: ListUsersQuery = {
  q: undefined,
  page: 1,
  limit: 50,
  sort: "created_at",
  order: "desc",
};

const defaultAuditQuery: ListAuditQuery = {
  q: undefined,
  page: 1,
  limit: 25,
  order: "desc",
};

function usersSearchParams(query: ListUsersQuery): string {
  const params = new URLSearchParams();
  if (query.q !== undefined) {
    params.set("q", query.q);
  }
  if (query.role !== undefined) {
    params.set("role", query.role);
  }
  if (query.is_active !== undefined) {
    params.set("is_active", String(query.is_active));
  }
  params.set("page", String(query.page));
  params.set("limit", String(query.limit));
  params.set("sort", query.sort);
  params.set("order", query.order);
  return params.toString();
}

function auditSearchParams(query: ListAuditQuery): string {
  const params = new URLSearchParams();
  if (query.action !== undefined) {
    params.set("action", query.action);
  }
  if (query.entity !== undefined) {
    params.set("entity", query.entity);
  }
  if (query.q !== undefined) {
    params.set("q", query.q);
  }
  params.set("page", String(query.page));
  params.set("limit", String(query.limit));
  params.set("order", query.order);
  return params.toString();
}

export function useUsers(overrides: Partial<ListUsersQuery> = {}, enabled = true) {
  const query = { ...defaultUsersQuery, ...overrides };
  return useQuery({
    queryKey: queryKeys.users.list(query),
    queryFn: () =>
      apiFetch(usersListResponseSchema, `/users?${usersSearchParams(query)}`),
    staleTime: ADMIN_STALE_MS,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAuditLog(overrides: Partial<ListAuditQuery> = {}, enabled = true) {
  const query = { ...defaultAuditQuery, ...overrides };
  return useQuery({
    queryKey: queryKeys.audit.list(query),
    queryFn: () =>
      apiFetch(auditListResponseSchema, `/audit?${auditSearchParams(query)}`),
    staleTime: ADMIN_STALE_MS,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAuditFacets(enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.audit.list(defaultAuditQuery), "facets"] as const,
    queryFn: () => apiFetch(auditFacetsResponseSchema, "/audit/facets"),
    staleTime: ADMIN_STALE_MS,
    enabled,
  });
}

export function activeUserCount(
  users: readonly { readonly is_active: boolean }[],
): number {
  return users.filter((user) => user.is_active).length;
}
