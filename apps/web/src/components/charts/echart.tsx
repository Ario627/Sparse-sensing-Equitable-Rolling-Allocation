import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import {
  init,
  use,
  type EChartsCoreOption,
  type EChartsType,
} from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { SERA_CHART_THEME, registerSeraChartTheme } from "@/lib/charts/theme.ts";
import { cn } from "@/lib/cn.ts";

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
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
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        chart.resize();
      });
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      style={{ height }}
      className={cn("w-full", className)}
    />
  );
}