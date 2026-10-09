import type { ExperimentRunStatus, ExperimentStatus } from "@sera/contracts";
import type { Tone } from "@/components/kit/status-pill.tsx";

const experimentTones: Record<ExperimentStatus, Tone> = {
  QUEUED: "neutral",
  RUNNING: "info",
  COMPLETED: "ok",
  FAILED: "crit",
  CANCELLED: "neutral",
};

const experimentLabels: Record<ExperimentStatus, string> = {
  QUEUED: "Dalam antrean",
  RUNNING: "Berjalan",
  COMPLETED: "Selesai",
  FAILED: "Gagal",
  CANCELLED: "Dibatalkan",
};

const runTones: Record<ExperimentRunStatus, Tone> = {
  QUEUED: "neutral",
  RUNNING: "info",
  COMPLETED: "ok",
  FAILED: "crit",
};

const runLabels: Record<ExperimentRunStatus, string> = {
  QUEUED: "Dalam antrean",
  RUNNING: "Berjalan",
  COMPLETED: "Selesai",
  FAILED: "Gagal",
};

export function experimentStatusTone(status: ExperimentStatus): Tone {
  return experimentTones[status];
}

export function experimentStatusLabel(status: ExperimentStatus): string {
  return experimentLabels[status];
}

export function runStatusTone(status: ExperimentRunStatus): Tone {
  return runTones[status];
}

export function runStatusLabel(status: ExperimentRunStatus): string {
  return runLabels[status];
}

export function progressRatio(runsDone: number, runsTotal: number | null): number | null {
  if (runsTotal === null || !Number.isFinite(runsTotal) || runsTotal <= 0) {
    return null;
  }
  if (!Number.isFinite(runsDone)) {
    return 0;
  }
  return Math.min(1, Math.max(0, runsDone / runsTotal));
}
