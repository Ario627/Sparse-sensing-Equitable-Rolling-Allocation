import type { ExperimentStatus } from "@sera/contracts";
import { MeterBar } from "@/components/kit/meter-bar.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import { cn } from "@/lib/cn.ts";
import { formatNumber, formatPercent } from "@/lib/format.ts";
import { experimentStatusLabel, experimentStatusTone, progressRatio } from "./status.ts";

const EMPTY_VALUE = "—";
const INDETERMINATE_WIDTH = "34%";

export interface RunProgressProps {
  readonly status: ExperimentStatus;
  readonly runsDone: number;
  readonly runsTotal: number | null;
  readonly medianRegret: number | null;
  readonly worstSr: number | null;
  readonly className?: string;
}

function MetricPair({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label-caps text-ink-3">{label}</dt>
      <dd className="font-mono text-sm text-ink tabular">{value}</dd>
    </div>
  );
}

export function RunProgress({
  status,
  runsDone,
  runsTotal,
  medianRegret,
  worstSr,
  className,
}: RunProgressProps) {
  const ratio = progressRatio(runsDone, runsTotal);
  const tone = experimentStatusTone(status);
  const doneLabel =
    runsTotal === null
      ? EMPTY_VALUE
      : `${formatNumber(runsDone)} / ${formatNumber(runsTotal)}`;
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <StatusPill tone={tone} size="md" label={experimentStatusLabel(status)} />
        {ratio !== null && (
          <span className="font-mono text-sm font-medium text-ink tabular">
            {formatPercent(ratio)}
          </span>
        )}
      </div>
      {ratio === null ? (
        <div
          aria-hidden="true"
          className="h-2 overflow-hidden rounded-xs border border-line/80 bg-sunk"
        >
          <div
            className="h-full animate-pulse-soft bg-line-2"
            style={{ width: INDETERMINATE_WIDTH }}
          />
        </div>
      ) : (
        <MeterBar value={ratio} tone={tone} ticks={false} valueLabel={doneLabel} />
      )}
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <MetricPair
          label="Median regret"
          value={medianRegret === null ? EMPTY_VALUE : formatPercent(medianRegret, 1)}
        />
        <MetricPair
          label="SR terburuk"
          value={worstSr === null ? EMPTY_VALUE : formatNumber(worstSr, 2)}
        />
      </dl>
    </div>
  );
}
