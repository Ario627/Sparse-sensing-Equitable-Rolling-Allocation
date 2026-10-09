import type { UserRole } from "@sera/contracts";
import type { ReactNode } from "react";
import { IconLock } from "@/components/icons.tsx";
import { InfoDialog } from "@/components/kit/info-dialog.tsx";
import {
  capabilityLines,
  hasAnyRole,
  roleLabel,
  roleProfile,
} from "@/lib/auth/roles.ts";
import { useRole } from "@/lib/auth/session-store.ts";

export interface RoleGateProps {
  readonly allow: readonly UserRole[];
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

function allowedLabel(allow: readonly UserRole[]): string {
  return allow.map((role) => roleLabel(role)).join(" atau ");
}

export function RoleGate({ allow, title, description, children }: RoleGateProps) {
  const role = useRole();
  if (hasAnyRole(role, allow)) {
    return <>{children}</>;
  }
  const profile = roleProfile(role);
  const lines = capabilityLines(role);
  return (
    <section className="flex flex-col items-start gap-4 rounded-xl border border-line bg-surface px-5 py-6 shadow-hair sm:px-7 sm:py-8">
      <span
        aria-hidden="true"
        className="grid size-10 place-items-center rounded-md border border-dashed border-warn/45 bg-warn-soft/60 text-warn"
      >
        <IconLock size={17} />
      </span>
      <div className="flex flex-col gap-1.5">
        <p className="label-caps text-warn">Akses terbatas</p>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="max-w-prose text-sm text-ink-2">{description}</p>
        <p className="text-xs text-ink-3">Tersedia untuk peran {allowedLabel(allow)}.</p>
      </div>
      {profile !== null && (
        <InfoDialog
          label="Lihat rincian kewenangan"
          eyebrow="Peran aktif"
          title={`${profile.label} · ${profile.mode}`}
          triggerClassName="border border-line-2 bg-surface"
        >
          <div className="flex flex-col gap-4">
            <p>{profile.summary}</p>
            <ul className="flex flex-col gap-1.5">
              {lines.map((line) => (
                <li key={line.label} className="flex items-start gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                      line.granted ? "bg-ok" : "bg-line-2"
                    }`}
                  />
                  <span className={line.granted ? "text-ink-2" : "text-ink-3"}>
                    {line.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </InfoDialog>
      )}
    </section>
  );
}
