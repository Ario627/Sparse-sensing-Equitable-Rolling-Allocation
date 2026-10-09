import type { UserRole } from "@sera/contracts";
import { describe, expect, it } from "vitest";
import { navGroupsFor } from "./nav.ts";

function labelsFor(role: UserRole | null): string[] {
  return navGroupsFor(role).flatMap((group) => group.items.map((item) => item.label));
}

function groupIdsFor(role: UserRole | null): string[] {
  return navGroupsFor(role).map((group) => group.id);
}

describe("navGroupsFor", () => {
  it("menyembunyikan grup riset dari operator", () => {
    const labels = labelsFor("OPERATOR");
    expect(labels).not.toContain("Simulasi");
    expect(labels).not.toContain("Eksperimen");
    expect(groupIdsFor("OPERATOR")).toEqual(["operations", "system"]);
  });

  it("menampilkan riset dan riwayat untuk peneliti", () => {
    const labels = labelsFor("RESEARCHER");
    expect(labels).toContain("Eksperimen");
    expect(labels).toContain("Riwayat");
    expect(labels).toContain("Peringatan");
  });

  it("admin melihat seluruh grup", () => {
    expect(groupIdsFor("ADMIN")).toEqual(["operations", "lab", "system"]);
  });

  it("pengamat hanya melihat ringkasan jaringan dan sistem", () => {
    const labels = labelsFor("VIEWER");
    expect(labels).toEqual(["Ringkasan", "Jaringan", "Perangkat", "Pengaturan"]);
  });

  it("tanpa sesi hanya menyisakan item tanpa batasan peran", () => {
    const labels = labelsFor(null);
    expect(labels).not.toContain("Riwayat");
    expect(labels).not.toContain("Peringatan");
    expect(labels).not.toContain("Simulasi");
    expect(labels).toContain("Ringkasan");
  });
});
