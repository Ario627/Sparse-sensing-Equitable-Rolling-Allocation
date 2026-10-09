import { BarChart, LineChart } from "echarts/charts";
import {
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from "echarts/components";
import { type EChartsCoreOption, type EChartsType, init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { registerSeraChartTheme, SERA_CHART_THEME } from "@/lib/charts/theme.ts";
import { cn } from "@/lib/cn.ts";

use([
  BarChart,
  LineChart,
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
  CanvasRenderer,
]);
registerSeraChartTheme();

export interface EChartProps {
  readonly option: EChartsCoreOption;
  readonly height: number;
  readonly ariaLabel: string;
  readonly className?: string;
}

export function EChart({ option, height, ariaLabel, className }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const chart = init(container, SERA_CHART_THEME, { renderer: "canvas" });
    chartRef.current = chart;
    const applySize = (): void => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (
        width > 0 &&
        height > 0 &&
        (chart.getWidth() !== width || chart.getHeight() !== height)
      ) {
        chart.resize();
      }
      chart.getZr().flush();
    };
    const observer = new ResizeObserver(applySize);
    observer.observe(container);
    window.addEventListener("resize", applySize);
    const poll = window.setInterval(applySize, 400);
    applySize();
    return () => {
      window.clearInterval(poll);
      observer.disconnect();
      window.removeEventListener("resize", applySize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) {
      return;
    }
    chart.setOption(option, { notMerge: true });
    chart.getZr().flush();
  }, [option]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      style={{ height }}
      className={cn("w-full overflow-hidden", className)}
    />
  );
}
