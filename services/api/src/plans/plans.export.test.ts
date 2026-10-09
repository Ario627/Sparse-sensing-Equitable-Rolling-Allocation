import { describe, expect, it } from 'vitest';
import { buildPlansCsv, PLAN_EXPORT_HEADERS } from './plans.export.ts';
import type { PlanExportRecord } from './plans.types.ts';

function exportRecord(
  overrides: Partial<PlanExportRecord> = {},
): PlanExportRecord {
  return {
    id: 'plan-1',
    networkName: 'Jaringan Demo',
    status: 'APPROVED',
    profile: 'BALANCED',
    horizonFrom: new Date('2026-10-08T00:00:00Z'),
    horizonTo: new Date('2026-10-08T06:00:00Z'),
    itemCount: 12,
    overrideCount: 1,
    solverName: 'highs',
    solverTimeMs: 1_240,
    mipGap: 0.001,
    createdAt: new Date('2026-10-08T00:00:00Z'),
    updatedAt: new Date('2026-10-08T00:05:00Z'),
    ...overrides,
  };
}

describe('buildPlansCsv', () => {
  it('opens with a UTF-8 BOM and the header row', () => {
    const csv = buildPlansCsv([]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.split('\r\n')[0]).toBe(`\uFEFF${PLAN_EXPORT_HEADERS.join(',')}`);
  });

  it('closes every file with a CRLF line break', () => {
    expect(buildPlansCsv([]).endsWith('\r\n')).toBe(true);
    expect(buildPlansCsv([exportRecord()]).endsWith('\r\n')).toBe(true);
  });

  it('writes one column per header and keeps plain values unquoted', () => {
    const csv = buildPlansCsv([exportRecord()]);
    const row = csv.split('\r\n')[1] ?? '';
    const columns = row.split(',');
    expect(columns).toHaveLength(PLAN_EXPORT_HEADERS.length);
    expect(columns[0]).toBe('plan-1');
    expect(columns[1]).toBe('Jaringan Demo');
    expect(columns[2]).toBe('APPROVED');
  });

  it('quotes values that contain separators or quote characters', () => {
    const csv = buildPlansCsv([
      exportRecord({ networkName: 'P3A "Makmur", Timur' }),
    ]);
    expect(csv).toContain('"P3A ""Makmur"", Timur"');
  });

  it('renders null fields as empty columns', () => {
    const csv = buildPlansCsv([
      exportRecord({ solverName: null, solverTimeMs: null, mipGap: null }),
    ]);
    const columns = (csv.split('\r\n')[1] ?? '').split(',');
    expect(columns).toHaveLength(PLAN_EXPORT_HEADERS.length);
    expect(columns[8]).toBe('');
    expect(columns[9]).toBe('');
    expect(columns[10]).toBe('');
  });
});
