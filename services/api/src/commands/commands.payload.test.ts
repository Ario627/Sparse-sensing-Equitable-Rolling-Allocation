import { commandAckSchema, commandSchema } from '@sera/contracts';
import { describe, expect, it } from 'vitest';
import {
  commandReference,
  evaluateGateMismatch,
  expectedPositionPct,
  isCommandExpired,
  parseJsonPayload,
  parseStoredPayload,
} from './commands.payload.ts';

const EXPIRES_AT = '2026-10-08T01:00:00Z';

function openCommand() {
  return commandSchema.parse({
    schema_version: 1,
    command_id: 'cmd-1',
    ts: '2026-10-08T00:00:00Z',
    action: 'open',
    target: 'gate-1',
    expires_at: EXPIRES_AT,
  });
}

describe('parseJsonPayload', () => {
  it('parses valid JSON buffers', () => {
    expect(parseJsonPayload(Buffer.from('{"a":1}'))).toEqual({ a: 1 });
  });

  it('returns null for malformed payloads', () => {
    expect(parseJsonPayload(Buffer.from('nope'))).toBeNull();
  });
});

describe('parseStoredPayload', () => {
  it('accepts the stored command envelope', () => {
    const stored = parseStoredPayload({
      device_id: 'esp32-01',
      command: {
        schema_version: 1,
        command_id: 'cmd-1',
        ts: '2026-10-08T00:00:00Z',
        action: 'close',
        target: 'gate-1',
        expires_at: EXPIRES_AT,
      },
    });
    expect(stored?.device_id).toBe('esp32-01');
    expect(stored?.command.action).toBe('close');
  });

  it('rejects payloads that break the command contract', () => {
    expect(
      parseStoredPayload({ device_id: 'esp32-01', command: { schema_version: 1 } }),
    ).toBeNull();
    expect(parseStoredPayload(null)).toBeNull();
  });
});

describe('expectedPositionPct', () => {
  it('anchors open and close commands to gate extremes', () => {
    expect(expectedPositionPct('open')).toBe(100);
    expect(expectedPositionPct('close')).toBe(0);
  });

  it('has no anchor for set_position', () => {
    expect(expectedPositionPct('set_position')).toBeNull();
  });
});

describe('evaluateGateMismatch', () => {
  it('flags a deviation above tolerance', () => {
    expect(evaluateGateMismatch('open', 12, 40)).toEqual({
      expectedPct: 100,
      deviationPct: 88,
    });
    expect(evaluateGateMismatch('close', 45, 40)).toEqual({
      expectedPct: 0,
      deviationPct: 45,
    });
  });

  it('keeps deviations exactly at tolerance', () => {
    expect(evaluateGateMismatch('open', 60, 40)).toBeNull();
  });

  it('skips actions without a fixed reference', () => {
    expect(evaluateGateMismatch('set_position', 5, 40)).toBeNull();
  });
});

describe('isCommandExpired', () => {
  it('treats the expiry instant as expired', () => {
    expect(isCommandExpired(openCommand(), new Date(EXPIRES_AT))).toBe(true);
    expect(
      isCommandExpired(openCommand(), new Date('2026-10-08T01:00:01Z')),
    ).toBe(true);
  });

  it('keeps commands alive before the expiry instant', () => {
    expect(
      isCommandExpired(openCommand(), new Date('2026-10-08T00:30:00Z')),
    ).toBe(false);
  });
});

describe('commandReference', () => {
  it('renders a human-readable reference', () => {
    const ack = commandAckSchema.parse({
      schema_version: 1,
      command_id: 'cmd-1',
      device_id: 'esp32-01',
      ts: '2026-10-08T00:00:02Z',
      status: 'accepted',
      position_pct: 100,
      detail: null,
    });
    expect(commandReference(ack)).toBe('plan command cmd-1');
  });
});
