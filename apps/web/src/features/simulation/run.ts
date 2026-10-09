import { toYaml, type YamlValue } from "@/lib/yaml.ts";
import type { SimulationScenario } from "./scenario.ts";

const BLOCK_ID_PREFIX = "b";
const BLOCK_ID_FIRST = 1;
const DEFAULT_REPLICATES = 1;
const DEFAULT_METHODS: readonly ExperimentMethod[] = ["sera"];
const DEFAULT_K_FACTORS: readonly number[] = [1];

export type ExperimentMethod =
  | "sera"
  | "proportional"
  | "rotation"
  | "greedy"
  | "oracle";

export interface ExperimentConfigInput {
  readonly experimentId: string;
  readonly scenario: SimulationScenario;
  readonly methods?: readonly ExperimentMethod[];
  readonly replicates?: number;
  readonly kFactors?: readonly number[];
  readonly sensorSets?: readonly (readonly string[])[];
}

export function defaultSensorSet(
  sensorCount: number,
  blockCount: number,
): readonly string[] {
  const bounded = Math.min(
    Math.max(0, Math.round(sensorCount)),
    Math.max(0, Math.round(blockCount)),
  );
  return Array.from(
    { length: bounded },
    (_, index) => `${BLOCK_ID_PREFIX}${index + BLOCK_ID_FIRST}`,
  );
}

export function generateExperimentId(
  seed: number,
  now: number = Date.now(),
): string {
  return `exp${now.toString(36)}${Math.abs(Math.round(seed)).toString(36)}`;
}

export function buildExperimentConfig(input: ExperimentConfigInput): {
  readonly [key: string]: YamlValue;
} {
  return {
    experiment_id: input.experimentId,
    methods: [...(input.methods ?? DEFAULT_METHODS)],
    scenarios: [input.scenario.preset],
    block_counts: [input.scenario.blocks],
    topologies: [input.scenario.topology],
    k_factors: [...(input.kFactors ?? DEFAULT_K_FACTORS)],
    sensor_sets:
      input.sensorSets === undefined
        ? [defaultSensorSet(input.scenario.sensors, input.scenario.blocks)]
        : input.sensorSets.map((set) => [...set]),
    replicates: input.replicates ?? DEFAULT_REPLICATES,
  };
}

export function buildExperimentYaml(input: ExperimentConfigInput): string {
  return toYaml(buildExperimentConfig(input));
}
