import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuditContext } from '../common/audit/audit-context.ts';
import { DomainEventBus } from '../common/events/domain-event-bus.service.ts';
import type { Env } from '../common/config/env.ts';
import type {
  PlanStatus,
  PolicyProfile,
  Prisma,
} from '../generated/prisma/client.ts';
import {
  SolverClient,
  SolverContractError,
  SolverRejectedError,
  SolverUnavailableError,
  type SolverPlanResult,
} from '../solver/solver.client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import {
  AUDIT_ENTITY,
  EVENT_TYPE_ALERT,
  FALLBACK_EVENT_MESSAGE,
  FALLBACK_PLAN_MESSAGE,
  HOUR_MS,
  PENDING_STATUSES,
  PLAN_MESSAGES,
  PROPOSE_AUDIT_ACTION,
  SEVERITY_WARNING,
  STATUS_FALLBACK,
  STATUS_PROPOSED,
} from './plans.constants.ts';
import { PlansRepository } from './plans.repository.ts';
import { toJsonInput } from './plans.selects.ts';
import {
  buildFallbackResult,
  buildSolverRequest,
  shiftFallbackPlan,
  validatePlanItems,
} from './plans.solver-payload.ts';
import type { ProposePlanInput } from './plans.types.ts';

interface SolverFailure {
  readonly reason: string;
  readonly sourcePlanId: string;
}

interface ProposalPersistence {
  readonly networkId: string;
  readonly profile: PolicyProfile;
  readonly horizonFrom: Date;
  readonly horizonTo: Date;
  readonly status: PlanStatus;
  readonly result: SolverPlanResult;
  readonly fallback: SolverFailure | null;
  readonly actorId: string;
  readonly audit: AuditContext;
}

interface ProposalOutcome {
  readonly planId: string;
  readonly alertEventId: string | null;
}

@Injectable()
export class PlanProposalService {
  private readonly defaultHorizonH: number;
  private readonly slotHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PlansRepository,
    private readonly solver: SolverClient,
    private readonly events: DomainEventBus,
    config: ConfigService<Env, true>,
  ) {
    this.defaultHorizonH = config.get('PLAN_HORIZON_H', { infer: true });
    this.slotHours = config.get('PLAN_SLOT_H', { infer: true });
  }

  async propose(
    actorId: string,
    input: ProposePlanInput,
    audit: AuditContext,
  ): Promise<string> {
    const now = new Date();
    const horizonH = input.horizonH ?? this.defaultHorizonH;
    const horizonTo = new Date(now.getTime() + horizonH * HOUR_MS);
    const data = await this.repository.loadProposalData(
      input.networkId,
      now,
      horizonTo,
    );
    if (data === null) {
      throw new NotFoundException(PLAN_MESSAGES.networkNotFound);
    }
    if (data.blocks.length === 0) {
      throw new ConflictException(PLAN_MESSAGES.networkEmpty);
    }
    const request = buildSolverRequest({
      data,
      profile: input.profile,
      horizonFrom: now,
      horizonTo,
      slotHours: this.slotHours,
      horizonHours: horizonH,
    });
    let result: SolverPlanResult;
    let fallback: SolverFailure | null = null;
    try {
      result = await this.solver.requestPlan(request);
    } catch (error) {
      if (error instanceof SolverRejectedError) {
        throw new BadGatewayException(PLAN_MESSAGES.solverRejected);
      }
      if (error instanceof SolverContractError) {
        throw new BadGatewayException(PLAN_MESSAGES.solverContract);
      }
      if (!(error instanceof SolverUnavailableError)) {
        throw error;
      }
      const source = await this.repository.findFallbackPlan(input.networkId);
      const shifted =
        source === null ? null : shiftFallbackPlan(source, now);
      if (shifted === null) {
        throw new ServiceUnavailableException(PLAN_MESSAGES.solverUnavailable);
      }
      fallback = { reason: error.message, sourcePlanId: shifted.sourcePlanId };
      result = buildFallbackResult(shifted, FALLBACK_PLAN_MESSAGE);
    }
    const blockIds = new Set(data.blocks.map((block) => block.id));
    const issues = validatePlanItems(result.items, blockIds);
    if (issues.length > 0) {
      throw new BadGatewayException({
        message: PLAN_MESSAGES.solverContract,
        issues,
      });
    }
    const status: PlanStatus =
      fallback === null ? STATUS_PROPOSED : STATUS_FALLBACK;
    // The plan.proposed event schema only permits the PROPOSED/FALLBACK subset.
    const eventStatus: 'PROPOSED' | 'FALLBACK' =
      status === STATUS_FALLBACK ? 'FALLBACK' : 'PROPOSED';
    const outcome = await this.persistProposal({
      networkId: input.networkId,
      profile: input.profile,
      horizonFrom: now,
      horizonTo,
      status,
      result,
      fallback,
      actorId,
      audit,
    });
    this.events.publish({
      type: 'plan.proposed',
      network_id: input.networkId,
      payload: {
        plan_id: outcome.planId,
        status: eventStatus,
        profile: input.profile,
        item_count: result.items.length,
        solver_time_ms: result.solver_stats.time_ms,
        mip_gap: result.solver_stats.mip_gap ?? null,
      },
    });
    if (outcome.alertEventId !== null) {
      this.events.publish({
        type: 'alert.raised',
        network_id: input.networkId,
        payload: {
          alert_id: outcome.alertEventId,
          severity: SEVERITY_WARNING,
          code: 'fallback_active',
          message: FALLBACK_EVENT_MESSAGE,
          block_id: null,
          plan_id: outcome.planId,
        },
      });
    }
    return outcome.planId;
  }

  private async persistProposal(
    input: ProposalPersistence,
  ): Promise<ProposalOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          networkId: input.networkId,
          status: input.status,
          profile: input.profile,
          horizonFrom: input.horizonFrom,
          horizonTo: input.horizonTo,
          solverName: input.result.solver_stats.solver,
          solverTimeMs: input.result.solver_stats.time_ms,
          mipGap: input.result.solver_stats.mip_gap ?? null,
          objectiveJson: toJsonInput(input.result.objective),
          bindingFactors: toJsonInput(input.result.binding_factors),
        },
        select: { id: true },
      });
      await tx.planItem.createMany({
        data: input.result.items.map((item) => ({
          planId: plan.id,
          blockId: item.block_id,
          slotStart: new Date(item.slot_start),
          slotEnd: new Date(item.slot_end),
          gateOpen: item.gate_open,
          volumeDelM3: item.volume_del_m3 ?? null,
          volumeGrossM3: item.volume_gross_m3 ?? null,
          serviceRatioEst: item.service_ratio_est ?? null,
          reasonJson: toJsonInput(item.reason),
        })),
      });
      if (input.result.scenarios.length > 0) {
        await tx.planScenario.createMany({
          data: input.result.scenarios.map((scenario) => ({
            planId: plan.id,
            scenarioId: scenario.scenario_id,
            probability: scenario.probability,
            payload: (scenario.payload ?? {}) as Prisma.InputJsonValue,
          })),
        });
      }
      await tx.plan.updateMany({
        where: {
          networkId: input.networkId,
          status: { in: [...PENDING_STATUSES] },
          id: { not: plan.id },
        },
        data: { status: 'SUPERSEDED' },
      });
      let alertEventId: string | null = null;
      if (input.fallback !== null) {
        const event = await tx.event.create({
          data: {
            networkId: input.networkId,
            type: EVENT_TYPE_ALERT,
            severity: SEVERITY_WARNING,
            message: FALLBACK_EVENT_MESSAGE,
            payload: {
              code: 'fallback_active',
              reason: input.fallback.reason,
              source_plan_id: input.fallback.sourcePlanId,
            },
          },
          select: { id: true },
        });
        alertEventId = event.id;
      }
      await tx.auditLog.create({
        data: {
          userId: input.actorId,
          action: PROPOSE_AUDIT_ACTION,
          entity: AUDIT_ENTITY,
          entityId: plan.id,
          after: {
            status: input.status,
            profile: input.profile,
            items: input.result.items.length,
            fallback_source: input.fallback?.sourcePlanId ?? null,
          },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
        },
      });
      return { planId: plan.id, alertEventId };
    });
  }
}