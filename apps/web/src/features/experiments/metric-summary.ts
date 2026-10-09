import type { RunMetricValue } from "./kpi.ts";

export interface QuantileSummary {
  readonly n: number;
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
}

export interface RunMetricInput {
  readonly method: string;
  readonly values: readonly RunMetricValue[];
}

export interface MethodMetricSummary {
  readonly method: string;
  readonly runCount: number;
  readonly metrics: Readonly<Record<string, QuantileSummary | null>>;
}

export function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0 || !Number.isFinite(q) || q < 0 || q > 1) {
    return null;
  }
  if (sorted.length === 1) {
    return sorted[0] ?? null;
  }
  const h = (sorted.length - 1) * q;
  const lower = Math.floor(h);
  const fraction = h - lower;
  const a = sorted[lower] ?? 0;
  const b = sorted[lower + 1] ?? a;
  return a + fraction * (b - a);
}

export function summarize(values: readonly number[]): QuantileSummary | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const first = sorted.at(0);
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  const median = quantile(sorted, 0.5) ?? first;
  return {
    n: sorted.length,
    min: first,
    q1: quantile(sorted, 0.25) ?? median,
    median,
    q3: quantile(sorted, 0.75) ?? median,
    max: last,
  };
}

interface MethodBucket {
  runCount: number;
  values: Map<string, number[]>;
}

export function summarizeRuns(
  runs: readonly RunMetricInput[],
  keys: readonly string[],
): readonly MethodMetricSummary[] {
  const wanted = new Set(keys);
  const buckets = new Map<string, MethodBucket>();
  for (const run of runs) {
    const bucket = buckets.get(run.method) ?? {
      runCount: 0,
      values: new Map<string, number[]>(),
    };
    bucket.runCount += 1;
    for (const item of run.values) {
      if (item.value === null || !wanted.has(item.descriptor.key)) {
        continue;
      }
      const list = bucket.values.get(item.descriptor.key) ?? [];
      list.push(item.value);
      bucket.values.set(item.descriptor.key, list);
    }
    buckets.set(run.method, bucket);
  }
  return [...buckets.keys()].sort().map((method) => {
    const bucket = buckets.get(method);
    const metrics: Record<string, QuantileSummary | null> = {};
    for (const key of keys) {
      metrics[key] = summarize(bucket?.values.get(key) ?? []);
    }
    return {
      method,
      runCount: bucket?.runCount ?? 0,
      metrics,
    };
  });
}
