import type { PlanItemResponse } from "@sera/contracts";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { cn } from "@/lib/cn.ts";
import { formatClockMs, formatClockRange, formatPercent } from "@/lib/format.ts";
import { buildTimelineDomain, hourTicks, percentOf } from "./timeline-scale.ts";

const DEFAULT_HEIGHT = 288;
const MIN_INNER_WIDTH = "min-w-[34rem]";
const BAR_HEIGHT_PX = 22;
const SR_LABEL_MIN_PERCENT = 11;

type SlotPhase = "past" | "active" | "scheduled" | "closed";

const phaseClasses: Record<SlotPhase, string> = {
  past: "border border-line bg-sunk text-ink-2",
  active: "border border-water bg-water text-surface",
  scheduled: "border border-water/40 bg-water-soft text-water-deep",
  closed: "border border-warn/40 bg-warn-soft text-warn",
};

const phaseLabels: Record<SlotPhase, string> = {
  past: "Selesai",
  active: "Berjalan",
  scheduled: "Terjadwal",
  closed: "Ditutup",
};

function phaseOf(item: PlanItemResponse, nowMs: number): SlotPhase {
  const start = Date.parse(item.slot_start);
  const end = Date.parse(item.slot_end);
  if (end <= nowMs) {
    return "past";
  }
  if (start <= nowMs) {
    return "active";
  }
  return item.gate_open ? "scheduled" : "closed";
}

function rowLabel(item: PlanItemResponse, phase: SlotPhase): string {
  const parts = [
    item.block_name,
    phaseLabels[phase],
    formatClockRange(item.slot_start, item.slot_end),
  ];
  if (item.service_ratio_est !== null) {
    parts.push(`rasio layanan ${formatPercent(item.service_ratio_est)}`);
  }
  return parts.join(", ");
}

interface TickRulerProps {
  readonly domain: ReturnType<typeof buildTimelineDomain>;
}

function TickRuler({ domain }: TickRulerProps) {
  return (
    <div className="relative h-6" aria-hidden="true">
      {hourTicks(domain).map((ms) => (
        <span
          key={ms}
          className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center gap-1"
          style={{ left: `${percentOf(ms, domain)}%` }}
        >
          <span className="font-mono text-2xs text-ink-3 tabular">
            {formatClockMs(ms)}
          </span>
          <span className="h-1.5 w-px bg-line-2" />
        </span>
      ))}
    </div>
  );
}

interface SlotRowProps {
  readonly item: PlanItemResponse;
  readonly phase: SlotPhase;
  readonly domain: ReturnType<typeof buildTimelineDomain>;
  readonly nowMs: number;
}

function SlotRow({ item, phase, domain, nowMs }: SlotRowProps) {
  const start = Date.parse(item.slot_start);
  const end = Date.parse(item.slot_end);
  const left = percentOf(start, domain);
  const width = Math.max(0.5, percentOf(end, domain) - left);
  const nowPercent = percentOf(nowMs, domain);
  const ratioLabel =
    item.service_ratio_est !== null && width >= SR_LABEL_MIN_PERCENT
      ? formatPercent(item.service_ratio_est)
      : null;
  return (
    <div
      className="grid h-9 grid-cols-[6.5rem_1fr] items-center gap-2 border-b border-line/60 last:border-b-0 sm:grid-cols-[8rem_1fr]"
      aria-label={rowLabel(item, phase)}
    >
      <p className="truncate pl-1 text-xs text-ink-2">{item.block_name}</p>
      <div className="relative h-full">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-ink/25"
          style={{ left: `${nowPercent}%` }}
        />
        <div
          title={`${formatClockRange(item.slot_start, item.slot_end)} · ${phaseLabels[phase]}`}
          className={cn(
            "absolute flex items-center justify-between gap-2 overflow-hidden rounded-xs px-2",
            phaseClasses[phase],
          )}
          style={{ left: `${left}%`, width: `${width}%`, height: BAR_HEIGHT_PX, top: "50%", transform: "translateY(-50%)" }}
        >
          <span className="truncate font-mono text-2xs tabular">
            {formatClockMs(start)}
          </span>
          {ratioLabel !== null && (
            <span className="truncate font-mono text-2xs tabular">
              {ratioLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export interface PlanTimelineProps {
  readonly items: readonly PlanItemResponse[];
  readonly now: number;
  readonly height?: number;
  readonly className?: string;
}

export function PlanTimeline({
  items,
  now,
  height = DEFAULT_HEIGHT,
  className,
}: PlanTimelineProps) {
  if (items.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-line bg-surface",
          className,
        )}
      >
        <EmptyState
          compact
          title="Belum ada slot"
          description="Plan ini belum memiliki slot alokasi."
        />
      </div>
    );
  }
  const ordered = [...items].sort(
    (a, b) => Date.parse(a.slot_start) - Date.parse(b.slot_start),
  );
  const domain = buildTimelineDomain(
    ordered.map((item) => [
      Date.parse(item.slot_start),
      Date.parse(item.slot_end),
    ]),
    now,
  );
  return (
    <div
      style={{ height }}
      className={cn(
        "overflow-auto rounded-md border border-line bg-surface",
        className,
      )}
    >
      <div className={cn("px-3 py-2", MIN_INNER_WIDTH)}>
        <div className="grid grid-cols-[6.5rem_1fr] gap-2 sm:grid-cols-[8rem_1fr]">
          <span aria-hidden="true" />
          <TickRuler domain={domain} />
        </div>
        {ordered.map((item) => (
          <SlotRow
            key={item.id}
            item={item}
            phase={phaseOf(item, now)}
            domain={domain}
            nowMs={now}
          />
        ))}
      </div>
    </div>
  );
}