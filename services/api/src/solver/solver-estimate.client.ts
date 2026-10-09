import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  SolverContractError,
  SolverHttpService,
} from './solver-http.service.ts';
import type { SolverNetworkPayload } from './solver.client.ts';

const SOLVER_ESTIMATE_PATH = '/v1/estimate';
const SCHEMA_VERSION = 1;
const MAX_STATES = 200;
const MAX_LOSSES = 3;

const estimateStateSchema = z.strictObject({
  block_id: z.uuid(),
  state: z.json(),
  covariance: z.json(),
  confidence: z.number().min(0).max(1),
  method: z.string().min(1).max(32),
});

const estimateLossSchema = z
  .strictObject({
    zone: z.enum(['HEAD', 'MIDDLE', 'TAIL']),
    eta_mean: z.number().gt(0).max(1),
    eta_lower: z.number().gt(0).max(1),
    eta_upper: z.number().gt(0).max(1),
    identified: z.boolean(),
    diagnostics: z.json().optional(),
  })
  .refine(
    (value) =>
      value.eta_lower <= value.eta_mean && value.eta_mean <= value.eta_upper,
    { error: 'eta interval must contain eta_mean' },
  );

export const solverEstimateResponseSchema = z.strictObject({
  schema_version: z.literal(1),
  request_id: z.string().min(1).max(64),
  ts: z.iso.datetime(),
  states: z.array(estimateStateSchema).min(1).max(MAX_STATES),
  losses: z.array(estimateLossSchema).max(MAX_LOSSES),
  diagnostics: z.json().optional(),
});

export type SolverEstimateState = z.infer<typeof estimateStateSchema>;
export type SolverEstimateLoss = z.infer<typeof estimateLossSchema>;
export type SolverEstimateResult = z.infer<typeof solverEstimateResponseSchema>;

export interface SolverObservationInput {
  readonly sensorId: string;
  readonly nodeId: string;
  readonly blockId: string | null;
  readonly type: string;
  readonly unit: string;
  readonly value: number;
  readonly quality: string;
  readonly ts: Date;
}

export interface SolverPreviousStateInput {
  readonly blockId: string;
  readonly ts: Date;
  readonly state: unknown;
  readonly covariance: unknown;
}

export interface SolverEstimateRequestInput {
  readonly network: SolverNetworkPayload;
  readonly observations: readonly SolverObservationInput[];
  readonly statePrev: readonly SolverPreviousStateInput[] | null;
  readonly windowMinutes: number;
}

@Injectable()
export class SolverEstimateClient {
  constructor(private readonly http: SolverHttpService) {}

  async requestEstimate(
    input: SolverEstimateRequestInput,
  ): Promise<SolverEstimateResult> {
    const requestId = randomUUID();
    const payload = await this.http.postJson(SOLVER_ESTIMATE_PATH, {
      schema_version: SCHEMA_VERSION,
      request_id: requestId,
      network_id: input.network.id,
      network: input.network,
      observations: input.observations.map((observation) => ({
        sensor_id: observation.sensorId,
        node_id: observation.nodeId,
        block_id: observation.blockId,
        type: observation.type,
        unit: observation.unit,
        value: observation.value,
        quality: observation.quality,
        ts: observation.ts.toISOString(),
      })),
      state_prev:
        input.statePrev === null
          ? null
          : input.statePrev.map((previous) => ({
              block_id: previous.blockId,
              ts: previous.ts.toISOString(),
              state: previous.state,
              covariance: previous.covariance,
            })),
      params: { window_minutes: input.windowMinutes },
    });
    const parsed = solverEstimateResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SolverContractError(
        `solver estimate response violates the contract: ${parsed.error.issues
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
}
