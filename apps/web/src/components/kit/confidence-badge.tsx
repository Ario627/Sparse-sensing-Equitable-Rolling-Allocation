import { cn } from "@/lib/cn.ts";
import { formatPercent } from "@/lib/format.ts";
import type { Tone } from "./status-pill.tsx";

const GAUGE_TICKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const MAJOR_TICK_EVERY = 5;
const DEFAULT_LABEL = "Keyakinan";

export interface ConfidenceBadgeProps {
  readonly value: number;
  readonly label?: string;
  readonly tone?: Tone;
  readonly className?: string;
}

interface ConfidenceGaugeProps {
  readonly value: number;
  readonly tone: Tone;
}

const tickFillClasses: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  fallback: "bg-fallback",
  info: "bg-info",
  neutral: "bg-ink-3",
};

const valueTextClasses: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  fallback: "text-fallback",
  info: "text-info",
  neutral: "text-ink",
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function filledTickCount(value: number): number {
  return Math.round(clampUnit(value) * GAUGE_TICKS.length);
}

function ConfidenceGauge({ value, tone }: ConfidenceGaugeProps) {
  const filled = filledTickCount(value);
  return (
    <span className="flex items-end gap-px" aria-hidden="true">
        {GAUGE_TICKS.map((tick) => (
            <span
            key={tick}
            className={cn(
                "w-0.5 rounded-[1px]",
                tick % MAJOR_TICK_EVERY === 0 ? "h-3" : "h-2",
                tick <= filled ? tickFillClasses[tone] : "bg-line-2",
            )}
            />
        ))}
    </span>
  );
}

export function ConfidenceBadge({
  value,
  label = DEFAULT_LABEL,
  tone = "neutral",
  className,
}: ConfidenceBadgeProps) {
  const normalized = clampUnit(value);
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-2 rounded-xs border border-line-2 bg-surface px-2 py-1",
        className,
      )}
    >
      <span className="label-caps text-ink-3">{label}</span>
      <ConfidenceGauge value={normalized} tone={tone} />
      <span
        className={cn(
          "font-mono text-xs font-medium tabular",
          valueTextClasses[tone],
        )}
      >
        {formatPercent(normalized)}
      </span>
    </span>
  );
}