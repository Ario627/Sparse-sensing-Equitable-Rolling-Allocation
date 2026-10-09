import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  createExperimentRequestSchema,
  experimentIdSchema,
  listExperimentRunsQuerySchema,
  listExperimentsQuerySchema,
  type CreateExperimentRequest,
  type ExperimentDetailResponse,
  type ExperimentRunResponse,
  type ExperimentsListResponse,
  type ExperimentRunsResponse,
  type ExperimentSummaryResponse,
  type ListExperimentRunsQuery,
  type ListExperimentsQuery,
} from '@sera/contracts';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/access-token.ts';
import { CurrentUser, Roles } from '../auth/auth.decorators.ts';
import { auditContextFrom } from '../common/audit/audit-context.ts';
import { ExperimentsService } from './experiments.service.ts';
import type {
  ExperimentRecord,
  ExperimentRunRecord,
} from './experiments.types.ts';

const RESEARCHER_ROLE = 'RESEARCHER' as const;
const CREATE_RATE_LIMIT = { default: { limit: 5, ttl: 60_000 } };
const CANCEL_RATE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

function toSummaryResponse(
  record: ExperimentRecord,
): ExperimentSummaryResponse {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    network_id: record.networkId,
    network_name: record.networkName,
    status: record.status,
    seed_base: record.seedBase,
    config_hash: record.configHash,
    solver_experiment_id: record.solverExperimentId,
    runs_total: record.runsTotal,
    runs_done: record.progress?.runsDone ?? record.runsDone,
    median_regret: record.progress?.medianRegret ?? null,
    worst_sr: record.progress?.worstSr ?? null,
    progress_polled_at:
      record.progress === null ? null : record.progress.polledAt.toISOString(),
    created_at: record.createdAt.toISOString(),
    started_at:
      record.startedAt === null ? null : record.startedAt.toISOString(),
    finished_at:
      record.finishedAt === null ? null : record.finishedAt.toISOString(),
  };
}

function toDetailResponse(
  record: {
    readonly configYaml: string;
  } & ExperimentRecord,
): ExperimentDetailResponse {
  return { ...toSummaryResponse(record), config_yaml: record.configYaml };
}

function toRunResponse(record: ExperimentRunRecord): ExperimentRunResponse {
  return {
    run_index: record.runIndex,
    scenario_id: record.scenarioId,
    seed: record.seed,
    method: record.method,
    sensor_count: record.sensorCount,
    topology: record.topology,
    k_factor: record.kFactor,
    status: toRunStatus(record.status),
    parquet_path: record.parquetPath,
    metrics: record.metrics,
    started_at:
      record.startedAt === null ? null : record.startedAt.toISOString(),
    finished_at:
      record.finishedAt === null ? null : record.finishedAt.toISOString(),
  };
}

function toRunStatus(value: string): ExperimentRunResponse['status'] {
  return value === 'QUEUED' || value === 'RUNNING' || value === 'FAILED'
    ? value
    : 'COMPLETED';
}

@Controller('experiments')
@Roles(RESEARCHER_ROLE)
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get()
  async list(
    @Query({ schema: listExperimentsQuerySchema }) query: ListExperimentsQuery,
  ): Promise<ExperimentsListResponse> {
    const page = await this.experiments.list({
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.network_id === undefined
        ? {}
        : { networkId: query.network_id }),
      page: query.page,
      limit: query.limit,
    });
    return {
      items: page.items.map(toSummaryResponse),
      page: query.page,
      limit: query.limit,
      total: page.total,
      total_pages: Math.max(1, Math.ceil(page.total / query.limit)),
    };
  }

  @Get(':id')
  async detail(
    @Param('id', { schema: experimentIdSchema }) id: string,
  ): Promise<ExperimentDetailResponse> {
    return toDetailResponse(await this.experiments.getById(id));
  }

  @Get(':id/runs')
  async runs(
    @Param('id', { schema: experimentIdSchema }) id: string,
    @Query({ schema: listExperimentRunsQuerySchema })
    query: ListExperimentRunsQuery,
  ): Promise<ExperimentRunsResponse> {
    const page = await this.experiments.listRuns(id, {
      page: query.page,
      limit: query.limit,
    });
    return {
      items: page.items.map(toRunResponse),
      page: query.page,
      limit: query.limit,
      total: page.total,
      total_pages: Math.max(1, Math.ceil(page.total / query.limit)),
    };
  }

  @Post()
  @Throttle(CREATE_RATE_LIMIT)
  async create(
    @Body({ schema: createExperimentRequestSchema })
    body: CreateExperimentRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ExperimentDetailResponse> {
    const created = await this.experiments.create(
      actor.id,
      {
        name: body.name,
        description: body.description,
        ...(body.network_id === undefined
          ? {}
          : { networkId: body.network_id }),
        configYaml: body.config_yaml,
        ...(body.seed_base === undefined ? {} : { seedBase: body.seed_base }),
      },
      auditContextFrom(request),
    );
    return toDetailResponse(created);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle(CANCEL_RATE_LIMIT)
  async cancel(
    @Param('id', { schema: experimentIdSchema }) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ExperimentDetailResponse> {
    return toDetailResponse(
      await this.experiments.cancel(actor.id, id, auditContextFrom(request)),
    );
  }
}
