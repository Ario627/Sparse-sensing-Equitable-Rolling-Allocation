import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuditContext } from '../common/audit/audit-context.ts';
import { DomainEventBus } from '../common/events/domain-event-bus.service.ts';
import type { ApprovalAction, Prisma } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import {
  AUDIT_ENTITY,
  DECIDE_AUDIT_ACTION,
  OVERRIDE_AUDIT_ACTION,
  PENDING_STATUSES,
  PLAN_MESSAGES,
} from './plans.constants.ts';
import type {
  PlanDecisionAction,
  PlanDecisionInput,
  PlanOverrideInput,
} from './plans.types.ts';

const DECISION_TO_APPROVAL: Readonly<
  Record<PlanDecisionAction, ApprovalAction>
> = {
  approve: 'APPROVE',
  reject: 'REJECT',
  request_changes: 'REQUEST_CHANGES',
};

interface OverrideChangeEntry {
  readonly plan_item_id: string;
  readonly gate_open_before: boolean;
  readonly gate_open_after: boolean;
}

@Injectable()
export class PlanDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
  ) {}

  async decide(
    actorId: string,
    planId: string,
    input: PlanDecisionInput,
    audit: AuditContext,
  ): Promise<void> {
    const decidedAt = new Date();
    const approvalAction = DECISION_TO_APPROVAL[input.action];
    const outcome = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        select: { id: true, status: true, networkId: true, horizonTo: true },
      });
      if (plan === null) {
        throw new NotFoundException(PLAN_MESSAGES.planNotFound);
      }
      if (!PENDING_STATUSES.includes(plan.status)) {
        throw new ConflictException(PLAN_MESSAGES.planDecided);
      }
      if (
        input.action === 'approve' &&
        plan.horizonTo.getTime() <= decidedAt.getTime()
      ) {
        throw new ConflictException(PLAN_MESSAGES.planExpired);
      }
      let nextStatus = plan.status;
      if (input.action !== 'request_changes') {
        nextStatus = input.action === 'approve' ? 'APPROVED' : 'SUPERSEDED';
        const claim = await tx.plan.updateMany({
          where: { id: planId, status: { in: [...PENDING_STATUSES] } },
          data: { status: nextStatus },
        });
        if (claim.count !== 1) {
          throw new ConflictException(PLAN_MESSAGES.decisionRaced);
        }
      }
      await tx.approval.create({
        data: {
          planId,
          userId: actorId,
          action: approvalAction,
          reason: input.reason ?? null,
        },
      });
      if (nextStatus === 'APPROVED') {
        await tx.plan.updateMany({
          where: {
            networkId: plan.networkId,
            status: { in: [...PENDING_STATUSES] },
            id: { not: planId },
          },
          data: { status: 'SUPERSEDED' },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: DECIDE_AUDIT_ACTION,
          entity: AUDIT_ENTITY,
          entityId: planId,
          before: { status: plan.status },
          after: { status: nextStatus, action: approvalAction },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
      return { networkId: plan.networkId };
    });
    this.events.publish({
      type: 'plan.approved',
      network_id: outcome.networkId,
      payload: {
        plan_id: planId,
        action: approvalAction,
        user_id: actorId,
        decided_at: decidedAt.toISOString(),
        reason: input.reason ?? null,
      },
    });
  }

  async override(
    actorId: string,
    planId: string,
    input: PlanOverrideInput,
    audit: AuditContext,
  ): Promise<void> {
    const now = new Date();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        select: { id: true, status: true, networkId: true, horizonTo: true },
      });
      if (plan === null) {
        throw new NotFoundException(PLAN_MESSAGES.planNotFound);
      }
      const decidable =
        PENDING_STATUSES.includes(plan.status) || plan.status === 'APPROVED';
      if (!decidable) {
        throw new ConflictException(PLAN_MESSAGES.planDecided);
      }
      if (plan.horizonTo.getTime() <= now.getTime()) {
        throw new ConflictException(PLAN_MESSAGES.planExpired);
      }
      const rows = await tx.planItem.findMany({
        where: {
          planId,
          id: { in: input.items.map((change) => change.itemId) },
        },
        select: { id: true, gateOpen: true },
      });
      const itemById = new Map(rows.map((row) => [row.id, row.gateOpen]));
      const unknown: string[] = [];
      const changes: OverrideChangeEntry[] = [];
      for (const change of input.items) {
        const current = itemById.get(change.itemId);
        if (current === undefined) {
          unknown.push(change.itemId);
          continue;
        }
        if (current !== change.gateOpen) {
          changes.push({
            plan_item_id: change.itemId,
            gate_open_before: current,
            gate_open_after: change.gateOpen,
          });
        }
      }
      if (unknown.length > 0) {
        throw new BadRequestException({
          message: PLAN_MESSAGES.unknownItems,
          itemIds: unknown,
        });
      }
      if (changes.length === 0) {
        return { applied: false, networkId: plan.networkId };
      }
      for (const change of changes) {
        await tx.planItem.update({
          where: { id: change.plan_item_id },
          data: { gateOpen: change.gate_open_after },
        });
      }
      await tx.override.create({
        data: {
          planId,
          userId: actorId,
          reason: input.reason,
          changesJson: changes as unknown as Prisma.InputJsonValue,
        },
      });
      let nextStatus = plan.status;
      if (PENDING_STATUSES.includes(plan.status)) {
        const claim = await tx.plan.updateMany({
          where: { id: planId, status: { in: [...PENDING_STATUSES] } },
          data: { status: 'APPROVED' },
        });
        if (claim.count === 1) {
          nextStatus = 'APPROVED';
          await tx.plan.updateMany({
            where: {
              networkId: plan.networkId,
              status: { in: [...PENDING_STATUSES] },
              id: { not: planId },
            },
            data: { status: 'SUPERSEDED' },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: OVERRIDE_AUDIT_ACTION,
          entity: AUDIT_ENTITY,
          entityId: planId,
          before: { status: plan.status },
          after: {
            status: nextStatus,
            reason: input.reason,
            changes: changes as unknown as Prisma.InputJsonValue,
          },
          ip: audit.ip,
          userAgent: audit.userAgent,
        },
      });
      return { applied: true, networkId: plan.networkId };
    });
    if (outcome.applied) {
      this.events.publish({
        type: 'plan.approved',
        network_id: outcome.networkId,
        payload: {
          plan_id: planId,
          action: 'OVERRIDE',
          user_id: actorId,
          decided_at: now.toISOString(),
          reason: input.reason,
        },
      });
    }
  }
}
