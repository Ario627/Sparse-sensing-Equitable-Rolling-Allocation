import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { type NavItem, navGroupsFor } from "@/app/nav.ts";
import { useSessionStore } from "@/lib/auth/session-store.ts";
import { cn } from "@/lib/cn.ts";
import { formatNumber } from "@/lib/format.ts";
import type { SocketState } from "@/lib/ws/socket.ts";
import { useRealtimeState } from "@/lib/ws/use-realtime.tsx";
import type { SidebarSignals } from "./sidebar-signals.ts";

const itemBase =
  "group flex items-start gap-3 rounded-md px-3 py-2.5 transition-[background-color,transform,color] duration-200 hover:translate-x-0.5 hover:bg-white/8";
const itemIdle = cn(itemBase, "text-surface/74 hover:text-surface");
const itemActive = cn(itemBase, "bg-water/22 text-white shadow-hair");

const badgeClass =
  "ml-auto mt-0.5 shrink-0 rounded-full bg-[#55b5ba]/22 px-1.5 py-0.5 font-mono text-2xs text-[#a5e2e5] tabular";

const connectionVisuals: Record<
  SocketState,
  { readonly dot: string; readonly label: string }
> = {
  connected: { dot: "bg-[#5fc98f]", label: "Terhubung" },
  connecting: { dot: "animate-pulse-soft bg-[#e0b34a]", label: "Menyambung" },
  disconnected: { dot: "bg-[#d77b6b]", label: "Terputus" },
};

interface SidebarNavItemProps {
  readonly item: NavItem;
  readonly pendingPlans: number;
}

function SidebarNavItem({ item, pendingPlans }: SidebarNavItemProps) {
  const Icon = item.icon;
  const badgeCount = item.badge === "pending_plans" ? pendingPlans : 0;
  return (
    <Link
      to={item.to}
      title={item.hint}
      className={itemIdle}
      activeProps={{ className: itemActive }}
      activeOptions={{ exact: item.to === "/operations" }}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] leading-tight font-medium">
          {item.label}
        </span>
        <span className="mt-0.5 truncate text-2xs leading-tight text-surface/42">
          {item.hint}
        </span>
      </span>
      {badgeCount > 0 && <span className={badgeClass}>{formatNumber(badgeCount)}</span>}
    </Link>
  );
}

export interface SidebarNavProps {
  readonly pendingPlans: number;
}

export function SidebarNav({ pendingPlans }: SidebarNavProps) {
  const role = useSessionStore((snapshot) => snapshot.user?.role ?? null);
  return (
    <nav
      aria-label="Navigasi utama"
      className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4"
    >
      {navGroupsFor(role).map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <p className="px-3 pb-1.5 label-caps text-surface/38">{group.label}</p>
          {group.items.map((item) => (
            <SidebarNavItem key={item.to} item={item} pendingPlans={pendingPlans} />
          ))}
        </div>
      ))}
    </nav>
  );
}

interface StatusCellProps {
  readonly label: string;
  readonly children: ReactNode;
}

function StatusCell({ label, children }: StatusCellProps) {
  return (
    <div className="flex flex-col items-center gap-1 px-1 py-3">
      {children}
      <span className="label-caps text-surface/38">{label}</span>
    </div>
  );
}

export interface SidebarStatusStripProps {
  readonly signals: SidebarSignals;
}

export function SidebarStatusStrip({ signals }: SidebarStatusStripProps) {
  const state = useRealtimeState();
  const visual = connectionVisuals[state];
  const staleTone = signals.staleCount > 0 ? "text-[#e0b34a]" : "text-surface/88";
  const pendingTone = signals.pendingPlans > 0 ? "text-[#e0b34a]" : "text-surface/88";
  return (
    <div className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10 bg-white/[0.03]">
      <StatusCell label="Koneksi">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", visual.dot)} />
          <span className="text-xs font-medium text-surface/85">{visual.label}</span>
        </span>
      </StatusCell>
      <StatusCell label="Sensor">
        <span
          title={
            signals.staleCount > 0
              ? `${formatNumber(signals.staleCount)} bacaan basi`
              : "Semua bacaan segar"
          }
          className={cn("font-mono text-sm font-medium tabular", staleTone)}
        >
          {formatNumber(signals.sensorCount)}
        </span>
      </StatusCell>
      <StatusCell label="Menunggu">
        <span className={cn("font-mono text-sm font-medium tabular", pendingTone)}>
          {formatNumber(signals.pendingPlans)}
        </span>
      </StatusCell>
    </div>
  );
}
