import type { UserRole } from "@sera/contracts";

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Admin",
  OPERATOR: "Operator",
  RESEARCHER: "Peneliti",
  VIEWER: "Pengamat",
};

export function roleLabel(role: UserRole): string {
  return roleLabels[role];
}
