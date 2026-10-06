import type { PlanExportRecord } from './plans.types.ts';

const CSV_BOM = '\uFEFF';
const CSV_SEPARATOR = ',';
const CSV_LINE_BREAK = '\r\n';
const CSV_QUOTE = '"';

export const PLAN_EXPORT_HEADERS = [
  'plan_id',
  'network_name',
  'status',
  'profile',
  'horizon_from',
  'horizon_to',
  'item_count',
  'override_count',
  'solver_name',
  'solver_time_ms',
  'mip_gap',
  'created_at',
  'updated_at',
] as const;

type ExportValue = string | number | null;

function escapeCsvValue(value: ExportValue): string {
  if (value === null) {
    return '';
  }
  const text = String(value);
  const requiresQuoting =
    text.includes(CSV_SEPARATOR) ||
    text.includes(CSV_QUOTE) ||
    text.includes('\r') ||
    text.includes('\n');
  if (!requiresQuoting) {
    return text;
  }
  const escaped = text.replaceAll(CSV_QUOTE, `${CSV_QUOTE}${CSV_QUOTE}`);
  return `${CSV_QUOTE}${escaped}${CSV_QUOTE}`;
}

function formatCsvRow(values: readonly ExportValue[]): string {
  return values.map(escapeCsvValue).join(CSV_SEPARATOR);
}

function toCsvValues(record: PlanExportRecord): readonly ExportValue[] {
  return [
    record.id,
    record.networkName,
    record.status,
    record.profile,
    record.horizonFrom.toISOString(),
    record.horizonTo.toISOString(),
    record.itemCount,
    record.overrideCount,
    record.solverName,
    record.solverTimeMs,
    record.mipGap,
    record.createdAt.toISOString(),
    record.updatedAt.toISOString(),
  ];
}

export function buildPlansCsv(records: readonly PlanExportRecord[]): string {
  const lines = [
    formatCsvRow(PLAN_EXPORT_HEADERS),
    ...records.map((record) => formatCsvRow(toCsvValues(record))),
  ];
  return `${CSV_BOM}${lines.join(CSV_LINE_BREAK)}${CSV_LINE_BREAK}`;
}
