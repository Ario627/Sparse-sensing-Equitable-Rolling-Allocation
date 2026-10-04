import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../common/config/env.ts';

const SOLVER_PLAN_PATH = '/v1/plan';
const SCHEMA_VERSION = 1;
const MAX_ITEMS = 2_000;
const MAX_SCENARIOS = 500;

export class SolverUnavailableError extends Error {}

export class SolverRejectedError extends Error {}

export class SolverContractError extends Error {}

const solverPlanItemSchema = z
  .strictObject({
    block_id: z.uuid(),
    slot_start: z.iso.datetime(),
    slot_end: z.iso.datetime(),
    gate_open: z.boolean(),
    volume_del_m3: z.number().nonnegative().nullable().optional(),
    volume_gross_m3: z.number().nonnegative().nullable().optional(),
    service_ratio_est: z.number().nonnegative().nullable().optional(),
    reason: z.unknown().optional(),
  })
  .refine((item) => Date.parse(item.slot_end) > Date.parse(item.slot_start), {
    error: 'slot_end must be after slot_start',
  });

const solverScenarioSchema = z.strictObject({
  scenario_id: z.string().min(1).max(64),
  probability: z.number().min(0).max(1),
  payload: z.unknown().optional(),
});

const solverStatsSchema = z.strictObject({
  solver: z.string().min(1).max(32),
  time_ms: z.int().nonnegative(),
  mip_gap: z.number().min(0).nullable().optional(),
});

export const solverPlanResponseSchema = z.strictObject({
  schema_version: z.literal(1),
  request_id: z.string().min(1).max(64),
  plan_id: z.string().min(1).max(64).nullable().optional(),
  items: z.array(solverPlanItemSchema).min(1).max(MAX_ITEMS),
  scenarios: z.array(solverScenarioSchema).max(MAX_SCENARIOS),
  objective: z.unknown().optional(),
  binding_factors: z.unknown().optional(),
  solver_stats: solverStatsSchema,
});

export type SolverPlanItem = z.infer<typeof solverPlanItemSchema>;
export type SolverPlanScenario = z.infer<typeof solverScenarioSchema>;
export type SolverPlanStats = z.infer<typeof solverStatsSchema>;
export type SolverPlanResult = z.infer<typeof solverPlanResponseSchema>;

export interface SolverNetworkNode {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly order_idx: number | null;
}

export interface SolverNetworkEdge {
  readonly id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly capacity_lps: number;
  readonly zone: string;
  readonly length_m: number | null;
}

export interface SolverNetworkBlock {
  readonly id: string;
  readonly node_id: string;
  readonly name: string;
  readonly area_m2: number;
  readonly crop_type: string;
  readonly nominal_flow_lps: number;
  readonly distance_from_source_m: number | null;
}

export interface SolverNetworkPayload {
  readonly id: string;
  readonly name: string;
  readonly topology: string;
  readonly nodes: readonly SolverNetworkNode[];
  readonly edges: readonly SolverNetworkEdge[];
  readonly blocks: readonly SolverNetworkBlock[];
}

export interface SolverLedgerEntry {
  readonly block_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly target_fair_m3: number;
  readonly target_req_m3: number;
  readonly delivered_m3: number;
  readonly service_ratio: number;
  readonly debt_m3: number;
  readonly debt_capped: boolean;
}

export interface SolverForecastEntry {
  readonly valid_from: string;
  readonly valid_to: string;
  readonly source: string;
  readonly rainfall_mm: number | null;
  readonly et0_mm: number | null;
  readonly temp_c: number | null;
}

export interface SolverStateEntry {
  readonly block_id: string;
  readonly ts: string;
  readonly confidence: number | null;
  readonly state: unknown;
  readonly covariance: unknown;
  readonly method: string;
}

export interface SolverPlanRequestInput {
  readonly network: SolverNetworkPayload;
  readonly ledger: readonly SolverLedgerEntry[];
  readonly forecasts: readonly SolverForecastEntry[];
  readonly state: readonly SolverStateEntry[] | null;
  readonly profile: string;
  readonly horizon: {
    readonly from: string;
    readonly to: string;
    readonly slot_hours: number;
  };
  readonly params: Record<string, unknown>;
}

function extractRejectionDetail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const detail = (body as Record<string, unknown>).detail;
  return typeof detail === 'string' && detail.length > 0 ? detail : null;
}

@Injectable()
export class SolverClient {
  private readonly logger = new Logger(SolverClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config
      .get('SOLVER_URL', { infer: true })
      .replace(/\/+$/, '');
    this.timeoutMs = config.get('SOLVER_TIMEOUT_MS', { infer: true });
  }

  async requestPlan(input: SolverPlanRequestInput): Promise<SolverPlanResult> {
    const requestId = randomUUID();
    const payload = await this.post(SOLVER_PLAN_PATH, {
      schema_version: SCHEMA_VERSION,
      request_id: requestId,
      network_id: input.network.id,
      network: input.network,
      profile: input.profile,
      horizon: input.horizon,
      state: input.state,
      ledger: input.ledger,
      forecasts: input.forecasts,
      params: input.params,
    });
    const parsed = solverPlanResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SolverContractError(
        `solver plan response violates the contract: ${parsed.error.issues
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

  private async post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new SolverUnavailableError(
        `solver request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.status >= 500) {
      throw new SolverUnavailableError(`solver responded ${response.status}`);
    }
    if (!response.ok) {
      const detail = await this.readJsonSafely(response);
      const message =
        extractRejectionDetail(detail) ?? `solver responded ${response.status}`;
      this.logger.warn(`solver rejected request: ${message}`);
      throw new SolverRejectedError(message);
    }
    const payload = await this.readJsonSafely(response);
    if (payload === null) {
      throw new SolverContractError('solver returned an empty or invalid body');
    }
    return payload;
  }

  private async readJsonSafely(response: Response): Promise<unknown | null> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}
