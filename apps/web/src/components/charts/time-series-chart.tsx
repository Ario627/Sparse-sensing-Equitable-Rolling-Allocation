import type { LineSeriesOption } from "echarts/charts";
import type { GridComponentOption, TooltipComponentOption } from "echarts/components";
import type { ComposeOption } from "echarts/core";
import { useMemo } from "react";
import {
  chartColors,
  chartFonts,
  type SeriesTone,
  seriesTones,
} from "@/lib/charts/theme.ts";
import { formatClockMs, formatInterval, formatNumber } from "@/lib/format.ts";
import { rgba } from "@/lib/palette.ts";
import { EChart } from "./echart.tsx";

const DEFAULT_HEIGHT = 180;
const DEFAULT_DIGITS = 2;
const SAMPLING_THRESHOLD = 300;
const SYMBOL_THRESHOLD = 30;
const MARKER_SIZE = 8;

export interface TimeSeriesPoint {
  readonly ts: string;
  readonly value: number;
  readonly low?: number | null;
  readonly high?: number | null;
}

export interface TimeSeriesChartProps {
  readonly points: readonly TimeSeriesPoint[];
  readonly label: string;
  readonly unit: string;
  readonly height?: number;
  readonly digits?: number;
  readonly includeZero?: boolean;
  readonly tone?: SeriesTone;
  readonly animate?: boolean;
  readonly compact?: boolean;
  readonly className?: string;
}

type TimeSeriesOption = ComposeOption<
  LineSeriesOption | GridComponentOption | TooltipComponentOption
>;

interface BandData {
  readonly base: [number, number][];
  readonly width: [number, number][];
}

interface BuildInput {
  readonly points: readonly TimeSeriesPoint[];
  readonly label: string;
  readonly unit: string;
  readonly digits: number;
  readonly includeZero: boolean;
  readonly tone: SeriesTone;
  readonly animate: boolean;
  readonly compact: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function valuePairs(points: readonly TimeSeriesPoint[]): [number, number][] {
  return points.map((point) => [Date.parse(point.ts), point.value]);
}

function bandData(points: readonly TimeSeriesPoint[]): BandData | null {
  const base: [number, number][] = [];
  const width: [number, number][] = [];
  for (const point of points) {
    if (typeof point.low !== "number" || typeof point.high !== "number") {
      continue;
    }
    base.push([Date.parse(point.ts), point.low]);
    width.push([Date.parse(point.ts), point.high - point.low]);
  }
  return base.length === 0 ? null : { base, width };
}

function markerHtml(color: string): string {
  return `<span style="display:inline-block;width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;background:${color};margin-right:6px"></span>`;
}

function tooltipFormatter(
  points: readonly TimeSeriesPoint[],
  unit: string,
  digits: number,
  lineColor: string,
): (params: unknown) => string {
  return (params) => {
    const list = Array.isArray(params) ? params : [params];
    const first = list.at(0);
    const raw = isRecord(first) ? first.value : undefined;
    const ms = Array.isArray(raw) && typeof raw[0] === "number" ? raw[0] : null;
    if (ms === null) {
      return "";
    }
    const point = points.find((entry) => Date.parse(entry.ts) === ms);
    if (point === undefined) {
      return "";
    }
    const header = `<div style="font-family:${chartFonts.mono};font-size:11px;color:${chartColors.ink3};margin-bottom:4px">${formatClockMs(ms)}</div>`;
    const valueRow = `<div style="display:flex;align-items:center">${markerHtml(lineColor)}<span style="font-family:${chartFonts.mono};font-variant-numeric:tabular-nums">${formatNumber(point.value, digits)} ${unit}</span></div>`;
    if (typeof point.low !== "number" || typeof point.high !== "number") {
      return header + valueRow;
    }
    const interval = { low: point.low, high: point.high };
    return `${header}${valueRow}<div style="margin-top:2px;font-size:11px;color:${chartColors.ink3}">selang ${formatInterval(interval, digits)}</div>`;
  };
}

function buildSeries(input: BuildInput, band: BandData | null): LineSeriesOption[] {
  const toneColors = seriesTones[input.tone];
  const series: LineSeriesOption[] = [];
  if (band !== null) {
    series.push(
      {
        id: "ci-base",
        name: " ",
        type: "line",
        data: band.base,
        stack: "ci",
        silent: true,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        tooltip: { show: false },
      },
      {
        id: "ci-width",
        name: " ",
        type: "line",
        data: band.width,
        stack: "ci",
        silent: true,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: toneColors.band },
        tooltip: { show: false },
      },
    );
  }
  series.push({
    id: "value",
    name: input.label,
    type: "line",
    data: valuePairs(input.points),
    showSymbol: !input.compact && input.points.length <= SYMBOL_THRESHOLD,
    symbolSize: 4,
    lineStyle: { width: input.compact ? 2.5 : 2, color: toneColors.line },
    itemStyle: { color: toneColors.line },
    areaStyle: {
      color: {
        type: "linear",
        x: 0,
        y: 0,
        x2: 0,
        y2: 1,
        colorStops: [
          { offset: 0, color: rgba(toneColors.line, input.compact ? 0.22 : 0.16) },
          { offset: 1, color: rgba(toneColors.line, 0) },
        ],
      },
    },
    endLabel: {
      show: !input.compact && input.points.length > 0,
      distance: 4,
      color: chartColors.ink2,
      fontFamily: chartFonts.mono,
      fontSize: 12,
      formatter: () => endLabelText(input.points.at(-1), input.digits),
    },
    ...(input.points.length > SAMPLING_THRESHOLD ? { sampling: "lttb" } : {}),
  });
  return series;
}

function endLabelText(point: TimeSeriesPoint | undefined, digits: number): string {
  return point === undefined ? "" : formatNumber(point.value, digits);
}

function buildOption(input: BuildInput): TimeSeriesOption {
  return {
    animation: input.animate,
    animationDuration: 240,
    animationDurationUpdate: 200,
    grid: input.compact
      ? { left: 0, right: 4, top: 12, bottom: 0, containLabel: true }
      : { left: 8, right: 52, top: 26, bottom: 2, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "line" },
      formatter: tooltipFormatter(
        input.points,
        input.unit,
        input.digits,
        seriesTones[input.tone].line,
      ),
    },
    xAxis: {
      type: "time",
      axisLabel: {
        formatter: (value: number) => formatClockMs(value),
        fontSize: input.compact ? 10 : 12,
      },
    },
    yAxis: input.compact
      ? {
          type: "value",
          scale: !input.includeZero,
          splitNumber: 2,
          axisLabel: { show: false },
          splitLine: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
        }
      : {
          type: "value",
          scale: !input.includeZero,
          splitNumber: 4,
          name: input.unit,
          axisLabel: {
            formatter: (value: number) => formatNumber(value, input.digits),
          },
        },
    series: buildSeries(input, bandData(input.points)),
  };
}

export function TimeSeriesChart({
  points,
  label,
  unit,
  height = DEFAULT_HEIGHT,
  digits = DEFAULT_DIGITS,
  includeZero = true,
  tone = "water",
  animate = true,
  compact = false,
  className,
}: TimeSeriesChartProps) {
  const option = useMemo(
    () =>
      buildOption({
        points,
        label,
        unit,
        digits,
        includeZero,
        tone,
        animate,
        compact,
      }),
    [points, label, unit, digits, includeZero, tone, animate, compact],
  );
  return (
    <EChart
      option={option}
      height={height}
      ariaLabel={`${label} · satuan ${unit} · ${points.length} titik`}
      {...(className === undefined ? {} : { className })}
    />
  );
}
