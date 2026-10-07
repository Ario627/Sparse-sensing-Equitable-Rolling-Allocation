import type { ExperimentStatus } from '@sera/contracts';
import type { ServerEventDraft } from '../common/events/domain-event-bus.service.ts';
import type { SolverExperimentRun } from '../solver/solver-experiments.client.ts';
import type {
  ExperimentPollRunInput,
  ExperimentPollUpdate,
  ExperimentProgressRecord,
  ExperimentRecord,
  ExperimentDetailRecord,
  ExperimentRunRecord,
} from './experiments.types.ts';
import { Prisma } from '../generated/prisma/client.ts';

export function parseIsoDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function toProgress(
  value: Prisma.JsonValue | null,
): ExperimentProgressRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const runsDone = record.runs_done;
  const polledAt = record.polled_at;
  if (typeof runsDone !== 'number' || typeof polledAt !== 'string') {
    return null;
  }
  const polledDate = parseIsoDate(polledAt);
  if (polledDate === null) {
    return null;
  }
  return {
    runsDone,
    medianRegret:
      typeof record.median_regret === 'number' ? record.median_regret : null,
    worstSr: typeof record.worst_sr === 'number' ? record.worst_sr : null,
    polledAt: polledDate,
  };
}

export const EXPERIMENT_SELECT = {
  id: true,
  name: true,
  description: true,
  networkId: true,
  status: true,
  seedBase: true,
  configHash: true,
  solverExperimentId: true,
  runsTotal: true,
  progressJson: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  network: { select: { name: true } },
  _count: { select: { runs: true } },
} satisfies Prisma.ExperimentSelect;

export type ExperimentRow = Prisma.ExperimentGetPayload<{
  select: typeof EXPERIMENT_SELECT;
}>;

export const EXPERIMENT_DETAIL_SELECT = {
  ...EXPERIMENT_SELECT,
  configYaml: true,
} satisfies Prisma.ExperimentSelect;

export type ExperimentDetailRow = Prisma.ExperimentGetPayload<{
  select: typeof EXPERIMENT_DETAIL_SELECT;
}>;

export const EXPERIMENT_RUN_SELECT = {
  runIndex: true,
  scenarioId: true,
  seed: true,
  method: true,
  sensorCount: true,
  topology: true,
  kFactor: true,
  status: true,
  parquetPath: true,
  metricsJson: true,
  startedAt: true,
  finishedAt: true,
} satisfies Prisma.ExperimentRunSelect;

export type ExperimentRunRow = Prisma.ExperimentRunGetPayload<{
  select: typeof EXPERIMENT_RUN_SELECT;
}>;

export function toExperimentRecord(row: ExperimentRow): ExperimentRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    networkId: row.networkId,
    networkName: row.network?.name ?? null,
    status: row.status,
    seedBase: row.seedBase,
    configHash: row.configHash,
    solverExperimentId: row.solverExperimentId,
    runsTotal: row.runsTotal,
    runsDone: row._count.runs,
    progress: toProgress(row.progressJson),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function toExperimentDetailRecord(
  row: ExperimentDetailRow,
): ExperimentDetailRecord {
  return { ...toExperimentRecord(row), configYaml: row.configYaml };
}

export function toRunRecord(row: ExperimentRunRow): ExperimentRunRecord {
  return {
    runIndex: row.runIndex,
    scenarioId: row.scenarioId,
    seed: row.seed,
    method: row.method,
    sensorCount: row.sensorCount,
    topology: row.topology,
    kFactor: row.kFactor,
    status: row.status,
    parquetPath: row.parquetPath,
    metrics: row.metricsJson,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function toPollRun(run: SolverExperimentRun): ExperimentPollRunInput {
  return {
    runIndex: run.run_index,
    scenarioId: run.scenario_id,
    seed: run.seed,
    method: run.method,
    sensorCount: run.sensor_count,
    topology: run.topology,
    kFactor: run.k_factor ?? null,
    status: run.status ?? 'COMPLETED',
    parquetPath: run.parquet_path ?? null,
    metrics: run.metrics,
    startedAt: parseIsoDate(run.started_at),
    finishedAt: parseIsoDate(run.finished_at),
  };
}

export function toRunPersistData(run: ExperimentPollRunInput) {
  return {
    scenarioId: run.scenarioId,
    seed: run.seed,
    method: run.method,
    sensorCount: run.sensorCount,
    topology: run.topology,
    kFactor: run.kFactor,
    status: run.status,
    parquetPath: run.parquetPath,
    metricsJson: run.metrics as Prisma.InputJsonValue,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

export function toMetricRows(
  runId: string,
  metrics: SolverExperimentRun['metrics'],
): Prisma.ExperimentMetricCreateManyInput[] {
  return Object.entries(metrics).map(([name, value]) =>
    typeof value === 'number'
      ? { runId, name, value, unit: null }
      : { runId, name, value: value.value, unit: value.unit ?? null },
  );
}

export function toProgressJsonInput(
  update: ExperimentPollUpdate,
): Prisma.InputJsonValue {
  return {
    runs_done: update.runsDone,
    median_regret: update.medianRegret,
    worst_sr: update.worstSr,
    polled_at: update.polledAt.toISOString(),
  };
}

export function toProgressEvent(input: {
  readonly experimentId: string;
  readonly networkId: string | null;
  readonly status: ExperimentStatus;
  readonly runsDone: number;
  readonly runsTotal: number | null;
  readonly medianRegret: number | null;
  readonly worstSr: number | null;
}): ServerEventDraft | null {
  if (input.runsTotal === null || input.runsTotal <= 0) {
    return null;
  }
  return {
    type: 'experiment.progress',
    network_id: input.networkId,
    payload: {
      experiment_id: input.experimentId,
      status: input.status,
      runs_done: input.runsDone,
      runs_total: input.runsTotal,
      median_regret: input.medianRegret,
      worst_sr: input.worstSr,
    },
  };
}
