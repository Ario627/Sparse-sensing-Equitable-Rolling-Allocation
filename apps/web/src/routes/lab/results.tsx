import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/kit/button.tsx";
import { CopyConfigButton } from "@/components/kit/copy-config-button.tsx";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import {
  useExperiment,
  useExperimentRuns,
  useExperiments,
} from "@/features/experiments/api.ts";
import {
  describeMetric,
  formatMetricValue,
  readRunMetrics,
  type MetricDescriptor,
} from "@/features/experiments/kpi.ts";
import {
  summarizeRuns,
  type MethodMetricSummary,
  type QuantileSummary,
} from "@/features/experiments/metric-summary.ts";
import {
  experimentStatusLabel,
  experimentStatusTone,
} from "@/features/experiments/status.ts";
import { formatDateTime, formatNumber } from "@/lib/format.ts";
import { buildSearch, readSearchString } from "@/lib/search.ts";
import { cn } from "@/lib/cn.ts";

const LIST_LIMIT = 50;
const RUN_LIMIT = 100;
const HASH_CHARS = 12;
const SUMMARY_KEYS = [
  "decision_regret",
  "worst_sr",
  "adequacy",
  "shortage_total_m3",
] as const;

const methodLabels: Record<string, string> = {
  sera: "SERA",
  proportional: "Proporsional",
  rotation: "Rotasi tetap",
  greedy: "Greedy ledger",
  oracle: "Oracle (penginderaan penuh)",
};

function methodLabel(method: string): string {
  return methodLabels[method] ?? method;
}

function rangeText(summary: QuantileSummary, descriptor: MetricDescriptor): string {
  return `p25–p75 ${formatNumber(summary.q1, descriptor.digits)}–${formatNumber(summary.q3, descriptor.digits)}`;
}

function MetricCell({
  descriptor,
  summary,
}: {
  readonly descriptor: MetricDescriptor;
  readonly summary: QuantileSummary | null;
}) {
  if (summary === null) {
    return (
      <div className="flex flex-col gap-0.5">
        <p className="label-caps text-ink-3">{descriptor.column}</p>
        <p className="font-mono text-sm text-ink-3 tabular">—</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <p className="label-caps text-ink-3">{descriptor.column}</p>
      <p className="font-mono text-sm font-medium text-ink tabular">
        {formatMetricValue(descriptor, summary.median)}
      </p>
      <p className="font-mono text-2xs text-ink-3 tabular">
        {rangeText(summary, descriptor)}
      </p>
    </div>
  );
}

function MethodRow({ summary }: { readonly summary: MethodMetricSummary }) {
  const descriptors = SUMMARY_KEYS.map((key) => describeMetric(key)).filter(
    (descriptor): descriptor is MetricDescriptor => descriptor !== null,
  );
  return (
    <section className="flex flex-col gap-3 border-b border-line/70 py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {methodLabel(summary.method)}
        </h3>
        <span className="font-mono text-xs text-ink-3 tabular">
          {formatNumber(summary.runCount)} run
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {descriptors.map((descriptor) => (
          <MetricCell
            key={descriptor.key}
            descriptor={descriptor}
            summary={summary.metrics[descriptor.key] ?? null}
          />
        ))}
      </div>
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

export function ResultsPage() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const listQuery = useExperiments({ limit: LIST_LIMIT });
  const items = listQuery.data?.items ?? [];
  const requested = readSearchString(search, "experiment");
  const selectedId = requested ?? items[0]?.id ?? null;
  const detailQuery = useExperiment(selectedId);
  const runsQuery = useExperimentRuns(
    selectedId ?? "",
    { page: 1, limit: RUN_LIMIT },
    selectedId !== null,
  );
  const detail = detailQuery.data ?? null;
  const runs = runsQuery.data?.items ?? [];
  const runInputs = runs.map((run) => ({
    method: run.method,
    values: readRunMetrics(run.metrics),
  }));
  const summaries = summarizeRuns(runInputs, SUMMARY_KEYS);
  const totalRuns = runsQuery.data?.total ?? 0;
  const truncated = totalRuns > runs.length;

  function selectExperiment(experimentId: string): void {
    navigate({
      to: "/lab/results",
      search: buildSearch({ experiment: experimentId }),
      replace: true,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Riset"
        title="Hasil"
        description="Ringkasan metrik per metode dari run yang terekam. Semua angka dihitung dari data nyata eksperimen terpilih."
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
      ) : listQuery.isPending ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Belum ada eksperimen"
          description="Jalankan eksperimen dari halaman Simulasi atau Anggaran Sensor."
          action={
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
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Pilih eksperimen"
              value={selectedId ?? ""}
              onChange={(event) => {
                selectExperiment(event.target.value);
              }}
              className={cn(inputClass, "w-auto max-w-full")}
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {detail !== null && (
              <StatusPill
                tone={experimentStatusTone(detail.status)}
                label={experimentStatusLabel(detail.status)}
              />
            )}
          </div>
          {selectedId !== null &&
            (detailQuery.isError ? (
              <ErrorState error={detailQuery.error} />
            ) : detail === null ? (
              <Skeleton className="h-40" />
            ) : (
              <section className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink">
                      {detail.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-ink-2">
                      Interval di bawah adalah kuartil antar-run (p25–p75),
                      bukan interval kepercayaan; uji statistik formal dihitung
                      di pipeline eksperimen dari Parquet.
                    </p>
                  </div>
                  <CopyConfigButton text={detail.config_yaml} />
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                  <Fact label="Config hash">
                    {detail.config_hash.slice(0, HASH_CHARS)}
                  </Fact>
                  <Fact label="Seed dasar">
                    {detail.seed_base === null
                      ? "—"
                      : formatNumber(detail.seed_base)}
                  </Fact>
                  <Fact label="Run selesai">
                    {formatNumber(detail.runs_done)}
                  </Fact>
                  <Fact label="Selesai pada">
                    {detail.finished_at === null
                      ? "—"
                      : formatDateTime(detail.finished_at)}
                  </Fact>
                </dl>
              </section>
            ))}
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
          ) : runsQuery.isPending ? (
            <Skeleton className="h-64" />
          ) : summaries.length === 0 ? (
            <EmptyState
              title="Belum ada run terekam"
              description="Ringkasan muncul setelah run pertama selesai."
            />
          ) : (
            <section className="flex flex-col rounded-md border border-line bg-surface px-4 py-2">
              {truncated && (
                <p className="pt-3 text-xs text-ink-3">
                  Menampilkan {formatNumber(runs.length)} run pertama dari{" "}
                  {formatNumber(totalRuns)}.
                </p>
              )}
              {summaries.map((summary) => (
                <MethodRow key={summary.method} summary={summary} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}