import type { ExperimentSummaryResponse } from "@sera/contracts";
import { type ReactNode, useMemo } from "react";
import { DataTable, type SeraColumnDef } from "@/components/kit/data-table.tsx";
import { MeterBar } from "@/components/kit/meter-bar.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import { cn } from "@/lib/cn.ts";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format.ts";
import { experimentStatusLabel, experimentStatusTone, progressRatio } from "./status.ts";

const EMPTY_VALUE = "—";
const HASH_CHARS = 8;

function ProgressCell({
  experiment,
}: {
  readonly experiment: ExperimentSummaryResponse;
}) {
  const ratio = progressRatio(experiment.runs_done, experiment.runs_total);
  if (ratio === null) {
    return <span className="font-mono text-xs text-ink-3 tabular">{EMPTY_VALUE}</span>;
  }
  return (
    <MeterBar
      value={ratio}
      tone={experimentStatusTone(experiment.status)}
      ticks={false}
      className="min-w-36"
      valueLabel={
        experiment.runs_total === null
          ? EMPTY_VALUE
          : `${formatNumber(experiment.runs_done)}/${formatNumber(experiment.runs_total)}`
      }
    />
  );
}

function NameCell({
  experiment,
  onOpen,
}: {
  readonly experiment: ExperimentSummaryResponse;
  readonly onOpen: ((experimentId: string) => void) | undefined;
}) {
  const content = (
    <>
      <span className="block max-w-64 truncate text-sm font-medium text-ink">
        {experiment.name}
      </span>
      <span className="block font-mono text-2xs text-ink-3 tabular">
        {experiment.config_hash.slice(0, HASH_CHARS)}
      </span>
    </>
  );
  if (onOpen === undefined) {
    return <span>{content}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => {
        onOpen(experiment.id);
      }}
      className="text-left hover:text-water"
    >
      {content}
    </button>
  );
}

function buildColumns(
  onOpen?: (experimentId: string) => void,
): SeraColumnDef<ExperimentSummaryResponse>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: "Eksperimen",
      cell: (info) => <NameCell experiment={info.row.original} onOpen={onOpen} />,
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      cell: (info) => {
        const experiment = info.row.original;
        return (
          <StatusPill
            tone={experimentStatusTone(experiment.status)}
            label={experimentStatusLabel(experiment.status)}
          />
        );
      },
    },
    {
      id: "progress",
      accessorFn: (row) => progressRatio(row.runs_done, row.runs_total),
      header: "Progres",
      cell: (info) => <ProgressCell experiment={info.row.original} />,
    },
    {
      id: "median_regret",
      accessorFn: (row) => row.median_regret,
      header: "Median regret",
      cell: (info) => {
        const value = info.row.original.median_regret;
        return (
          <span className="font-mono text-xs text-ink tabular">
            {value === null ? EMPTY_VALUE : formatPercent(value, 1)}
          </span>
        );
      },
    },
    {
      id: "worst_sr",
      accessorFn: (row) => row.worst_sr,
      header: "SR terburuk",
      cell: (info) => {
        const value = info.row.original.worst_sr;
        return (
          <span className="font-mono text-xs text-ink tabular">
            {value === null ? EMPTY_VALUE : formatNumber(value, 2)}
          </span>
        );
      },
    },
    {
      id: "created_at",
      accessorKey: "created_at",
      header: "Dibuat",
      cell: (info) => (
        <span className="font-mono text-xs text-ink-2 tabular">
          {formatDateTime(info.row.original.created_at)}
        </span>
      ),
    },
  ];
}

export interface ExperimentTableProps {
  readonly experiments: readonly ExperimentSummaryResponse[];
  readonly isLoading?: boolean;
  readonly onOpen?: (experimentId: string) => void;
  readonly emptyAction?: ReactNode;
  readonly className?: string;
}

export function ExperimentTable({
  experiments,
  isLoading = false,
  onOpen,
  emptyAction,
  className,
}: ExperimentTableProps) {
  const columns = useMemo(() => buildColumns(onOpen), [onOpen]);
  return (
    <DataTable
      columns={columns}
      data={[...experiments]}
      isLoading={isLoading}
      getRowId={(experiment) => experiment.id}
      emptyTitle="Belum ada eksperimen"
      emptyDescription="Jalankan eksperimen pertama dari halaman Simulasi."
      emptyAction={emptyAction}
      className={cn(className)}
    />
  );
}
