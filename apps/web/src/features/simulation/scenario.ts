import type { Topology } from "@sera/contracts";

const SENSOR_MIN = 0;
const SENSOR_MAX = 20;
const BLOCKS_MIN = 6;
const BLOCKS_MAX = 20;
const HORIZON_MIN = 1;
const HORIZON_MAX = 90;
const SUPPLY_MIN = 2;
const SUPPLY_MAX = 20;
const SUPPLY_STEP = 0.5;
const SEED_MAX = 1_000_000_000;
const SEED_SPAN = 2 ** 32;
const DEFAULT_SEED = 1042;

export type ScenarioPresetKey =
  | "nominal"
  | "drought"
  | "supply_shock"
  | "sensor_failure"
  | "sensor_noise_high"
  | "loss_stressed"
  | "loss_severe"
  | "forecast_bad"
  | "gate_degraded";

export interface ScenarioPreset {
  readonly key: ScenarioPresetKey;
  readonly label: string;
  readonly description: string;
}

export interface SimulationScenario {
  readonly preset: ScenarioPresetKey;
  readonly topology: Topology;
  readonly sensors: number;
  readonly seed: number;
  readonly supplyLps: number;
  readonly blocks: number;
  readonly horizonDays: number;
}

export type SimulationSearch = Record<string, string>;

export const scenarioPresets: readonly ScenarioPreset[] = [
  {
    key: "nominal",
    label: "Nominal",
    description: "Kondisi dasar tanpa gangguan",
  },
  {
    key: "drought",
    label: "Kekeringan",
    description: "Debit turun bertahap sampai 40% pada hari ke-20",
  },
  {
    key: "supply_shock",
    label: "Guncangan suplai",
    description: "Debit anjlok mendadak pada hari ke-5",
  },
  {
    key: "sensor_failure",
    label: "Sensor hilang",
    description: "Zona hilir kehilangan sensor",
  },
  {
    key: "sensor_noise_high",
    label: "Noise tinggi",
    description: "Bacaan sensor berisik",
  },
  {
    key: "loss_stressed",
    label: "Loss tertekan",
    description: "Kehilangan air meningkat di semua zona",
  },
  {
    key: "loss_severe",
    label: "Loss berat",
    description: "Kehilangan air parah terutama di hilir",
  },
  {
    key: "forecast_bad",
    label: "Forecast buruk",
    description: "Prakiraan cuaca tidak akurat",
  },
  {
    key: "gate_degraded",
    label: "Pintu degradasi",
    description: "Pintu lambat merespons dan kadang macet",
  },
];

export const defaultScenario: SimulationScenario = {
  preset: "nominal",
  topology: "BRANCHED",
  sensors: 2,
  seed: DEFAULT_SEED,
  supplyLps: 10,
  blocks: 10,
  horizonDays: 30,
};

export const scenarioBounds = {
  sensors: { min: SENSOR_MIN, max: SENSOR_MAX },
  blocks: { min: BLOCKS_MIN, max: BLOCKS_MAX },
  horizonDays: { min: HORIZON_MIN, max: HORIZON_MAX },
  supplyLps: { min: SUPPLY_MIN, max: SUPPLY_MAX, step: SUPPLY_STEP },
} as const;

const topologyValues: readonly Topology[] = ["CHAIN", "BRANCHED", "MIXED"];

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseInteger(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const text = asString(raw);
  if (text === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function parseDecimal(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const text = asString(raw);
  if (text === undefined) {
    return fallback;
  }
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function parsePreset(raw: unknown): ScenarioPresetKey {
  const text = asString(raw)?.trim().toLowerCase();
  if (text === undefined) {
    return defaultScenario.preset;
  }
  const found = scenarioPresets.find((preset) => preset.key === text);
  return found?.key ?? defaultScenario.preset;
}

function parseTopology(raw: unknown): Topology {
  const text = asString(raw)?.trim().toUpperCase();
  if (text === undefined) {
    return defaultScenario.topology;
  }
  const found = topologyValues.find((value) => value === text);
  return found ?? defaultScenario.topology;
}

export function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  const sample = buffer[0] ?? 0;
  return Math.floor((sample / SEED_SPAN) * (SEED_MAX + 1));
}

export function parseSimulationSearch(
  search: Record<string, unknown>,
): SimulationScenario {
  return {
    preset: parsePreset(search.scenario),
    topology: parseTopology(search.topology),
    sensors: parseInteger(
      search.sensors,
      defaultScenario.sensors,
      SENSOR_MIN,
      SENSOR_MAX,
    ),
    seed: parseInteger(search.seed, defaultScenario.seed, 0, SEED_MAX),
    supplyLps: parseDecimal(
      search.supply,
      defaultScenario.supplyLps,
      SUPPLY_MIN,
      SUPPLY_MAX,
    ),
    blocks: parseInteger(
      search.blocks,
      defaultScenario.blocks,
      BLOCKS_MIN,
      BLOCKS_MAX,
    ),
    horizonDays: parseInteger(
      search.horizon,
      defaultScenario.horizonDays,
      HORIZON_MIN,
      HORIZON_MAX,
    ),
  };
}

export function toSimulationSearch(
  scenario: SimulationScenario,
): SimulationSearch {
  const search: SimulationSearch = {};
  if (scenario.preset !== defaultScenario.preset) {
    search.scenario = scenario.preset;
  }
  if (scenario.topology !== defaultScenario.topology) {
    search.topology = scenario.topology.toLowerCase();
  }
  if (scenario.sensors !== defaultScenario.sensors) {
    search.sensors = String(scenario.sensors);
  }
  if (scenario.seed !== defaultScenario.seed) {
    search.seed = String(scenario.seed);
  }
  if (scenario.supplyLps !== defaultScenario.supplyLps) {
    search.supply = String(scenario.supplyLps);
  }
  if (scenario.blocks !== defaultScenario.blocks) {
    search.blocks = String(scenario.blocks);
  }
  if (scenario.horizonDays !== defaultScenario.horizonDays) {
    search.horizon = String(scenario.horizonDays);
  }
  return search;
}
