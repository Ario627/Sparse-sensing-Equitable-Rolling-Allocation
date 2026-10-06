import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuditContext } from '../common/audit/audit-context.ts';
import { PLAN_MESSAGES } from './plans.constants.ts';
import { PlanDecisionService } from './plans.decision.service.ts';
import { PlanExecutionService } from './plans.execution.service.ts';
import { PlanProposalService } from './plans.proposal.service.ts';
import { PlansRepository } from './plans.repository.ts';
import { buildPlansCsv } from './plans.export.ts';
import type {
  PlanDecisionInput,
  PlanDetailRecord,
  PlanExportQuery,
  PlanListPage,
  PlanListQuery,
  PlanOverrideInput,
  ProposePlanInput,
} from './plans.types.ts';

@Injectable()
export class PlansService {
  constructor(
    private readonly repository: PlansRepository,
    private readonly proposal: PlanProposalService,
    private readonly decisions: PlanDecisionService,
    private readonly execution: PlanExecutionService,
  ) {}

  list(query: PlanListQuery): Promise<PlanListPage> {
    return this.repository.listPlans(query);
  }

  async getById(id: string): Promise<PlanDetailRecord> {
    const detail = await this.repository.findPlanDetail(id);
    if (detail === null) {
      throw new NotFoundException(PLAN_MESSAGES.planNotFound);
    }
    return detail;
  }

  async export(
    actorId: string,
    query: PlanExportQuery,
    audit: AuditContext,
  ): Promise<string> {
    const rows = await this.repository.findExportRows(query);
    await this.repository.recordExportAudit(actorId, audit, query, rows.length);
    return buildPlansCsv(rows);
  }

  async propose(
    actorId: string,
    input: ProposePlanInput,
    audit: AuditContext,
  ): Promise<PlanDetailRecord> {
    const planId = await this.proposal.propose(actorId, input, audit);
    return this.getById(planId);
  }

  async decide(
    actorId: string,
    planId: string,
    input: PlanDecisionInput,
    audit: AuditContext,
  ): Promise<PlanDetailRecord> {
    await this.decisions.decide(actorId, planId, input, audit);
    return this.getById(planId);
  }

  async override(
    actorId: string,
    planId: string,
    input: PlanOverrideInput,
    audit: AuditContext,
  ): Promise<PlanDetailRecord> {
    await this.decisions.override(actorId, planId, input, audit);
    return this.getById(planId);
  }

  async execute(
    actorId: string,
    planId: string,
    audit: AuditContext,
  ): Promise<PlanDetailRecord> {
    await this.execution.execute(actorId, planId, audit);
    return this.getById(planId);
  }
}
