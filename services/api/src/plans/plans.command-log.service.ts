import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { evaluateGateMismatch } from '../commands/commands.payload.ts';
import type { Env } from '../common/config/env.ts';
import { PLAN_MESSAGES } from './plans.constants.ts';
import { PlanCommandLogRepository } from './plans.command-log.repository.ts';
import type {
  CommandLogBaseRecord,
  CommandLogFeedbackRecord,
  FeedbackCandidateRecord,
  PlanCommandLogEntryRecord,
  PlanCommandLogPage,
  PlanCommandLogSummaryRecord,
} from './plans.command-log.types.ts';

const COMMAND_LOG_MAX_ROWS = 500;

interface MutableSummary {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  expired: number;
  unanswered: number;
  unknown: number;
  mismatchCount: number;
}

function isNewerFeedback(
  candidate: FeedbackCandidateRecord,
  current: FeedbackCandidateRecord,
): boolean {
  const delta = candidate.ts.getTime() - current.ts.getTime();
  return delta > 0 || (delta === 0 && candidate.id > current.id);
}

function pickLatestFeedback(
  rows: readonly FeedbackCandidateRecord[],
): Map<string, FeedbackCandidateRecord> {
  const latest = new Map<string, FeedbackCandidateRecord>();
  for (const row of rows) {
    const current = latest.get(row.commandId);
    if (current === undefined || isNewerFeedback(row, current)) {
      latest.set(row.commandId, row);
    }
  }
  return latest;
}

function toFeedbackRecord(
  candidate: FeedbackCandidateRecord,
): CommandLogFeedbackRecord {
  return {
    positionPct: candidate.positionPct,
    flowLps: candidate.flowLps,
    ts: candidate.ts,
  };
}

function emptySummary(): PlanCommandLogSummaryRecord {
  return {
    total: 0,
    pending: 0,
    accepted: 0,
    rejected: 0,
    expired: 0,
    unanswered: 0,
    unknown: 0,
    mismatchCount: 0,
  };
}

function toEntry(
  base: CommandLogBaseRecord,
  block: { readonly blockId: string; readonly blockName: string } | undefined,
  feedback: CommandLogFeedbackRecord | null,
  tolerancePct: number,
): PlanCommandLogEntryRecord {
  return {
    commandId: base.commandId,
    planItemId: base.planItemId,
    blockId: block?.blockId ?? null,
    blockName: block?.blockName ?? null,
    deviceId: base.deviceId,
    action: base.action,
    status: base.status,
    issuedAt: base.issuedAt,
    ackedAt: base.ackedAt,
    attempts: base.attempts,
    lastAttemptAt: base.lastAttemptAt,
    expiresAt: base.expiresAt,
    target: base.target,
    feedback,
    mismatch:
      base.action === null || feedback === null || feedback.positionPct === null
        ? null
        : evaluateGateMismatch(base.action, feedback.positionPct, tolerancePct),
  };
}

function summarize(
  items: readonly PlanCommandLogEntryRecord[],
): PlanCommandLogSummaryRecord {
  const counts: MutableSummary = {
    total: items.length,
    pending: 0,
    accepted: 0,
    rejected: 0,
    expired: 0,
    unanswered: 0,
    unknown: 0,
    mismatchCount: 0,
  };
  for (const item of items) {
    counts[item.status] += 1;
    if (item.mismatch !== null) {
      counts.mismatchCount += 1;
    }
  }
  return counts;
}

@Injectable()
export class PlanCommandLogService {
  private readonly tolerancePct: number;

  constructor(
    private readonly repository: PlanCommandLogRepository,
    config: ConfigService<Env, true>,
  ) {
    this.tolerancePct = config.get('GATE_POSITION_TOLERANCE_PCT', {
      infer: true,
    });
  }

  async load(planId: string): Promise<PlanCommandLogPage> {
    const plan = await this.repository.findPlan(planId);
    if (plan === null) {
      throw new NotFoundException(PLAN_MESSAGES.planNotFound);
    }
    const itemBlocks = await this.repository.findPlanItemBlocks(planId);
    if (itemBlocks.length === 0) {
      return { planId, items: [], summary: emptySummary() };
    }
    const commands = await this.repository.findCommands(
      itemBlocks.map((row) => row.itemId),
      COMMAND_LOG_MAX_ROWS,
    );
    const feedbackByCommand =
      commands.length === 0
        ? new Map<string, FeedbackCandidateRecord>()
        : pickLatestFeedback(
            await this.repository.findFeedback(
              commands.map((row) => row.commandId),
            ),
          );
    const blockByItem = new Map(itemBlocks.map((row) => [row.itemId, row]));
    const items = commands.map((base) => {
      const candidate = feedbackByCommand.get(base.commandId) ?? null;
      return toEntry(
        base,
        base.planItemId === null ? undefined : blockByItem.get(base.planItemId),
        candidate === null ? null : toFeedbackRecord(candidate),
        this.tolerancePct,
      );
    });
    return { planId, items, summary: summarize(items) };
  }
}