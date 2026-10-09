import { registerTheme } from "echarts/core";
import { palette, rgba } from "@/lib/palette.ts";

export const SERA_CHART_THEME = "sera";

export const chartColors = {
  ink: palette.ink,
  ink2: palette.ink2,
  ink3: palette.ink3,
  line: palette.line,
  line2: palette.line2,
  surface: palette.surface,
  water: palette.water,
  paddy: palette.paddy,
  ok: palette.ok,
  warn: palette.warn,
  crit: palette.crit,
  fallback: palette.fallback,
  info: palette.info,
} as const;

export const chartFonts = {
  sans: '"IBM Plex Sans Variable", ui-sans-serif, system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
} as const;

export const seriesTones = {
  water: { line: palette.water, band: rgba(palette.water, 0.14) },
  paddy: { line: palette.paddy, band: rgba(palette.paddy, 0.14) },
  ink: { line: palette.ink2, band: rgba(palette.ink, 0.1) },
  warn: { line: palette.warn, band: rgba(palette.warn, 0.14) },
} as const;

export type SeriesTone = keyof typeof seriesTones;

const axisLabel = {
  color: chartColors.ink2,
  fontFamily: chartFonts.mono,
  fontSize: 12,
};

const seraTheme = {
  color: [
    chartColors.water,
    chartColors.paddy,
    chartColors.info,
    chartColors.warn,
    chartColors.crit,
    chartColors.fallback,
  ],
  backgroundColor: "transparent",
  textStyle: { fontFamily: chartFonts.sans, color: chartColors.ink2 },
  grid: { left: 8, right: 16, top: 28, bottom: 2, containLabel: true },
  axisPointer: { lineStyle: { color: chartColors.line2, width: 1 } },
  categoryAxis: {
    axisLine: { lineStyle: { color: chartColors.line } },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel,
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: chartColors.line, type: "dashed" } },
    axisLabel,
    nameTextStyle: {
      color: chartColors.ink2,
      fontFamily: chartFonts.mono,
      fontSize: 12,
    },
  },
  timeAxis: {
    axisLine: { lineStyle: { color: chartColors.line } },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel,
  },
  tooltip: {
    backgroundColor: chartColors.surface,
    borderColor: chartColors.line,
    borderWidth: 1,
    padding: [10, 12],
    confine: true,
    textStyle: {
      color: chartColors.ink,
      fontFamily: chartFonts.sans,
      fontSize: 12,
    },
    extraCssText:
      "box-shadow: 0 12px 32px -16px rgba(22, 26, 23, 0.28); border-radius: 8px;",
  },
  line: {
    smooth: false,
    symbol: "circle",
    symbolSize: 5,
    showSymbol: false,
    lineStyle: { width: 2 },
  },
};

let registered = false;

export function registerSeraChartTheme(): void {
  if (registered) {
    return;
  }
  registerTheme(SERA_CHART_THEME, seraTheme);
  registered = true;
}
