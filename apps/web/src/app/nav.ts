import type { UserRole } from "@sera/contracts";
import type { ComponentType } from "react";
import {
  IconArchive,
  IconBell,
  IconChart,
  IconChip,
  IconFlask,
  IconGauge,
  IconNetwork,
  type IconProps,
  IconRun,
  IconSchedule,
  IconSliders,
  IconTarget,
} from "@/components/icons.tsx";
import { hasAnyRole, labRoles, ledgerRoles } from "@/lib/auth/roles.ts";

export type NavItemPath =
  | "/operations"
  | "/operations/network"
  | "/operations/schedule"
  | "/operations/alerts"
  | "/operations/history"
  | "/lab/simulation"
  | "/lab/experiments"
  | "/lab/sensor-budget"
  | "/lab/results"
  | "/system/hardware"
  | "/system/settings";

export interface NavItem {
  readonly to: NavItemPath;
  readonly label: string;
  readonly hint: string;
  readonly icon: ComponentType<IconProps>;
  readonly badge?: "pending_plans";
  readonly roles?: readonly UserRole[];
}

export interface NavGroup {
  readonly id: "operations" | "lab" | "system";
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const navGroups: readonly NavGroup[] = [
  {
    id: "operations",
    label: "Operasi",
    items: [
      {
        to: "/operations",
        label: "Ringkasan",
        hint: "Kondisi jaringan",
        icon: IconGauge,
      },
      {
        to: "/operations/network",
        label: "Jaringan",
        hint: "Blok & pintu air",
        icon: IconNetwork,
      },
      {
        to: "/operations/schedule",
        label: "Jadwal",
        hint: "Rencana & persetujuan",
        icon: IconSchedule,
        badge: "pending_plans",
      },
      {
        to: "/operations/alerts",
        label: "Peringatan",
        hint: "Kejadian penting",
        icon: IconBell,
        roles: ledgerRoles,
      },
      {
        to: "/operations/history",
        label: "Riwayat",
        hint: "Jejak keputusan",
        icon: IconArchive,
        roles: ledgerRoles,
      },
    ],
  },
  {
    id: "lab",
    label: "Riset",
    items: [
      {
        to: "/lab/simulation",
        label: "Simulasi",
        hint: "Susun skenario",
        icon: IconFlask,
        roles: labRoles,
      },
      {
        to: "/lab/experiments",
        label: "Eksperimen",
        hint: "Pantau batch",
        icon: IconRun,
        roles: labRoles,
      },
      {
        to: "/lab/sensor-budget",
        label: "Anggaran Sensor",
        hint: "Uji jumlah sensor",
        icon: IconTarget,
        roles: labRoles,
      },
      {
        to: "/lab/results",
        label: "Hasil",
        hint: "Metrik & baseline",
        icon: IconChart,
        roles: labRoles,
      },
    ],
  },
  {
    id: "system",
    label: "Sistem",
    items: [
      {
        to: "/system/hardware",
        label: "Perangkat",
        hint: "Status HIL",
        icon: IconChip,
      },
      {
        to: "/system/settings",
        label: "Pengaturan",
        hint: "Profil & operasi",
        icon: IconSliders,
      },
    ],
  },
];

export function navGroupsFor(role: UserRole | null): readonly NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => item.roles === undefined || hasAnyRole(role, item.roles),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

export function isNavItemActive(to: NavItemPath, pathname: string): boolean {
  if (to === "/operations") {
    return pathname === "/operations";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}
