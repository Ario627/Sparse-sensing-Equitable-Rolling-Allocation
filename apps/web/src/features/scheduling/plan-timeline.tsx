import type { PlanItemResponse } from "@sera/contracts";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { cn } from "@/lib/cn.ts";
import {
  formatCappedPercent,
  formatClockMs,
  formatClockRange,
  formatUnit,
} from "@/lib/format.ts";
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

const phaseChips: Record<SlotPhase, string> = {
  past: "bg-sunk",
  active: "bg-water",
  scheduled: "bg-water-soft",
  closed: "bg-warn-soft",
};

const phaseLabels: Record<SlotPhase, string> = {
  past: "Selesai",
  active: "Berjalan",
  scheduled: "Terjadwal",
  closed: "Ditutup",
};

const PHASE_ORDER: readonly SlotPhase[] = ["past", "active", "scheduled", "closed"];

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
    parts.push(`rasio layanan ${formatCappedPercent(item.service_ratio_est)}`);
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
      ? formatCappedPercent(item.service_ratio_est)
      : null;
  const volumeNote =
    item.volume_del_m3 === null
      ? ""
      : ` · ${formatUnit(item.volume_del_m3, "m³", 1)} sampai`;
  return (
    <li
      className="grid h-9 grid-cols-[6.5rem_1fr] items-center gap-2 border-b border-line/60 last:border-b-0 hover:bg-water-soft/25 sm:grid-cols-[8rem_1fr]"
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
          title={`${formatClockRange(item.slot_start, item.slot_end)} · ${phaseLabels[phase]}${volumeNote}`}
          className={cn(
            "absolute flex items-center justify-between gap-2 overflow-hidden rounded-xs px-2",
            phaseClasses[phase],
          )}
          style={{
            left: `${left}%`,
            width: `${width}%`,
            height: BAR_HEIGHT_PX,
            top: "50%",
            transform: "translateY(-50%)",
          }}
        >
          <span className="truncate font-mono text-2xs tabular">
            {formatClockMs(start)}
          </span>
          {ratioLabel !== null && (
            <span className="truncate font-mono text-2xs tabular">{ratioLabel}</span>
          )}
        </div>
      </div>
    </li>
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
      <div className={cn("rounded-md border border-line bg-surface", className)}>
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
    ordered.map((item) => [Date.parse(item.slot_start), Date.parse(item.slot_end)]),
    now,
  );
  const phases = new Set(ordered.map((item) => phaseOf(item, now)));
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-hair",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
        <p className="label-caps text-water">Linimasa slot</p>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {PHASE_ORDER.filter((phase) => phases.has(phase)).map((phase) => (
            <li
              key={phase}
              className="inline-flex items-center gap-1.5 text-2xs text-ink-2"
            >
              <span
                aria-hidden="true"
                className={cn("h-2 w-4 rounded-xs", phaseChips[phase])}
              />
              {phaseLabels[phase]}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5 text-2xs text-ink-2">
            <span aria-hidden="true" className="h-3 w-px bg-ink/30" />
            sekarang {formatClockMs(now)}
          </li>
        </ul>
      </div>
      <div style={{ height }} className="overflow-auto">
        <div className={cn("px-3 py-2", MIN_INNER_WIDTH)}>
          <div className="grid grid-cols-[6.5rem_1fr] gap-2 sm:grid-cols-[8rem_1fr]">
            <span aria-hidden="true" />
            <TickRuler domain={domain} />
          </div>
          <ul className="flex flex-col">
            {ordered.map((item) => (
              <SlotRow
                key={item.id}
                item={item}
                phase={phaseOf(item, now)}
                domain={domain}
                nowMs={now}
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
