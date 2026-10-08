import type {
  PlanDetailResponse,
  PlanItemResponse,
  TelemetryLatestItemResponse,
} from "@sera/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "@/components/kit/button.tsx";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { FallbackBanner } from "@/components/kit/fallback-banner.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { MetricCard } from "@/components/kit/metric-card.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import { useNetwork, useNetworks } from "@/features/network/api.ts";
import { NetworkCanvas } from "@/features/network/network-canvas.tsx";
import { buildNetworkView } from "@/features/network/selectors.ts";
import { planStatusLabel, planStatusTone } from "@/features/network/status.ts";
import { usePlan, usePlans } from "@/features/scheduling/api.ts";
import { ApprovalActions } from "@/features/scheduling/approval-actions.tsx";
import {
  isActionableStatus,
  nextUpcomingItem,
  pickActionablePlan,
} from "@/features/scheduling/plan-selection.ts";
import { ProposePlanButton } from "@/features/scheduling/propose-plan-button.tsx";
import type { PlanActionName } from "@/features/scheduling/use-plan-actions.ts";
import { useLatestTelemetry } from "@/features/sensors/api.ts";
import { sensorQualityLabel } from "@/features/sensors/status.ts";
import { cn } from "@/lib/cn.ts";
import { formatClockRange, formatNumber, formatPercent } from "@/lib/format.ts";
import { useNow } from "@/lib/hooks.ts";
import { readReasonNotes } from "@/lib/notes.ts";
import { buildSearch, readSearchString } from "@/lib/search.ts";

const TICK_MS = 30_000;
const CANVAS_HEIGHT = 240;
const SKELETON_KEYS = ["air", "rasio", "sensor", "kualitas"] as const;
const FALLBACK_REASON =
  "Solver tidak menyelesaikan solusi penuh; plan disusun dengan aturan fallback.";

interface SourceFlow {
  readonly valueLps: number;
  readonly stale: boolean;
}

function sourceFlow(
  items: readonly TelemetryLatestItemResponse[],
  sourceNodeId: string | null,
): SourceFlow | null {
  if (sourceNodeId === null) {
    return null;
  }
  let valueLps: number | null = null;
  let bestAge = Number.POSITIVE_INFINITY;
  let stale = false;
  for (const item of items) {
    if (
      item.type !== "FLOW" ||
      item.node_id !== sourceNodeId ||
      item.value === null
    ) {
      continue;
    }
    const age = item.age_s ?? Number.POSITIVE_INFINITY;
    if (age < bestAge) {
      valueLps = item.value;
      bestAge = age;
      stale = item.stale;
    }
  }
  return valueLps === null ? null : { valueLps, stale };
}

function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {SKELETON_KEYS.map((key) => (
        <Skeleton key={key} className="h-24" />
      ))}
    </div>
  );
}

function NoteList({ notes }: { readonly notes: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {notes.map((note) => (
        <li key={note} className="text-xs text-ink-2">
          {note}
        </li>
      ))}
    </ul>
  );
}

function WhyDisclosure({ plan }: { readonly plan: PlanDetailResponse }) {
  const notes = readReasonNotes(plan.binding_factors);
  if (notes.length === 0) {
    return null;
  }
  return (
    <details className="rounded-md border border-line bg-surface">
      <summary className="label-caps cursor-pointer list-none px-3.5 py-2.5 text-ink-3 [&::-webkit-details-marker]:hidden">
        Mengapa rencana ini?
      </summary>
      <div className="border-t border-line px-3.5 py-3">
        <NoteList notes={notes} />
      </div>
    </details>
  );
}

interface DecisionBlockProps {
  readonly plan: PlanDetailResponse;
  readonly nextItem: PlanItemResponse | null;
  readonly onOpenSchedule: () => void;
}

function DecisionBlock({ plan, nextItem, onOpenSchedule }: DecisionBlockProps) {
  const showActions: readonly PlanActionName[] = isActionableStatus(plan.status)
    ? ["approve", "reject"]
    : plan.status === "APPROVED"
      ? ["execute"]
      : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusPill
          tone={planStatusTone(plan.status)}
          label={planStatusLabel(plan.status)}
          size="md"
        />
        {nextItem === null ? (
          <span className="text-sm text-ink-3">
            Tidak ada slot mendatang pada plan ini.
          </span>
        ) : (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-ink">
              {nextItem.block_name}
            </span>
            <span className="font-mono text-xs text-ink-2 tabular">
              {formatClockRange(nextItem.slot_start, nextItem.slot_end)}
            </span>
          </span>
        )}
      </div>
      {showActions.length > 0 && (
        <ApprovalActions plan={plan} show={showActions} />
      )}
      <div>
        <Button size="sm" variant="ghost" onClick={onOpenSchedule}>
          Buka jadwal
        </Button>
      </div>
      <WhyDisclosure plan={plan} />
    </div>
  );
}

export function OverviewPage() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const now = useNow(TICK_MS);
  const networksQuery = useNetworks({ limit: 50 });
  const networks = networksQuery.data?.items ?? [];
  const requestedId = readSearchString(search, "network");
  const networkId = requestedId ?? networks[0]?.id ?? null;
  const networkQuery = useNetwork(networkId);
  const latestQuery = useLatestTelemetry(networkId);
  const plansQuery = usePlans(
    networkId === null ? {} : { network_id: networkId, limit: 20 },
  );
  const picked = pickActionablePlan(plansQuery.data?.items ?? []);
  const planQuery = usePlan(picked?.id ?? null);

  const detail = networkQuery.data ?? null;
  const telemetry = latestQuery.data?.items ?? [];
  const view =
    detail === null
      ? null
      : buildNetworkView({
          detail,
          telemetry,
          planItems: planQuery.data?.items ?? [],
          now,
        });
  const sourceNodeId =
    detail?.nodes.find((node) => node.type === "SOURCE")?.id ?? null;
  const flow = sourceFlow(telemetry, sourceNodeId);
  const nextItem = nextUpcomingItem(planQuery.data?.items ?? [], now);
  const contentError = networkQuery.error ?? latestQuery.error;

  function openNetwork(blockId: string | null): void {
    navigate({
      to: "/operations/network",
      search: buildSearch({ network: networkId, block: blockId }),
    });
  }

  function openSchedule(): void {
    navigate({
      to: "/operations/schedule",
      search: buildSearch({ network: networkId, plan: picked?.id ?? null }),
    });
  }

  function selectNetwork(nextId: string): void {
    navigate({ to: "/operations", search: buildSearch({ network: nextId }) });
  }

  const networkSelect =
    networks.length > 1 ? (
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
    ) : null;

  if (networksQuery.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Ringkasan" />
        <MetricsSkeleton />
      </div>
    );
  }

  if (networksQuery.isError) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Ringkasan" />
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
        <PageHeader eyebrow="Operasi" title="Ringkasan" />
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
        title={detail?.name ?? "Ringkasan"}
        description="Kondisi jaringan dan keputusan yang menunggu tindakan."
        actions={networkSelect}
      />
      {picked?.status === "FALLBACK" && (
        <FallbackBanner reason={FALLBACK_REASON} />
      )}
      {contentError !== null ? (
        <ErrorState
          error={contentError}
          action={
            <Button
              size="sm"
              onClick={() => {
                void networkQuery.refetch();
                void latestQuery.refetch();
              }}
            >
              Coba lagi
            </Button>
          }
        />
      ) : view === null || latestQuery.data === undefined ? (
        <MetricsSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="Air tersedia"
            value={flow === null ? "—" : formatNumber(flow.valueLps, 1)}
            unit="L/s"
            note={
              flow === null
                ? "Belum ada bacaan debit di sumber"
                : flow.stale
                  ? "Bacaan sumber sudah basi"
                  : "Dari sensor debit di sumber"
            }
          />
          <MetricCard
            label="Rasio layanan"
            value={
              view.summary.averageServiceRatio === null
                ? "—"
                : formatPercent(view.summary.averageServiceRatio)
            }
            note={
              view.summary.weakestBlockName === null
                ? "Belum ada slot plan"
                : `Terendah: ${view.summary.weakestBlockName}`
            }
          />
          <MetricCard
            label="Titik sensor"
            value={formatNumber(view.summary.sensorCount)}
            note={
              view.summary.staleSensorCount > 0
                ? `${formatNumber(view.summary.staleSensorCount)} basi`
                : "Semua segar"
            }
          />
          <MetricCard
            label="Kualitas data"
            value={sensorQualityLabel(view.summary.worstSensorQuality)}
            note={
              view.summary.worstSensorQuality === null
                ? "Belum ada bacaan"
                : "Kualitas terburuk"
            }
          />
        </div>
      )}
      {contentError === null && view !== null && (
        <section className="flex flex-col gap-2">
          <NetworkCanvas
            flow={view.flow}
            height={CANVAS_HEIGHT}
            onBlockSelect={(blockId) => {
              openNetwork(blockId);
            }}
          />
          <p className="text-xs text-ink-3">
            Klik blok di kanvas untuk membuka keadaan jaringan.
          </p>
        </section>
      )}
      <section className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3.5">
        <p className="label-caps text-ink-3">Keputusan berikutnya</p>
        {picked === null ? (
          networkId === null ? (
            <p className="text-sm text-ink-3">Pilih jaringan terlebih dahulu.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink-2">
                Belum ada plan untuk jaringan ini. Ajukan plan agar solver
                menyusun alokasi.
              </p>
              <ProposePlanButton networkId={networkId} />
            </div>
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
        ) : planQuery.data === undefined ? (
          <Skeleton className="h-20" />
        ) : (
          <DecisionBlock
            plan={planQuery.data}
            nextItem={nextItem}
            onOpenSchedule={openSchedule}
          />
        )}
      </section>
    </div>
  );
}