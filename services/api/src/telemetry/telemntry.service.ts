import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  deviceStatusSchema,
  Reading,
  telemetrySchema,
  type SensorType,
} from '@sera/contracts';
import type { Env } from '../common/config/env.ts';
import type { Prisma, ReadingQuality } from '../generated/prisma/client.ts';
import { MqttService, type MqttMessage } from '../mqtt/mqtt.service.ts';
import { DomainEventBus } from '../common/events/domain-event-bus.service.ts';
import { PrismaService } from '../prisma/prisma.service.ts';

const TELEMETRY_CHANNEL = 'telemetry';
const STATUS_CHANNEL = 'status';
const STALE_SWEEP_INTERVAL_MS = 60_000;
const REJECTION_WINDOW_MS = 300_000;
const MAX_PAYLOAD_BYTES = 65_536;
const MAX_REPORTED_ISSUES = 10;
const EVENT_TYPE_ALERT = 'alert';
const EVENT_TYPE_SYSTEM = 'system';
const SEVERITY_WARNING = 'warning';
const SEVERITY_INFO = 'info';
const STALE_ALERT_CODE = 'stale_data';
const OFFLINE_ALERT_CODE = 'sensor_offline';

const REASON_INVALID_TOPIC = 'invalid_topic';
const REASON_PAYLOAD_TOO_LARGE = 'payload_too_large';
const REASON_INVALID_JSON = 'invalid_json';
const REASON_SCHEMA_VIOLATION = 'schema_violation';
const REASON_IDENTITY_MISMATCH = 'identity_mismatch';
const REASON_TIMESTAMP_SKEW = 'timestamp_skew';
const REASON_READINGS_REJECTED = 'readings_rejected';
const REASON_UNKNOWN_SENSOR = 'unknown_sensor';
const REASON_TYPE_MISMATCH = 'type_mismatch';
const REASON_UNIT_MISMATCH = 'unit_mismatch';

const SANITY_RANGES: Partial<Record<SensorType, { min: number; max: number }>> =
  {
    FLOW: { min: 0, max: 500 },
    PRESSURE: { min: 0, max: 2_000 },
    SOIL_MOISTURE: { min: 0, max: 100 },
  };

interface ParsedTopic {
  readonly site: string;
  readonly device: string;
  readonly channel: string;
}

interface SensorRow {
  readonly id: string;
  readonly type: SensorType;
  readonly unit: string;
  readonly networkId: string;
  readonly node: { readonly block: { readonly id: string } | null } | null;
}

interface SensorMeta {
  readonly id: string;
  readonly type: SensorType;
  readonly unit: string;
  readonly networkId: string;
  readonly blockId: string | null;
}

interface IngestOutcome {
  readonly networkId: string | null;
  readonly stored: number;
  readonly duplicates: number;
  readonly rejectedReadings: number;
  readonly reasons: Record<string, number>;
}

export interface TelemetryStats {
  readonly received: number;
  readonly stored: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly trackedDevices: number;
}

interface EventInput {
  readonly type: string;
  readonly severity: string;
  readonly message: string;
  readonly payload: Record<string, unknown>;
  readonly networkId: string | null;
}

interface IngestOutcome {
  readonly networkId: string | null;
  readonly accepted: readonly Reading[];
  readonly stored: number;
  readonly duplicates: number;
  readonly rejectedReadings: number;
  readonly reasons: Record<string, number>;
}

interface StoredEvent {
  readonly id: string;
}

type JsonParseResult = { ok: true; value: unknown } | { ok: false };

function bump(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}


function parseJson(payload: Buffer): JsonParseResult {
    try {
        return {ok: true, value: JSON.parse(payload.toString('utf-8'))};
    } catch {
        return {ok: false};
    }
}


function parseTopic(prefix: string, topic: string): ParsedTopic | null {
    const expectedPrefix = `${prefix}/`;
    if(!topic.startsWith(expectedPrefix)) {
        return null;
    }

    const segments = topic.slice(expectedPrefix.length).split('/');
    const site = segments[0];
    const device = segments[1];
    const channel = segments[2];

    if(site === undefined || device === undefined || channel === undefined) {
        return null;
    }

    if (segments.length !== 3) {
        return null;
    }

    return {site, device, channel};
}

function resolveQuality(
  sensorType: SensorType,
  value: number,
  declared: ReadingQuality,
): ReadingQuality {
  if (declared !== 'GOOD') {
    return declared;
  }
  const range = SANITY_RANGES[sensorType];
  if (range === undefined) {
    return 'GOOD';
  }
  return value >= range.min && value <= range.max ? 'GOOD' : 'SUSPECT';
}


function toSensorMeta(row: SensorRow): SensorMeta {
    return {
        id: row.id,
        type: row.type,
        unit: row.unit,
        networkId: row.networkId,
        blockId: row.node?.block?.id ?? null,
    }
}

class RejectionRecorder {
  private readonly entries = new Map<
    string,
    { firstAt: number; count: number }
  >();

  constructor(private readonly windowMs: number) {}

  register(key: string): { report: boolean; suppressed: number } {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (entry === undefined) {
      this.entries.set(key, { firstAt: now, count: 1 });
      return { report: true, suppressed: 0 };
    }
    entry.count += 1;
    if (now - entry.firstAt < this.windowMs) {
      return { report: false, suppressed: 0 };
    }
    const suppressed = entry.count - 1;
    this.entries.set(key, { firstAt: now, count: 1 });
    return { report: true, suppressed };
  }
}

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly lastSeenByDevice = new Map<string, number>();
  private readonly rejectionRecorder = new RejectionRecorder(
    REJECTION_WINDOW_MS,
  );

  private readonly prefix: string;
  private readonly maxSkewMs: number;
  private readonly staleMs: number;
  private readonly stats = {
    received: 0,
    stored: 0,
    duplicates: 0,
    rejected: 0,
  };
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly mqtt: MqttService,
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
    config: ConfigService<Env, true>,
  ) {
    this.prefix = config.get('MQTT_TOPIC_PREFIX', { infer: true });
    this.maxSkewMs =
      config.get('TELEMETRY_MAX_SKEW_S', { infer: true }) * 1_000;
    this.staleMs = config.get('TELEMETRY_STALE_S', { infer: true }) * 1_000;
  }

  async onModuleInit(): Promise<void> {
    this.mqtt.register({
      topics: [
        `${this.prefix}/+/+/${TELEMETRY_CHANNEL}`,
        `${this.prefix}/+/+/${STATUS_CHANNEL}`,
      ],
      handler: (message) => this.handleMessage(message),
    });
    await this.loadLastSeen();
    this.sweepTimer = setInterval(() => {
      void this.sweepStaleDevices();
    }, STALE_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  getStats(): TelemetryStats {
    return { ...this.stats, trackedDevices: this.lastSeenByDevice.size };
  }

  private async handleMessage(message: MqttMessage): Promise<void> {
    const parsed = parseTopic(this.prefix, message.topic);
    if (parsed === null) {
      await this.reportRejection(
        `${REASON_INVALID_TOPIC}:${message.topic}`,
        REASON_INVALID_TOPIC,
        `telemetry topic rejected: ${message.topic}`,
        { topic: message.topic },
        null,
      );
      return;
    }
    if (parsed.channel === TELEMETRY_CHANNEL) {
      await this.handleTelemetry(parsed, message.payload);
      return;
    }
    if (parsed.channel === STATUS_CHANNEL) {
      await this.handleStatus(parsed, message.payload);
    }
  }

  private async handleTelemetry(
    parsed: ParsedTopic,
    payload: Buffer,
  ): Promise<void> {
    const rejectionKey = (reason: string): string =>
      `${reason}:${parsed.site}/${parsed.device}`;
    this.stats.received += 1;
    if (payload.length > MAX_PAYLOAD_BYTES) {
      await this.reportRejection(
        rejectionKey(REASON_PAYLOAD_TOO_LARGE),
        REASON_PAYLOAD_TOO_LARGE,
        `telemetry rejected: payload exceeds ${MAX_PAYLOAD_BYTES} bytes`,
        { site: parsed.site, device: parsed.device, bytes: payload.length },
        null,
      );
      return;
    }
    const json = parseJson(payload);
    if (!json.ok) {
      await this.reportRejection(
        rejectionKey(REASON_INVALID_JSON),
        REASON_INVALID_JSON,
        'telemetry rejected: payload is not valid JSON',
        { site: parsed.site, device: parsed.device },
        null,
      );
      return;
    }
    const result = telemetrySchema.safeParse(json.value);
    if (!result.success) {
      await this.reportRejection(
        rejectionKey(REASON_SCHEMA_VIOLATION),
        REASON_SCHEMA_VIOLATION,
        'telemetry rejected: payload violates the contract',
        {
          site: parsed.site,
          device: parsed.device,
          issues: result.error.issues
            .slice(0, MAX_REPORTED_ISSUES)
            .map(
              (issue) =>
                `${issue.path.map((segment) => String(segment)).join('.')}: ${issue.message}`,
            ),
        },
        null,
      );
      return;
    }
    const telemetry = result.data;
    if (
      telemetry.site_id !== parsed.site ||
      telemetry.device_id !== parsed.device
    ) {
      await this.reportRejection(
        rejectionKey(REASON_IDENTITY_MISMATCH),
        REASON_IDENTITY_MISMATCH,
        'telemetry rejected: payload identity does not match its topic',
        {
          site: parsed.site,
          device: parsed.device,
          payload_site: telemetry.site_id,
          payload_device: telemetry.device_id,
        },
        null,
      );
      return;
    }
    const tsMs = Date.parse(telemetry.ts);
    if (Math.abs(Date.now() - tsMs) > this.maxSkewMs) {
      await this.reportRejection(
        rejectionKey(REASON_TIMESTAMP_SKEW),
        REASON_TIMESTAMP_SKEW,
        'telemetry rejected: timestamp outside the accepted window',
        {
          site: parsed.site,
          device: parsed.device,
          ts: telemetry.ts,
          max_skew_s: this.maxSkewMs / 1_000,
        },
        null,
      );
      return;
    }
    const outcome = await this.ingest(parsed, telemetry, tsMs);
    if (outcome.rejectedReadings > 0) {
      await this.reportRejection(
        rejectionKey(REASON_READINGS_REJECTED),
        REASON_READINGS_REJECTED,
        outcome.stored + outcome.duplicates === 0
          ? 'telemetry rejected: no usable readings'
          : 'telemetry partially rejected: some readings were dropped',
        {
          site: parsed.site,
          device: parsed.device,
          seq: telemetry.seq,
          rejected: outcome.rejectedReadings,
          reasons: outcome.reasons,
        },
        outcome.networkId,
      );
    }

    if (outcome.stored > 0) {
      this.events.publish({
        type: 'telemetry.updated',
        network_id: outcome.networkId,
        payload: {
          device_id: telemetry.device_id,
          site_id: telemetry.site_id,
          seq: telemetry.seq,
          readings: [...outcome.accepted],
        },
      });
    }
    if (outcome.stored > 0 || outcome.duplicates > 0) {
      this.logger.debug(
        `telemetry ${parsed.device}: stored ${outcome.stored}, duplicates ${outcome.duplicates}`,
      );
    }
  }

  private async handleStatus(
    parsed: ParsedTopic,
    payload: Buffer,
  ): Promise<void> {
    const json = parseJson(payload);
    if (!json.ok) {
      return;
    }
    const result = deviceStatusSchema.safeParse(json.value);
    if (!result.success) {
      return;
    }
    const status = result.data;
    if (status.site_id !== parsed.site || status.device_id !== parsed.device) {
      return;
    }

    const message = `device ${parsed.device} is ${status.status}`;
    const stored = await this.writeEvent({
      type: EVENT_TYPE_SYSTEM,
      severity: SEVERITY_INFO,
      message,
      payload: {
        site: parsed.site,
        device: parsed.device,
        status: status.status,
        ts: status.ts,
      },
      networkId: null,
    });
    if (stored !== null && status.status === 'offline') {
      this.events.publish({
        type: 'alert.raised',
        network_id: null,
        payload: {
          alert_id: stored.id,
          severity: SEVERITY_WARNING,
          code: OFFLINE_ALERT_CODE,
          message,
          block_id: null,
          plan_id: null,
        },
      });
    }
  }

  private async ingest(
    parsed: ParsedTopic,
    telemetry: {
      readonly seq: number;
      readonly readings: readonly {
        readonly sensor_id: string;
        readonly type: SensorType;
        readonly unit: string;
        readonly value: number;
        readonly quality: ReadingQuality;
      }[];
    },
    tsMs: number,
  ): Promise<IngestOutcome> {
    const sensorIds = [
      ...new Set(telemetry.readings.map((reading) => reading.sensor_id)),
    ];
    const sensorRows = await this.prisma.sensor.findMany({
      where: { deviceId: parsed.device, id: { in: sensorIds } },
      select: {
        id: true,
        type: true,
        unit: true,
        networkId: true,
        node: { select: { block: { select: { id: true } } } },
      },
    });
    const sensorById = new Map(
      sensorRows.map((row) => [row.id, toSensorMeta(row)]),
    );
    const rows: Prisma.SensorReadingCreateManyInput[] = [];
    const accepted: Reading[] = [];
    const reasons: Record<string, number> = {};
    let networkId: string | null = null;
    for (const reading of telemetry.readings) {
      const sensor = sensorById.get(reading.sensor_id);
      if (sensor === undefined) {
        bump(reasons, REASON_UNKNOWN_SENSOR);
        continue;
      }
      if (sensor.type !== reading.type) {
        bump(reasons, REASON_TYPE_MISMATCH);
        continue;
      }
      if (sensor.unit !== reading.unit) {
        bump(reasons, REASON_UNIT_MISMATCH);
        continue;
      }
      networkId ??= sensor.networkId;
      const quality = resolveQuality(
        sensor.type,
        reading.value,
        reading.quality,
      );
      accepted.push({
        sensor_id: reading.sensor_id,
        type: reading.type,
        value: reading.value,
        unit: reading.unit,
        quality,
      });
      rows.push({
        sensorId: sensor.id,
        blockId: sensor.blockId,
        ts: new Date(tsMs),
        value: reading.value,
        quality,
        seq: telemetry.seq,
      });
    }
    const rejectedReadings = telemetry.readings.length - rows.length;
    if (rows.length === 0) {
      return {
        networkId,
        accepted,
        stored: 0,
        duplicates: 0,
        rejectedReadings,
        reasons,
      };
    }
    const inserted = await this.prisma.sensorReading.createMany({
      data: rows,
      skipDuplicates: true,
    });
    const duplicates = rows.length - inserted.count;
    if (inserted.count > 0) {
      const previous = this.lastSeenByDevice.get(parsed.device) ?? 0;
      if (tsMs > previous) {
        this.lastSeenByDevice.set(parsed.device, tsMs);
      }
    }
    this.stats.stored += inserted.count;
    this.stats.duplicates += duplicates;
    return {
      networkId,
      accepted,
      stored: inserted.count,
      duplicates,
      rejectedReadings,
      reasons,
    };
  }

  private async reportRejection(
    key: string,
    reason: string,
    message: string,
    payload: Record<string, unknown>,
    networkId: string | null,
  ): Promise<void> {
    this.stats.rejected += 1;
    const decision = this.rejectionRecorder.register(key);
    if (!decision.report) {
      this.logger.debug(`telemetry rejection suppressed: ${key}`);
      return;
    }
    await this.writeEvent({
      type: EVENT_TYPE_ALERT,
      severity: SEVERITY_WARNING,
      message:
        decision.suppressed > 0
          ? `${message} (x${decision.suppressed + 1} in window)`
          : message,
      payload: { ...payload, reason, suppressed: decision.suppressed },
      networkId,
    });
  }

  private async writeEvent(input: EventInput): Promise<StoredEvent | null> {
    try {
      return await this.prisma.event.create({
        data: {
          networkId: input.networkId,
          type: input.type,
          severity: input.severity,
          message: input.message,
          payload: input.payload as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    } catch (error) {
      this.logger.warn(`failed to persist event: ${String(error)}`);
      return null;
    }
  }

  private async loadLastSeen(): Promise<void> {
    try {
      const grouped = await this.prisma.sensorReading.groupBy({
        by: ['sensorId'],
        _max: { ts: true },
      });
      const sensorIds = grouped.map((row) => row.sensorId);
      if (sensorIds.length === 0) {
        return;
      }
      const sensors = await this.prisma.sensor.findMany({
        where: { id: { in: sensorIds } },
        select: { id: true, deviceId: true },
      });
      const deviceBySensor = new Map(
        sensors.map((sensor) => [sensor.id, sensor.deviceId]),
      );
      for (const row of grouped) {
        const device = deviceBySensor.get(row.sensorId);
        const ts = row._max.ts;
        if (device === undefined || ts === null) {
          continue;
        }
        const ms = ts.getTime();
        if (ms > (this.lastSeenByDevice.get(device) ?? 0)) {
          this.lastSeenByDevice.set(device, ms);
        }
      }
    } catch (error) {
      this.logger.warn(
        `failed to load device last-seen state: ${String(error)}`,
      );
    }
  }

  private async sweepStaleDevices(): Promise<void> {
    const now = Date.now();
    const expired: { device: string; lastSeen: number }[] = [];
    for (const [device, lastSeen] of this.lastSeenByDevice) {
      if (now - lastSeen > this.staleMs) {
        expired.push({ device, lastSeen });
      }
    }
    
    for (const entry of expired) {
      this.lastSeenByDevice.delete(entry.device);
      const message = `device ${entry.device} is stale: no readings within ${this.staleMs / 1_000} s`;
      const stored = await this.writeEvent({
        type: EVENT_TYPE_ALERT,
        severity: SEVERITY_WARNING,
        message,
        payload: {
          device: entry.device,
          code: STALE_ALERT_CODE,
          last_seen_at: new Date(entry.lastSeen).toISOString(),
          threshold_s: this.staleMs / 1_000,
        },
        networkId: null,
      });
      if (stored !== null) {
        this.events.publish({
          type: 'alert.raised',
          network_id: null,
          payload: {
            alert_id: stored.id,
            severity: SEVERITY_WARNING,
            code: STALE_ALERT_CODE,
            message,
            block_id: null,
            plan_id: null,
          },
        });
      }
    }
  }
}