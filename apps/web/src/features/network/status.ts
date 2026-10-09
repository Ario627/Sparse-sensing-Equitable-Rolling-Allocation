import type {
  AlertCode,
  AlertSeverity,
  PlanStatus,
  PolicyProfile,
} from "@sera/contracts";
import type { Tone } from "@/components/kit/status-pill.tsx";

export interface StatusBand {
  readonly tone: Tone;
  readonly label: string;
}

const SERVICE_CRIT_BAND: StatusBand = { tone: "crit", label: "Kritis" };
const K_UNKNOWN_BAND: StatusBand = {
  tone: "neutral",
  label: "Tidak diketahui",
};
const K_CRIT_BAND: StatusBand = { tone: "crit", label: "Kekurangan berat" };

export const serviceRatioBands: readonly (StatusBand & {
  readonly min: number;
})[] = [
  { min: 0.85, tone: "ok", label: "Aman" },
  { min: 0.7, tone: "warn", label: "Cukup" },
];

export const kFactorBands: readonly (StatusBand & { readonly min: number })[] = [
  { min: 0.9, tone: "ok", label: "Normal" },
  { min: 0.7, tone: "warn", label: "Cukup langka" },
  { min: 0.5, tone: "warn", label: "Kekurangan" },
];

const planStatusTones: Record<PlanStatus, Tone> = {
  PROPOSED: "warn",
  APPROVED: "ok",
  EXECUTED: "neutral",
  SUPERSEDED: "neutral",
  FALLBACK: "fallback",
};

const planStatusLabels: Record<PlanStatus, string> = {
  PROPOSED: "Diajukan",
  APPROVED: "Disetujui",
  EXECUTED: "Tereksekusi",
  SUPERSEDED: "Digantikan",
  FALLBACK: "Fallback",
};

const policyProfileLabels: Record<PolicyProfile, string> = {
  EQUITY_FIRST: "Pemerataan dulu",
  SHORTAGE_FIRST: "Kekurangan dulu",
  BALANCED: "Seimbang",
};

const alertSeverityTones: Record<AlertSeverity, Tone> = {
  info: "info",
  warning: "warn",
  critical: "crit",
};

const alertCodeLabels: Record<AlertCode, string> = {
  supply_drop: "Debit turun dari rencana",
  sensor_offline: "Sensor offline",
  service_floor_breach: "Batas layanan minimum terlampaui",
  gate_mismatch: "Pintu tidak mengikuti perintah",
  fallback_active: "Mode fallback aktif",
  stale_data: "Data tidak diperbarui",
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function bandFor(
  bands: readonly (StatusBand & { readonly min: number })[],
  fallback: StatusBand,
  value: number,
): StatusBand {
  for (const band of bands) {
    if (value >= band.min) {
      return { tone: band.tone, label: band.label };
    }
  }
  return fallback;
}

export function serviceRatioBand(ratio: number): StatusBand {
  return bandFor(serviceRatioBands, SERVICE_CRIT_BAND, clamp01(ratio));
}

export function kFactorBand(value: number | null): StatusBand {
  if (value === null) {
    return K_UNKNOWN_BAND;
  }
  return bandFor(kFactorBands, K_CRIT_BAND, clamp01(value));
}

export function planStatusTone(status: PlanStatus): Tone {
  return planStatusTones[status];
}

export function planStatusLabel(status: PlanStatus): string {
  return planStatusLabels[status];
}

export function policyProfileLabel(profile: PolicyProfile): string {
  return policyProfileLabels[profile];
}

export function alertSeverityTone(severity: AlertSeverity): Tone {
  return alertSeverityTones[severity];
}

export function alertCodeLabel(code: AlertCode): string {
  return alertCodeLabels[code];
}
