import type { PlanDetailResponse, PlanItemResponse } from "@sera/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { TimeSeriesChart } from "@/components/charts/time-series-chart.tsx";
import { Button } from "@/components/kit/button.tsx";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { FallbackBanner } from "@/components/kit/fallback-banner.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { StatusPill, type Tone } from "@/components/kit/status-pill.tsx";
import { useNetwork, useNetworks } from "@/features/network/api.ts";
import { NetworkCanvas } from "@/features/network/network-canvas.tsx";
import {
  buildNetworkView,
  type FlowReading,
  freshestFlowReading,
  type NetworkView,
  sourceFlowReading,
  type ZoneServiceSummary,
  zoneLabel,
  zoneServiceSummary,
} from "@/features/network/selectors.ts";
import {
  planStatusLabel,
  planStatusTone,
  serviceRatioBand,
} from "@/features/network/status.ts";
import { usePlan, usePlans } from "@/features/scheduling/api.ts";
import { ApprovalActions } from "@/features/scheduling/approval-actions.tsx";
import {
  isActionableStatus,
  nextUpcomingItem,
  pickActionablePlan,
  upcomingItems,
} from "@/features/scheduling/plan-selection.ts";
import { ProposePlanButton } from "@/features/scheduling/propose-plan-button.tsx";
import type { PlanActionName } from "@/features/scheduling/use-plan-actions.ts";
import { useLatestTelemetry, useTelemetryReadings } from "@/features/sensors/api.ts";
import { sensorQualityLabel, sensorQualityTone } from "@/features/sensors/status.ts";
import { cn } from "@/lib/cn.ts";
import {
  formatAge,
  formatCappedPercent,
  formatClockRange,
  formatNumber,
} from "@/lib/format.ts";
import { useNow } from "@/lib/hooks.ts";
import { readReasonNotes } from "@/lib/notes.ts";
import { buildSearch, readSearchString } from "@/lib/search.ts";

const TICK_MS = 30_000;
const CANVAS_HEIGHT = 240;
const CHART_HEIGHT = 132;
const READINGS_LIMIT = 120;
const UPCOMING_COUNT = 3;
const DELTA_EPSILON = 0.05;
const FALLBACK_REASON =
  "Solver tidak menyelesaikan solusi penuh; plan disusun dengan aturan fallback.";

interface ZonePanelProps {
  readonly zones: readonly ZoneServiceSummary[];
}

function ZonePanel({ zones }: ZonePanelProps) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-hair">
      <p className="text-xs font-medium text-ink-3">Rasio per zona</p>
      <ul className="mt-4 flex flex-col gap-4">
        {zones.map((zone) => {
          const band =
            zone.averageRatio === null ? null : serviceRatioBand(zone.averageRatio);
          const width =
            zone.averageRatio === null
              ? 0
              : Math.round(Math.min(1, Math.max(0, zone.averageRatio)) * 100);
          const title =
            zone.weakestBlockName === null
              ? `${formatNumber(zone.blockCount)} blok`
              : `${formatNumber(zone.blockCount)} blok · terendah ${zone.weakestBlockName}`;
          return (
            <li key={zone.zone} className="flex items-center gap-3" title={title}>
              <span className="w-11 shrink-0 text-xs text-ink-2">
                {zoneLabel(zone.zone)}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunk">
                <span
                  className={cn(
                    "block h-full rounded-full",
                    fillToneClasses[band?.tone ?? "neutral"],
                  )}
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-xs text-ink tabular">
                {formatCappedPercent(zone.averageRatio)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface UpcomingPanelProps {
  readonly items: readonly PlanItemResponse[];
}

function UpcomingPanel({ items }: UpcomingPanelProps) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-hair">
      <p className="text-xs font-medium text-ink-3">Slot mendatang</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">Tidak ada slot mendatang.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-line/70">
          {items.map((item) => (
            <li
              key={item.id}
              title={item.gate_open ? "Pintu dibuka" : "Pintu ditutup"}
              className="flex items-center justify-between gap-3 py-2.5 last:pb-0"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    item.gate_open ? "bg-water" : "bg-line-2",
                  )}
                />
                <span className="truncate text-sm text-ink">{item.block_name}</span>
              </span>
              <span className="font-mono text-xs text-ink-2 tabular">
                {formatClockRange(item.slot_start, item.slot_end)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface FlowPoint {
  readonly ts: string;
  readonly value: number;
}

const fillToneClasses: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  fallback: "bg-fallback",
  info: "bg-info",
  neutral: "bg-ink-3",
};

interface ConditionHeroProps {
  readonly view: NetworkView;
  readonly flow: FlowReading | null;
  readonly points: readonly FlowPoint[];
}

function ConditionHero({ view, flow, points }: ConditionHeroProps) {
  const first = points.at(0);
  const delta = flow !== null && first !== undefined ? flow.valueLps - first.value : null;
  const showDelta = delta !== null && Math.abs(delta) >= DELTA_EPSILON;
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-hair">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink-3">
            Debit{flow === null || flow.nodeName === null ? "" : ` · ${flow.nodeName}`}
          </p>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-4xl leading-none font-medium tracking-tight text-ink tabular">
              {flow === null ? "—" : formatNumber(flow.valueLps, 1)}
            </span>
            <span className="text-sm text-ink-3">L/s</span>
            {showDelta && (
              <span className="ml-1 font-mono text-xs text-ink-3 tabular">
                {delta > 0 ? "↑" : "↓"} {formatNumber(Math.abs(delta), 1)}
              </span>
            )}
          </p>
        </div>
        {flow?.stale === true && (
          <span className="rounded-full bg-crit-soft px-2.5 py-1 text-2xs font-medium text-crit">
            {flow.ageS === null ? "basi" : `basi ${formatAge(flow.ageS)}`}
          </span>
        )}
      </div>
      <div className="mt-4">
        {flow === null ? (
          <div className="grid h-24 place-items-center rounded-lg bg-sunk/60 text-xs text-ink-3">
            Belum ada sensor debit pada jaringan ini
          </div>
        ) : points.length < 2 ? (
          <div className="grid h-24 place-items-center rounded-lg bg-sunk/60 text-xs text-ink-3">
            Menunggu cukup data grafik
          </div>
        ) : (
          <TimeSeriesChart
            points={points}
            label="Debit"
            unit="L/s"
            height={CHART_HEIGHT}
            digits={1}
            tone="water"
            animate={false}
            compact
          />
        )}
      </div>
      <dl className="mt-5 grid grid-cols-3 divide-x divide-line border-t border-line pt-4">
        <div className="pr-4">
          <dt className="text-2xs text-ink-3">Rasio layanan</dt>
          <dd className="mt-1 font-mono text-lg leading-none font-medium text-ink tabular">
            {formatCappedPercent(view.summary.averageServiceRatio)}
          </dd>
          <p className="mt-1 text-2xs text-ink-3">
            {view.summary.weakestBlockName === null
              ? "belum ada plan"
              : `terendah ${view.summary.weakestBlockName}`}
          </p>
        </div>
        <div className="px-4">
          <dt className="text-2xs text-ink-3">Sensor</dt>
          <dd className="mt-1 font-mono text-lg leading-none font-medium text-ink tabular">
            {formatNumber(view.summary.sensorCount)}
          </dd>
          <p className="mt-1 text-2xs text-ink-3">
            {view.summary.staleSensorCount > 0
              ? `${formatNumber(view.summary.staleSensorCount)} basi`
              : "semua segar"}
          </p>
        </div>
        <div className="pl-4">
          <dt className="text-2xs text-ink-3">Kualitas data</dt>
          <dd className="mt-1.5">
            <StatusPill
              tone={sensorQualityTone(view.summary.worstSensorQuality)}
              label={sensorQualityLabel(view.summary.worstSensorQuality)}
            />
          </dd>
        </div>
      </dl>
    </section>
  );
}

function MetricsSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-[4.5rem]" />
      <Skeleton className="h-56" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
    </div>
  );
}

function WhyDisclosure({ plan }: { readonly plan: PlanDetailResponse }) {
  const notes = readReasonNotes(plan.binding_factors);
  if (notes.length === 0) {
    return null;
  }
  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-water-deep transition-colors hover:text-water [&::-webkit-details-marker]:hidden">
        Mengapa rencana ini?
        <span
          aria-hidden="true"
          className="text-2xs transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <ul className="mt-3 flex flex-col gap-1.5 rounded-lg bg-sunk/60 p-4">
        {notes.map((note) => (
          <li key={note} className="text-xs text-ink-2">
            {note}
          </li>
        ))}
      </ul>
    </details>
  );
}

interface DecisionBlockProps {
  readonly plan: PlanDetailResponse;
  readonly nextItem: PlanItemResponse | null;
}

function DecisionBlock({ plan, nextItem }: DecisionBlockProps) {
  const showActions: readonly PlanActionName[] = isActionableStatus(plan.status)
    ? ["approve", "reject"]
    : plan.status === "APPROVED"
      ? ["execute"]
      : [];
  return (
    <div className="flex flex-col gap-4">
      {nextItem === null ? (
        <p className="text-sm text-ink-3">Tidak ada slot mendatang pada plan ini.</p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="label-caps text-ink-3">Berikutnya</span>
          <span className="text-base font-medium text-ink">{nextItem.block_name}</span>
          <span className="font-mono text-xs text-ink-2 tabular">
            {formatClockRange(nextItem.slot_start, nextItem.slot_end)}
          </span>
        </div>
      )}
      {showActions.length > 0 && <ApprovalActions plan={plan} show={showActions} />}
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
  const sourceNodeId = detail?.nodes.find((node) => node.type === "SOURCE")?.id ?? null;
  const flow =
    sourceFlowReading(telemetry, sourceNodeId) ?? freshestFlowReading(telemetry);
  const sourceSensorId = flow?.sensorId ?? null;
  const readingsQuery = useTelemetryReadings(
    sourceSensorId === null ? {} : { sensor_id: sourceSensorId, limit: READINGS_LIMIT },
    sourceSensorId !== null,
  );
  const flowPoints: readonly FlowPoint[] = [...(readingsQuery.data?.items ?? [])]
    .reverse()
    .map((item) => ({ ts: item.ts, value: item.value }));
  const zones = view === null ? [] : zoneServiceSummary(view.blocks);
  const upcoming = upcomingItems(planQuery.data?.items ?? [], now, UPCOMING_COUNT);
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
      {picked?.status === "FALLBACK" && <FallbackBanner reason={FALLBACK_REASON} />}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-hair">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusPill
              tone={picked === null ? "info" : planStatusTone(picked.status)}
              label={
                picked === null ? "Belum ada usulan" : planStatusLabel(picked.status)
              }
              size="md"
            />
            <Button size="sm" variant="ghost" onClick={openSchedule}>
              Buka jadwal
            </Button>
          </div>
          {picked === null ? (
            networkId === null ? (
              <p className="text-sm text-ink-3">Pilih jaringan terlebih dahulu.</p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-2">
                  Belum ada usulan alokasi untuk jaringan ini.
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
            <DecisionBlock plan={planQuery.data} nextItem={nextItem} />
          )}
        </div>
      </section>
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
        <>
          <ConditionHero view={view} flow={flow} points={flowPoints} />
          <div className="grid gap-5 lg:grid-cols-2">
            <ZonePanel zones={zones} />
            <UpcomingPanel items={upcoming} />
          </div>
          <NetworkCanvas
            flow={view.flow}
            height={CANVAS_HEIGHT}
            onBlockSelect={(blockId) => {
              openNetwork(blockId);
            }}
          />
        </>
      )}
    </div>
  );
}
