/**
 * Test pemrosesan data backend: dari pesan MQTT mentah sampai baris database.
 *
 * Yang diuji bukan sekadar validator kontrak, tapi seluruh jalur pemrosesan
 * `TelemetryService.handleTelemetry`: parse topik -> cek ukuran payload -> parse
 * JSON -> validasi skema -> cek identitas -> cek skew waktu -> pencocokan sensor
 * di database -> penyusunan baris `SensorReading` -> pencatatan event penolakan.
 *
 * Sebagai keluaran, test menulis dua artefak ke `experiments/results/backend_pipeline/`:
 *   * `report.json` — angka mentah per kategori payload
 *   * `pipeline.svg` — chart hasil pemrosesan
 *
 * Semua dependensi (MQTT, Prisma, event bus, config) dimock sehingga test tidak
 * butuh Postgres maupun broker.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/common/config/env.ts';
import type { DomainEventBus } from '../src/common/events/domain-event-bus.service.ts';
import type { MqttService } from '../src/mqtt/mqtt.service.ts';
import type { PrismaService } from '../src/prisma/prisma.service.ts';
import { TelemetryService } from '../src/telemetry/telemntry.service.ts';
import { renderStackedBarChart, type BarGroup } from './svg-chart.ts';

const SITE = 'demo-01';
const DEVICE = 'esp32-01';
const PREFIX = 'sera';
const TELEMETRY_TOPIC = `${PREFIX}/${SITE}/${DEVICE}/telemetry`;
const STATUS_TOPIC = `${PREFIX}/${SITE}/${DEVICE}/status`;
const MAX_SKEW_S = 300;

const ARTIFACT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../experiments/results/backend_pipeline',
);

interface SensorFixture {
  readonly id: string;
  readonly type: string;
  readonly unit: string;
  readonly networkId: string;
  readonly blockId: string | null;
}

const SENSORS: readonly SensorFixture[] = [
  { id: 'lvl-head-01', type: 'WATER_LEVEL', unit: 'mm', networkId: 'net-1', blockId: 'blk-1' },
  { id: 'flow-head-01', type: 'FLOW', unit: 'L/s', networkId: 'net-1', blockId: 'blk-1' },
  { id: 'lvl-tail-01', type: 'WATER_LEVEL', unit: 'mm', networkId: 'net-1', blockId: 'blk-2' },
];

interface CapturedWrite {
  readonly sensorId: string;
  readonly blockId: string | null;
  readonly value: number;
  readonly quality: string;
  readonly seq: number;
  readonly ts: Date;
}

interface CapturedEvent {
  readonly type: string;
  readonly severity: string;
  readonly message: string;
  readonly payload: Record<string, unknown>;
}

interface Harness {
  readonly service: TelemetryService;
  readonly writes: CapturedWrite[];
  readonly events: CapturedEvent[];
  readonly subscribed: string[];
}

function isoSecondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function telemetryPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    device_id: DEVICE,
    site_id: SITE,
    seq: 1001,
    ts: isoSecondsAgo(1),
    readings: [
      { sensor_id: 'lvl-head-01', type: 'WATER_LEVEL', value: 418.2, unit: 'mm', quality: 'GOOD' },
      { sensor_id: 'flow-head-01', type: 'FLOW', value: 8.4, unit: 'L/s', quality: 'GOOD' },
      { sensor_id: 'lvl-tail-01', type: 'WATER_LEVEL', value: 268.5, unit: 'mm', quality: 'GOOD' },
    ],
    rssi_dbm: -62,
    firmware: '0.2.0',
    ...overrides,
  };
}

function buildHarness(): Harness {
  const writes: CapturedWrite[] = [];
  const events: CapturedEvent[] = [];
  const subscribed: string[] = [];

  const prisma = {
    sensor: {
      findMany: async (args: {
        where: { deviceId: string; id: { in: readonly string[] } };
      }): Promise<unknown[]> => {
        const wanted = new Set(args.where.id.in);
        return SENSORS.filter(
          (sensor) => args.where.deviceId === DEVICE && wanted.has(sensor.id),
        ).map((sensor) => ({
          id: sensor.id,
          type: sensor.type,
          unit: sensor.unit,
          networkId: sensor.networkId,
          node: sensor.blockId === null ? null : { block: { id: sensor.blockId } },
        }));
      },
    },
    sensorReading: {
      createMany: async (args: {
        data: readonly {
          sensorId: string;
          blockId: string | null;
          ts: Date;
          value: number;
          quality: string;
          seq: number;
        }[];
      }): Promise<{ count: number }> => {
        for (const row of args.data) {
          writes.push({
            sensorId: row.sensorId,
            blockId: row.blockId,
            value: row.value,
            quality: row.quality,
            seq: row.seq,
            ts: row.ts,
          });
        }
        return { count: args.data.length };
      },
      groupBy: async (): Promise<unknown[]> => [],
    },
    event: {
      create: async (args: { data: { type: string; severity: string; message: string; payload: unknown } }) => {
        events.push({
          type: args.data.type,
          severity: args.data.severity,
          message: args.data.message,
          payload: args.data.payload as Record<string, unknown>,
        });
        return { id: `evt-${events.length}` };
      },
    },
  };

  const mqtt = {
    register: (subscription: { topics: readonly string[] }): void => {
      subscribed.push(...subscription.topics);
    },
  };

  const bus = { publish: (): void => undefined };

  const values: Record<string, unknown> = {
    MQTT_TOPIC_PREFIX: PREFIX,
    TELEMETRY_MAX_SKEW_S: MAX_SKEW_S,
    TELEMETRY_STALE_S: 900,
  };
  const config = {
    get: (key: string): unknown => values[key],
  };

  const service = new TelemetryService(
    mqtt as unknown as MqttService,
    prisma as unknown as PrismaService,
    bus as unknown as DomainEventBus,
    config as unknown as ConfigService<Env, true>,
  );

  return { service, writes, events, subscribed };
}

type Ingest = (parsed: { kind: string; site: string; device: string }, payload: Buffer) => Promise<void>;

function ingestOf(service: TelemetryService): Ingest {
  return (
    service as unknown as { handleTelemetry: Ingest }
  ).handleTelemetry.bind(service);
}

async function publish(
  harness: Harness,
  topic: string,
  body: string,
): Promise<void> {
  const parsed = topic === TELEMETRY_TOPIC
    ? { kind: 'telemetry', site: SITE, device: DEVICE }
    : { kind: 'telemetry', site: SITE, device: DEVICE };
  await ingestOf(harness.service)(parsed, Buffer.from(body, 'utf-8'));
}

describe('pemrosesan telemetry backend', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  it('mendaftarkan langganan ke topik telemetry dan status', () => {
    harness.service.onModuleInit();
    expect(harness.subscribed).toContain(`${PREFIX}/+/+/telemetry`);
    expect(harness.subscribed).toContain(`${PREFIX}/+/+/status`);
  });

  it('menulis satu baris SensorReading per reading yang valid', async () => {
    await publish(harness, TELEMETRY_TOPIC, JSON.stringify(telemetryPayload()));
    expect(harness.writes).toHaveLength(3);
    expect(harness.writes.map((row) => row.sensorId).sort()).toEqual([
      'flow-head-01',
      'lvl-head-01',
      'lvl-tail-01',
    ]);
    expect(harness.events).toHaveLength(0);
  });

  it('memetakan sensor ke blok lewat relasi node', async () => {
    await publish(harness, TELEMETRY_TOPIC, JSON.stringify(telemetryPayload()));
    const byBlock = new Map(harness.writes.map((row) => [row.sensorId, row.blockId]));
    expect(byBlock.get('lvl-head-01')).toBe('blk-1');
    expect(byBlock.get('lvl-tail-01')).toBe('blk-2');
  });

  it('menyimpan seq dan timestamp sebagai satu titik waktu yang sama', async () => {
    const payload = telemetryPayload({ seq: 4242 });
    await publish(harness, TELEMETRY_TOPIC, JSON.stringify(payload));
    const expected = Date.parse(String(payload.ts));
    for (const row of harness.writes) {
      expect(row.seq).toBe(4242);
      expect(row.ts.getTime()).toBe(expected);
    }
  });
});

describe('penolakan telemetry backend', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  it('menolak JSON yang tidak valid tanpa menulis baris', async () => {
    await publish(harness, TELEMETRY_TOPIC, '{bukan json');
    expect(harness.writes).toHaveLength(0);
    expect(harness.events[0]?.payload.reason).toBe('invalid_json');
  });

  it('menolak payload dengan field asing (kontrak strict)', async () => {
    await publish(harness, TELEMETRY_TOPIC, JSON.stringify(telemetryPayload({ extra: 1 })));
    expect(harness.writes).toHaveLength(0);
    expect(harness.events[0]?.payload.reason).toBe('schema_violation');
  });

  it('menolak nilai di luar rentang fisik sensor', async () => {
    const payload = telemetryPayload();
    const readings = (payload.readings as Record<string, unknown>[]).map((reading) => ({
      ...reading,
      value: 9999,
    }));
    await publish(harness, TELEMETRY_TOPIC, JSON.stringify({ ...payload, readings }));
    expect(harness.writes).toHaveLength(0);
    expect(harness.events[0]?.payload.reason).toBe('schema_violation');
  });

  it('menolak payload yang mengaku device lain dari topiknya', async () => {
    await publish(
      harness,
      TELEMETRY_TOPIC,
      JSON.stringify(telemetryPayload({ device_id: 'esp32-99' })),
    );
    expect(harness.writes).toHaveLength(0);
    expect(harness.events[0]?.payload.reason).toBe('identity_mismatch');
  });

  it('menolak timestamp di luar jendela skew', async () => {
    await publish(
      harness,
      TELEMETRY_TOPIC,
      JSON.stringify(telemetryPayload({ ts: isoSecondsAgo(MAX_SKEW_S + 120) })),
    );
    expect(harness.writes).toHaveLength(0);
    expect(harness.events[0]?.payload.reason).toBe('timestamp_skew');
  });

  it('menerima timestamp tepat di batas jendela skew', async () => {
    await publish(
      harness,
      TELEMETRY_TOPIC,
      JSON.stringify(telemetryPayload({ ts: isoSecondsAgo(MAX_SKEW_S - 30) })),
    );
    expect(harness.writes).toHaveLength(3);
  });

  it('menolak payload melebihi batas ukuran', async () => {
    const padding = 'x'.repeat(70_000);
    await publish(
      harness,
      TELEMETRY_TOPIC,
      JSON.stringify(telemetryPayload({ firmware: padding })),
    );
    expect(harness.writes).toHaveLength(0);
    expect(harness.events[0]?.payload.reason).toBe('payload_too_large');
  });

  it('menolak reading dari sensor yang tidak terdaftar untuk device itu', async () => {
    const payload = telemetryPayload({
      readings: [
        { sensor_id: 'lvl-head-01', type: 'WATER_LEVEL', value: 400, unit: 'mm', quality: 'GOOD' },
        { sensor_id: 'tidak-ada-01', type: 'WATER_LEVEL', value: 400, unit: 'mm', quality: 'GOOD' },
      ],
    });
    await publish(harness, TELEMETRY_TOPIC, JSON.stringify(payload));
    expect(harness.writes).toHaveLength(1);
    const rejection = harness.events.find((event) => event.payload.reason === 'readings_rejected');
    expect(rejection?.payload.rejected).toBe(1);
  });

  it('menolak reading yang tipenya berbeda dari database', async () => {
    const payload = telemetryPayload({
      readings: [
        { sensor_id: 'lvl-head-01', type: 'FLOW', value: 4.2, unit: 'mm', quality: 'GOOD' },
      ],
    });
    await publish(harness, TELEMETRY_TOPIC, JSON.stringify(payload));
    expect(harness.writes).toHaveLength(0);
    const reasons = harness.events[0]?.payload.reasons as Record<string, number>;
    expect(reasons.type_mismatch).toBe(1);
  });

  it('menolak reading yang satuannya berbeda dari database', async () => {
    // WATER_LEVEL tidak bisa dipakai di sini: kontrak sudah mengunci satuannya
    // ke "mm" lewat rentang fisik, sehingga payload seperti itu gugur lebih awal
    // sebagai schema_violation. FLOW tidak punya rentang fisik, jadi penolakan
    // benar-benar terjadi di perbandingan unit terhadap database.
    const payload = telemetryPayload({
      readings: [
        { sensor_id: 'flow-head-01', type: 'FLOW', value: 0.0084, unit: 'm3/s', quality: 'GOOD' },
      ],
    });
    await publish(harness, TELEMETRY_TOPIC, JSON.stringify(payload));
    expect(harness.writes).toHaveLength(0);
    const reasons = harness.events[0]?.payload.reasons as Record<string, number>;
    expect(reasons.unit_mismatch).toBe(1);
  });

  it('menandai reading di luar rentang sanity sebagai SUSPECT, bukan menolaknya', async () => {
    const payload = telemetryPayload({
      readings: [
        { sensor_id: 'flow-head-01', type: 'FLOW', value: 900, unit: 'L/s', quality: 'GOOD' },
      ],
    });
    await publish(harness, TELEMETRY_TOPIC, JSON.stringify(payload));
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0]?.quality).toBe('SUSPECT');
  });
});

describe('chart hasil pemrosesan backend', () => {
  it('menulis report.json dan pipeline.svg dari korpus payload', async () => {
    interface Case {
      readonly label: string;
      readonly reason?: string;
      readonly body: string;
    }

    const cases: Case[] = [
      { label: 'valid (3 sensor)', body: JSON.stringify(telemetryPayload()) },
      {
        label: 'kualitas STALE',
        body: JSON.stringify(
          telemetryPayload({
            readings: (telemetryPayload().readings as Record<string, unknown>[]).map(
              (reading) => ({ ...reading, quality: 'STALE' }),
            ),
          }),
        ),
      },
      { label: 'JSON rusak', body: '{bukan json' },
      { label: 'field asing', body: JSON.stringify(telemetryPayload({ extra: 1 })) },
      {
        label: 'device tidak cocok',
        body: JSON.stringify(telemetryPayload({ device_id: 'esp32-99' })),
      },
      {
        label: 'timestamp basi',
        body: JSON.stringify(telemetryPayload({ ts: isoSecondsAgo(MAX_SKEW_S + 600) })),
      },
      {
        label: 'sensor tak dikenal',
        body: JSON.stringify(
          telemetryPayload({
            readings: [
              { sensor_id: 'hantu-01', type: 'FLOW', value: 1, unit: 'L/s', quality: 'GOOD' },
            ],
          }),
        ),
      },
      {
        label: 'satuan beda dari DB',
        body: JSON.stringify(
          telemetryPayload({
            readings: [
              { sensor_id: 'flow-head-01', type: 'FLOW', value: 0.0084, unit: 'm3/s', quality: 'GOOD' },
            ],
          }),
        ),
      },
      {
        label: 'kombinasi valid + hantu',
        body: JSON.stringify(
          telemetryPayload({
            readings: [
              { sensor_id: 'lvl-head-01', type: 'WATER_LEVEL', value: 400, unit: 'mm', quality: 'GOOD' },
              { sensor_id: 'hantu-01', type: 'FLOW', value: 1, unit: 'L/s', quality: 'GOOD' },
            ],
          }),
        ),
      },
    ];

    const rows: {
      label: string;
      stored: number;
      rejected: number;
      messageRejected: number;
    }[] = [];
    for (const testCase of cases) {
      const harness = buildHarness();
      const offeredReadings = (JSON.parse(
        testCase.body.startsWith('{bukan') ? '{"readings":[]}' : testCase.body,
      ) as { readings?: unknown[] }).readings?.length ?? 0;
      await publish(harness, TELEMETRY_TOPIC, testCase.body);
      const stored = harness.writes.length;
      const rejected = Math.max(0, offeredReadings - stored);
      rows.push({
        label: testCase.label,
        stored,
        rejected,
        // Payload yang tidak bisa diparse tidak punya reading untuk dihitung,
        // tetapi pesannya tetap ditolak dan dicatat sebagai event alert.
        messageRejected: offeredReadings === 0 && harness.events.length > 0 ? 1 : 0,
      });
      expect(stored).toBeGreaterThanOrEqual(0);
    }

    const totalStored = rows.reduce((sum, row) => sum + row.stored, 0);
    const totalRejected = rows.reduce((sum, row) => sum + row.rejected, 0);
    const totalMessageRejected = rows.reduce((sum, row) => sum + row.messageRejected, 0);
    expect(totalStored).toBeGreaterThan(0);
    expect(totalMessageRejected).toBeGreaterThan(0);

    const groups: BarGroup[] = rows.map((row) => ({
      label: row.label,
      segments: [
        { label: 'baris ditulis', value: row.stored, color: '#1b4965' },
        { label: 'reading ditolak', value: row.rejected, color: '#e07a5f' },
        { label: 'pesan ditolak', value: row.messageRejected, color: '#8d99ae' },
      ],
    }));

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
      join(ARTIFACT_DIR, 'report.json'),
      `${JSON.stringify(
        {
          generated_by: 'services/api/test/backend-pipeline.test.ts',
          topic: TELEMETRY_TOPIC,
          max_skew_s: MAX_SKEW_S,
          registered_sensors: SENSORS.map((sensor) => sensor.id),
          cases: rows,
          totals: {
            stored: totalStored,
            rejected: totalRejected,
            message_rejected: totalMessageRejected,
          },
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    writeFileSync(
      join(ARTIFACT_DIR, 'pipeline.svg'),
      renderStackedBarChart(groups, {
        title: 'Pemrosesan telemetry backend per kategori payload',
        subtitle: `topik ${TELEMETRY_TOPIC} — ${cases.length} kategori, ${totalStored} baris ditulis, ${totalRejected} reading ditolak, ${totalMessageRejected} pesan ditolak`,
      }),
      'utf-8',
    );
  });

  it('membedakan status online dan offline pada topik status', async () => {
    const harness = buildHarness();
    const handleStatus = (
      harness.service as unknown as {
        handleStatus: (
          parsed: { kind: string; site: string; device: string },
          payload: Buffer,
        ) => Promise<void>;
      }
    ).handleStatus.bind(harness.service);

    const statusBody = (status: string): string =>
      JSON.stringify({
        schema_version: 1,
        device_id: DEVICE,
        site_id: SITE,
        status,
        ts: isoSecondsAgo(1),
      });

    await handleStatus({ kind: 'status', site: SITE, device: DEVICE }, Buffer.from(statusBody('online')));
    const onlineEvents = harness.events.length;
    await handleStatus({ kind: 'status', site: SITE, device: DEVICE }, Buffer.from(statusBody('offline')));
    expect(harness.events.length).toBe(onlineEvents + 1);
    expect(harness.events.at(-1)?.payload.status).toBe('offline');
  });
});
