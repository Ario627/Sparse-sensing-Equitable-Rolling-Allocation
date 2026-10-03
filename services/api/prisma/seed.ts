import { createHash, scryptSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client.ts';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEMO_EPOCH = new Date('2026-10-03T00:00:00.000Z');
const DEMO_SEED = 1042;
const WEATHER_DAYS = 7;
const LEDGER_PERIOD_DAYS = 14;
const LEDGER_PERIOD_HOURS = 6;
const LEDGER_GAMMA = 0.9;
const LEDGER_DEBT_MAX_M3 = 40;
const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024,
};

const NODE_SPECS = [
  { key: 'S', type: 'SOURCE', name: 'Sumber Utama', orderIdx: 0 },
  { key: 'H', type: 'JUNCTION', name: 'Head Box', orderIdx: 1 },
  { key: 'GA', type: 'GATE', name: 'Gate A', orderIdx: 2 },
  { key: 'TA', type: 'BLOCK_TERMINAL', name: 'Terminal A', orderIdx: 3 },
  { key: 'GB', type: 'GATE', name: 'Gate B', orderIdx: 2 },
  { key: 'TB', type: 'BLOCK_TERMINAL', name: 'Terminal B', orderIdx: 3 },
  { key: 'M', type: 'JUNCTION', name: 'Middle Box', orderIdx: 2 },
  { key: 'GC', type: 'GATE', name: 'Gate C', orderIdx: 3 },
  { key: 'TC', type: 'BLOCK_TERMINAL', name: 'Terminal C', orderIdx: 4 },
  { key: 'GD', type: 'GATE', name: 'Gate D', orderIdx: 3 },
  { key: 'TD', type: 'BLOCK_TERMINAL', name: 'Terminal D', orderIdx: 4 },
  { key: 'RT', type: 'JUNCTION', name: 'Tail Box', orderIdx: 3 },
  { key: 'GE', type: 'GATE', name: 'Gate E', orderIdx: 4 },
  { key: 'TE', type: 'BLOCK_TERMINAL', name: 'Terminal E', orderIdx: 5 },
  { key: 'GF', type: 'GATE', name: 'Gate F', orderIdx: 4 },
  { key: 'TF', type: 'BLOCK_TERMINAL', name: 'Terminal F', orderIdx: 5 },
] as const;

const EDGE_SPECS = [
  { from: 'S', to: 'H', zone: 'HEAD', capacityLps: 20, lengthM: 120 },
  { from: 'H', to: 'GA', zone: 'HEAD', capacityLps: 6, lengthM: 30 },
  { from: 'GA', to: 'TA', zone: 'HEAD', capacityLps: 5, lengthM: 12 },
  { from: 'H', to: 'GB', zone: 'HEAD', capacityLps: 6, lengthM: 34 },
  { from: 'GB', to: 'TB', zone: 'HEAD', capacityLps: 5, lengthM: 14 },
  { from: 'H', to: 'M', zone: 'MIDDLE', capacityLps: 14, lengthM: 180 },
  { from: 'M', to: 'GC', zone: 'MIDDLE', capacityLps: 6, lengthM: 40 },
  { from: 'GC', to: 'TC', zone: 'MIDDLE', capacityLps: 5, lengthM: 15 },
  { from: 'M', to: 'GD', zone: 'MIDDLE', capacityLps: 6, lengthM: 44 },
  { from: 'GD', to: 'TD', zone: 'MIDDLE', capacityLps: 5, lengthM: 16 },
  { from: 'M', to: 'RT', zone: 'TAIL', capacityLps: 8, lengthM: 140 },
  { from: 'RT', to: 'GE', zone: 'TAIL', capacityLps: 4, lengthM: 26 },
  { from: 'GE', to: 'TE', zone: 'TAIL', capacityLps: 3.5, lengthM: 10 },
  { from: 'RT', to: 'GF', zone: 'TAIL', capacityLps: 4, lengthM: 28 },
  { from: 'GF', to: 'TF', zone: 'TAIL', capacityLps: 3.5, lengthM: 12 },
] as const;

const BLOCK_SPECS = [
  {
    key: 'TA',
    name: 'Blok A',
    areaM2: 4200,
    nominalFlowLps: 2.8,
    distanceFromSourceM: 150,
    needFactor: 0.95,
    serviceRatioBase: 0.93,
  },
  {
    key: 'TB',
    name: 'Blok B',
    areaM2: 3800,
    nominalFlowLps: 2.5,
    distanceFromSourceM: 185,
    needFactor: 1.0,
    serviceRatioBase: 0.9,
  },
  {
    key: 'TC',
    name: 'Blok C',
    areaM2: 5100,
    nominalFlowLps: 3.1,
    distanceFromSourceM: 380,
    needFactor: 1.0,
    serviceRatioBase: 0.85,
  },
  {
    key: 'TD',
    name: 'Blok D',
    areaM2: 4600,
    nominalFlowLps: 2.9,
    distanceFromSourceM: 410,
    needFactor: 1.05,
    serviceRatioBase: 0.83,
  },
  {
    key: 'TE',
    name: 'Blok E',
    areaM2: 3400,
    nominalFlowLps: 2.2,
    distanceFromSourceM: 560,
    needFactor: 1.12,
    serviceRatioBase: 0.72,
  },
  {
    key: 'TF',
    name: 'Blok F',
    areaM2: 3600,
    nominalFlowLps: 2.3,
    distanceFromSourceM: 590,
    needFactor: 1.15,
    serviceRatioBase: 0.7,
  },
] as const;

const SENSOR_SPECS = [
  { id: 'lvl-head-01', nodeKey: 'H', type: 'WATER_LEVEL', unit: 'mm' },
  { id: 'flow-head-01', nodeKey: 'H', type: 'FLOW', unit: 'L/s' },
  { id: 'lvl-tail-01', nodeKey: 'RT', type: 'WATER_LEVEL', unit: 'mm' },
] as const;

const USER_SPECS = [
  {
    email: 'admin@sera.local',
    fullName: 'Admin Demo',
    role: 'ADMIN',
    password: 'sera-demo-admin',
  },
  {
    email: 'operator@sera.local',
    fullName: 'Operator P3A Demo',
    role: 'OPERATOR',
    password: 'sera-demo-operator',
  },
  {
    email: 'researcher@sera.local',
    fullName: 'Peneliti Demo',
    role: 'RESEARCHER',
    password: 'sera-demo-researcher',
  },
] as const;

const DEMO_DEVICE_ID = 'esp32-01';

const EXPERIMENT_CONFIG_YAML = `experiment: E1_sensor_budget_curve
methods: [sera, proportional, rotation, greedy, oracle]
topology: branched
n_blocks: 6
sensor_counts: [0, 1, 2, 3, 4]
scenarios: [normal, drought]
seeds: 10
seed_base: 1042
`;

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function requireId(map: ReadonlyMap<string, string>, key: string): string {
  const id = map.get(key);
  if (id === undefined) {
    throw new Error(`seed is missing a generated id for ${key}`);
  }
  return id;
}

function hashDemoPassword(password: string): string {
  const salt = 'sera-demo-v1';
  const derived = scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${derived.toString('hex')}`;
}

function buildWeatherRows(random: () => number) {
  return Array.from({ length: WEATHER_DAYS }, (_, index) => {
    const validFrom = addDays(DEMO_EPOCH, index);
    return {
      validFrom,
      validTo: addDays(validFrom, 1),
      issuedAt: new Date(DEMO_EPOCH.getTime() - 6 * 3_600_000),
      source: 'synthetic',
      rainfallMm: roundTo(random() * 12, 1),
      et0Mm: roundTo(4 + random() * 2.5, 2),
      tempC: roundTo(26 + random() * 6, 1),
    };
  });
}

function buildLedgerRows(
  networkId: string,
  blockId: string,
  spec: (typeof BLOCK_SPECS)[number],
  random: () => number,
) {
  const capabilityM3 = spec.nominalFlowLps * 3.6 * LEDGER_PERIOD_HOURS;
  const targetReqM3 = roundTo(capabilityM3 * spec.needFactor, 2);
  const targetFairM3 = roundTo(Math.min(targetReqM3, capabilityM3), 2);
  const rows = [];
  let debt = 0;
  for (let index = 0; index < LEDGER_PERIOD_DAYS; index += 1) {
    const periodStart = addDays(DEMO_EPOCH, index - LEDGER_PERIOD_DAYS);
    const periodEnd = addDays(periodStart, 1);
    const serviceRatio = roundTo(
      clamp(spec.serviceRatioBase + (random() - 0.5) * 0.1, 0.35, 1),
      4,
    );
    const deliveredM3 = roundTo(targetFairM3 * serviceRatio, 2);
    const rawDebt = LEDGER_GAMMA * debt + (targetFairM3 - deliveredM3);
    const debtCapped = rawDebt > LEDGER_DEBT_MAX_M3;
    debt = roundTo(clamp(rawDebt, 0, LEDGER_DEBT_MAX_M3), 2);
    rows.push({
      networkId,
      blockId,
      periodStart,
      periodEnd,
      targetFairM3,
      targetReqM3,
      deliveredM3,
      serviceRatio,
      debtM3: debt,
      debtCapped,
      createdAt: periodEnd,
    });
  }
  return rows;
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required to seed the demo database');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

async function resetDemoData(prisma: PrismaClient): Promise<void> {
  await prisma.approval.deleteMany();
  await prisma.override.deleteMany();
  await prisma.planItem.deleteMany();
  await prisma.planScenario.deleteMany();
  await prisma.event.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.gateFeedback.deleteMany();
  await prisma.gateCommand.deleteMany();
  await prisma.sensorReading.deleteMany();
  await prisma.serviceLedger.deleteMany();
  await prisma.cropState.deleteMany();
  await prisma.stateEstimate.deleteMany();
  await prisma.lossParameter.deleteMany();
  await prisma.weatherForecast.deleteMany();
  await prisma.experimentMetric.deleteMany();
  await prisma.experimentRun.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.sensor.deleteMany();
  await prisma.block.deleteMany();
  await prisma.edge.deleteMany();
  await prisma.node.deleteMany();
  await prisma.irrigationNetwork.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.p3A.deleteMany();
  await prisma.user.deleteMany();
}

async function seedOrganization(prisma: PrismaClient) {
  const p3a = await prisma.p3A.create({
    data: { name: 'P3A Sumber Makmur', region: 'Jawa Timur' },
  });
  const users = await prisma.user.createManyAndReturn({
    data: USER_SPECS.map((spec) => ({
      email: spec.email,
      fullName: spec.fullName,
      role: spec.role,
      passwordHash: hashDemoPassword(spec.password),
    })),
  });
  const userIdByEmail = new Map(users.map((user) => [user.email, user.id]));
  await prisma.membership.createMany({
    data: USER_SPECS.map((spec) => ({
      userId: requireId(userIdByEmail, spec.email),
      p3aId: p3a.id,
      role: spec.role.toLowerCase(),
    })),
  });
  return { p3aId: p3a.id };
}

async function seedNetwork(prisma: PrismaClient, p3aId: string) {
  const network = await prisma.irrigationNetwork.create({
    data: {
      p3aId,
      name: 'Jaringan Demo Branched-6',
      description: 'Seed demo deterministik untuk pengembangan dan demo',
      topology: 'BRANCHED',
    },
  });
  const nodes = await prisma.node.createManyAndReturn({
    data: NODE_SPECS.map((spec) => ({
      networkId: network.id,
      type: spec.type,
      name: spec.name,
      orderIdx: spec.orderIdx,
    })),
  });
  const nodeIdByKey = new Map(
    NODE_SPECS.map((spec, index) => [spec.key, nodes[index]!.id]),
  );
  await prisma.edge.createMany({
    data: EDGE_SPECS.map((spec) => ({
      networkId: network.id,
      fromNodeId: requireId(nodeIdByKey, spec.from),
      toNodeId: requireId(nodeIdByKey, spec.to),
      zone: spec.zone,
      capacityLps: spec.capacityLps,
      lengthM: spec.lengthM,
    })),
  });
  const blocks = await prisma.block.createManyAndReturn({
    data: BLOCK_SPECS.map((spec) => ({
      networkId: network.id,
      nodeId: requireId(nodeIdByKey, spec.key),
      name: spec.name,
      areaM2: spec.areaM2,
      nominalFlowLps: spec.nominalFlowLps,
      distanceFromSourceM: spec.distanceFromSourceM,
    })),
  });
  const blockIdByKey = new Map(
    BLOCK_SPECS.map((spec, index) => [spec.key, blocks[index]!.id]),
  );
  return { networkId: network.id, nodeIdByKey, blockIdByKey };
}

async function seedSensors(
  prisma: PrismaClient,
  networkId: string,
  nodeIdByKey: ReadonlyMap<string, string>,
): Promise<void> {
  await prisma.sensor.createMany({
    data: SENSOR_SPECS.map((spec) => ({
      networkId,
      nodeId: requireId(nodeIdByKey, spec.nodeKey),
      deviceId: DEMO_DEVICE_ID,
      type: spec.type,
      unit: spec.unit,
      installedAt: DEMO_EPOCH,
    })),
  });
}

async function seedWeather(
  prisma: PrismaClient,
  networkId: string,
  random: () => number,
): Promise<number> {
  const rows = buildWeatherRows(random);
  await prisma.weatherForecast.createMany({
    data: rows.map((row) => ({ networkId, ...row })),
  });
  return rows.length;
}

async function seedLedger(
  prisma: PrismaClient,
  networkId: string,
  blockIdByKey: ReadonlyMap<string, string>,
  random: () => number,
): Promise<number> {
  const rows = BLOCK_SPECS.flatMap((spec) =>
    buildLedgerRows(networkId, requireId(blockIdByKey, spec.key), spec, random),
  );
  await prisma.serviceLedger.createMany({ data: rows });
  return rows.length;
}

async function seedExperiment(
  prisma: PrismaClient,
  networkId: string,
): Promise<string> {
  const experiment = await prisma.experiment.create({
    data: {
      networkId,
      name: 'E1 sensor budget (demo)',
      description:
        'Kurva sensor budget: 5 jumlah sensor x 2 skenario x 10 seed',
      configYaml: EXPERIMENT_CONFIG_YAML,
      configHash: createHash('sha256')
        .update(EXPERIMENT_CONFIG_YAML)
        .digest('hex'),
      seedBase: DEMO_SEED,
    },
  });
  return experiment.id;
}

async function main(): Promise<void> {
  loadEnv({
    path: [
      path.resolve(MODULE_DIR, '../.env'),
      path.resolve(MODULE_DIR, '../../docker/.env'),
    ],
    quiet: true,
  });
  const prisma = createClient();
  try {
    await resetDemoData(prisma);
    const { p3aId } = await seedOrganization(prisma);
    const { networkId, nodeIdByKey, blockIdByKey } = await seedNetwork(
      prisma,
      p3aId,
    );
    await seedSensors(prisma, networkId, nodeIdByKey);
    const weatherDays = await seedWeather(
      prisma,
      networkId,
      createRandom(DEMO_SEED),
    );
    const ledgerRows = await seedLedger(
      prisma,
      networkId,
      blockIdByKey,
      createRandom(DEMO_SEED + 1),
    );
    const experimentId = await seedExperiment(prisma, networkId);
    console.log(
      JSON.stringify({
        networkId,
        users: USER_SPECS.length,
        nodes: NODE_SPECS.length,
        edges: EDGE_SPECS.length,
        blocks: BLOCK_SPECS.length,
        sensors: SENSOR_SPECS.length,
        weatherDays,
        ledgerRows,
        experimentId,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
