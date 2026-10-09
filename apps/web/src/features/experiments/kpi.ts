import { formatNumber, formatPercent, formatUnit } from "@/lib/format.ts";

export type MetricDirection = "higher_better" | "lower_better";
export type MetricFormat = "percent" | "decimal" | "m3" | "ms" | "mm";
export type MetricVerdict = "better" | "worse" | "same";

export interface MetricDescriptor {
  readonly key: string;
  readonly label: string;
  readonly column: string;
  readonly unit: string;
  readonly format: MetricFormat;
  readonly direction: MetricDirection;
  readonly digits: number;
}

export interface RunMetricValue {
  readonly descriptor: MetricDescriptor;
  readonly value: number | null;
}

export interface MetricDelta {
  readonly delta: number;
  readonly relativePercent: number | null;
  readonly verdict: MetricVerdict;
}

const EPSILON = 1e-9;

export const metricDescriptors: readonly MetricDescriptor[] = [
  {
    key: "adequacy",
    label: "Kecukupan pemenuhan",
    column: "Kecukupan",
    unit: "%",
    format: "percent",
    direction: "higher_better",
    digits: 1,
  },
  {
    key: "efficiency",
    label: "Efisiensi penyaluran",
    column: "Efisiensi",
    unit: "%",
    format: "percent",
    direction: "higher_better",
    digits: 1,
  },
  {
    key: "dependability",
    label: "Keandalan pemenuhan target",
    column: "Keandalan",
    unit: "%",
    format: "percent",
    direction: "higher_better",
    digits: 1,
  },
  {
    key: "equity",
    label: "Pemerataan antar-blok",
    column: "Pemerataan",
    unit: "%",
    format: "percent",
    direction: "higher_better",
    digits: 1,
  },
  {
    key: "worst_sr",
    label: "Rasio layanan terburuk",
    column: "SR terburuk",
    unit: "",
    format: "decimal",
    direction: "higher_better",
    digits: 2,
  },
  {
    key: "shortage_total_m3",
    label: "Kekurangan total",
    column: "Kekurangan",
    unit: "m³",
    format: "m3",
    direction: "lower_better",
    digits: 1,
  },
  {
    key: "tail_deficit_m3",
    label: "Defisit blok hilir",
    column: "Defisit hilir",
    unit: "m³",
    format: "m3",
    direction: "lower_better",
    digits: 1,
  },
  {
    key: "cvar_shortage_m3",
    label: "CVaR kekurangan",
    column: "CVaR",
    unit: "m³",
    format: "m3",
    direction: "lower_better",
    digits: 1,
  },
  {
    key: "state_rmse",
    label: "Galat estimasi state",
    column: "RMSE state",
    unit: "mm",
    format: "mm",
    direction: "lower_better",
    digits: 2,
  },
  {
    key: "solve_time_ms",
    label: "Waktu penyelesaian solver",
    column: "Waktu solve",
    unit: "ms",
    format: "ms",
    direction: "lower_better",
    digits: 0,
  },
  {
    key: "decision_regret",
    label: "Regret keputusan",
    column: "Regret",
    unit: "%",
    format: "percent",
    direction: "lower_better",
    digits: 1,
  },
];

export const summaryMetricKeys: readonly string[] = [
  "adequacy",
  "dependability",
  "equity",
  "worst_sr",
  "shortage_total_m3",
  "cvar_shortage_m3",
  "solve_time_ms",
];

const descriptorByKey = new Map<string, MetricDescriptor>(
  metricDescriptors.map((descriptor) => [descriptor.key, descriptor]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function describeMetric(key: string): MetricDescriptor | null {
  return descriptorByKey.get(key) ?? null;
}

export function formatMetricValue(
  descriptor: MetricDescriptor,
  value: number | null,
): string {
  if (value === null) {
    return "—";
  }
  switch (descriptor.format) {
    case "percent":
      return formatPercent(value, descriptor.digits);
    case "m3":
      return formatUnit(value, "m³", descriptor.digits);
    case "ms":
      return formatUnit(value, "ms", descriptor.digits);
    case "mm":
      return formatUnit(value, "mm", descriptor.digits);
    case "decimal":
      return formatNumber(value, descriptor.digits);
  }
}

export function readRunMetrics(raw: unknown): readonly RunMetricValue[] {
  const record = isRecord(raw) ? raw : {};
  return metricDescriptors.map((descriptor) => ({
    descriptor,
    value: numericOrNull(record[descriptor.key]),
  }));
}

export function computeMetricDelta(
  key: string,
  value: number,
  reference: number,
): MetricDelta | null {
  const descriptor = descriptorByKey.get(key);
  if (
    descriptor === undefined ||
    !Number.isFinite(value) ||
    !Number.isFinite(reference)
  ) {
    return null;
  }
  const delta = value - reference;
  const signed = descriptor.direction === "higher_better" ? delta : -delta;
  const verdict: MetricVerdict =
    Math.abs(signed) < EPSILON ? "same" : signed > 0 ? "better" : "worse";
  return {
    delta,
    relativePercent: reference === 0 ? null : (delta / Math.abs(reference)) * 100,
    verdict,
  };
}
