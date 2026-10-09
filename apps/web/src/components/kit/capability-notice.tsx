import { IconLock } from "@/components/icons.tsx";
import { InfoDialog } from "@/components/kit/info-dialog.tsx";
import {
  type Capability,
  capabilityHoldersLabel,
  capabilityLabel,
  hasCapability,
  roleProfile,
} from "@/lib/auth/roles.ts";
import { useRole } from "@/lib/auth/session-store.ts";
import { cn } from "@/lib/cn.ts";

export function useCapability(capability: Capability): boolean {
  return hasCapability(useRole(), capability);
}

export interface CapabilityNoticeProps {
  readonly capability: Capability;
  readonly className?: string;
}

export function CapabilityNotice({ capability, className }: CapabilityNoticeProps) {
  const role = useRole();
  if (hasCapability(role, capability)) {
    return null;
  }
  const holders = capabilityHoldersLabel(capability);
  const profile = roleProfile(role);
  return (
    <InfoDialog
      variant="ghost"
      label={`Butuh peran ${holders}`}
      eyebrow="Kewenangan"
      title={capabilityLabel(capability)}
      triggerClassName={cn(
        "min-h-9 border border-dashed border-warn/45 bg-warn-soft/60 text-warn hover:bg-warn-soft hover:text-warn",
        className,
      )}
    >
      <div className="flex flex-col gap-3">
        <p>
          Tindakan ini hanya tersedia untuk peran {holders}. Server menolak permintaan
          dari peran lain, sehingga tombolnya tidak ditampilkan sebagai jalan buntu.
        </p>
        {profile !== null && (
          <div className="rounded-md bg-sunk/70 px-3.5 py-3">
            <p className="text-2xs font-medium text-ink-3">
              Peran aktif · {profile.label}
            </p>
            <p className="mt-1.5 text-xs text-ink-2">{profile.summary}</p>
          </div>
        )}
      </div>
    </InfoDialog>
  );
}

export interface RestrictedHintProps {
  readonly children: string;
  readonly className?: string;
}

export function RestrictedHint({ children, className }: RestrictedHintProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-2xs font-medium text-ink-3",
        className,
      )}
    >
      <IconLock size={12} />
      {children}
    </span>
  );
}
