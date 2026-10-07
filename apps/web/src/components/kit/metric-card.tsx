import {
  IconTrendDown,
  IconTrendFlat,
  IconTrendUp,
  type IconProps,
} from "@/components/icons.tsx";
import { cn } from "@/lib/cn.ts";
import type { JSX } from "react/jsx-runtime";

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
      className={cn(
        "mt-2 flex items-center gap-1 text-xs",
        trendToneClasses[trend.tone],
      )}
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
        "rounded-md border border-line bg-surface p-3 xs:p-4",
        className,
      )}
    >
      <p className="label-caps text-ink-3">{label}</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl leading-none font-medium tracking-tight text-ink tabular">
          {value}
        </span>
        {unit !== undefined && <span className="text-xs text-ink-2">{unit}</span>}
      </p>
      {interval !== undefined && (
        <p className="mt-1.5 font-mono text-xs text-ink-2 tabular">
          selang {interval}
        </p>
      )}
      {trend !== undefined && <TrendIndicator trend={trend} />}
      {note !== undefined && <p className="mt-1.5 text-xs text-ink-3">{note}</p>}
    </div>
  );
}