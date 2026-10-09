import type {
  PlanApprovalSummary,
  PlanStatus,
  PlanSummaryResponse,
  PolicyProfile,
} from "@sera/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/kit/button.tsx";
import { DataTable, type SeraColumnDef } from "@/components/kit/data-table.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import {
  TimeRangePicker,
  type TimeRange,
} from "@/components/kit/time-range-picker.tsx";
import { useNetwork, useNetworks } from "@/features/network/api.ts";
import {
  planStatusLabel,
  planStatusTone,
  policyProfileLabel,
} from "@/features/network/status.ts";
import { downloadPlansCsv, usePlans } from "@/features/scheduling/api.ts";
import { isApiError } from "@/lib/api/client.ts";
import { useSessionStore } from "@/lib/auth/session-store.ts";
import { cn } from "@/lib/cn.ts";
import { formatDateTime, formatNumber } from "@/lib/format.ts";
import { buildSearch } from "@/lib/search.ts";

const HISTORY_LIMIT = 20;
const ALL = "";

const statusValues: readonly PlanStatus[] = [
  "PROPOSED",
  "APPROVED",
  "EXECUTED",
  "SUPERSEDED",
  "FALLBACK",
];

const profileValues: readonly PolicyProfile[] = [
  "EQUITY_FIRST",
  "SHORTAGE_FIRST",
  "BALANCED",
];

const approvalActionLabels: Record<PlanApprovalSummary["action"], string> = {
  APPROVE: "Disetujui",
  REJECT: "Ditolak",
  REQUEST_CHANGES: "Minta ubah",
};

interface HistoryFilters {
  readonly status: PlanStatus | "";
  readonly profile: PolicyProfile | "";
  readonly networkId: string;
  readonly blockId: string;
  readonly range: TimeRange | null;
}

const initialFilters: HistoryFilters = {
  status: ALL,
  profile: ALL,
  networkId: ALL,
  blockId: ALL,
  range: null,
};

function exportFilename(): string {
  return `sera-plans-${new Date().toISOString().slice(0, 10)}.csv`;
}

function DecisionCell({ plan }: { readonly plan: PlanSummaryResponse }) {
  const approval = plan.last_approval;
  const override = plan.last_override;
  if (approval === null && override === null) {
    return <span className="text-xs text-ink-3">—</span>;
  }
  return (
    <span className="flex max-w-56 flex-col gap-1">
      {approval !== null && (
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-ink">
            {approvalActionLabels[approval.action]} · {approval.user_name}
          </span>
          {approval.reason !== null && (
            <span className="truncate text-2xs text-ink-3" title={approval.reason}>
              {approval.reason}
            </span>
          )}
        </span>
      )}
      {override !== null && (
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-ink">Override · {override.user_name}</span>
          <span className="truncate text-2xs text-ink-3" title={override.reason}>
            {override.reason}
          </span>
        </span>
      )}
    </span>
  );
}

function buildColumns(
  onOpen: (plan: PlanSummaryResponse) => void,
): SeraColumnDef<PlanSummaryResponse>[] {
  return [
    {
      id: "created_at",
      accessorKey: "created_at",
      header: "Dibuat",
      cell: (info) => (
        <button
          type="button"
          onClick={() => {
            onOpen(info.row.original);
          }}
          className="font-mono text-xs text-ink tabular hover:text-water"
        >
          {formatDateTime(info.row.original.created_at)}
        </button>
      ),
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: "Status",
      cell: (info) => (
        <StatusPill
          tone={planStatusTone(info.row.original.status)}
          label={planStatusLabel(info.row.original.status)}
        />
      ),
    },
    {
      id: "network",
      accessorFn: (row) => row.network_name,
      header: "Jaringan",
      cell: (info) => (
        <span className="block max-w-40 truncate text-xs text-ink-2">
          {info.row.original.network_name}
        </span>
      ),
    },
    {
      id: "profile",
      accessorFn: (row) => row.profile,
      header: "Profil",
      cell: (info) => (
        <span className="text-xs text-ink-2">
          {policyProfileLabel(info.row.original.profile)}
        </span>
      ),
    },
    {
      id: "horizon",
      accessorFn: (row) => row.horizon_from,
      header: "Horizon",
      cell: (info) => (
        <span className="flex flex-col gap-0.5 font-mono text-2xs text-ink-2 tabular">
          <span>{formatDateTime(info.row.original.horizon_from)}</span>
          <span>{formatDateTime(info.row.original.horizon_to)}</span>
        </span>
      ),
    },
    {
      id: "items",
      accessorFn: (row) => row.item_count,
      header: "Item",
      cell: (info) => (
        <span className="font-mono text-xs text-ink-2 tabular">
          {formatNumber(info.row.original.item_count)}
        </span>
      ),
    },
    {
      id: "decision",
      accessorFn: (row) =>
        row.last_override?.created_at ?? row.last_approval?.created_at ?? row.created_at,
      header: "Keputusan terakhir",
      cell: (info) => <DecisionCell plan={info.row.original} />,
    },
  ];
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<HistoryFilters>(initialFilters);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const role = useSessionStore((snapshot) => snapshot.user?.role ?? null);
  const canExport = role === "OPERATOR" || role === "ADMIN";
  const networksQuery = useNetworks({ limit: 50 });
  const networks = networksQuery.data?.items ?? [];
  const networkQuery = useNetwork(
    filters.networkId === ALL ? null : filters.networkId,
  );
  const blocks = networkQuery.data?.blocks ?? [];
  const plansQuery = usePlans({
    ...(filters.networkId === ALL ? {} : { network_id: filters.networkId }),
    ...(filters.status === ALL ? {} : { status: filters.status }),
    ...(filters.profile === ALL ? {} : { profile: filters.profile }),
    ...(filters.blockId === ALL ? {} : { block_id: filters.blockId }),
    ...(filters.range === null
      ? {}
      : { from: filters.range.from, to: filters.range.to }),
    page,
    limit: HISTORY_LIMIT,
  });
  const plans = plansQuery.data?.items ?? [];
  const total = plansQuery.data?.total ?? 0;
  const totalPages = plansQuery.data?.total_pages ?? 1;
  const openPlan = useCallback(
    (plan: PlanSummaryResponse): void => {
      navigate({
        to: "/operations/schedule",
        search: buildSearch({ network: plan.network_id, plan: plan.id }),
      });
    },
    [navigate],
  );
  const columns = useMemo(() => buildColumns(openPlan), [openPlan]);

  function update(patch: Partial<HistoryFilters>): void {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  async function exportCsv(): Promise<void> {
    setExporting(true);
    setExportError(null);
    try {
      await downloadPlansCsv(
        {
          ...(filters.networkId === ALL ? {} : { network_id: filters.networkId }),
          ...(filters.status === ALL ? {} : { status: filters.status }),
          ...(filters.profile === ALL ? {} : { profile: filters.profile }),
          ...(filters.blockId === ALL ? {} : { block_id: filters.blockId }),
          ...(filters.range === null
            ? {}
            : { from: filters.range.from, to: filters.range.to }),
          sort: "created_at",
          order: "desc",
        },
        exportFilename(),
      );
    } catch (cause) {
      setExportError(
        isApiError(cause) ? cause.message : "Ekspor gagal. Coba lagi.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Operasi"
        title="Riwayat"
        description="Jejak plan, keputusan, dan override lintas jaringan."
        actions={
          canExport ? (
            <Button
              size="sm"
              variant="outline"
              pending={exporting}
              pendingLabel="Menyiapkan…"
              onClick={() => {
                void exportCsv();
              }}
            >
              Ekspor CSV
            </Button>
          ) : undefined
        }
      />
      {exportError !== null && (
        <p role="alert" className="text-xs text-crit">
          {exportError}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Status plan"
            value={filters.status}
            onChange={(event) => {
              const next = statusValues.find(
                (value) => value === event.target.value,
              );
              update({ status: next ?? ALL });
            }}
            className={cn(inputClass, "w-auto")}
          >
            <option value={ALL}>Semua status</option>
            {statusValues.map((value) => (
              <option key={value} value={value}>
                {planStatusLabel(value)}
              </option>
            ))}
          </select>
          <select
            aria-label="Profil kebijakan"
            value={filters.profile}
            onChange={(event) => {
              const next = profileValues.find(
                (value) => value === event.target.value,
              );
              update({ profile: next ?? ALL });
            }}
            className={cn(inputClass, "w-auto")}
          >
            <option value={ALL}>Semua profil</option>
            {profileValues.map((value) => (
              <option key={value} value={value}>
                {policyProfileLabel(value)}
              </option>
            ))}
          </select>
          <select
            aria-label="Jaringan"
            value={filters.networkId}
            onChange={(event) => {
              update({ networkId: event.target.value, blockId: ALL });
            }}
            className={cn(inputClass, "w-auto")}
          >
            <option value={ALL}>Semua jaringan</option>
            {networks.map((network) => (
              <option key={network.id} value={network.id}>
                {network.name}
              </option>
            ))}
          </select>
          {filters.networkId !== ALL && blocks.length > 0 && (
            <select
              aria-label="Blok"
              value={filters.blockId}
              onChange={(event) => {
                update({ blockId: event.target.value });
              }}
              className={cn(inputClass, "w-auto")}
            >
              <option value={ALL}>Semua blok</option>
              {blocks.map((block) => (
                <option key={block.id} value={block.id}>
                  {block.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <TimeRangePicker
          value={filters.range}
          onChange={(range) => {
            update({ range });
          }}
        />
      </div>
      {plansQuery.isError ? (
        <ErrorState
          error={plansQuery.error}
          action={
            <Button
              size="sm"
              onClick={() => {
                void plansQuery.refetch();
              }}
            >
              Coba lagi
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={[...plans]}
          isLoading={plansQuery.isPending}
          pageSize={HISTORY_LIMIT}
          sortable={false}
          serverPager={{
            page,
            pageSize: HISTORY_LIMIT,
            totalPages,
            total,
            onPageChange: setPage,
          }}
          getRowId={(plan) => plan.id}
          emptyTitle="Belum ada plan"
          emptyDescription="Plan yang diajukan akan muncul di sini beserta jejak keputusannya."
        />
      )}
    </div>
  );
}