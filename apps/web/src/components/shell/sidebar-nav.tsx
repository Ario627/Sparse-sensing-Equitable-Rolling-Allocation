import { Link } from "@tanstack/react-router";
import { type NavItem, navGroupsFor } from "@/app/nav.ts";
import { useRole } from "@/lib/auth/session-store.ts";
import { cn } from "@/lib/cn.ts";
import { formatCappedPercent, formatNumber } from "@/lib/format.ts";
import type { SocketState } from "@/lib/ws/socket.ts";
import { useRealtimeState } from "@/lib/ws/use-realtime.tsx";
import type { SidebarSignals } from "./sidebar-signals.ts";

const RAIL_LEFT = "left-[33px]";

const itemBase =
  "group relative z-10 flex items-center gap-3 rounded-sm py-1.5 pr-2.5 pl-3 transition-colors duration-200";
const itemIdle = cn(itemBase, "text-surface/72 hover:bg-white/6 hover:text-surface");
const itemActive = cn(itemBase, "bg-white/8 text-surface");

const markerBase =
  "grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-200";
const markerIdle = cn(
  markerBase,
  "border-white/15 bg-reservoir text-surface/60 group-hover:border-white/30 group-hover:text-surface/90",
);
const markerActive = cn(markerBase, "border-water-line bg-water text-surface");

const badgeClass =
  "ml-auto shrink-0 rounded-full bg-water-line/18 px-1.5 py-0.5 font-mono text-2xs text-water-line tabular";

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
      {({ isActive }) => (
        <>
          <span aria-hidden="true" className={isActive ? markerActive : markerIdle}>
            <Icon size={12} />
          </span>
          <span className="truncate text-[13px]">{item.label}</span>
          {badgeCount > 0 && (
            <span className={badgeClass}>{formatNumber(badgeCount)}</span>
          )}
        </>
      )}
    </Link>
  );
}

export interface SidebarNavProps {
  readonly pendingPlans: number;
}

export function SidebarNav({ pendingPlans }: SidebarNavProps) {
  const role = useRole();
  return (
    <nav
      aria-label="Navigasi utama"
      className="relative flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4"
    >
      <span
        aria-hidden="true"
        className={cn("absolute top-7 bottom-7 w-px bg-white/12", RAIL_LEFT)}
      />
      {navGroupsFor(role).map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 px-3 pb-1.5">
            <p className="label-caps text-surface/40">{group.label}</p>
            <span aria-hidden="true" className="h-px flex-1 bg-white/10" />
          </div>
          {group.items.map((item) => (
            <SidebarNavItem key={item.to} item={item} pendingPlans={pendingPlans} />
          ))}
        </div>
      ))}
    </nav>
  );
}

export interface SidebarStatusStripProps {
  readonly signals: SidebarSignals;
}

export function SidebarStatusStrip({ signals }: SidebarStatusStripProps) {
  const state = useRealtimeState();
  const visual = connectionVisuals[state];
  const freshness = signals.freshness;
  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5 font-mono text-2xs">
      <span className="flex items-center gap-1.5" title="Status saluran realtime">
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", visual.dot)} />
        <span className="text-surface/70">{visual.label}</span>
      </span>
      <span
        title={
          freshness === null
            ? "Belum ada bacaan sensor"
            : `${formatNumber(signals.sensorCount - signals.staleCount)} dari ${formatNumber(signals.sensorCount)} sensor segar`
        }
        className={cn(
          "tabular",
          signals.staleCount > 0 ? "text-[#e0b34a]" : "text-surface/70",
        )}
      >
        {formatCappedPercent(freshness)} segar
      </span>
      <span
        title="Rencana berstatus diajukan"
        className={cn(
          "tabular",
          signals.pendingPlans > 0 ? "text-[#e0b34a]" : "text-surface/55",
        )}
      >
        {formatNumber(signals.pendingPlans)} menunggu
      </span>
    </div>
  );
}
