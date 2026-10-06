import type { CommandLogAction, CommandLogStatus } from '@sera/contracts';

export interface PlanItemBlockRecord {
  readonly itemId: string;
  readonly blockId: string;
  readonly blockName: string;
}

export interface CommandLogBaseRecord {
  readonly commandId: string;
  readonly planItemId: string | null;
  readonly action: CommandLogAction | null;
  readonly status: CommandLogStatus;
  readonly issuedAt: Date;
  readonly ackedAt: Date | null;
  readonly attempts: number;
  readonly lastAttemptAt: Date | null;
  readonly deviceId: string | null;
  readonly expiresAt: Date | null;
  readonly target: string | null;
}

export interface FeedbackCandidateRecord {
  readonly id: string;
  readonly commandId: string;
  readonly positionPct: number | null;
  readonly flowLps: number | null;
  readonly ts: Date;
}

export interface CommandLogFeedbackRecord {
  readonly positionPct: number | null;
  readonly flowLps: number | null;
  readonly ts: Date;
}

export interface CommandLogMismatchRecord {
  readonly expectedPct: number;
  readonly deviationPct: number;
}

export interface PlanCommandLogEntryRecord {
  readonly commandId: string;
  readonly planItemId: string | null;
  readonly blockId: string | null;
  readonly blockName: string | null;
  readonly deviceId: string | null;
  readonly action: CommandLogAction | null;
  readonly status: CommandLogStatus;
  readonly issuedAt: Date;
  readonly ackedAt: Date | null;
  readonly attempts: number;
  readonly lastAttemptAt: Date | null;
  readonly expiresAt: Date | null;
  readonly target: string | null;
  readonly feedback: CommandLogFeedbackRecord | null;
  readonly mismatch: CommandLogMismatchRecord | null;
}

export interface PlanCommandLogSummaryRecord {
  readonly total: number;
  readonly pending: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly expired: number;
  readonly unanswered: number;
  readonly unknown: number;
  readonly mismatchCount: number;
}

export interface PlanCommandLogPage {
  readonly planId: string;
  readonly items: readonly PlanCommandLogEntryRecord[];
  readonly summary: PlanCommandLogSummaryRecord;
}
