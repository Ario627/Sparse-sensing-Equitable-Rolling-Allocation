import { cn } from "@/lib/cn.ts";
import type { EstimateInterval } from "@/lib/format.ts";
import type { Tone } from "./status-pill.tsx";

const TICKS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const MAJOR_TICK_STEP = 50;
const PERCENT_MAX = 100;

export interface MeterRange {
  readonly min: number;
  readonly max: number;
}

export interface MeterMarker {
  readonly value: number;
  readonly label?: string;
}

export interface MeterBarProps {
  readonly value: number;
  readonly range?: MeterRange;
  readonly interval?: EstimateInterval | null;
  readonly marker?: MeterMarker | null;
  readonly tone?: Tone;
  readonly valueLabel?: string;
  readonly ticks?: boolean;
  readonly className?: string;
}

const DEFAULT_RANGE: MeterRange = { min: 0, max: 1 };

const fillClasses: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  fallback: "bg-fallback",
  info: "bg-info",
  neutral: "bg-ink-3",
};

const bandClasses: Record<Tone, string> = {
  ok: "bg-ok/25",
  warn: "bg-warn/25",
  crit: "bg-crit/25",
  fallback: "bg-fallback/25",
  info: "bg-info/25",
  neutral: "bg-ink-3/25",
};

function clampPercent(value: number): number {
  return Math.min(PERCENT_MAX, Math.max(0, value));
}

function toPercent(value: number, range: MeterRange): number {
  const span = range.max - range.min;
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(value)) {
    return 0;
  }
  return clampPercent(((value - range.min) / span) * PERCENT_MAX);
}

export function MeterBar({
  value,
  range = DEFAULT_RANGE,
  interval = null,
  marker = null,
  tone = "neutral",
  valueLabel,
  ticks = true,
  className,
}: MeterBarProps) {
  const valuePct = toPercent(value, range);
  const bandLeftPct = interval === null ? 0 : toPercent(interval.low, range);
  const bandRightPct = interval === null ? 0 : toPercent(interval.high, range);
  const markerPct = marker === null ? 0 : toPercent(marker.value, range);
  const markerLabel = marker?.label;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative min-w-0 flex-1">
        <div
          aria-hidden="true"
          className="relative h-2 overflow-hidden rounded-xs border border-line/80 bg-sunk"
        >
          {interval !== null && (
            <span
              className={cn("absolute inset-y-0", bandClasses[tone])}
              style={{
                left: `${bandLeftPct}%`,
                width: `${Math.max(0, bandRightPct - bandLeftPct)}%`,
              }}
            />
          )}
          <span
            className={cn("absolute inset-y-0 left-0", fillClasses[tone])}
            style={{ width: `${valuePct}%` }}
          />
        </div>
        {marker !== null && (
          <span
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-ink/60"
            style={{ left: `${markerPct}%` }}
          />
        )}
        {ticks && (
          <div aria-hidden="true" className="mt-0.5 flex items-start justify-between">
            {TICKS.map((tick) => (
              <span
                key={tick}
                className={cn(
                  "w-px bg-line-2",
                  tick % MAJOR_TICK_STEP === 0 ? "h-1.5" : "h-1",
                )}
              />
            ))}
          </div>
        )}
      </div>
      {(valueLabel !== undefined || markerLabel !== undefined) && (
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {valueLabel !== undefined && (
            <span className="font-mono text-xs text-ink tabular">{valueLabel}</span>
          )}
          {markerLabel !== undefined && (
            <span className="text-2xs text-ink-3">{markerLabel}</span>
          )}
        </span>
      )}
    </div>
  );
}