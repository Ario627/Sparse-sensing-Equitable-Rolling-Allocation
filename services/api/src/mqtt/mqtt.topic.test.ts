import { describe, expect, it } from 'vitest';
import { buildCommandTopic, parseSeraTopic } from './mqtt.topic.ts';

describe('buildCommandTopic', () => {
  it('builds the backend to device command topic', () => {
    expect(buildCommandTopic('sera', 'demo-01', 'esp32-01')).toBe(
      'sera/demo-01/esp32-01/command',
    );
  });
});

describe('parseSeraTopic', () => {
  it('parses each channel of a device topic', () => {
    expect(parseSeraTopic('sera', 'sera/demo-01/esp32-01/telemetry')).toEqual({
      kind: 'telemetry',
      site: 'demo-01',
      device: 'esp32-01',
    });
    expect(parseSeraTopic('sera', 'sera/demo-01/esp32-01/status')).toEqual({
      kind: 'status',
      site: 'demo-01',
      device: 'esp32-01',
    });
    expect(parseSeraTopic('sera', 'sera/demo-01/esp32-01/command')).toEqual({
      kind: 'command',
      site: 'demo-01',
      device: 'esp32-01',
    });
  });

  it('parses the nested command ack topic', () => {
    expect(parseSeraTopic('sera', 'sera/demo-01/esp32-01/command/ack')).toEqual({
      kind: 'command-ack',
      site: 'demo-01',
      device: 'esp32-01',
    });
  });

  it('rejects topics from another prefix', () => {
    expect(parseSeraTopic('sera', 'other/demo-01/esp32-01/telemetry')).toBeNull();
  });

  it('rejects topics without a device segment', () => {
    expect(parseSeraTopic('sera', 'sera/demo-01')).toBeNull();
  });

  it('rejects unknown channels and trailing segments', () => {
    expect(parseSeraTopic('sera', 'sera/demo-01/esp32-01/config')).toBeNull();
    expect(
      parseSeraTopic('sera', 'sera/demo-01/esp32-01/command/ack/extra'),
    ).toBeNull();
  });

  it('rejects an ack channel without the nested suffix', () => {
    expect(parseSeraTopic('sera', 'sera/demo-01/esp32-01/ack')).toBeNull();
  });
});
