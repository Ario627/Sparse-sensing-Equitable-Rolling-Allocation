import type { JSX } from "react/jsx-runtime";
import {
  type IconProps,
  IconTrendDown,
  IconTrendFlat,
  IconTrendUp,
} from "@/components/icons.tsx";
import { cn } from "@/lib/cn.ts";

export type TrendDirection = "up" | "down" | "flat";
export type TrendTone = "ok" | "warn" | "crit" | "neutral";

export interface MetricTrend {
  readonly direction: TrendDirection;
  readonly tone: TrendTone;
  readonly label: string;
}

export interface MetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly interval?: string;
  readonly trend?: MetricTrend;
  readonly note?: string;
  readonly className?: string;
}

const trendIcons: Record<TrendDirection, (props: IconProps) => JSX.Element> = {
  up: IconTrendUp,
  down: IconTrendDown,
  flat: IconTrendFlat,
};

const trendToneClasses: Record<TrendTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  neutral: "text-ink-3",
};

function TrendIndicator({ trend }: { readonly trend: MetricTrend }) {
  const Icon = trendIcons[trend.direction];
  return (
    <p
      className={cn("mt-2 flex items-center gap-1 text-xs", trendToneClasses[trend.tone])}
    >
      <Icon size={14} />
      {trend.label}
    </p>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  interval,
  trend,
  note,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border border-line bg-surface p-4 shadow-hair transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-line-2 hover:shadow-pop xs:p-5",
        className,
      )}
    >
      <span aria-hidden="true" className="absolute inset-y-4 left-0 w-0.5 bg-water/60" />
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="font-display text-4xl leading-none font-semibold tracking-tight text-ink tabular">
          {value}
        </span>
        {unit !== undefined && <span className="text-xs text-ink-2">{unit}</span>}
      </p>
      {interval !== undefined && (
        <p className="mt-1.5 font-mono text-xs text-ink-2 tabular">selang {interval}</p>
      )}
      {trend !== undefined && <TrendIndicator trend={trend} />}
      {note !== undefined && <p className="mt-1.5 text-xs text-ink-3">{note}</p>}
    </div>
  );
}
