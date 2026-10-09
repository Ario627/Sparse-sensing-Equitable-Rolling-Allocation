export const TOPIC_PREFIX = "sera";

const SEGMENT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export interface DeviceEndpoint {
  readonly site: string;
  readonly device: string;
}

export type SeraTopicKind = "telemetry" | "status" | "command" | "commandAck";

export interface SeraTopic {
  readonly kind: SeraTopicKind;
  readonly site: string;
  readonly device: string;
}

const CHANNEL_KINDS: ReadonlyMap<string, SeraTopicKind> = new Map([
  ["telemetry", "telemetry"],
  ["status", "status"],
  ["command", "command"],
]);

export function telemetryTopic(endpoint: DeviceEndpoint): string {
  return buildTopic(endpoint, "telemetry");
}

export function statusTopic(endpoint: DeviceEndpoint): string {
  return buildTopic(endpoint, "status");
}

export function commandTopic(endpoint: DeviceEndpoint): string {
  return buildTopic(endpoint, "command");
}

export function commandAckTopic(endpoint: DeviceEndpoint): string {
  return buildTopic(endpoint, "command/ack");
}

function assertSegment(vaue: string, name: string): void {
  if (!SEGMENT_PATTERN.test(vaue)) {
    throw new RangeError(`${name} must match ${String(SEGMENT_PATTERN)}`);
  }
}

function buildTopic(endpoint: DeviceEndpoint, suffix: string): string {
  assertSegment(endpoint.site, "site");
  assertSegment(endpoint.device, "device");
  return `${TOPIC_PREFIX}/${endpoint.site}/${endpoint.device}/${suffix}`;
}

export function belongsToDevice(
  topic: string,
  endpoint: DeviceEndpoint,
): boolean {
  const parsed = parseSeraTopic(topic);
  return (
    parsed !== null &&
    parsed.site === endpoint.site &&
    parsed.device === endpoint.device
  );
}

export function parseSeraTopic(topic: string): SeraTopic | null {
  const segments = topic.split("/");
  if (segments[0] !== TOPIC_PREFIX) {
    return null;
  }
  const site = segments[1];
  const device = segments[2];
  const channel = segments[3];
  if (site === undefined || device === undefined || channel === undefined) {
    return null;
  }
  if (!SEGMENT_PATTERN.test(site) || !SEGMENT_PATTERN.test(device)) {
    return null;
  }
  if (segments.length === 5 && channel === "command" && segments[4] === "ack") {
    return { kind: "commandAck", site, device };
  }
  const kind = CHANNEL_KINDS.get(channel);
  return segments.length === 4 && kind !== undefined
    ? { kind, site, device }
    : null;
}