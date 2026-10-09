import type {
  AlertSeverity,
  EventResponse,
  PlanDetailResponse,
  PlanItemResponse,
  ReadingQuality,
  TelemetryReadingResponse,
} from "@sera/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  type ChartMarker,
  type ChartSpan,
  summarizeSeries,
  TimeSeriesChart,
} from "@/components/charts/time-series-chart.tsx";
import { Button } from "@/components/kit/button.tsx";
import { CapabilityNotice, useCapability } from "@/components/kit/capability-notice.tsx";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { FallbackBanner } from "@/components/kit/fallback-banner.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { InfoDialog } from "@/components/kit/info-dialog.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { StatusPill, type Tone } from "@/components/kit/status-pill.tsx";
import { FlowRibbon } from "@/components/viz/flow-ribbon.tsx";
import { useEventsFeed } from "@/features/events/api.ts";
import { useNetwork, useNetworks } from "@/features/network/api.ts";
import { meanConfidence, useLatestEstimates } from "@/features/network/estimates-api.ts";
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
import { planStatusLabel, planStatusTone } from "@/features/network/status.ts";
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
import { hasAnyRole, planRoles } from "@/lib/auth/roles.ts";
import { useRole } from "@/lib/auth/session-store.ts";
import { cn } from "@/lib/cn.ts";
import {
  formatCappedPercent,
  formatClockRange,
  formatDateTime,
  formatNumber,
} from "@/lib/format.ts";
import { useNow } from "@/lib/hooks.ts";
import { readReasonNotes } from "@/lib/notes.ts";
import { buildSearch, readSearchString } from "@/lib/search.ts";

const TICK_MS = 30_000;
const CHART_HEIGHT = 208;
const READINGS_LIMIT = 120;
const UPCOMING_COUNT = 3;
const EVENT_LIMIT = 25;
const GANGGUAN_COUNT = 4;
const FALLBACK_REASON =
  "Solver tidak menyelesaikan solusi penuh; plan disusun dengan aturan fallback.";

const EMPTY_MARKERS: readonly ChartMarker[] = [];

const fillToneClasses: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  fallback: "bg-fallback",
  info: "bg-info",
  neutral: "bg-ink-3",
};

function severityTone(severity: AlertSeverity): Tone {
  if (severity === "critical") {
    return "crit";
  }
  return severity === "warning" ? "warn" : "info";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

interface StatProps {
  readonly label: string;
  readonly value?: string;
  readonly note?: string;
  readonly children?: ReactNode;
}

function Stat({ label, value, note, children }: StatProps) {
  return (
    <div className="flex min-w-0 flex-col px-4 py-3 first:pl-0 last:pr-0">
      <p className="label-caps text-ink-3">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        {children ?? (
          <span className="font-display text-2xl leading-none font-semibold text-ink tabular">
            {value}
          </span>
        )}
      </p>
      {note !== undefined && <p className="mt-1 truncate text-2xs text-ink-3">{note}</p>}
    </div>
  );
}

interface FlowProfilePanelProps {
  readonly view: NetworkView;
  readonly flow: FlowReading | null;
  readonly confidence: number | null;
  readonly planStatus: PlanDetailResponse["status"] | null;
  readonly sourceName: string | null;
  readonly onOpenSchedule: () => void;
  readonly canOpenSchedule: boolean;
}

function FlowProfilePanel({
  view,
  flow,
  confidence,
  planStatus,
  sourceName,
  onOpenSchedule,
  canOpenSchedule,
}: FlowProfilePanelProps) {
  return (
    <section className="contour-paper overflow-hidden rounded-xl border border-line bg-surface shadow-hair">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="label-caps text-water">Profil aliran</p>
          <p className="mt-1 text-sm text-ink-2">
            Pembagian debit per blok dari hulu ke hilir
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InfoDialog
            label="Cara membaca"
            eyebrow="Profil aliran"
            title="Membaca profil aliran"
            triggerClassName="border border-line-2 bg-surface"
          >
            <div className="flex flex-col gap-3">
              <p>
                Pita air mewakili debit yang tersisa ketika aliran bergerak ke hilir.
                Ketebalannya menyusut setiap kali sebagian air dialihkan ke blok.
              </p>
              <p>
                Garis putus-putus di atas permukaan air adalah muka rencana. Selisih
                bergaris miring di antaranya adalah air yang belum tersalurkan.
              </p>
              <p>
                Sisir di bawah menunjukkan rasio layanan tiap blok; panjang batangnya
                sebanding dengan rasio, warnanya mengikuti status. Titik merah kecil
                menandai blok yang sensornya basi, sedangkan garis pendek di atas sisir
                menandai pintu yang sedang dibuka.
              </p>
              <p>
                Kabut tipis pada muka air melebar seiring turunnya keyakinan estimasi,
                sehingga permukaan yang paling tidak pasti terlihat paling kabur.
              </p>
            </div>
          </InfoDialog>
          <StatusPill
            tone={planStatus === null ? "neutral" : planStatusTone(planStatus)}
            label={planStatus === null ? "Belum ada plan" : planStatusLabel(planStatus)}
          />
          {canOpenSchedule && (
            <Button size="sm" variant="ghost" onClick={onOpenSchedule}>
              Buka jadwal
            </Button>
          )}
        </div>
      </div>
      <FlowRibbon
        className="px-2 py-3"
        blocks={view.blocks.map((block) => ({
          id: block.blockId,
          name: block.name,
          zone: block.zone,
          serviceRatio: block.serviceRatio,
          tone: block.band.tone,
          bandLabel: block.band.label,
          nominalFlowLps: block.nominalFlowLps,
          staleCount: block.sensors.staleCount,
          gateOpen: block.slot?.gateOpen ?? false,
        }))}
        sourceName={sourceName}
        flowLps={flow?.valueLps ?? null}
        confidence={confidence}
      />
      <div className="grid grid-cols-2 divide-line border-t border-line sm:grid-cols-4 sm:divide-x">
        <Stat label="Debit intake" value="—">
          <span className="font-mono text-lg leading-none font-medium text-ink tabular">
            {flow === null ? "—" : formatNumber(flow.valueLps, 1)}
          </span>
          <span className="text-2xs text-ink-3">L/s</span>
        </Stat>
        <Stat
          label="Rasio layanan"
          value={formatCappedPercent(view.summary.averageServiceRatio)}
          note={
            view.summary.weakestBlockName === null
              ? "belum ada plan"
              : `terendah ${view.summary.weakestBlockName}`
          }
        />
        <Stat
          label="Titik sensor"
          value={formatNumber(view.summary.sensorCount)}
          note={
            view.summary.staleSensorCount > 0
              ? `${formatNumber(view.summary.staleSensorCount)} basi`
              : "semua segar"
          }
        />
        <Stat label="Kualitas data">
          <StatusPill
            tone={sensorQualityTone(view.summary.worstSensorQuality)}
            label={sensorQualityLabel(view.summary.worstSensorQuality)}
          />
        </Stat>
      </div>
    </section>
  );
}

function qualitySpans(
  readings: readonly TelemetryReadingResponse[],
): readonly ChartSpan[] {
  const spans: ChartSpan[] = [];
  let open: { from: string; to: string; quality: ReadingQuality } | null = null;
  for (const reading of readings) {
    if (reading.quality === "GOOD") {
      if (open !== null) {
        spans.push({
          from: open.from,
          to: open.to,
          tone: open.quality === "STALE" ? "crit" : "warn",
          label: "mutu turun",
        });
        open = null;
      }
      continue;
    }
    open =
      open === null
        ? { from: reading.ts, to: reading.ts, quality: reading.quality }
        : { from: open.from, to: reading.ts, quality: reading.quality };
  }
  if (open !== null) {
    spans.push({
      from: open.from,
      to: open.to,
      tone: open.quality === "STALE" ? "crit" : "warn",
      label: "mutu turun",
    });
  }
  return spans;
}

interface DischargePanelProps {
  readonly points: readonly { readonly ts: string; readonly value: number }[];
  readonly events: readonly EventResponse[];
  readonly spans: readonly ChartSpan[];
  readonly reference: number | null;
  readonly loadingEvents: boolean;
  readonly eventsAllowed: boolean;
}

function DischargePanel({
  points,
  events,
  spans,
  reference,
  loadingEvents,
  eventsAllowed,
}: DischargePanelProps) {
  const summary = summarizeSeries(points);
  const first = points.at(0);
  const last = points.at(-1);
  const window =
    first === undefined || last === undefined
      ? null
      : `${formatDateTime(first.ts)} — ${formatDateTime(last.ts)}`;
  const markers: readonly ChartMarker[] =
    first === undefined || last === undefined
      ? EMPTY_MARKERS
      : events
          .filter((event) => {
            const ms = Date.parse(event.created_at);
            return ms >= Date.parse(first.ts) && ms <= Date.parse(last.ts);
          })
          .map((event) => ({
            ts: event.created_at,
            label:
              event.message.length > 26
                ? `${event.message.slice(0, 25)}…`
                : event.message,
            tone: severityTone(event.severity),
          }));
  const recent = events.slice(0, GANGGUAN_COUNT);

  return (
    <section className="flex flex-col rounded-xl border border-line bg-surface shadow-hair">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="label-caps text-water">Debit intake</p>
          <p className="mt-1 font-mono text-2xs text-ink-3 tabular">
            {window ?? "menunggu data"}
          </p>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-ink-2 tabular">
            min {summary.min === null ? "—" : formatNumber(summary.min, 1)}
          </span>
          <span className="font-mono text-xs text-ink-2 tabular">
            rata {summary.mean === null ? "—" : formatNumber(summary.mean, 1)}
          </span>
          <span className="font-mono text-xs text-ink-2 tabular">
            maks {summary.max === null ? "—" : formatNumber(summary.max, 1)}
          </span>
        </div>
      </div>
      <div className="px-3 pt-3 pb-1">
        {points.length < 2 ? (
          <div className="grid h-40 place-items-center rounded-md bg-sunk/60 text-xs text-ink-3">
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
            markers={markers}
            spans={spans}
            reference={
              reference === null
                ? null
                : { value: reference, label: "rencana", tone: "neutral" }
            }
          />
        )}
      </div>
      <div className="border-t border-line px-5 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="label-caps text-ink-3">Gangguan terakhir</p>
          {spans.length > 0 && (
            <p className="text-2xs text-ink-3">
              {formatNumber(spans.length)} jeda mutu data pada grafik
            </p>
          )}
        </div>
        {!eventsAllowed ? (
          <div className="mt-2.5">
            <CapabilityNotice capability="event.read" />
          </div>
        ) : loadingEvents ? (
          <Skeleton className="mt-2.5 h-14" />
        ) : recent.length === 0 ? (
          <p className="mt-2 text-xs text-ink-3">
            Tidak ada gangguan tercatat pada jaringan ini.
          </p>
        ) : (
          <ul className="mt-1.5 flex flex-col divide-y divide-line/70">
            {recent.map((event) => (
              <li key={event.id} className="flex items-center gap-2.5 py-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    fillToneClasses[severityTone(event.severity)],
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                  {event.message}
                </span>
                <span className="shrink-0 font-mono text-2xs text-ink-3 tabular">
                  {formatDateTime(event.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface ZonePanelProps {
  readonly zones: readonly ZoneServiceSummary[];
}

function ZonePanel({ zones }: ZonePanelProps) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-hair">
      <p className="label-caps text-water">Rasio per zona</p>
      <ul className="mt-4 flex flex-col gap-4">
        {zones.map((zone) => {
          const width =
            zone.averageRatio === null ? 0 : Math.round(clamp01(zone.averageRatio) * 100);
          const title =
            zone.weakestBlockName === null
              ? `${formatNumber(zone.blockCount)} blok`
              : `${formatNumber(zone.blockCount)} blok · terendah ${zone.weakestBlockName}`;
          const tone =
            zone.averageRatio === null
              ? "neutral"
              : zone.averageRatio >= 0.85
                ? "ok"
                : zone.averageRatio >= 0.7
                  ? "warn"
                  : "crit";
          return (
            <li key={zone.zone} className="flex items-center gap-3" title={title}>
              <span className="w-12 shrink-0 font-mono text-2xs text-ink-2">
                {zoneLabel(zone.zone)}
              </span>
              <span className="flume-bed h-2 flex-1 overflow-hidden rounded-xs bg-sunk">
                <span
                  className={cn("block h-full", fillToneClasses[tone])}
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="w-11 shrink-0 text-right font-mono text-xs text-ink tabular">
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
      <p className="label-caps text-water">Slot mendatang</p>
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

function MetricsSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-80" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
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
    <InfoDialog
      label="Mengapa rencana ini?"
      eyebrow="Dasar keputusan"
      title="Faktor yang mengikat rencana"
    >
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <li key={note} className="flex items-start gap-2 text-xs">
            <span aria-hidden="true" className="mt-1.5 size-1.5 rounded-full bg-water" />
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </InfoDialog>
  );
}

interface DecisionPanelProps {
  readonly plan: PlanDetailResponse | null;
  readonly status: PlanDetailResponse["status"] | null;
  readonly nextItem: PlanItemResponse | null;
  readonly networkId: string | null;
  readonly pending: boolean;
  readonly error: Error | null;
  readonly onRetry: () => void;
}

function DecisionPanel({
  plan,
  status,
  nextItem,
  networkId,
  pending,
  error,
  onRetry,
}: DecisionPanelProps) {
  const canDecide = useCapability("plan.decide");
  const canPropose = useCapability("plan.propose");
  const showActions: readonly PlanActionName[] =
    plan === null
      ? []
      : isActionableStatus(plan.status)
        ? ["approve", "reject"]
        : plan.status === "APPROVED"
          ? ["execute"]
          : [];
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-hair">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-caps text-water">Keputusan</p>
        <StatusPill
          tone={status === null ? "neutral" : planStatusTone(status)}
          label={status === null ? "Belum ada usulan" : planStatusLabel(status)}
        />
      </div>
      {plan === null ? (
        networkId === null ? (
          <p className="text-sm text-ink-3">Pilih jaringan terlebih dahulu.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">
              Belum ada usulan alokasi untuk jaringan ini.
            </p>
            {canPropose ? (
              <ProposePlanButton networkId={networkId} />
            ) : (
              <CapabilityNotice capability="plan.propose" />
            )}
          </div>
        )
      ) : error !== null ? (
        <ErrorState
          error={error}
          action={
            <Button size="sm" onClick={onRetry}>
              Coba lagi
            </Button>
          }
        />
      ) : pending ? (
        <Skeleton className="h-24" />
      ) : (
        <>
          {nextItem === null ? (
            <p className="text-sm text-ink-3">Tidak ada slot mendatang pada plan ini.</p>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="label-caps text-ink-3">Berikutnya</span>
              <span className="text-base font-medium text-ink">
                {nextItem.block_name}
              </span>
              <span className="font-mono text-xs text-ink-2 tabular">
                {formatClockRange(nextItem.slot_start, nextItem.slot_end)}
              </span>
            </div>
          )}
          {showActions.length === 0 ? null : canDecide ? (
            <ApprovalActions plan={plan} show={showActions} />
          ) : (
            <CapabilityNotice capability="plan.decide" />
          )}
          <WhyDisclosure plan={plan} />
        </>
      )}
    </section>
  );
}

export function OverviewPage() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const role = useRole();
  const now = useNow(TICK_MS);
  const networksQuery = useNetworks({ limit: 50 });
  const networks = networksQuery.data?.items ?? [];
  const requestedId = readSearchString(search, "network");
  const networkId = requestedId ?? networks[0]?.id ?? null;
  const networkQuery = useNetwork(networkId);
  const latestQuery = useLatestTelemetry(networkId);
  const estimatesQuery = useLatestEstimates(networkId);
  const eventsAllowed = useCapability("event.read");
  const eventsQuery = useEventsFeed(
    networkId === null
      ? { limit: EVENT_LIMIT, order: "desc" }
      : { limit: EVENT_LIMIT, order: "desc", network_id: networkId },
    eventsAllowed,
  );
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
  const readings = [...(readingsQuery.data?.items ?? [])].reverse();
  const flowPoints = readings.map((item) => ({ ts: item.ts, value: item.value }));
  const spans = qualitySpans(readings);
  const zones = view === null ? [] : zoneServiceSummary(view.blocks);
  const upcoming = upcomingItems(planQuery.data?.items ?? [], now, UPCOMING_COUNT);
  const nextItem = nextUpcomingItem(planQuery.data?.items ?? [], now);
  const contentError = networkQuery.error ?? latestQuery.error;
  const confidence = meanConfidence(estimatesQuery.data?.items ?? []);
  const designLps =
    view === null
      ? null
      : view.blocks.reduce((sum, block) => sum + block.nominalFlowLps, 0);
  const events = (eventsQuery.data?.pages ?? []).flatMap((page) => page.items);
  const sourceName = detail?.nodes.find((node) => node.type === "SOURCE")?.name ?? null;

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
        description="Profil aliran, gangguan, dan keputusan yang menunggu tindakan."
        actions={networkSelect}
      />
      {picked?.status === "FALLBACK" && <FallbackBanner reason={FALLBACK_REASON} />}
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
          <FlowProfilePanel
            view={view}
            flow={flow}
            confidence={confidence}
            planStatus={picked?.status ?? null}
            sourceName={sourceName}
            onOpenSchedule={openSchedule}
            canOpenSchedule={hasAnyRole(role, planRoles)}
          />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <DischargePanel
              points={flowPoints}
              events={events}
              spans={spans}
              reference={designLps}
              loadingEvents={eventsQuery.isPending}
              eventsAllowed={eventsAllowed}
            />
            <DecisionPanel
              plan={planQuery.data ?? null}
              status={picked?.status ?? null}
              nextItem={nextItem}
              networkId={networkId}
              pending={planQuery.isPending && picked !== null}
              error={planQuery.error}
              onRetry={() => {
                void planQuery.refetch();
              }}
            />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <ZonePanel zones={zones} />
            <UpcomingPanel items={upcoming} />
          </div>
        </>
      )}
      {view !== null && view.summary.blockCount > 0 && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              openNetwork(null);
            }}
          >
            Buka peta jaringan
          </Button>
        </div>
      )}
    </div>
  );
}
