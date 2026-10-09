export type SeraTopicKind = 'telemetry' | 'status' | 'command' | 'command-ack';

export interface ParsedSeraTopic {
  readonly kind: SeraTopicKind;
  readonly site: string;
  readonly device: string;
}

const CHANNEL_KINDS: Readonly<Record<string, SeraTopicKind>> = {
  telemetry: 'telemetry',
  status: 'status',
  command: 'command',
};

export function buildCommandTopic(
  prefix: string,
  site: string,
  device: string,
): string {
  return `${prefix}/${site}/${device}/command`;
}

export function parseSeraTopic(
  prefix: string,
  topic: string,
): ParsedSeraTopic | null {
  const expectedPrefix = `${prefix}/`;
  if (!topic.startsWith(expectedPrefix)) {
    return null;
  }
  const segments = topic.slice(expectedPrefix.length).split('/');
  const site = segments[0];
  const device = segments[1];
  const channel = segments[2];
  if (site === undefined || device === undefined || channel === undefined) {
    return null;
  }
  if (segments.length === 3) {
    const kind = CHANNEL_KINDS[channel];
    return kind === undefined ? null : { kind, site, device };
  }
  if (segments.length === 4 && channel === 'command' && segments[3] === 'ack') {
    return { kind: 'command-ack', site, device };
  }
  return null;
}
