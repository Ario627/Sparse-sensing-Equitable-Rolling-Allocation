import { describe, expect, it } from 'vitest';
import {
  toAlertSeverity,
  toEventRecord,
  toEventType,
  type EventRow,
} from './events.selects.ts';

const CREATED_AT = new Date('2026-10-08T00:00:00Z');

function eventRow(overrides: Partial<EventRow>): EventRow {
  const row = {
    id: 'event-1',
    type: 'alert',
    severity: 'warning',
    message: 'gate did not follow the commanded position',
    networkId: 'net-1',
    planId: null,
    payload: { code: 'gate_mismatch' },
    acknowledgedAt: null,
    createdAt: CREATED_AT,
    acknowledgedBy: null,
    ...overrides,
  };
  return row as unknown as EventRow;
}

describe('toEventType', () => {
  it('keeps known types', () => {
    expect(toEventType('alert')).toBe('alert');
    expect(toEventType('fallback')).toBe('fallback');
  });

  it('normalizes unknown types to system', () => {
    expect(toEventType('weird')).toBe('system');
  });
});

describe('toAlertSeverity', () => {
  it('keeps known severities', () => {
    expect(toAlertSeverity('critical')).toBe('critical');
    expect(toAlertSeverity('info')).toBe('info');
  });

  it('normalizes unknown severities to info', () => {
    expect(toAlertSeverity('severe')).toBe('info');
  });
});

describe('toEventRecord', () => {
  it('maps an unacknowledged alert', () => {
    const record = toEventRecord(eventRow({}));
    expect(record.type).toBe('alert');
    expect(record.severity).toBe('warning');
    expect(record.acknowledgedAt).toBeNull();
    expect(record.acknowledgedBy).toBeNull();
    expect(record.createdAt).toBe(CREATED_AT);
  });

  it('maps the acknowledging actor', () => {
    const record = toEventRecord(
      eventRow({
        acknowledgedAt: CREATED_AT,
        acknowledgedBy: { id: 'user-1', fullName: 'Operator Demo' },
      }),
    );
    expect(record.acknowledgedAt).toBe(CREATED_AT);
    expect(record.acknowledgedBy).toEqual({
      id: 'user-1',
      fullName: 'Operator Demo',
    });
  });

  it('normalizes malformed rows without losing the row', () => {
    const record = toEventRecord(
      eventRow({ type: 'plumbing', severity: 'nope' }),
    );
    expect(record.type).toBe('system');
    expect(record.severity).toBe('info');
    expect(record.message).toContain('gate');
  });
});
