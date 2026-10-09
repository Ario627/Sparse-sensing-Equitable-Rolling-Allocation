import type {
  CommandLogAction,
  CommandLogStatus,
  PlanApprovalResponse,
  PlanCommandLogEntry,
  PlanCommandLogSummary,
  PlanOverrideResponse,
  PlanStatus,
} from "@sera/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/kit/button.tsx";
import { DataTable, type SeraColumnDef } from "@/components/kit/data-table.tsx";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { FallbackBanner } from "@/components/kit/fallback-banner.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { StatusPill, type Tone } from "@/components/kit/status-pill.tsx";
import { useNetworks } from "@/features/network/api.ts";
import {
  planStatusLabel,
  planStatusTone,
  policyProfileLabel,
} from "@/features/network/status.ts";
import { usePlan, usePlanCommands, usePlans } from "@/features/scheduling/api.ts";
import { ApprovalActions } from "@/features/scheduling/approval-actions.tsx";
import {
  isActionableStatus,
  pickActionablePlan,
} from "@/features/scheduling/plan-selection.ts";
import { PlanTimeline } from "@/features/scheduling/plan-timeline.tsx";
import { ProposePlanButton } from "@/features/scheduling/propose-plan-button.tsx";
import {
  summarizePlanWindow,
  type PlanWindowSummary,
} from "@/features/scheduling/plan-summary.ts";
import type { PlanActionName } from "@/features/scheduling/use-plan-actions.ts";
import { useSessionStore } from "@/lib/auth/session-store.ts";
import { decisionRoles, hasAnyRole } from "@/lib/auth/roles.ts";
import { cn } from "@/lib/cn.ts";
import {
  formatClockRange,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatUnit,
} from "@/lib/format.ts";
import { useNow } from "@/lib/hooks.ts";
import { buildSearch, readSearchString } from "@/lib/search.ts";

const TICK_MS = 30_000;
const PLAN_OPTION_LIMIT = 20;
const FALLBACK_REASON =
  "Solver tidak menyelesaikan solusi penuh; plan disusun dengan aturan fallback.";
const COMMANDS_HINT = "Perintah pintu dikirim setelah plan disetujui.";

const commandStatusTones: Record<CommandLogStatus, Tone> = {
  pending: "info",
  accepted: "ok",
  rejected: "crit",
  expired: "warn",
  unanswered: "warn",
  unknown: "neutral",
};

const commandStatusLabels: Record<CommandLogStatus, string> = {
  pending: "Menunggu",
  accepted: "Diterima",
  rejected: "Ditolak",
  expired: "Kedaluwarsa",
  unanswered: "Tanpa balasan",
  unknown: "Tidak diketahui",
};

const commandActionLabels: Record<CommandLogAction, string> = {
  open: "Buka",
  close: "Tutup",
  set_position: "Atur posisi",
};

const approvalActionLabels: Record<PlanApprovalResponse["action"], string> = {
  APPROVE: "Disetujui",
  REJECT: "Ditolak",
  REQUEST_CHANGES: "Minta ubah",
};

function actionsForStatus(status: PlanStatus): readonly PlanActionName[] {
  if (isActionableStatus(status)) {
    return ["approve", "reject", "request_changes", "override"];
  }
  if (status === "APPROVED") {
    return ["execute", "override"];
  }
  return [];
}

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label-caps text-ink-3">{label}</dt>
      <dd className="font-mono text-xs text-ink tabular">{children}</dd>
    </div>
  );
}

function windowText(summary: PlanWindowSummary): string {
  if (summary.windowStart === null || summary.windowEnd === null) {
    return "—";
  }
  const sameDay = formatDate(summary.windowStart) === formatDate(summary.windowEnd);
  return sameDay
    ? formatClockRange(summary.windowStart, summary.windowEnd)
    : `${formatDate(summary.windowStart)} → ${formatDate(summary.windowEnd)}`;
}

function ApprovalList({
  approvals,
}: {
  readonly approvals: readonly PlanApprovalResponse[];
}) {
  if (approvals.length === 0) {
    return <p className="text-xs text-ink-3">Belum ada keputusan tercatat.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {approvals.map((approval) => (
        <li
          key={approval.id}
          className="flex flex-col gap-0.5 border-b border-line/60 pb-2 last:border-b-0 last:pb-0"
        >
          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-xs font-medium text-ink">
              {approvalActionLabels[approval.action]} · {approval.user_name}
            </span>
            <span className="font-mono text-2xs text-ink-3 tabular">
              {formatDateTime(approval.created_at)}
            </span>
          </span>
          {approval.reason !== null && (
            <span className="text-xs text-ink-2">{approval.reason}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function OverrideList({
  overrides,
}: {
  readonly overrides: readonly PlanOverrideResponse[];
}) {
  if (overrides.length === 0) {
    return <p className="text-xs text-ink-3">Belum ada override tercatat.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {overrides.map((override) => (
        <li
          key={override.id}
          className="flex flex-col gap-0.5 border-b border-line/60 pb-2 last:border-b-0 last:pb-0"
        >
          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-xs font-medium text-ink">{override.user_name}</span>
            <span className="font-mono text-2xs text-ink-3 tabular">
              {formatDateTime(override.created_at)}
            </span>
          </span>
          <span className="text-xs text-ink-2">{override.reason}</span>
        </li>
      ))}
    </ul>
  );
}

function CommandSummary({ summary }: { readonly summary: PlanCommandLogSummary }) {
  const parts = [
    `diterima ${formatNumber(summary.accepted)}`,
    `menunggu ${formatNumber(summary.pending)}`,
    `ditolak ${formatNumber(summary.rejected)}`,
    `kedaluwarsa ${formatNumber(summary.expired)}`,
    `tanpa balasan ${formatNumber(summary.unanswered)}`,
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <p className="font-mono text-xs text-ink-2 tabular">{parts.join(" · ")}</p>
      {summary.mismatch_count > 0 && (
        <StatusPill
          tone="crit"
          label={`${formatNumber(summary.mismatch_count)} tidak cocok`}
        />
      )}
    </div>
  );
}

function buildCommandColumns(): SeraColumnDef<PlanCommandLogEntry>[] {
  return [
    {
      id: "target",
      accessorFn: (row) => row.block_name ?? row.target ?? "",
      header: "Pintu",
      cell: (info) => (
        <span className="text-sm text-ink">
          {info.row.original.block_name ?? info.row.original.target ?? "—"}
        </span>
      ),
    },
    {
      id: "action",
      accessorFn: (row) => row.action ?? "",
      header: "Aksi",
      cell: (info) => (
        <span className="text-xs text-ink-2">
          {info.row.original.action === null
            ? "—"
            : commandActionLabels[info.row.original.action]}
        </span>
      ),
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: "Status",
      cell: (info) => {
        const entry = info.row.original;
        return (
          <span className="flex flex-col gap-0.5">
            <StatusPill
              tone={commandStatusTones[entry.status]}
              label={commandStatusLabels[entry.status]}
            />
            {entry.mismatch !== null && (
              <span className="text-2xs text-crit">
                selisih {entry.mismatch.deviation_pct}%
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: "attempts",
      accessorFn: (row) => row.attempts,
      header: "Percobaan",
      cell: (info) => (
        <span className="font-mono text-xs text-ink-2 tabular">
          {formatNumber(info.row.original.attempts)}
        </span>
      ),
    },
    {
      id: "issued_at",
      accessorKey: "issued_at",
      header: "Dikirim",
      cell: (info) => (
        <span className="font-mono text-xs text-ink-2 tabular">
          {formatDateTime(info.row.original.issued_at)}
        </span>
      ),
    },
    {
      id: "acked_at",
      accessorFn: (row) => row.acked_at,
      header: "Dikonfirmasi",
      cell: (info) => (
        <span className="font-mono text-xs text-ink-2 tabular">
          {info.row.original.acked_at === null
            ? "—"
            : formatDateTime(info.row.original.acked_at)}
        </span>
      ),
    },
  ];
}

const commandColumns = buildCommandColumns();

export function SchedulePage() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const now = useNow(TICK_MS);
  const networksQuery = useNetworks({ limit: 50 });
  const networks = networksQuery.data?.items ?? [];
  const requestedNetwork = readSearchString(search, "network");
  const networkId = requestedNetwork ?? networks[0]?.id ?? null;
  const network = networks.find((item) => item.id === networkId) ?? null;
  const plansQuery = usePlans(
    networkId === null ? {} : { network_id: networkId, limit: PLAN_OPTION_LIMIT },
  );
  const plans = plansQuery.data?.items ?? [];
  const requestedPlan = readSearchString(search, "plan");
  const picked = pickActionablePlan(plans);
  const activePlanId = requestedPlan ?? picked?.id ?? null;
  const planQuery = usePlan(activePlanId);
  const plan = planQuery.data ?? null;
  const commandsEnabled =
    plan !== null && (plan.status === "APPROVED" || plan.status === "EXECUTED");
  const commandsQuery = usePlanCommands(activePlanId ?? "", commandsEnabled);
  const windowSummary = plan === null ? null : summarizePlanWindow(plan.items);
  const role = useSessionStore((snapshot) => snapshot.user?.role ?? null);
  const canDecide = hasAnyRole(role, decisionRoles);
  const rawActions = plan === null ? [] : actionsForStatus(plan.status);
  const planActions = canDecide ? rawActions : [];

  function selectNetwork(nextId: string): void {
    navigate({
      to: "/operations/schedule",
      search: buildSearch({ network: nextId, plan: null }),
    });
  }

  function selectPlan(nextId: string): void {
    navigate({
      to: "/operations/schedule",
      search: buildSearch({ network: networkId, plan: nextId }),
    });
  }

  const headerActions = (
    <>
      {networks.length > 1 && (
        <select
          aria-label="Pilih jaringan"
          value={networkId ?? ""}
          onChange={(event) => {
            selectNetwork(event.target.value);
          }}
          className={cn(inputClass, "w-auto")}
        >
          {networks.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      )}
      {plans.length > 1 && (
        <select
          aria-label="Pilih plan"
          value={activePlanId ?? ""}
          onChange={(event) => {
            selectPlan(event.target.value);
          }}
          className={cn(inputClass, "w-auto")}
        >
          {plans.map((item) => (
            <option key={item.id} value={item.id}>
              {planStatusLabel(item.status)} · {formatDateTime(item.created_at)}
            </option>
          ))}
        </select>
      )}
    </>
  );

  if (networksQuery.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Jadwal" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (networksQuery.isError) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Jadwal" />
        <ErrorState
          error={networksQuery.error}
          action={
            <Button
              size="sm"
              onClick={() => {
                void networksQuery.refetch();
              }}
            >
              Coba lagi
            </Button>
          }
        />
      </div>
    );
  }

  if (networks.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Jadwal" />
        <EmptyState
          title="Belum ada jaringan"
          description="Minta admin mendaftarkan jaringan irigasi sebelum memakai halaman operasi."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Operasi"
        title={network?.name ?? "Jadwal"}
        description="Rencana alokasi, persetujuan, dan perintah pintu."
        actions={headerActions}
      />
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
      ) : activePlanId === null ? (
        plansQuery.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <EmptyState
            title="Belum ada plan"
            description={
              canDecide
                ? "Ajukan plan agar solver menyusun alokasi untuk jaringan ini."
                : "Belum ada plan untuk jaringan ini. Pengajuan plan dilakukan oleh operator P3A."
            }
            action={
              !canDecide || networkId === null ? undefined : (
                <ProposePlanButton networkId={networkId} />
              )
            }
          />
        )
      ) : planQuery.isError ? (
        <ErrorState
          error={planQuery.error}
          action={
            <Button
              size="sm"
              onClick={() => {
                void planQuery.refetch();
              }}
            >
              Coba lagi
            </Button>
          }
        />
      ) : plan === null ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {plan.status === "FALLBACK" && <FallbackBanner reason={FALLBACK_REASON} />}
          <section className="flex flex-col gap-4 rounded-md border border-line bg-surface p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  tone={planStatusTone(plan.status)}
                  label={planStatusLabel(plan.status)}
                  size="md"
                />
                <span className="text-xs text-ink-3">
                  {policyProfileLabel(plan.profile)}
                </span>
              </div>
              <ApprovalActions plan={plan} show={planActions} />
            </div>
            {planActions.length > 0 && (
              <p className="text-2xs leading-relaxed text-ink-3">
                Jadwal dihitung solver. Gunakan Ubah manual untuk menyesuaikan
                pintu per slot — semua perubahan tercatat di jejak audit.
              </p>
            )}
            {!canDecide && rawActions.length > 0 && (
              <p className="text-2xs leading-relaxed text-ink-3">
                Persetujuan, eksekusi, dan ubah manual hanya tersedia untuk operator
                P3A. Plan tetap dapat ditinjau dari halaman ini.
              </p>
            )}
            <dl className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-x-6 gap-y-3 rounded-md border border-line bg-paper/70 p-3 sm:grid-cols-[repeat(4,minmax(0,1fr))]">
              <Fact label="Slot">{formatNumber(windowSummary?.slotCount ?? 0)}</Fact>
              <Fact label="Blok terlayani">
                {formatNumber(windowSummary?.blockCount ?? 0)}
              </Fact>
              <Fact label="Volume dialokasikan">
                {windowSummary?.volumeGrossM3 == null
                  ? "—"
                  : formatUnit(windowSummary.volumeGrossM3, "m³", 1)}
              </Fact>
              <Fact label="Jendela">
                {windowSummary === null ? "—" : windowText(windowSummary)}
              </Fact>
            </dl>
            <p className="font-mono text-2xs text-ink-3 tabular">
              Solver {plan.solver_name ?? "—"} ·{" "}
              {plan.solver_time_ms === null
                ? "—"
                : formatUnit(plan.solver_time_ms, "ms", 0)}{" "}
              · MIP gap {plan.mip_gap === null ? "—" : formatPercent(plan.mip_gap, 1)}{" "}
              · dibuat {formatDateTime(plan.created_at)}
            </p>
          </section>
          <PlanTimeline items={plan.items} now={now} />
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3.5">
              <p className="label-caps text-ink-3">Persetujuan</p>
              <ApprovalList approvals={plan.approvals} />
            </section>
            <section className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3.5">
              <p className="label-caps text-ink-3">Override</p>
              <OverrideList overrides={plan.overrides} />
            </section>
          </div>
          <section className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3.5">
            <p className="label-caps text-ink-3">Perintah pintu</p>
            {!commandsEnabled ? (
              <p className="text-sm text-ink-3">{COMMANDS_HINT}</p>
            ) : commandsQuery.isError ? (
              <ErrorState
                error={commandsQuery.error}
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      void commandsQuery.refetch();
                    }}
                  >
                    Coba lagi
                  </Button>
                }
              />
            ) : commandsQuery.data === undefined ? (
              <Skeleton className="h-24" />
            ) : (
              <>
                <CommandSummary summary={commandsQuery.data.summary} />
                <DataTable
                  columns={commandColumns}
                  data={[...commandsQuery.data.items]}
                  getRowId={(entry) => entry.command_id}
                  emptyTitle="Belum ada perintah"
                  emptyDescription="Perintah akan muncul di sini setelah plan dieksekusi."
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
