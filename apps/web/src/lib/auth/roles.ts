import type { UserRole } from "@sera/contracts";

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Admin",
  OPERATOR: "Operator",
  RESEARCHER: "Peneliti",
  VIEWER: "Pengamat",
};

export const labRoles = ["RESEARCHER", "ADMIN"] as const satisfies readonly UserRole[];

export const ledgerRoles = [
  "OPERATOR",
  "RESEARCHER",
  "ADMIN",
] as const satisfies readonly UserRole[];

export const decisionRoles = ["OPERATOR", "ADMIN"] as const satisfies readonly UserRole[];

export type Capability =
  | "plan.propose"
  | "plan.decide"
  | "plan.export"
  | "event.read"
  | "event.acknowledge"
  | "ledger.read"
  | "ledger.settle"
  | "experiment.run"
  | "admin.topology"
  | "admin.sensors"
  | "admin.users"
  | "admin.audit";

const capabilityHolders: Record<Capability, readonly UserRole[]> = {
  "plan.propose": decisionRoles,
  "plan.decide": decisionRoles,
  "plan.export": decisionRoles,
  "event.read": ledgerRoles,
  "event.acknowledge": ["OPERATOR", "ADMIN"],
  "ledger.read": ledgerRoles,
  "ledger.settle": ["ADMIN"],
  "experiment.run": labRoles,
  "admin.topology": ["ADMIN"],
  "admin.sensors": ["ADMIN"],
  "admin.users": ["ADMIN"],
  "admin.audit": ["ADMIN"],
};

const capabilityLabels: Record<Capability, string> = {
  "plan.propose": "Menyusun rencana alokasi",
  "plan.decide": "Menyetujui dan menolak rencana",
  "plan.export": "Mengekspor rencana",
  "event.read": "Membaca peringatan dan riwayat",
  "event.acknowledge": "Menandai peringatan selesai",
  "ledger.read": "Membaca neraca layanan",
  "ledger.settle": "Menutup periode neraca",
  "experiment.run": "Menjalankan eksperimen dan simulasi",
  "admin.topology": "Mengubah topologi jaringan",
  "admin.sensors": "Mendaftarkan dan mengubah sensor",
  "admin.users": "Mengelola pengguna dan keanggotaan",
  "admin.audit": "Membaca jejak audit sistem",
};

const capabilityOrder: readonly Capability[] = [
  "plan.propose",
  "plan.decide",
  "plan.export",
  "event.read",
  "event.acknowledge",
  "ledger.read",
  "ledger.settle",
  "experiment.run",
  "admin.topology",
  "admin.sensors",
  "admin.users",
  "admin.audit",
];

export interface RoleProfile {
  readonly label: string;
  readonly mode: string;
  readonly focus: string;
  readonly summary: string;
}

const roleProfiles: Record<UserRole, RoleProfile> = {
  ADMIN: {
    label: "Admin",
    mode: "Administrasi",
    focus: "Tata kelola jaringan, pengguna, dan sensor",
    summary:
      "Memegang seluruh kewenangan sistem: menyusun dan memutuskan rencana, menjalankan riset, serta mengelola pengguna, topologi, dan sensor. Setiap perubahan tercatat pada jejak audit.",
  },
  OPERATOR: {
    label: "Operator",
    mode: "Keputusan",
    focus: "Rencana alokasi dan peringatan lapangan",
    summary:
      "Menjalankan siklus keputusan harian: mengusulkan rencana, menyetujui atau menolak, mengeksekusi perintah pintu, dan menandai peringatan selesai. Tidak dapat mengubah topologi, sensor, atau pengguna.",
  },
  RESEARCHER: {
    label: "Peneliti",
    mode: "Riset",
    focus: "Skenario, eksperimen, dan evaluasi metode",
    summary:
      "Menyusun skenario, menjalankan eksperimen, dan menilai hasil. Memiliki akses baca ke peringatan dan neraca layanan untuk keperluan analisis, tanpa kewenangan mengubah keputusan operasi.",
  },
  VIEWER: {
    label: "Pengamat",
    mode: "Pantau",
    focus: "Pemantauan kondisi jaringan tanpa tindakan",
    summary:
      "Melihat kondisi jaringan, rencana, dan perangkat apa adanya. Seluruh tindakan keputusan, penandaan peringatan, dan penjalanan eksperimen ditutup untuk peran ini.",
  },
};

export function roleLabel(role: UserRole): string {
  return roleLabels[role];
}

export function roleProfile(role: UserRole | null): RoleProfile | null {
  return role === null ? null : roleProfiles[role];
}

export function hasAnyRole(role: UserRole | null, allowed: readonly UserRole[]): boolean {
  return role !== null && allowed.includes(role);
}

export function isLabRole(role: UserRole | null): boolean {
  return hasAnyRole(role, labRoles);
}

export function hasCapability(role: UserRole | null, capability: Capability): boolean {
  return hasAnyRole(role, capabilityHolders[capability]);
}

export function capabilityLabel(capability: Capability): string {
  return capabilityLabels[capability];
}

export function capabilityHoldersLabel(capability: Capability): string {
  return capabilityHolders[capability]
    .map((holder) => roleLabels[holder])
    .join(" atau ");
}

export interface CapabilityLine {
  readonly label: string;
  readonly granted: boolean;
}

export function capabilityLines(role: UserRole | null): readonly CapabilityLine[] {
  return capabilityOrder.map((capability) => ({
    label: capabilityLabels[capability],
    granted: hasCapability(role, capability),
  }));
}
