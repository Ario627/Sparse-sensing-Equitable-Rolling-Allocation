import type { ExperimentRunResponse } from "@sera/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/kit/button.tsx";
import { CopyConfigButton } from "@/components/kit/copy-config-button.tsx";
import { DataTable, type SeraColumnDef } from "@/components/kit/data-table.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { RoleGate } from "@/components/kit/role-gate.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import {
  useCancelExperiment,
  useExperiment,
  useExperimentRuns,
  useExperiments,
} from "@/features/experiments/api.ts";
import { ExperimentTable } from "@/features/experiments/experiment-table.tsx";
import {
  describeMetric,
  formatMetricValue,
  readRunMetrics,
} from "@/features/experiments/kpi.ts";
import { summarizeRuns } from "@/features/experiments/metric-summary.ts";
import {
  MethodComparisonChart,
  RunMetricChart,
} from "@/features/experiments/run-charts.tsx";
import { RunProgress } from "@/features/experiments/run-progress.tsx";
import { hasMetric } from "@/features/experiments/run-series.ts";
import { runStatusLabel, runStatusTone } from "@/features/experiments/status.ts";
import { isApiError } from "@/lib/api/client.ts";
import { labRoles } from "@/lib/auth/roles.ts";
import { formatDateTime, formatNumber } from "@/lib/format.ts";
import { buildSearch, readSearchString } from "@/lib/search.ts";

const LIST_LIMIT = 50;
const RUN_LIMIT = 50;
const HASH_CHARS = 12;
const REGRET_KEY = "decision_regret";

interface RegretValue {
  readonly value: number | null;
  readonly text: string;
}

function runRegret(entry: ExperimentRunResponse): RegretValue {
  const metric = readRunMetrics(entry.metrics).find(
    (item) => item.descriptor.key === REGRET_KEY,
  );
  if (metric === undefined) {
    return { value: null, text: "—" };
  }
  return {
    value: metric.value,
    text: formatMetricValue(metric.descriptor, metric.value),
  };
}

function buildRunColumns(): SeraColumnDef<ExperimentRunResponse>[] {
  return [
    {
      id: "run_index",
      accessorKey: "run_index",
      header: "Run",
      cell: (info) => (
        <span className="font-mono text-xs text-ink tabular">
          {formatNumber(info.row.original.run_index)}
        </span>
      ),
    },
    {
      id: "scenario",
      accessorKey: "scenario_id",
      header: "Skenario",
      cell: (info) => (
        <span className="text-xs text-ink-2">{info.row.original.scenario_id}</span>
      ),
    },
    {
      id: "method",
      accessorKey: "method",
      header: "Metode",
      cell: (info) => (
        <span className="text-xs text-ink-2">{info.row.original.method}</span>
      ),
    },
    {
      id: "sensors",
      accessorFn: (row) => row.sensor_count,
      header: "Sensor",
      cell: (info) => (
        <span className="font-mono text-xs text-ink-2 tabular">
          {formatNumber(info.row.original.sensor_count)}
        </span>
      ),
    },
    {
      id: "topology",
      accessorKey: "topology",
      header: "Topologi",
      cell: (info) => (
        <span className="text-xs text-ink-2">{info.row.original.topology}</span>
      ),
    },
    {
      id: "k_factor",
      accessorFn: (row) => row.k_factor,
      header: "K",
      cell: (info) => (
        <span className="font-mono text-xs text-ink-2 tabular">
          {info.row.original.k_factor === null
            ? "—"
            : formatNumber(info.row.original.k_factor, 2)}
        </span>
      ),
    },
    {
      id: "regret",
      accessorFn: (row) => runRegret(row).value,
      header: "Regret",
      cell: (info) => (
        <span className="font-mono text-xs text-ink tabular">
          {runRegret(info.row.original).text}
        </span>
      ),
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: "Status",
      cell: (info) => (
        <StatusPill
          tone={runStatusTone(info.row.original.status)}
          label={runStatusLabel(info.row.original.status)}
        />
      ),
    },
  ];
}

const runColumns = buildRunColumns();

interface ChartCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
}

function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle !== undefined && (
          <span className="text-2xs text-ink-3">{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label-caps text-ink-3">{label}</dt>
      <dd className="font-mono text-xs text-ink tabular">{children}</dd>
    </div>
  );
}

export function ExperimentsPage() {
  return (
    <RoleGate
      allow={labRoles}
      title="Halaman riset khusus peneliti"
      description="Pemantauan batch eksperimen hanya terbuka untuk peran peneliti atau admin."
    >
      <ExperimentsContent />
    </RoleGate>
  );
}

function ExperimentsContent() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const [runsPage, setRunsPage] = useState(1);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const listQuery = useExperiments({ limit: LIST_LIMIT });
  const items = listQuery.data?.items ?? [];
  const requested = readSearchString(search, "experiment");
  const selectedId = requested ?? items[0]?.id ?? null;
  const detailQuery = useExperiment(selectedId);
  const runsQuery = useExperimentRuns(
    selectedId ?? "",
    { page: runsPage, limit: RUN_LIMIT },
    selectedId !== null,
  );
  const cancel = useCancelExperiment(selectedId ?? "");
  const detail = detailQuery.data ?? null;
  const runs = runsQuery.data?.items ?? [];
  const chartKeys = ["decision_regret", "worst_sr"] as const;
  const availableCharts = chartKeys.filter((key) => hasMetric(runs, key));
  const comparisonKey =
    availableCharts.length === 0
      ? null
      : availableCharts.includes("decision_regret")
        ? "decision_regret"
        : (availableCharts[0] ?? null);
  const comparisonSummaries =
    comparisonKey === null
      ? []
      : summarizeRuns(
          runs.map((run) => ({
            method: run.method,
            values: readRunMetrics(run.metrics),
          })),
          [comparisonKey],
        );

  function selectExperiment(experimentId: string): void {
    setRunsPage(1);
    setCancelError(null);
    navigate({
      to: "/lab/experiments",
      search: buildSearch({ experiment: experimentId }),
      replace: true,
    });
  }

  async function cancelSelected(): Promise<void> {
    setCancelError(null);
    await cancel.mutateAsync().catch((cause: unknown) => {
      setCancelError(isApiError(cause) ? cause.message : "Pembatalan gagal. Coba lagi.");
    });
  }

  const live =
    detail !== null && (detail.status === "QUEUED" || detail.status === "RUNNING");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Riset"
        title="Eksperimen"
        description="Pantau batch yang berjalan dan periksa hasil per run."
      />
      {listQuery.isError ? (
        <ErrorState
          error={listQuery.error}
          action={
            <Button
              size="sm"
              onClick={() => {
                void listQuery.refetch();
              }}
            >
              Coba lagi
            </Button>
          }
        />
      ) : (
        <ExperimentTable
          experiments={items}
          isLoading={listQuery.isPending}
          onOpen={selectExperiment}
          emptyAction={
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                void navigate({ to: "/lab/simulation" });
              }}
            >
              Buka Simulasi
            </Button>
          }
        />
      )}
      {selectedId !== null &&
        (detailQuery.isError ? (
          <ErrorState
            error={detailQuery.error}
            action={
              <Button
                size="sm"
                onClick={() => {
                  void detailQuery.refetch();
                }}
              >
                Coba lagi
              </Button>
            }
          />
        ) : detail === null ? (
          <Skeleton className="h-56" />
        ) : (
          <section className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="label-caps text-ink-3">Eksperimen terpilih</p>
                <h2 className="mt-0.5 text-base font-semibold text-ink">{detail.name}</h2>
                {detail.description !== null && (
                  <p className="mt-0.5 text-xs text-ink-2">{detail.description}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {live && (
                  <Button
                    size="sm"
                    variant="danger"
                    pending={cancel.isPending}
                    pendingLabel="Membatalkan…"
                    onClick={() => {
                      void cancelSelected();
                    }}
                  >
                    Batalkan
                  </Button>
                )}
                <CopyConfigButton text={detail.config_yaml} />
              </div>
            </div>
            {cancelError !== null && (
              <p role="alert" className="text-xs text-crit">
                {cancelError}
              </p>
            )}
            <RunProgress
              status={detail.status}
              runsDone={detail.runs_done}
              runsTotal={detail.runs_total}
              medianRegret={detail.median_regret}
              worstSr={detail.worst_sr}
            />
            <dl className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-x-6 gap-y-2 sm:grid-cols-[repeat(4,minmax(0,1fr))]">
              <Fact label="Config hash">{detail.config_hash.slice(0, HASH_CHARS)}</Fact>
              <Fact label="Seed dasar">
                {detail.seed_base === null ? "—" : formatNumber(detail.seed_base)}
              </Fact>
              <Fact label="Dibuat">{formatDateTime(detail.created_at)}</Fact>
              <Fact label="Selesai">
                {detail.finished_at === null ? "—" : formatDateTime(detail.finished_at)}
              </Fact>
            </dl>
          </section>
        ))}
      {selectedId !== null &&
        detail !== null &&
        runs.length >= 2 &&
        availableCharts.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="label-caps text-ink-3">Hasil per run</p>
              <span className="font-mono text-2xs text-ink-3 tabular">
                {formatNumber(runs.length)} run · gulir atau seret untuk zoom
              </span>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {availableCharts.includes("decision_regret") && (
                <ChartCard
                  title="Regret keputusan"
                  subtitle="per run — lebih rendah lebih baik"
                >
                  <RunMetricChart runs={runs} metricKey="decision_regret" />
                </ChartCard>
              )}
              {availableCharts.includes("worst_sr") && (
                <ChartCard
                  title="SR terburuk"
                  subtitle="per run — lebih tinggi lebih baik"
                >
                  <RunMetricChart runs={runs} metricKey="worst_sr" />
                </ChartCard>
              )}
            </div>
            {comparisonKey !== null && comparisonSummaries.length > 0 && (
              <ChartCard
                title={`Median ${describeMetric(comparisonKey)?.label ?? "metrik"} per metode`}
                subtitle="dari run yang terekam pada eksperimen ini"
              >
                <MethodComparisonChart
                  summaries={comparisonSummaries}
                  metricKey={comparisonKey}
                />
              </ChartCard>
            )}
          </section>
        )}
      {selectedId !== null && (
        <section className="flex flex-col gap-2">
          <p className="label-caps text-ink-3">Runs</p>
          {runsQuery.isError ? (
            <ErrorState
              error={runsQuery.error}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    void runsQuery.refetch();
                  }}
                >
                  Coba lagi
                </Button>
              }
            />
          ) : (
            <DataTable
              columns={runColumns}
              data={[...runs]}
              isLoading={runsQuery.isPending}
              sortable={false}
              serverPager={{
                page: runsPage,
                pageSize: RUN_LIMIT,
                totalPages: runsQuery.data?.total_pages ?? 1,
                total: runsQuery.data?.total ?? 0,
                onPageChange: setRunsPage,
              }}
              getRowId={(entry) => `${entry.run_index}`}
              emptyTitle="Belum ada run"
              emptyDescription="Run akan muncul saat solver mulai bekerja."
            />
          )}
        </section>
      )}
    </div>
  );
}
