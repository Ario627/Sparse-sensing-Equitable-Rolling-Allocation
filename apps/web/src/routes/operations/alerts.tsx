import type { AlertSeverity, EventResponse } from "@sera/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/kit/button.tsx";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import {
  TimeRangePicker,
  type TimeRange,
} from "@/components/kit/time-range-picker.tsx";
import {
  useAcknowledgeEvent,
  useEventsFeed,
  useEventsStats,
} from "@/features/events/api.ts";
import { alertSeverityTone } from "@/features/network/status.ts";
import { isApiError } from "@/lib/api/client.ts";
import { cn } from "@/lib/cn.ts";
import { formatDateTime, formatNumber } from "@/lib/format.ts";
import { buildSearch } from "@/lib/search.ts";

type AckFilter = "unacked" | "all" | "acked";

const severityLabels: Record<AlertSeverity, string> = {
  info: "Info",
  warning: "Perhatian",
  critical: "Kritis",
};

const severityBars: Record<AlertSeverity, string> = {
  info: "border-info",
  warning: "border-warn",
  critical: "border-crit",
};

const typeLabels: Record<EventResponse["type"], string> = {
  trigger: "Pemicu",
  fallback: "Fallback",
  alert: "Peringatan",
  system: "Sistem",
};

const ackOptions: readonly { readonly value: AckFilter; readonly label: string }[] = [
  { value: "unacked", label: "Belum ditandai" },
  { value: "all", label: "Semua" },
  { value: "acked", label: "Sudah ditandai" },
];

const severityOptions: readonly {
  readonly value: AlertSeverity | "";
  readonly label: string;
}[] = [
  { value: "", label: "Semua tingkat" },
  { value: "critical", label: "Kritis" },
  { value: "warning", label: "Perhatian" },
  { value: "info", label: "Info" },
];

function ackFilterValue(filter: AckFilter): boolean | undefined {
  if (filter === "unacked") {
    return false;
  }
  if (filter === "acked") {
    return true;
  }
  return undefined;
}

interface AlertRowProps {
  readonly event: EventResponse;
  readonly acknowledging: boolean;
  readonly onAcknowledge: (eventId: string) => void;
  readonly onOpenNetwork: (event: EventResponse) => void;
}

function AlertRow({
  event,
  acknowledging,
  onAcknowledge,
  onOpenNetwork,
}: AlertRowProps) {
  const acked = event.acknowledged_at !== null;
  const canAcknowledge = event.type === "alert" && !acked;
  return (
    <li
      className={cn(
        "flex flex-col gap-2 border-l-2 py-3 pr-1 pl-3 sm:flex-row sm:items-start sm:justify-between",
        severityBars[event.severity],
        acked && "opacity-55",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusPill
            tone={alertSeverityTone(event.severity)}
            label={severityLabels[event.severity]}
          />
          <span className="label-caps text-ink-3">{typeLabels[event.type]}</span>
          <span className="font-mono text-2xs text-ink-3 tabular">
            {formatDateTime(event.created_at)}
          </span>
        </div>
        <p className="text-sm text-ink">{event.message}</p>
        {acked && (
          <p className="text-2xs text-ink-3">
            Ditandai {event.acknowledged_by?.full_name ?? "operator"} ·{" "}
            {formatDateTime(event.acknowledged_at ?? event.created_at)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {event.network_id !== null && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onOpenNetwork(event);
            }}
          >
            Buka jaringan
          </Button>
        )}
        {canAcknowledge && (
          <Button
            size="sm"
            variant="outline"
            pending={acknowledging}
            pendingLabel="Menandai…"
            onClick={() => {
              onAcknowledge(event.id);
            }}
          >
            Tandai dibaca
          </Button>
        )}
      </div>
    </li>
  );
}

interface StatsStripProps {
  readonly unacknowledged: number;
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
}

function StatsStrip({
  unacknowledged,
  critical,
  warning,
  info,
}: StatsStripProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-line bg-surface px-3.5 py-3">
      <span className="flex items-baseline gap-2">
        <span className="font-mono text-2xl leading-none font-medium text-ink tabular">
          {formatNumber(unacknowledged)}
        </span>
        <span className="label-caps text-ink-3">Belum ditandai</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusPill
          tone="crit"
          label={`${severityLabels.critical} ${formatNumber(critical)}`}
        />
        <StatusPill
          tone="warn"
          label={`${severityLabels.warning} ${formatNumber(warning)}`}
        />
        <StatusPill
          tone="info"
          label={`${severityLabels.info} ${formatNumber(info)}`}
        />
      </span>
    </div>
  );
}

export function AlertsPage() {
  const navigate = useNavigate();
  const [ackFilter, setAckFilter] = useState<AckFilter>("unacked");
  const [severity, setSeverity] = useState<AlertSeverity | "">("");
  const [range, setRange] = useState<TimeRange | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const acknowledgedValue = ackFilterValue(ackFilter);
  const eventsQuery = useEventsFeed({
    ...(acknowledgedValue === undefined
      ? {}
      : { acknowledged: acknowledgedValue }),
    ...(severity === "" ? {} : { severity }),
    ...(range === null ? {} : { from: range.from, to: range.to }),
  });
  const statsQuery = useEventsStats();
  const ack = useAcknowledgeEvent();
  const items = eventsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const total = eventsQuery.data?.pages[0]?.total ?? 0;
  const untouched = ackFilter === "unacked" && severity === "" && range === null;

  function openNetwork(event: EventResponse): void {
    navigate({
      to: "/operations/network",
      search: buildSearch({ network: event.network_id, block: null }),
    });
  }

  async function acknowledge(eventId: string): Promise<void> {
    setAcknowledgingId(eventId);
    await ack.mutateAsync(eventId).catch(() => undefined);
    setAcknowledgingId(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Operasi"
        title="Peringatan"
        description="Kejadian yang butuh perhatian operator, terbaru lebih dahulu."
      />
      {statsQuery.data !== undefined && (
        <StatsStrip
          unacknowledged={statsQuery.data.unacknowledged}
          critical={statsQuery.data.by_severity.critical}
          warning={statsQuery.data.by_severity.warning}
          info={statsQuery.data.by_severity.info}
        />
      )}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Status tanda dibaca"
            className="inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-sm border border-line-2 bg-sunk p-0.5"
          >
            {ackOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={option.value === ackFilter}
                onClick={() => {
                  setAckFilter(option.value);
                }}
                className={cn(
                  "h-7 rounded-xs px-2.5 text-xs font-medium transition-colors",
                  option.value === ackFilter
                    ? "bg-surface text-ink shadow-hair"
                    : "text-ink-2 hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Tingkat keparahan"
            value={severity}
            onChange={(event) => {
              const next = severityOptions.find(
                (option) => option.value === event.target.value,
              );
              setSeverity(next?.value ?? "");
            }}
            className={cn(inputClass, "w-auto")}
          >
            {severityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <TimeRangePicker value={range} onChange={setRange} />
      </div>
      {ack.isError && (
        <p role="alert" className="text-xs text-crit">
          {isApiError(ack.error)
            ? ack.error.message
            : "Penandaan gagal. Coba lagi."}
        </p>
      )}
      {eventsQuery.isError ? (
        <ErrorState
          error={eventsQuery.error}
          action={
            <Button
              size="sm"
              onClick={() => {
                void eventsQuery.refetch();
              }}
            >
              Coba lagi
            </Button>
          }
        />
      ) : eventsQuery.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-16" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Tidak ada kejadian"
          description={
            untouched
              ? "Tidak ada yang menunggu tindakan saat ini."
              : "Tidak ada kejadian pada filter ini."
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-line/60 rounded-md border border-line bg-surface px-3.5 py-1">
            {items.map((event) => (
              <AlertRow
                key={event.id}
                event={event}
                acknowledging={acknowledgingId === event.id}
                onAcknowledge={(eventId) => {
                  void acknowledge(eventId);
                }}
                onOpenNetwork={openNetwork}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-xs text-ink-3 tabular">
              Menampilkan {formatNumber(items.length)} dari{" "}
              {formatNumber(total)}
            </p>
            {eventsQuery.hasNextPage && (
              <Button
                size="sm"
                variant="outline"
                pending={eventsQuery.isFetchingNextPage}
                pendingLabel="Memuat…"
                onClick={() => {
                  void eventsQuery.fetchNextPage();
                }}
              >
                Muat lagi
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}