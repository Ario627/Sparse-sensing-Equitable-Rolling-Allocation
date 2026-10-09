import type { LineSeriesOption } from "echarts/charts";
import type {
  GridComponentOption,
  MarkAreaComponentOption,
  MarkLineComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import type { ComposeOption } from "echarts/core";
import { useMemo } from "react";
import type { Tone } from "@/components/kit/status-pill.tsx";
import {
  chartColors,
  chartFonts,
  type SeriesTone,
  seriesTones,
} from "@/lib/charts/theme.ts";
import { formatClockMs, formatInterval, formatNumber } from "@/lib/format.ts";
import { palette, rgba } from "@/lib/palette.ts";
import { EChart } from "./echart.tsx";

const DEFAULT_HEIGHT = 180;
const DEFAULT_DIGITS = 2;
const SAMPLING_THRESHOLD = 300;
const SYMBOL_THRESHOLD = 30;
const MARKER_SIZE = 8;
const MARKER_LABEL_LIMIT = 4;
const SPAN_OPACITY = 0.12;
const SPAN_LABEL_LIMIT = 2;

const toneColors: Record<Tone, string> = {
  ok: palette.ok,
  warn: palette.warn,
  crit: palette.crit,
  fallback: palette.fallback,
  info: palette.info,
  neutral: palette.ink3,
};

export interface TimeSeriesPoint {
  readonly ts: string;
  readonly value: number;
  readonly low?: number | null;
  readonly high?: number | null;
}

export interface ChartMarker {
  readonly ts: string;
  readonly label: string;
  readonly tone: Tone;
}

export interface ChartSpan {
  readonly from: string;
  readonly to: string;
  readonly tone: Tone;
  readonly label: string;
}

export interface ChartReference {
  readonly value: number;
  readonly label: string;
  readonly tone: Tone;
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
  readonly markers?: readonly ChartMarker[];
  readonly spans?: readonly ChartSpan[];
  readonly reference?: ChartReference | null;
  readonly className?: string;
}

type TimeSeriesOption = ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | MarkLineComponentOption
  | MarkAreaComponentOption
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
  readonly markers: readonly ChartMarker[];
  readonly spans: readonly ChartSpan[];
  readonly reference: ChartReference | null;
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
  markers: readonly ChartMarker[],
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
    const near = markers.filter(
      (marker) => Math.abs(Date.parse(marker.ts) - ms) <= 60_000,
    );
    const markerRows = near
      .map(
        (marker) =>
          `<div style="margin-top:3px;font-size:11px;color:${toneColors[marker.tone]}">${marker.label}</div>`,
      )
      .join("");
    if (typeof point.low !== "number" || typeof point.high !== "number") {
      return header + valueRow + markerRows;
    }
    const interval = { low: point.low, high: point.high };
    return `${header}${valueRow}<div style="margin-top:2px;font-size:11px;color:${chartColors.ink3}">selang ${formatInterval(interval, digits)}</div>${markerRows}`;
  };
}

function markLineData(input: BuildInput): MarkLineComponentOption["data"] {
  const data: NonNullable<MarkLineComponentOption["data"]> = [];
  if (input.reference !== null) {
    data.push({
      yAxis: input.reference.value,
      lineStyle: {
        color: toneColors[input.reference.tone],
        width: 1,
        type: [5, 5],
      },
      label: {
        show: true,
        formatter: input.reference.label,
        position: "insideEndTop",
        color: toneColors[input.reference.tone],
        fontFamily: chartFonts.mono,
        fontSize: 10,
      },
    });
  }
  const showLabels = input.markers.length <= MARKER_LABEL_LIMIT;
  for (const marker of input.markers) {
    data.push({
      xAxis: Date.parse(marker.ts),
      lineStyle: { color: rgba(toneColors[marker.tone], 0.7), width: 1 },
      label: {
        show: showLabels,
        formatter: marker.label,
        position: "insideStartTop",
        color: toneColors[marker.tone],
        fontFamily: chartFonts.sans,
        fontSize: 10,
      },
    });
  }
  return data;
}

function markAreaData(input: BuildInput): MarkAreaComponentOption["data"] {
  if (input.spans.length === 0) {
    return undefined;
  }
  const showLabels = input.spans.length <= SPAN_LABEL_LIMIT;
  return input.spans.map((span, index) => [
    {
      xAxis: Date.parse(span.from),
      itemStyle: { color: rgba(toneColors[span.tone], SPAN_OPACITY) },
      ...(showLabels && index === 0
        ? {
            label: {
              show: true,
              formatter: span.label,
              position: "insideTopLeft" as const,
              color: toneColors[span.tone],
              fontFamily: chartFonts.mono,
              fontSize: 10,
            },
          }
        : {}),
    },
    { xAxis: Date.parse(span.to) },
  ]);
}

function buildSeries(input: BuildInput, band: BandData | null): LineSeriesOption[] {
  const toneColorsByTone = seriesTones[input.tone];
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
        areaStyle: { color: toneColorsByTone.band },
        tooltip: { show: false },
      },
    );
  }
  const markLine = markLineData(input);
  const markArea = markAreaData(input);
  series.push({
    id: "value",
    name: input.label,
    type: "line",
    data: valuePairs(input.points),
    showSymbol: !input.compact && input.points.length <= SYMBOL_THRESHOLD,
    symbolSize: 4,
    lineStyle: { width: input.compact ? 2.5 : 2, color: toneColorsByTone.line },
    itemStyle: { color: toneColorsByTone.line },
    areaStyle: {
      color: {
        type: "linear",
        x: 0,
        y: 0,
        x2: 0,
        y2: 1,
        colorStops: [
          { offset: 0, color: rgba(toneColorsByTone.line, input.compact ? 0.2 : 0.14) },
          { offset: 1, color: rgba(toneColorsByTone.line, 0) },
        ],
      },
    },
    ...(markLine === undefined || markLine.length === 0
      ? {}
      : {
          markLine: { silent: true, symbol: "none", animation: false, data: markLine },
        }),
    ...(markArea === undefined
      ? {}
      : { markArea: { silent: true, animation: false, data: markArea } }),
    endLabel: {
      show: !input.compact && input.points.length > 0,
      distance: 4,
      color: chartColors.ink2,
      fontFamily: chartFonts.mono,
      fontSize: 12,
      formatter: () => {
        const last = input.points.at(-1);
        return last === undefined ? "" : formatNumber(last.value, input.digits);
      },
    },
    ...(input.points.length > SAMPLING_THRESHOLD ? { sampling: "lttb" } : {}),
  });
  return series;
}

function buildOption(input: BuildInput): TimeSeriesOption {
  return {
    animation: input.animate,
    animationDuration: 240,
    animationDurationUpdate: 200,
    grid: input.compact
      ? { left: 0, right: 4, top: 16, bottom: 0, containLabel: true }
      : { left: 8, right: 56, top: 34, bottom: 2, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "line" },
      formatter: tooltipFormatter(
        input.points,
        input.unit,
        input.digits,
        seriesTones[input.tone].line,
        input.markers,
      ),
    },
    xAxis: {
      type: "time",
      axisLabel: {
        formatter: (value: number) => formatClockMs(value),
        fontSize: input.compact ? 10 : 12,
        hideOverlap: true,
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

export interface SeriesSummary {
  readonly count: number;
  readonly latest: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly mean: number | null;
}

export function summarizeSeries(points: readonly TimeSeriesPoint[]): SeriesSummary {
  if (points.length === 0) {
    return { count: 0, latest: null, min: null, max: null, mean: null };
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const point of points) {
    min = Math.min(min, point.value);
    max = Math.max(max, point.value);
    total += point.value;
  }
  return {
    count: points.length,
    latest: points.at(-1)?.value ?? null,
    min,
    max,
    mean: total / points.length,
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
  markers = [],
  spans = [],
  reference = null,
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
        markers,
        spans,
        reference,
      }),
    [
      points,
      label,
      unit,
      digits,
      includeZero,
      tone,
      animate,
      compact,
      markers,
      spans,
      reference,
    ],
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
