import type { ExperimentRunResponse } from "@sera/contracts";
import type { BarSeriesOption, LineSeriesOption } from "echarts/charts";
import type {
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  ToolboxComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import type { ComposeOption } from "echarts/core";
import { useMemo } from "react";
import { EChart } from "@/components/charts/echart.tsx";
import { chartColors, chartFonts } from "@/lib/charts/theme.ts";
import { formatNumber } from "@/lib/format.ts";
import { palette } from "@/lib/palette.ts";
import { describeMetric, formatMetricValue, type MetricDescriptor } from "./kpi.ts";
import type { MethodMetricSummary } from "./metric-summary.ts";
import { buildRunSeries, methodLabel, type RunSeries } from "./run-series.ts";

const RUN_CHART_HEIGHT = 216;
const COMPARISON_CHART_HEIGHT = 196;
const NO_DATA_TEXT = "Belum ada data untuk grafik ini.";

type LineOption = ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | ToolboxComponentOption
  | DataZoomComponentOption
>;

type BarOption = ComposeOption<
  BarSeriesOption | GridComponentOption | TooltipComponentOption
>;

const METHOD_COLORS: Record<string, string> = {
  sera: palette.water,
  proportional: palette.info,
  rotation: palette.paddy,
  greedy: palette.warn,
  oracle: palette.ink2,
};

const FALLBACK_COLOR = palette.ink3;

function methodColor(method: string): string {
  return METHOD_COLORS[method] ?? FALLBACK_COLOR;
}

function markerHtml(color: string): string {
  return `<span style="display:inline-block;width:8px;height:8px;background:${color};border-radius:2px;margin-right:6px"></span>`;
}

function lineTooltip(
  descriptor: MetricDescriptor,
): (params: unknown) => string {
  return (params) => {
    const entry = Array.isArray(params) ? params.at(0) : params;
    if (typeof entry !== "object" || entry === null) {
      return "";
    }
    const record = entry as Record<string, unknown>;
    const color = typeof record.color === "string" ? record.color : chartColors.water;
    const name = typeof record.seriesName === "string" ? record.seriesName : "";
    const data = record.data;
    if (
      !Array.isArray(data) ||
      typeof data[0] !== "number" ||
      typeof data[1] !== "number"
    ) {
      return "";
    }
    const header = `<div style="font-family:${chartFonts.mono};font-size:11px;color:${chartColors.ink3};margin-bottom:4px">Run #${formatNumber(data[0])}</div>`;
    const row = `<div style="display:flex;align-items:center">${markerHtml(color)}<span style="color:${chartColors.ink2}">${name}</span><span style="margin-left:10px;font-family:${chartFonts.mono};font-variant-numeric:tabular-nums">${formatMetricValue(descriptor, data[1])}</span></div>`;
    return header + row;
  };
}

interface ComparisonEntry {
  readonly method: string;
  readonly median: number;
  readonly n: number;
  readonly runs: number;
}

function barTooltip(
  entries: readonly ComparisonEntry[],
  descriptor: MetricDescriptor,
): (params: unknown) => string {
  return (params) => {
    if (typeof params !== "object" || params === null) {
      return "";
    }
    const index = (params as { dataIndex?: unknown }).dataIndex;
    if (typeof index !== "number") {
      return "";
    }
    const entry = entries[index];
    if (entry === undefined) {
      return "";
    }
    const header = `<div style="font-family:${chartFonts.mono};font-size:11px;color:${chartColors.ink3};margin-bottom:4px">${methodLabel(entry.method)}</div>`;
    const value = `<div style="display:flex;align-items:center">${markerHtml(methodColor(entry.method))}<span style="font-family:${chartFonts.mono};font-variant-numeric:tabular-nums">${formatMetricValue(descriptor, entry.median)}</span></div>`;
    const note = `<div style="margin-top:3px;font-size:11px;color:${chartColors.ink3}">median dari ${formatNumber(entry.n)} run · total ${formatNumber(entry.runs)} run metode</div>`;
    return header + value + note;
  };
}

function buildLineOption(
  series: readonly RunSeries[],
  descriptor: MetricDescriptor,
): LineOption {
  return {
    animation: false,
    grid: { left: 6, right: 12, top: 26, bottom: 28, containLabel: true },
    legend: {
      bottom: 0,
      left: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 3,
      itemGap: 14,
      textStyle: {
        color: chartColors.ink2,
        fontFamily: chartFonts.sans,
        fontSize: 12,
      },
    },
    toolbox: {
      right: 0,
      top: 0,
      itemSize: 14,
      iconStyle: { borderColor: chartColors.line2, borderWidth: 1.1 },
      emphasis: { iconStyle: { borderColor: chartColors.water } },
      feature: {
        dataZoom: { yAxisIndex: "none" },
        restore: {},
      },
    },
    tooltip: { trigger: "item", confine: true, formatter: lineTooltip(descriptor) },
    dataZoom: [{ type: "inside", xAxisIndex: 0 }],
    xAxis: {
      type: "value",
      min: 0,
      minInterval: 1,
      axisLabel: { formatter: (value: number) => formatNumber(value) },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number) => formatMetricValue(descriptor, value),
      },
    },
    series: series.map((entry) => ({
      id: entry.method,
      name: methodLabel(entry.method),
      type: "line" as const,
      data: entry.points.map((point) => [point.x, point.y]),
      showSymbol: true,
      symbolSize: 5,
      connectNulls: false,
      lineStyle: {
        width: entry.method === "sera" ? 2.4 : 1.6,
        color: methodColor(entry.method),
      },
      itemStyle: { color: methodColor(entry.method) },
      emphasis: { focus: "series" as const },
    })),
  };
}

function comparisonEntries(
  summaries: readonly MethodMetricSummary[],
  metricKey: string,
): readonly ComparisonEntry[] {
  const entries: ComparisonEntry[] = [];
  for (const summary of summaries) {
    const quantiles = summary.metrics[metricKey];
    if (quantiles === undefined || quantiles === null) {
      continue;
    }
    entries.push({
      method: summary.method,
      median: quantiles.median,
      n: quantiles.n,
      runs: summary.runCount,
    });
  }
  return entries;
}

function buildBarOption(
  entries: readonly ComparisonEntry[],
  descriptor: MetricDescriptor,
): BarOption {
  return {
    animation: false,
    grid: { left: 6, right: 12, top: 24, bottom: 2, containLabel: true },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: barTooltip(entries, descriptor),
    },
    xAxis: {
      type: "category",
      data: entries.map((entry) => methodLabel(entry.method)),
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number) => formatMetricValue(descriptor, value),
      },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 42,
        data: entries.map((entry) => ({
          value: entry.median,
          itemStyle: { color: methodColor(entry.method), borderRadius: [3, 3, 0, 0] },
        })),
        label: {
          show: true,
          position: "top",
          formatter: (params: unknown) => {
            const value = (params as { value?: unknown }).value;
            return typeof value === "number"
              ? formatMetricValue(descriptor, value)
              : "";
          },
          color: chartColors.ink2,
          fontFamily: chartFonts.mono,
          fontSize: 11,
        },
      },
    ],
  };
}

export interface RunMetricChartProps {
  readonly runs: readonly ExperimentRunResponse[];
  readonly metricKey: string;
}

export function RunMetricChart({ runs, metricKey }: RunMetricChartProps) {
  const descriptor = describeMetric(metricKey);
  const series = useMemo(() => buildRunSeries(runs, metricKey), [runs, metricKey]);
  const option = useMemo(
    () => (descriptor === null ? null : buildLineOption(series, descriptor)),
    [series, descriptor],
  );
  if (descriptor === null || option === null || series.length === 0) {
    return <p className="text-sm text-ink-3">{NO_DATA_TEXT}</p>;
  }
  const total = series.reduce((sum, entry) => sum + entry.points.length, 0);
  return (
    <EChart
      option={option}
      height={RUN_CHART_HEIGHT}
      ariaLabel={`${descriptor.label} per run · ${formatNumber(total)} titik`}
    />
  );
}

export interface MethodComparisonChartProps {
  readonly summaries: readonly MethodMetricSummary[];
  readonly metricKey: string;
}

export function MethodComparisonChart({
  summaries,
  metricKey,
}: MethodComparisonChartProps) {
  const descriptor = describeMetric(metricKey);
  const entries = useMemo(
    () => comparisonEntries(summaries, metricKey),
    [summaries, metricKey],
  );
  const option = useMemo(
    () => (descriptor === null ? null : buildBarOption(entries, descriptor)),
    [entries, descriptor],
  );
  if (descriptor === null || option === null || entries.length === 0) {
    return <p className="text-sm text-ink-3">{NO_DATA_TEXT}</p>;
  }
  return (
    <EChart
      option={option}
      height={COMPARISON_CHART_HEIGHT}
      ariaLabel={`Median ${descriptor.label} per metode · ${formatNumber(entries.length)} metode`}
    />
  );
}
