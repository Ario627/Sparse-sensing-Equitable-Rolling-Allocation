import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.ts';
import {
  GATE_COMMAND_LOG_SELECT,
  GATE_FEEDBACK_LOG_SELECT,
  PLAN_ITEM_BLOCK_SELECT,
  toCommandLogBase,
  toFeedbackCandidate,
  toPlanItemBlock,
} from './plans.command-log.selects.ts';
import type {
  CommandLogBaseRecord,
  FeedbackCandidateRecord,
  PlanItemBlockRecord,
} from './plans.command-log.types.ts';

@Injectable()
export class PlanCommandLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPlan(planId: string): Promise<{ id: string } | null> {
    return this.prisma.plan.findUnique({
      where: { id: planId },
      select: { id: true },
    });
  }

  async findPlanItemBlocks(planId: string): Promise<PlanItemBlockRecord[]> {
    const rows = await this.prisma.planItem.findMany({
      where: { planId },
      select: PLAN_ITEM_BLOCK_SELECT,
    });
    return rows.map(toPlanItemBlock);
  }

  async findCommands(
    planItemIds: readonly string[],
    limit: number,
  ): Promise<CommandLogBaseRecord[]> {
    const rows = await this.prisma.gateCommand.findMany({
      where: { planItemId: { in: [...planItemIds] } },
      orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: GATE_COMMAND_LOG_SELECT,
    });
    return rows.map(toCommandLogBase);
  }

  async findFeedback(
    commandIds: readonly string[],
  ): Promise<FeedbackCandidateRecord[]> {
    const rows = await this.prisma.gateFeedback.findMany({
      where: { commandId: { in: [...commandIds] } },
      select: GATE_FEEDBACK_LOG_SELECT,
    });
    return rows.flatMap((row) => {
      const candidate = toFeedbackCandidate(row);
      return candidate === null ? [] : [candidate];
    });
  }
}
