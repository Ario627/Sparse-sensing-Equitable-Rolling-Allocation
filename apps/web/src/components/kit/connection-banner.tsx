import { cn } from "@/lib/cn.ts";
import { formatAgeFrom } from "@/lib/format.ts";
import { Button } from "./button.tsx";

export type ConnectionState = "connected" | "connecting" | "disconnected";

export interface ConnectionBannerProps {
  readonly state: ConnectionState;
  readonly lastSyncIso?: string | null;
  readonly now?: number;
  readonly onRetry?: () => void;
  readonly className?: string;
}

interface BannerVisual {
  readonly title: string;
  readonly containerClass: string;
  readonly dotClass: string;
  readonly pulse: boolean;
}

const visuals: Record<Exclude<ConnectionState, "connected">, BannerVisual> = {
  connecting: {
    title: "Menyambung ulang…",
    containerClass: "border-info/30 bg-info-soft",
    dotClass: "bg-info",
    pulse: true,
  },
  disconnected: {
    title: "Koneksi realtime terputus",
    containerClass: "border-warn/40 bg-warn-soft",
    dotClass: "bg-warn",
    pulse: false,
  },
};

function syncFragment(lastSyncIso: string | null | undefined, now: number | undefined): string {
  if (lastSyncIso === undefined || lastSyncIso === null) {
    return "Belum ada data diterima";
  }
  return `Data terakhir ${formatAgeFrom(lastSyncIso, now)} lalu`;
}

export function ConnectionBanner({
  state,
  lastSyncIso = null,
  now,
  onRetry,
  className,
}: ConnectionBannerProps) {
  if (state === "connected") {
    return null;
  }
  const visual = visuals[state];
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b px-3 py-2",
        visual.containerClass,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          visual.dotClass,
          visual.pulse && "animate-pulse-soft",
        )}
      />
      <p className="text-xs font-medium text-ink">{visual.title}</p>
      <p className="text-xs text-ink-2">
        {syncFragment(lastSyncIso, now)}
      </p>
      {state === "disconnected" && onRetry !== undefined && (
        <Button size="sm" variant="ghost" onClick={onRetry} className="ml-auto">
          Coba lagi
        </Button>
      )}
    </div>
  );
}