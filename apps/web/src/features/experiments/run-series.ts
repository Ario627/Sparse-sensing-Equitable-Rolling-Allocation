import type { ExperimentRunResponse } from "@sera/contracts";
import { readRunMetrics } from "./kpi.ts";

export interface RunSeriesPoint {
  readonly x: number;
  readonly y: number;
}

export interface RunSeries {
  readonly method: string;
  readonly points: readonly RunSeriesPoint[];
}

const METHOD_LABELS: Record<string, string> = {
  sera: "SERA",
  proportional: "Proporsional",
  rotation: "Rotasi tetap",
  greedy: "Greedy ledger",
  oracle: "Oracle (penginderaan penuh)",
};

const METHOD_ORDER = ["sera", "proportional", "rotation", "greedy", "oracle"] as const;

const KNOWN_METHODS = new Set<string>(METHOD_ORDER);

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

export function methodsInOrder(
  runs: readonly ExperimentRunResponse[],
): readonly string[] {
  const present = new Set(runs.map((run) => run.method));
  const known = METHOD_ORDER.filter((method) => present.has(method));
  const unknown = [...present].filter((method) => !KNOWN_METHODS.has(method)).sort();
  return [...known, ...unknown];
}

export function hasMetric(
  runs: readonly ExperimentRunResponse[],
  metricKey: string,
): boolean {
  return runs.some((run) =>
    readRunMetrics(run.metrics).some(
      (metric) => metric.descriptor.key === metricKey && metric.value !== null,
    ),
  );
}

export function buildRunSeries(
  runs: readonly ExperimentRunResponse[],
  metricKey: string,
): readonly RunSeries[] {
  const byMethod = new Map<string, RunSeriesPoint[]>();
  for (const run of runs) {
    const metric = readRunMetrics(run.metrics).find(
      (item) => item.descriptor.key === metricKey,
    );
    if (metric === undefined || metric.value === null) {
      continue;
    }
    const list = byMethod.get(run.method) ?? [];
    list.push({ x: run.run_index, y: metric.value });
    byMethod.set(run.method, list);
  }
  return methodsInOrder(runs)
    .filter((method) => byMethod.has(method))
    .map((method) => ({
      method,
      points: [...(byMethod.get(method) ?? [])].sort((a, b) => a.x - b.x),
    }));
}
