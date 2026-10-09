import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  SolverContractError,
  SolverHttpService,
  SolverRejectedError,
} from './solver-http.service.ts';

const EXPERIMENTS_PATH = '/v1/experiments';
const SCHEMA_VERSION = 1;
const MAX_RUNS_PER_POLL = 1_000;
const UNSUPPORTED_CANCEL_STATUSES: ReadonlySet<number> = new Set([
  404, 405, 501,
]);

const solverExperimentRunMetricsSchema = z.record(
  z.string(),
  z.union([
    z.number(),
    z.strictObject({
      value: z.number(),
      unit: z.string().min(1).max(24).optional(),
    }),
  ]),
);

export const solverExperimentRunSchema = z.strictObject({
  run_index: z.int().nonnegative(),
  scenario_id: z.string().min(1).max(64),
  seed: z.int().nonnegative(),
  method: z.string().min(1).max(32),
  sensor_count: z.int().nonnegative().max(64),
  topology: z.enum(['CHAIN', 'BRANCHED', 'MIXED']),
  k_factor: z.number().nullable().optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']).optional(),
  parquet_path: z.string().min(1).max(500).nullable().optional(),
  metrics: solverExperimentRunMetricsSchema,
  started_at: z.iso.datetime().nullable().optional(),
  finished_at: z.iso.datetime().nullable().optional(),
});

const experimentStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const solverExperimentStartResponseSchema = z.strictObject({
  schema_version: z.literal(1),
  request_id: z.string().min(1).max(64),
  experiment_id: z.string().min(1).max(64),
  status: experimentStatusSchema,
  runs_total: z.int().positive().nullable().optional(),
  config_hash: z.string().min(8).max(128).nullable().optional(),
});

const solverExperimentStatusResponseSchema = z.strictObject({
  schema_version: z.literal(1),
  experiment_id: z.string().min(1).max(64),
  status: experimentStatusSchema,
  runs_done: z.int().nonnegative(),
  runs_total: z.int().positive().nullable().optional(),
  median_regret: z.number().nonnegative().nullable().optional(),
  worst_sr: z.number().nonnegative().nullable().optional(),
  started_at: z.iso.datetime().nullable().optional(),
  finished_at: z.iso.datetime().nullable().optional(),
  runs: z.array(solverExperimentRunSchema).max(MAX_RUNS_PER_POLL).optional(),
});

const solverExperimentCancelResponseSchema = z.strictObject({
  schema_version: z.literal(1),
  experiment_id: z.string().min(1).max(64),
  status: experimentStatusSchema,
});

export interface SolverExperimentStartInput {
  readonly configYaml: string;
  readonly seedBase: number | null;
  readonly maxRuns: number;
}

export type SolverExperimentStartResult = z.infer<
  typeof solverExperimentStartResponseSchema
>;
export type SolverExperimentStatusResult = z.infer<
  typeof solverExperimentStatusResponseSchema
>;
export type SolverExperimentRun = z.infer<typeof solverExperimentRunSchema>;

@Injectable()
export class SolverExperimentsClient {
  constructor(private readonly http: SolverHttpService) {}

  async startExperiment(
    input: SolverExperimentStartInput,
  ): Promise<SolverExperimentStartResult> {
    const requestId = randomUUID();
    const payload = await this.http.postJson(EXPERIMENTS_PATH, {
      schema_version: SCHEMA_VERSION,
      request_id: requestId,
      config_yaml: input.configYaml,
      seed_base: input.seedBase,
      max_runs: input.maxRuns,
    });
    const parsed = solverExperimentStartResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SolverContractError(
        `solver experiment start response violates the contract: ${parsed.error.issues
          .slice(0, 5)
          .map((issue) => issue.message)
          .join('; ')}`,
      );
    }
    if (parsed.data.request_id !== requestId) {
      throw new SolverContractError('solver echoed an unexpected request_id');
    }
    return parsed.data;
  }

  async fetchExperiment(
    solverExperimentId: string,
  ): Promise<SolverExperimentStatusResult> {
    const payload = await this.http.getJson(
      `${EXPERIMENTS_PATH}/${encodeURIComponent(solverExperimentId)}`,
    );
    const parsed = solverExperimentStatusResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SolverContractError(
        `solver experiment status response violates the contract: ${parsed.error.issues
          .slice(0, 5)
          .map((issue) => issue.message)
          .join('; ')}`,
      );
    }
    return parsed.data;
  }

  async cancelExperiment(
    solverExperimentId: string,
  ): Promise<'cancelled' | 'unsupported'> {
    try {
      const payload = await this.http.postJson(
        `${EXPERIMENTS_PATH}/${encodeURIComponent(solverExperimentId)}/cancel`,
        {},
      );
      const parsed = solverExperimentCancelResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new SolverContractError(
          'solver experiment cancel response violates the contract',
        );
      }
      return 'cancelled';
    } catch (error) {
      if (
        error instanceof SolverRejectedError &&
        UNSUPPORTED_CANCEL_STATUSES.has(error.status)
      ) {
        return 'unsupported';
      }
      throw error;
    }
  }
}
