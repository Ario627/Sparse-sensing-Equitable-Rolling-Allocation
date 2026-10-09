import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { navGroups, type NavItem } from "@/app/nav.ts";
import { IconClose, IconLogout, IconMenu } from "@/components/icons.tsx";
import { Button } from "@/components/kit/button.tsx";
import { ConnectionBanner } from "@/components/kit/connection-banner.tsx";
import { BrandMark } from "@/components/shell/brand.tsx";
import { logout } from "@/lib/auth/auth-api.ts";
import { roleLabel } from "@/lib/auth/roles.ts";
import { useSessionStore } from "@/lib/auth/session-store.ts";
import { cn } from "@/lib/cn.ts";
import { formatClockMs } from "@/lib/format.ts";
import { useNow } from "@/lib/hooks.ts";
import { readLastEventAt, retryConnection } from "@/lib/ws/socket.ts";
import { RealtimeProvider, useRealtimeState } from "@/lib/ws/use-realtime.tsx";

const CLOCK_TICK_MS = 15_000;
const QUICK_ITEM_COUNT = 4;
const TIME_ZONE_LABEL = "WIB";

const navLinkBase =
  "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-sunk hover:text-ink";
const navLinkActive = cn(
  navLinkBase,
  "bg-water-soft/70 text-water-deep hover:bg-water-soft/70 hover:text-water-deep",
);
const quickLinkBase =
  "flex flex-col items-center gap-1 border-t-2 border-transparent px-1 pt-1.5 pb-1.5 text-2xs text-ink-3 transition-colors";
const quickLinkActive = cn(quickLinkBase, "border-water text-water");
const menuItemBase = "flex flex-1 flex-col gap-1.5";

function SidebarLink({ item }: { readonly item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      title={item.hint}
      className={navLinkBase}
      activeProps={{ className: navLinkActive }}
      activeOptions={{ exact: item.to === "/operations" }}
    >
      <Icon size={16} className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function QuickLink({ item }: { readonly item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={quickLinkBase}
      activeProps={{ className: quickLinkActive }}
      activeOptions={{ exact: item.to === "/operations" }}
    >
      <Icon size={18} />
      <span>{item.label}</span>
    </Link>
  );
}

function MenuLink({
  item,
  onNavigate,
}: {
  readonly item: NavItem;
  readonly onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      title={item.hint}
      className={navLinkBase}
      activeProps={{ className: navLinkActive }}
      activeOptions={{ exact: item.to === "/operations" }}
      onClick={onNavigate}
    >
      <Icon size={16} className="shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

function UserBox({
  onLogout,
  className,
}: {
  readonly onLogout: () => void;
  readonly className?: string;
}) {
  const user = useSessionStore((snapshot) => snapshot.user);
  if (user === null) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-t border-line px-3 py-3",
        className,
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium text-ink">
          {user.full_name}
        </span>
        <span className="text-2xs text-ink-3">{roleLabel(user.role)}</span>
      </span>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Keluar dari sesi"
        onClick={onLogout}
      >
        <IconLogout size={15} />
      </Button>
    </div>
  );
}

function SidebarNav() {
  return (
    <nav
      aria-label="Navigasi utama"
      className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4"
    >
      {navGroups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <p className="px-2.5 label-caps text-ink-3">{group.label}</p>
          {group.items.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function MobileBottomNav({
  menuOpen,
  onMenuToggle,
}: {
  readonly menuOpen: boolean;
  readonly onMenuToggle: () => void;
}) {
  const quickItems = navGroups[0]?.items.slice(0, QUICK_ITEM_COUNT) ?? [];
  return (
    <nav
      aria-label="Navigasi cepat"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-safe backdrop-blur md:hidden"
    >
      <div className="grid grid-cols-5">
        {quickItems.map((item) => (
          <QuickLink key={item.to} item={item} />
        ))}
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-label="Buka semua menu"
          onClick={onMenuToggle}
          className={cn(
            quickLinkBase,
            menuOpen && "border-water text-water",
          )}
        >
          <IconMenu size={18} />
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
}

function MobileMenu({
  open,
  onClose,
  onLogout,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onLogout: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      return;
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Semua menu"
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      className={cn(
        "fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-xl border border-line bg-surface p-0",
        "pb-safe md:hidden",
        "motion-safe:translate-y-4 motion-safe:opacity-0 motion-safe:transition-discrete motion-safe:transition-all motion-safe:duration-200",
        "motion-safe:open:translate-y-0 motion-safe:open:opacity-100",
        "motion-safe:starting:open:translate-y-4 motion-safe:starting:open:opacity-0",
      )}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <p className="label-caps text-ink-3">Semua menu</p>
        <Button size="sm" variant="ghost" aria-label="Tutup menu" onClick={onClose}>
          <IconClose size={16} />
        </Button>
      </div>
      <nav aria-label="Semua bagian" className="flex flex-col gap-5 px-4 py-4">
        {navGroups.map((group) => (
          <div key={group.id} className={menuItemBase}>
            <p className="label-caps text-ink-3">{group.label}</p>
            {group.items.map((item) => (
              <MenuLink key={item.to} item={item} onNavigate={onClose} />
            ))}
          </div>
        ))}
      </nav>
      <UserBox onLogout={onLogout} />
    </dialog>
  );
}

function ConnectionStrip({ now }: { readonly now: number }) {
  const state = useRealtimeState();
  return (
    <ConnectionBanner
      state={state}
      lastSyncIso={readLastEventAt()}
      now={now}
      onRetry={retryConnection}
    />
  );
}

function AppShell({ children }: { readonly children: ReactNode }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const now = useNow(CLOCK_TICK_MS);

  async function handleLogout(): Promise<void> {
    setMenuOpen(false);
    await logout().catch(() => undefined);
    void navigate({ to: "/login" });
  }

  function handleLogoutClick(): void {
    void handleLogout();
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line md:flex">
        <div className="px-4 pt-safe pb-3">
          <BrandMark />
        </div>
        <SidebarNav />
        <UserBox onLogout={handleLogoutClick} />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-paper/95 pt-safe backdrop-blur">
          <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5 sm:px-5">
            <div className="md:hidden">
              <BrandMark />
            </div>
            <span className="hidden md:block" aria-hidden="true" />
            <span className="flex items-baseline gap-1.5 font-mono text-xs text-ink-2 tabular">
              {formatClockMs(now)}
              <span className="text-2xs text-ink-3">{TIME_ZONE_LABEL}</span>
            </span>
          </div>
          <ConnectionStrip now={now} />
        </header>
        <main className="flex-1 px-3 pt-4 pb-24 sm:px-5 md:pb-10 lg:px-7">
          {children}
        </main>
      </div>
      <MobileBottomNav
        menuOpen={menuOpen}
        onMenuToggle={() => {
          setMenuOpen((current) => !current);
        }}
      />
      <MobileMenu
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false);
        }}
        onLogout={handleLogoutClick}
      />
    </div>
  );
}

export function AppShellLayout() {
  return (
    <RealtimeProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </RealtimeProvider>
  );
}