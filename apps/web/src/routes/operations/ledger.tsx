import type { LedgerEntryResponse } from "@sera/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { BarSeriesOption, LineSeriesOption } from "echarts/charts";
import type {
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import type { ComposeOption } from "echarts/core";
import { useMemo } from "react";
import { EChart } from "@/components/charts/echart.tsx";
import { Button } from "@/components/kit/button.tsx";
import { DataTable, type SeraColumnDef } from "@/components/kit/data-table.tsx";
import { EmptyState } from "@/components/kit/empty-state.tsx";
import { ErrorState } from "@/components/kit/error-state.tsx";
import { inputClass } from "@/components/kit/field.tsx";
import { InfoDialog } from "@/components/kit/info-dialog.tsx";
import { PageHeader } from "@/components/kit/page-header.tsx";
import { RoleGate } from "@/components/kit/role-gate.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { StatusPill } from "@/components/kit/status-pill.tsx";
import {
  periodPoints,
  useLedgerCurrent,
  useLedgerHistory,
} from "@/features/ledger/api.ts";
import { useNetworks } from "@/features/network/api.ts";
import { ledgerRoles } from "@/lib/auth/roles.ts";
import { chartColors, chartFonts } from "@/lib/charts/theme.ts";
import { cn } from "@/lib/cn.ts";
import {
  formatCappedPercent,
  formatDate,
  formatNumber,
  formatUnit,
} from "@/lib/format.ts";
import { palette, rgba } from "@/lib/palette.ts";
import { buildSearch, readSearchString } from "@/lib/search.ts";

const CHART_HEIGHT = 268;
const PERIOD_POINTS = 14;
const HISTORY_LIMIT = 400;
const LAGGING_COUNT = 3;
const RATIO_AXIS_MAX = 1.2;

type LedgerChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
>;

interface LedgerPoint {
  readonly periodEnd: string;
  readonly debtM3: number;
  readonly meanServiceRatio: number;
  readonly blocks: number;
  readonly cappedBlocks: number;
}

function axisDateLabel(ms: number): string {
  return formatDate(new Date(ms).toISOString());
}

function buildChartOption(points: readonly LedgerPoint[]): LedgerChartOption {
  return {
    animation: false,
    grid: { left: 8, right: 8, top: 38, bottom: 2, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const first = list.at(0) as { readonly axisValue?: number } | undefined;
        const ms = typeof first?.axisValue === "number" ? first.axisValue : null;
        if (ms === null) {
          return "";
        }
        const point = points.find((entry) => Date.parse(entry.periodEnd) === ms);
        if (point === undefined) {
          return "";
        }
        const header = `<div style="font-family:${chartFonts.mono};font-size:11px;color:${chartColors.ink3};margin-bottom:4px">${formatDate(point.periodEnd)}</div>`;
        const debt = `<div style="display:flex;align-items:center"><span style="display:inline-block;width:8px;height:8px;background:${palette.warn};margin-right:6px"></span><span style="font-family:${chartFonts.mono};font-variant-numeric:tabular-nums">${formatUnit(point.debtM3, "m³", 1)}</span></div>`;
        const ratio = `<div style="display:flex;align-items:center;margin-top:2px"><span style="display:inline-block;width:8px;height:8px;background:${palette.water};margin-right:6px"></span><span style="font-family:${chartFonts.mono};font-variant-numeric:tabular-nums">rasio ${formatCappedPercent(point.meanServiceRatio)}</span></div>`;
        const note = `<div style="margin-top:3px;font-size:11px;color:${chartColors.ink3}">${formatNumber(point.blocks)} blok · ${formatNumber(point.cappedBlocks)} tertahan</div>`;
        return header + debt + ratio + note;
      },
    },
    xAxis: {
      type: "time",
      axisLabel: { formatter: axisDateLabel, hideOverlap: true },
    },
    yAxis: [
      {
        type: "value",
        name: "m³",
        splitNumber: 3,
        axisLabel: { formatter: (value: number) => formatNumber(value) },
      },
      {
        type: "value",
        name: "%",
        min: 0,
        max: RATIO_AXIS_MAX,
        splitNumber: 3,
        splitLine: { show: false },
        axisLabel: {
          formatter: (value: number) => formatNumber(value * 100),
        },
      },
    ],
    series: [
      {
        id: "debt",
        name: "Tunggakan",
        type: "bar",
        data: points.map((point) => [Date.parse(point.periodEnd), point.debtM3]),
        barMaxWidth: 18,
        itemStyle: { color: rgba(palette.warn, 0.85), borderRadius: [3, 3, 0, 0] },
      },
      {
        id: "ratio",
        name: "Rasio layanan",
        type: "line",
        yAxisIndex: 1,
        data: points.map((point) => [
          Date.parse(point.periodEnd),
          point.meanServiceRatio,
        ]),
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: palette.water, width: 2 },
        itemStyle: { color: palette.water },
      },
    ],
  };
}

function buildColumns(): SeraColumnDef<LedgerEntryResponse>[] {
  return [
    {
      id: "block",
      accessorKey: "block_name",
      header: "Blok",
      cell: (info) => (
        <span className="text-sm font-medium text-ink">
          {info.row.original.block_name}
        </span>
      ),
    },
    {
      id: "fair",
      accessorKey: "target_fair_m3",
      header: "Target adil",
      cell: (info) => (
        <span className="font-mono text-xs text-ink-2 tabular">
          {formatUnit(info.row.original.target_fair_m3, "m³", 1)}
        </span>
      ),
    },
    {
      id: "delivered",
      accessorKey: "delivered_m3",
      header: "Tersalur",
      cell: (info) => (
        <span className="font-mono text-xs text-ink tabular">
          {formatUnit(info.row.original.delivered_m3, "m³", 1)}
        </span>
      ),
    },
    {
      id: "ratio",
      accessorKey: "service_ratio",
      header: "Rasio",
      cell: (info) => (
        <span className="font-mono text-xs text-ink tabular">
          {formatCappedPercent(info.row.original.service_ratio)}
        </span>
      ),
    },
    {
      id: "debt",
      accessorFn: (row) => row.debt_m3,
      header: "Tunggakan",
      cell: (info) => {
        const entry = info.row.original;
        if (entry.debt_m3 <= 0) {
          return <span className="text-xs text-ink-3">lunas</span>;
        }
        return (
          <span
            className={cn(
              "font-mono text-xs tabular",
              entry.debt_capped ? "text-crit" : "text-warn",
            )}
          >
            {formatUnit(entry.debt_m3, "m³", 1)}
          </span>
        );
      },
    },
    {
      id: "state",
      accessorFn: (row) => row.debt_capped,
      header: "Status",
      cell: (info) =>
        info.row.original.debt_capped ? (
          <StatusPill tone="crit" label="Tertahan" />
        ) : info.row.original.debt_m3 > 0 ? (
          <StatusPill tone="warn" label="Menunggak" />
        ) : (
          <StatusPill tone="ok" label="Lunas" />
        ),
    },
  ];
}

function StatCell({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
}) {
  return (
    <div className="flex flex-col px-5 py-3.5">
      <p className="label-caps text-ink-3">{label}</p>
      <p className="mt-1 font-display text-2xl leading-none font-semibold text-ink tabular">
        {value}
      </p>
      <p className="mt-1 truncate text-2xs text-ink-3">{note}</p>
    </div>
  );
}

export function LedgerPage() {
  return (
    <RoleGate
      allow={ledgerRoles}
      title="Halaman neraca khusus operator dan peneliti"
      description="Neraca layanan memuat tunggakan antar periode, jadi hanya terbuka untuk peran yang berwenang membacanya."
    >
      <LedgerContent />
    </RoleGate>
  );
}

function LedgerContent() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const networksQuery = useNetworks({ limit: 50 });
  const networks = networksQuery.data?.items ?? [];
  const requestedId = readSearchString(search, "network");
  const networkId = requestedId ?? networks[0]?.id ?? null;
  const currentQuery = useLedgerCurrent(networkId);
  const historyQuery = useLedgerHistory({
    limit: HISTORY_LIMIT,
    ...(networkId === null ? {} : { network_id: networkId }),
  });

  const summary = currentQuery.data?.summary ?? null;
  const entries = currentQuery.data?.items ?? [];
  const points = useMemo(
    () => periodPoints(historyQuery.data?.items ?? [], PERIOD_POINTS),
    [historyQuery.data],
  );
  const option = useMemo(() => buildChartOption(points), [points]);
  const columns = useMemo(() => buildColumns(), []);
  const lagging = useMemo(
    () =>
      [...entries]
        .filter((entry) => entry.debt_m3 > 0)
        .sort((a, b) => b.debt_m3 - a.debt_m3)
        .slice(0, LAGGING_COUNT),
    [entries],
  );

  function selectNetwork(nextId: string): void {
    navigate({ to: "/operations/ledger", search: buildSearch({ network: nextId }) });
  }

  const networkSelect =
    networks.length > 1 ? (
      <select
        aria-label="Pilih jaringan"
        value={networkId ?? ""}
        onChange={(event) => {
          selectNetwork(event.target.value);
        }}
        className={cn(inputClass, "w-auto")}
      >
        {networks.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    ) : null;

  if (networksQuery.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Neraca" />
        <Skeleton className="h-24" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (networksQuery.isError) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Neraca" />
        <ErrorState error={networksQuery.error} />
      </div>
    );
  }

  if (networks.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Operasi" title="Neraca" />
        <EmptyState
          title="Belum ada jaringan"
          description="Minta admin mendaftarkan jaringan irigasi sebelum memakai halaman operasi."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Operasi"
        title="Neraca"
        description="Layanan tersalur per blok dan tunggakan antar periode."
        actions={networkSelect}
      />
      {currentQuery.isError ? (
        <ErrorState
          error={currentQuery.error}
          action={
            <Button
              size="sm"
              onClick={() => {
                void currentQuery.refetch();
              }}
            >
              Coba lagi
            </Button>
          }
        />
      ) : (
        <>
          <section className="grid grid-cols-2 divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-hair sm:grid-cols-4 sm:divide-x">
            <StatCell
              label="Rasio terendah"
              value={formatCappedPercent(summary?.worst_sr ?? null)}
              note="blok paling tertinggal"
            />
            <StatCell
              label="Rasio rata-rata"
              value={formatCappedPercent(summary?.mean_sr ?? null)}
              note={`${formatNumber(summary?.block_count ?? 0)} blok pada periode ini`}
            />
            <StatCell
              label="Total tunggakan"
              value={formatUnit(summary?.total_debt_m3 ?? 0, "m³", 1)}
              note="belum tertutup di periode berjalan"
            />
            <StatCell
              label="Blok tertahan"
              value={formatNumber(summary?.capped_blocks ?? 0)}
              note="tunggakan mencapai batas"
            />
          </section>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-hair">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <p className="label-caps text-water">Tunggakan per periode</p>
                  <p className="mt-1 text-xs text-ink-3">
                    Batang: total tunggakan. Garis: rasio layanan rata-rata.
                  </p>
                </div>
                <InfoDialog
                  label="Cara membaca"
                  eyebrow="Neraca"
                  title="Membaca neraca layanan"
                  triggerClassName="border border-line-2 bg-surface"
                >
                  <div className="flex flex-col gap-3">
                    <p>
                      Setiap periode, kebutuhan tiap blok dicatat sebagai target, lalu
                      dibandingkan dengan volume yang benar-benar tersalur. Selisihnya
                      menjadi tunggakan yang dibawa ke periode berikutnya.
                    </p>
                    <p>
                      Rasio layanan adalah volume tersalur dibagi target adil. Nilai di
                      atas 100% berarti blok menerima lebih dari bagian adilnya pada
                      periode itu.
                    </p>
                    <p>
                      Tunggakan yang mencapai batas kebijakan ditandai tertahan, artinya
                      blok itu tidak lagi menumpuk tunggakan tak terbatas dan prioritas
                      pemulihannya dinaikkan.
                    </p>
                  </div>
                </InfoDialog>
              </div>
              <div className="px-3 pt-3 pb-1">
                {historyQuery.isError ? (
                  <div className="px-2 pb-3">
                    <ErrorState error={historyQuery.error} />
                  </div>
                ) : historyQuery.isPending ? (
                  <Skeleton className="h-60" />
                ) : points.length < 2 ? (
                  <div className="grid h-60 place-items-center rounded-md bg-sunk/60 text-xs text-ink-3">
                    Butuh minimal dua periode tercatat untuk menggambar tren.
                  </div>
                ) : (
                  <EChart
                    option={option}
                    height={CHART_HEIGHT}
                    ariaLabel="Tunggakan dan rasio layanan per periode"
                  />
                )}
              </div>
            </section>
            <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-hair">
              <p className="label-caps text-water">Perlu dipulihkan</p>
              {lagging.length === 0 ? (
                <p className="text-sm text-ink-2">
                  Tidak ada tunggakan pada periode berjalan.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {lagging.map((entry) => {
                    const ratio = Math.min(1, Math.max(0, entry.service_ratio));
                    return (
                      <li key={entry.block_id} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm text-ink">
                            {entry.block_name}
                          </span>
                          <span className="font-mono text-xs text-warn tabular">
                            {formatUnit(entry.debt_m3, "m³", 1)}
                          </span>
                        </div>
                        <span className="flume-bed h-2 overflow-hidden rounded-xs bg-sunk">
                          <span
                            className={cn(
                              "block h-full",
                              entry.debt_capped ? "bg-crit" : "bg-warn",
                            )}
                            style={{ width: `${Math.round(ratio * 100)}%` }}
                          />
                        </span>
                        <p className="text-2xs text-ink-3">
                          rasio {formatCappedPercent(entry.service_ratio)}
                          {entry.debt_capped ? " · tertahan" : ""}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
          {currentQuery.isPending ? (
            <Skeleton className="h-56" />
          ) : (
            <DataTable
              columns={columns}
              data={[...entries]}
              getRowId={(entry) => entry.block_id}
              emptyTitle="Belum ada periode tercatat"
              emptyDescription="Neraca terisi setelah estimator menutup periode layanan."
            />
          )}
        </>
      )}
    </div>
  );
}
