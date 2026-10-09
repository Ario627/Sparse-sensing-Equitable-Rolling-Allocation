import { describe, expect, it } from 'vitest';
import {
  canonicalizeJson,
  normalizeCalibration,
  toSensorSummary,
  type SensorRow,
} from './sensors.selects.ts';

const NOW_MS = Date.parse('2026-10-08T00:00:00Z');
const STALE_MS = 300_000;

function sensorRow(overrides: Partial<Record<string, unknown>>): SensorRow {
  const row = {
    id: 'lvl-head-01',
    deviceId: 'esp32-01',
    networkId: 'net-1',
    type: 'WATER_LEVEL',
    unit: 'mm',
    isActive: true,
    installedAt: null,
    calibration: null,
    node: { id: 'node-1', name: 'Head Box', block: null },
    ...overrides,
  };
  return row as unknown as SensorRow;
}

describe('canonicalizeJson', () => {
  it('sorts object keys recursively while preserving arrays', () => {
    expect(canonicalizeJson({ b: 1, a: { d: 2, c: [3, 1] } })).toBe(
      '{"a":{"c":[3,1],"d":2},"b":1}',
    );
  });

  it('produces identical strings for reordered inputs', () => {
    const left = { params: { n: 1.87, C: 0.0042 }, method: 'power_law' };
    const right = { method: 'power_law', params: { C: 0.0042, n: 1.87 } };
    expect(canonicalizeJson(left)).toBe(canonicalizeJson(right));
  });
});

describe('normalizeCalibration', () => {
  const base = {
    method: 'power_law' as const,
    params: { C: 0.0042, n: 1.87 },
    fit: { r2: 0.987, rmse: 0.11, points: 12 },
    operator: null,
    notes: null,
  };

  it('stamps the server time when calibrated_at is absent', () => {
    const now = new Date('2026-10-08T00:00:00Z');
    const record = normalizeCalibration(
      { ...base, calibrated_at: null },
      now,
    );
    expect(record.calibrated_at).toBe('2026-10-08T00:00:00.000Z');
  });

  it('preserves an explicit calibrated_at', () => {
    const record = normalizeCalibration(
      { ...base, calibrated_at: '2026-10-01T00:00:00.000Z' },
      new Date('2026-10-08T00:00:00Z'),
    );
    expect(record.calibrated_at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('keeps params, fit, operator, and notes', () => {
    const record = normalizeCalibration(
      { ...base, calibrated_at: null, operator: 'demo', notes: 'mini channel' },
      new Date('2026-10-08T00:00:00Z'),
    );
    expect(record.params).toEqual({ C: 0.0042, n: 1.87 });
    expect(record.fit.points).toBe(12);
    expect(record.operator).toBe('demo');
    expect(record.notes).toBe('mini channel');
  });
});

describe('toSensorSummary', () => {
  it('marks sensors without readings as stale', () => {
    const record = toSensorSummary(sensorRow({}), null, NOW_MS, STALE_MS);
    expect(record.stale).toBe(true);
    expect(record.ageS).toBeNull();
    expect(record.lastReadingAt).toBeNull();
  });

  it('reports age and freshness for recent readings', () => {
    const lastReading = new Date(NOW_MS - 90_000);
    const record = toSensorSummary(
      sensorRow({}),
      lastReading,
      NOW_MS,
      STALE_MS,
    );
    expect(record.ageS).toBe(90);
    expect(record.stale).toBe(false);
  });

  it('flags readings older than the stale threshold', () => {
    const lastReading = new Date(NOW_MS - 600_000);
    const record = toSensorSummary(
      sensorRow({}),
      lastReading,
      NOW_MS,
      STALE_MS,
    );
    expect(record.ageS).toBe(600);
    expect(record.stale).toBe(true);
  });

  it('summarizes the calibration metadata', () => {
    const record = toSensorSummary(
      sensorRow({
        calibration: {
          method: 'power_law',
          calibrated_at: '2026-10-01T00:00:00.000Z',
        },
      }),
      null,
      NOW_MS,
      STALE_MS,
    );
    expect(record.calibrated).toBe(true);
    expect(record.calibrationMethod).toBe('power_law');
    expect(record.calibratedAt?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it('resolves node and block context when attached', () => {
    const record = toSensorSummary(
      sensorRow({
        node: {
          id: 'node-9',
          name: 'Terminal C',
          block: { id: 'blk-c', name: 'Blok C' },
        },
      }),
      null,
      NOW_MS,
      STALE_MS,
    );
    expect(record.nodeId).toBe('node-9');
    expect(record.blockId).toBe('blk-c');
    expect(record.blockName).toBe('Blok C');
  });
});
