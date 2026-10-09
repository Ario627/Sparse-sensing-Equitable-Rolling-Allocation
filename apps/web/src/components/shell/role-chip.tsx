import { IconChevronDown, IconSpan } from "@/components/icons.tsx";
import { InfoDialog } from "@/components/kit/info-dialog.tsx";
import { capabilityLines, roleLabel, roleProfile } from "@/lib/auth/roles.ts";
import { useSessionStore } from "@/lib/auth/session-store.ts";
import { cn } from "@/lib/cn.ts";

export function RoleChip() {
  const user = useSessionStore((snapshot) => snapshot.user);
  if (user === null) {
    return null;
  }
  const profile = roleProfile(user.role);
  const lines = capabilityLines(user.role);
  const granted = lines.filter((line) => line.granted).length;
  return (
    <InfoDialog
      eyebrow="Peran aktif"
      title={`${roleLabel(user.role)} · Mode ${profile?.mode ?? ""}`}
      trigger={
        <button
          type="button"
          className="flex shrink-0 items-center gap-2 rounded-sm border border-line-2 bg-surface py-1.5 pr-2 pl-2.5 transition-colors hover:border-water/40 hover:bg-water-soft/50"
        >
          <IconSpan size={14} className="text-water" />
          <span className="hidden text-xs font-medium text-ink sm:inline">
            {roleLabel(user.role)}
          </span>
          <span className="hidden text-xs text-ink-3 md:inline">
            Mode {profile?.mode ?? ""}
          </span>
          <IconChevronDown size={13} className="text-ink-3" />
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <p>{profile?.summary}</p>
        <div className="flex flex-col gap-2">
          <p className="label-caps text-ink-3">
            {granted} dari {lines.length} kewenangan
          </p>
          <ul className="flex flex-col gap-1.5">
            {lines.map((line) => (
              <li key={line.label} className="flex items-start gap-2 text-xs">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    line.granted ? "bg-water" : "bg-line-2",
                  )}
                />
                <span className={line.granted ? "text-ink-2" : "text-ink-3"}>
                  {line.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-ink-3">
          Kewenangan ini berlaku pada antarmuka dan ditegakkan ulang oleh server, jadi
          peran tidak bisa saling mengambil alih tindakan.
        </p>
      </div>
    </InfoDialog>
  );
}
