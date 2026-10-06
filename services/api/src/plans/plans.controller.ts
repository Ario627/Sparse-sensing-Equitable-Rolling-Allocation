import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  exportPlansQuerySchema,
  listPlansQuerySchema,
  planDecisionRequestSchema,
  planIdSchema,
  planOverrideRequestSchema,
  proposePlanRequestSchema,
  type ExportPlansQuery,
  type ListPlansQuery,
  type PlanDecisionRequest,
  type PlanDetailResponse,
  type PlanOverrideRequest,
  type PlanOverrideResponse,
  type PlansListResponse,
  type PlanSummaryResponse,
  type ProposePlanRequest,
} from '@sera/contracts';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/access-token.ts';
import { CurrentUser, Roles } from '../auth/auth.decorators.ts';
import { auditContextFrom } from '../common/audit/audit-context.ts';
import { PLAN_EXPORT_FILENAME } from './plans.constants.ts';
import { PlansService } from './plans.service.ts';
import type {
  PlanApprovalRecord,
  PlanDetailRecord,
  PlanItemRecord,
  PlanOverrideRecord,
  PlanSummaryRecord,
} from './plans.types.ts';

const OPERATOR_ROLE = 'OPERATOR' as const;
const PROPOSE_RATE_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const DECIDE_RATE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const EXECUTE_RATE_LIMIT = { default: { limit: 20, ttl: 60_000 } };
const EXPORT_RATE_LIMIT = { default: { limit: 5, ttl: 60_000 } };

function toSummaryResponse(record: PlanSummaryRecord): PlanSummaryResponse {
  return {
    id: record.id,
    network_id: record.networkId,
    network_name: record.networkName,
    status: record.status,
    profile: record.profile,
    horizon_from: record.horizonFrom.toISOString(),
    horizon_to: record.horizonTo.toISOString(),
    solver_name: record.solverName,
    solver_time_ms: record.solverTimeMs,
    mip_gap: record.mipGap,
    item_count: record.itemCount,
    override_count: record.overrideCount,
    last_approval:
      record.lastApproval === null
        ? null
        : {
            action: record.lastApproval.action,
            user_name: record.lastApproval.userName,
            reason: record.lastApproval.reason,
            created_at: record.lastApproval.createdAt.toISOString(),
          },
    last_override:
      record.lastOverride === null
        ? null
        : {
            user_name: record.lastOverride.userName,
            reason: record.lastOverride.reason,
            created_at: record.lastOverride.createdAt.toISOString(),
          },
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function toItemResponse(
  record: PlanItemRecord,
): PlanDetailResponse['items'][number] {
  return {
    id: record.id,
    block_id: record.blockId,
    block_name: record.blockName,
    slot_start: record.slotStart.toISOString(),
    slot_end: record.slotEnd.toISOString(),
    gate_open: record.gateOpen,
    volume_del_m3: record.volumeDelM3,
    volume_gross_m3: record.volumeGrossM3,
    service_ratio_est: record.serviceRatioEst,
    reason_json: record.reasonJson,
  };
}

function toApprovalResponse(
  record: PlanApprovalRecord,
): PlanDetailResponse['approvals'][number] {
  return {
    id: record.id,
    user_id: record.userId,
    user_name: record.userName,
    user_email: record.userEmail,
    action: record.action,
    reason: record.reason,
    created_at: record.createdAt.toISOString(),
  };
}

function toOverrideResponse(record: PlanOverrideRecord): PlanOverrideResponse {
  return {
    id: record.id,
    user_id: record.userId,
    user_name: record.userName,
    reason: record.reason,
    changes: record.changes as PlanOverrideResponse['changes'],
    created_at: record.createdAt.toISOString(),
  };
}

function toDetailResponse(record: PlanDetailRecord): PlanDetailResponse {
  return {
    ...toSummaryResponse(record),
    items: record.items.map(toItemResponse),
    approvals: record.approvals.map(toApprovalResponse),
    overrides: record.overrides.map(toOverrideResponse),
    objective: record.objective,
    binding_factors: record.bindingFactors,
  };
}

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  async list(
    @Query({ schema: listPlansQuerySchema }) query: ListPlansQuery,
  ): Promise<PlansListResponse> {
    const page = await this.plansService.list({
      ...(query.network_id === undefined
        ? {}
        : { networkId: query.network_id }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.profile === undefined ? {} : { profile: query.profile }),
      ...(query.block_id === undefined ? {} : { blockId: query.block_id }),
      ...(query.from === undefined ? {} : { from: new Date(query.from) }),
      ...(query.to === undefined ? {} : { to: new Date(query.to) }),
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
    });

    return {
      items: page.items.map(toSummaryResponse),
      page: query.page,
      limit: query.limit,
      total: page.total,
      total_pages: Math.max(1, Math.ceil(page.total / query.limit)),
    };
  }

  @Roles(OPERATOR_ROLE)
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    `attachment; filename="${PLAN_EXPORT_FILENAME}"`,
  )
  @Throttle(EXPORT_RATE_LIMIT)
  async exportPlans(
    @Query({ schema: exportPlansQuerySchema }) query: ExportPlansQuery,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<string> {
    return this.plansService.export(
      actor.id,
      {
        ...(query.network_id === undefined
          ? {}
          : { networkId: query.network_id }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.profile === undefined ? {} : { profile: query.profile }),
        ...(query.block_id === undefined ? {} : { blockId: query.block_id }),
        ...(query.from === undefined ? {} : { from: new Date(query.from) }),
        ...(query.to === undefined ? {} : { to: new Date(query.to) }),
        sort: query.sort,
        order: query.order,
      },
      auditContextFrom(request),
    );
  }

  @Get(':id')
  async detail(
    @Param('id', { schema: planIdSchema }) id: string,
  ): Promise<PlanDetailResponse> {
    return toDetailResponse(await this.plansService.getById(id));
  }

  @Roles(OPERATOR_ROLE)
  @Post()
  @Throttle(PROPOSE_RATE_LIMIT)
  async propose(
    @Body({ schema: proposePlanRequestSchema }) body: ProposePlanRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<PlanDetailResponse> {
    const created = await this.plansService.propose(
      actor.id,
      {
        networkId: body.network_id,
        profile: body.profile,
        ...(body.horizon_h === undefined ? {} : { horizonH: body.horizon_h }),
      },
      auditContextFrom(request),
    );
    return toDetailResponse(created);
  }

  @Roles(OPERATOR_ROLE)
  @Post(':id/decision')
  @Throttle(DECIDE_RATE_LIMIT)
  async decide(
    @Param('id', { schema: planIdSchema }) id: string,
    @Body({ schema: planDecisionRequestSchema }) body: PlanDecisionRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<PlanDetailResponse> {
    const decided = await this.plansService.decide(
      actor.id,
      id,
      {
        action: body.action,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      },
      auditContextFrom(request),
    );
    return toDetailResponse(decided);
  }

  @Roles(OPERATOR_ROLE)
  @Post(':id/override')
  @Throttle(DECIDE_RATE_LIMIT)
  async override(
    @Param('id', { schema: planIdSchema }) id: string,
    @Body({ schema: planOverrideRequestSchema }) body: PlanOverrideRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<PlanDetailResponse> {
    const overridden = await this.plansService.override(
      actor.id,
      id,
      {
        reason: body.reason,
        items: body.items.map((item) => ({
          itemId: item.item_id,
          gateOpen: item.gate_open,
        })),
      },
      auditContextFrom(request),
    );
    return toDetailResponse(overridden);
  }

  @Roles(OPERATOR_ROLE)
  @Post(':id/execute')
  @Throttle(EXECUTE_RATE_LIMIT)
  async execute(
    @Param('id', { schema: planIdSchema }) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<PlanDetailResponse> {
    const executed = await this.plansService.execute(
      actor.id,
      id,
      auditContextFrom(request),
    );
    return toDetailResponse(executed);
  }
}
