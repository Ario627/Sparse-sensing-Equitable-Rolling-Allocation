import type { ComponentType } from "react";
import {
  IconArchive,
  IconBell,
  IconChart,
  IconChip,
  IconFlask,
  IconGauge,
  IconNetwork,
  IconRun,
  IconSchedule,
  IconSliders,
  IconTarget,
  type IconProps,
} from "@/components/icons.tsx";

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
        hint: "Kondisi jaringan saat ini",
        icon: IconGauge,
      },
      {
        to: "/operations/network",
        label: "Jaringan",
        hint: "Keadaan node dan blok",
        icon: IconNetwork,
      },
      {
        to: "/operations/schedule",
        label: "Jadwal",
        hint: "Rencana alokasi dan persetujuan",
        icon: IconSchedule,
      },
      {
        to: "/operations/alerts",
        label: "Peringatan",
        hint: "Kejadian yang butuh perhatian",
        icon: IconBell,
      },
      {
        to: "/operations/history",
        label: "Riwayat",
        hint: "Jejak plan, persetujuan, dan override",
        icon: IconArchive,
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
        hint: "Susun skenario dan jalankan",
        icon: IconFlask,
      },
      {
        to: "/lab/experiments",
        label: "Eksperimen",
        hint: "Jalankan dan pantau batch",
        icon: IconRun,
      },
      {
        to: "/lab/sensor-budget",
        label: "Anggaran Sensor",
        hint: "Berapa sensor yang cukup",
        icon: IconTarget,
      },
      {
        to: "/lab/results",
        label: "Hasil",
        hint: "Metrik, baseline, Pareto",
        icon: IconChart,
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
        hint: "Status node dan HIL",
        icon: IconChip,
      },
      {
        to: "/system/settings",
        label: "Pengaturan",
        hint: "Profil kebijakan dan operasi",
        icon: IconSliders,
      },
    ],
  },
];

export function isNavItemActive(to: NavItemPath, pathname: string): boolean {
  if (to === "/operations") {
    return pathname === "/operations";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}
