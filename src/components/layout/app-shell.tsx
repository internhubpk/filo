"use client";

// =============================================================================
// AppShell — the logged-in product frame.
// =============================================================================
// Desktop: collapsible sidebar (Dashboard, Create, Documents, Spreadsheets,
// Presentations, Files, Billing, Settings), live plan/usage indicator,
// user menu, theme switcher, command palette (⌘K), recent-activity center.
// Mobile: compact header + slide-in navigation drawer; no horizontal
// overflow; touch targets ≥ 40px.
// Auth: session is read from localStorage via useFiloSession; unauthenticated
// visitors are redirected to /login?next=<path>.
// =============================================================================

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMounted } from "@/hooks/use-mounted";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  FolderOpen,
  Settings as SettingsIcon,
  LayoutDashboard,
  Sparkles,
  CreditCard,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Menu,
  X,
  LogOut,
  ChevronDown,
  Activity,
  Command,
  Moon,
  Sun,
  Monitor,
  ShieldCheck,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { initials, timeAgo, formatNumber } from "@/lib/format";
import { useFiloSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CommandPalette } from "@/components/layout/command-palette";
import { Skeleton } from "@/components/ui/skeleton";
import { LogoMark } from "@/components/shared/logo";

// ---- Navigation model ----
const NAV_MAIN = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/create", label: "Create", icon: Sparkles, shortcut: "N" },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/spreadsheets", label: "Spreadsheets", icon: FileSpreadsheet },
  { href: "/presentations", label: "Presentations", icon: Presentation },
  { href: "/files", label: "Files", icon: FolderOpen },
] as const;

const NAV_SECONDARY = [
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

interface QuotaData {
  planName?: string;
  planTier?: string;
  usedGenerations?: number;
  planLimit?: number;
  planStorageMb?: number;
  usage?: { storageBytes?: number; fileCount?: number };
  subscription?: { status?: string } | null;
}

// ---- Sidebar collapse store (localStorage-backed, useSyncExternalStore) ----
function subscribeSidebar(callback: () => void) {
  window.addEventListener("filo:sidebar", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("filo:sidebar", callback);
    window.removeEventListener("storage", callback);
  };
}
function getSidebarSnapshot() {
  return localStorage.getItem("filo_sidebar_collapsed") === "1";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, ready, clearSession } = useFiloSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ---- Persist sidebar collapse per browser (hydration-safe, no effects) ----
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, () => false);
  const toggleCollapsed = useCallback(() => {
    localStorage.setItem(
      "filo_sidebar_collapsed",
      localStorage.getItem("filo_sidebar_collapsed") === "1" ? "0" : "1"
    );
    window.dispatchEvent(new Event("filo:sidebar"));
  }, []);

  // ---- Global shortcuts: ⌘K palette, N = create ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (!typing && (e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        router.push("/create");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  // ---- Live quota (real Convex data; poll 30s) ----
  const quota = useApi<QuotaData>(
    ready && user
      ? () => apiClient.getBillingOverview().then((r) => (r.success ? ((r.data ?? null) as QuotaData | null) : null))
      : null,
    { pollMs: 30_000 }
  );

  // Close mobile drawer on navigation (state adjustment during render —
  // the React-endorsed alternative to an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  // ---- Auth guard (after possible state adjustment) ----
  useEffect(() => {
    if (ready && !user) {
      const next = encodeURIComponent(pathname || "/dashboard");
      router.replace(`/login?next=${next}`);
    }
  }, [ready, user, router, pathname]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading your workspace…</p>
        </div>
      </div>
    );
  }

  const used = quota.data?.usedGenerations ?? 0;
  const limit = quota.data?.planLimit ?? 0;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  const sidebar = (
    <SidebarContent
      collapsed={collapsed}
      quota={{ planName: quota.data?.planName, used, limit, pct, loading: quota.loading && !quota.data }}
      isActive={(href) => pathname === href || pathname.startsWith(href + "/")}
      onLogout={async () => {
        await apiClient.logout().catch(() => {});
        clearSession();
        router.push("/");
      }}
      userEmail={user.email}
      userName={user.name}
    />
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:block",
          collapsed ? "w-[68px]" : "w-64"
        )}
      >
        {sidebar}
      </aside>
      <div className={cn("hidden lg:block shrink-0 transition-[width] duration-200", collapsed ? "w-[68px]" : "w-64")} />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="size-4.5" /> : <PanelLeftClose className="size-4.5" />}
          </Button>

          {/* Search / command trigger */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="group mx-auto flex h-9 w-full max-w-md items-center gap-2 rounded-lg border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted sm:mx-0"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <kbd className="hidden items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium sm:flex">
              <Command className="size-2.5" />K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1">
            <ThemeMenu />
            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-1.5 sm:px-2" aria-label="Account menu">
                  <Avatar className="size-7">
                    <AvatarFallback className="text-xs">{initials(user.name)}</AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[120px] truncate text-sm md:inline">{user.name}</span>
                  <ChevronDown className="hidden size-3.5 text-muted-foreground md:inline" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="truncate text-sm font-medium">{user.name}</div>
                  <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/billing")}>
                  <CreditCard className="mr-2 size-4" /> Billing
                  <span className="ml-auto text-xs text-muted-foreground">{quota.data?.planName ?? "…"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/settings")}>
                  <SettingsIcon className="mr-2 size-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await apiClient.logout().catch(() => {});
                    clearSession();
                    router.push("/");
                  }}
                >
                  <LogOut className="mr-2 size-4" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>

        {/* Mobile footer nav (thumb-reachable primary destinations) */}
        <nav className="sticky bottom-0 z-20 grid grid-cols-5 border-t bg-background/95 backdrop-blur lg:hidden" aria-label="Primary">
          {NAV_MAIN.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-[11px]",
                  active ? "text-primary" : "text-muted-foreground"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>

      {/* Command palette */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

// =============================================================================
// Sidebar content (shared desktop/mobile)
// =============================================================================
function SidebarContent({
  collapsed,
  quota,
  isActive,
  onLogout,
  userEmail,
  userName,
}: {
  collapsed: boolean;
  quota: { planName?: string; used: number; limit: number; pct: number; loading: boolean };
  isActive: (href: string) => boolean;
  onLogout: () => void;
  userEmail: string;
  userName: string;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className={cn("flex h-14 items-center border-b", collapsed ? "justify-center px-2" : "px-4")}>
        <Link href="/dashboard" className="flex items-center gap-2 overflow-hidden" aria-label="Filo home">
          <LogoMark size={28} />
          {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight">Filo</span>}
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3" aria-label="Workspace">
        {NAV_MAIN.map((item) => (
        <NavItem key={item.href} {...item} collapsed={collapsed} active={isActive(item.href)} />
        ))}
        <div className={cn("py-2", collapsed ? "" : "px-2")}>
          <div className="border-t" />
        </div>
        {NAV_SECONDARY.map((item) => (
          <NavItem key={item.href} {...item} collapsed={collapsed} active={isActive(item.href)} />
        ))}
      </nav>

      {/* Usage + plan indicator (real data) */}
      <div className={cn("border-t p-3", collapsed && "px-2")}>
        {!collapsed ? (
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">AI generations</span>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {quota.planName ?? "Free"}
              </span>
            </div>
            {quota.loading ? (
              <Skeleton className="mt-2 h-2 w-full" />
            ) : (
              <Progress value={quota.pct} className="mt-2 h-1.5" aria-label="Monthly generation usage" />
            )}
            <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
              {quota.limit === -1
                ? `${formatNumber(quota.used)} used · unlimited`
                : `${formatNumber(quota.used)} / ${formatNumber(quota.limit)} this month`}
            </p>
            <Button asChild size="sm" variant="outline" className="mt-2.5 h-7 w-full text-xs">
              <Link href="/billing">Manage plan</Link>
            </Button>
          </div>
        ) : (
          <Tooltip label={`${quota.used}/${quota.limit === -1 ? "∞" : quota.limit} generations`}>
            <Link href="/billing" className="flex justify-center rounded-md p-1.5 hover:bg-sidebar-accent" aria-label="Plan usage">
              <CreditCard className="size-4.5" />
            </Link>
          </Tooltip>
        )}

        {/* User card */}
        {!collapsed ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg px-1 py-1">
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">{initials(userName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{userName}</p>
              <p className="truncate text-[11px] text-muted-foreground">{userEmail}</p>
            </div>
            <Button variant="ghost" size="icon" className="size-7" onClick={onLogout} aria-label="Log out">
              <LogOut className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  collapsed,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed: boolean;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      )}
    >
      <Icon className={cn("size-4.5 shrink-0", active && "text-primary")} />
      {!collapsed && <span className="truncate">{label}</span>}
      {active && !collapsed && <span className="ml-auto size-1.5 rounded-full bg-primary" aria-hidden />}
    </Link>
  );
}

// ---- Minimal tooltip for collapsed mode (CSS-only, accessible) ----
function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex w-full justify-center">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover/tip:block"
      >
        {label}
      </span>
    </span>
  );
}

// ---- Theme switcher (light / dark / system) ----
function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          {mounted && theme === "dark" ? <Moon className="size-4.5" /> : mounted && theme === "light" ? <Sun className="size-4.5" /> : <Monitor className="size-4.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="mr-2 size-4" /> Light {theme === "light" && <Check />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="mr-2 size-4" /> Dark {theme === "dark" && <Check />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="mr-2 size-4" /> System {theme === "system" && <Check />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Check() {
  return <ShieldCheck className="ml-auto size-3.5 text-primary" aria-hidden />;
}
