"use client";

// =============================================================================
// AppShell v2 — the rebuilt logged-in product frame.
// =============================================================================
// The old 8-item sidebar (Dashboard / Create / Documents / Spreadsheets /
// Presentations / Files / Billing / Settings) is GONE. Filo is now a
// chat-centered workspace:
//
//   ┌──┬──────────────────────────────────────────┐
//   │rail│  page content (full height)           │
//   └──┴──────────────────────────────────────────┘
//
//   rail — 56px, icon-only, every icon meaningful:
//     • Filo logo        → home (/chat)
//     • New chat         → /chat (fresh conversation)
//     • Documents        → /documents (the library)
//     • spacer
//     • Personal menu    → avatar → Profile & settings / Billing / theme / Log out
//
// Billing and Settings live in the compact personal menu (they are
// occasional destinations, not workspace destinations). The chat workspace
// owns its own history panel — this shell stays out of its way.
//
// Auth: session read via useFiloSession; unauthenticated visitors are
// redirected to /login?next=<path>. Hydration-safe loading state.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FileText,
  MessageSquarePlus,
  Settings as SettingsIcon,
  CreditCard,
  LogOut,
  Moon,
  Sun,
  Monitor,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { useFiloSession } from "@/hooks/use-session";
import { useMounted } from "@/hooks/use-mounted";
import { apiClient } from "@/lib/api-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CommandPalette } from "@/components/layout/command-palette";
import { LogoMark } from "@/components/shared/logo";

// ---- Tooltip delay tuned for a dense rail ----
const RAIL_TOOLTIP = { delayDuration: 250, skipDelayDuration: 100 };

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, ready, clearSession } = useFiloSession();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ---- Global shortcut: ⌘K palette ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Auth guard ----
  useEffect(() => {
    if (ready && !user) {
      const next = encodeURIComponent(pathname || "/chat");
      router.replace(`/login?next=${next}`);
    }
  }, [ready, user, router, pathname]);

  const logout = useCallback(async () => {
    await apiClient.logout().catch(() => {});
    clearSession();
    // Full navigation — deterministic landing on the marketing page even
    // when the auth guard's SPA redirect fires in the same tick.
    window.location.assign("/");
  }, [clearSession]);

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading your workspace…</p>
        </div>
      </div>
    );
  }

  const isChat = pathname === "/chat" || pathname.startsWith("/chat/");

  return (
    <TooltipProvider delayDuration={RAIL_TOOLTIP.delayDuration} skipDelayDuration={RAIL_TOOLTIP.skipDelayDuration}>
      <div className="flex h-screen overflow-hidden bg-background">
        <Rail
          isChat={isChat}
          userName={user.name}
          userEmail={user.email}
          onLogout={logout}
          planHint={user.planId ? undefined : "Free plan"}
        />

        {/* Main column — pages own their full height (chat scrolls internally) */}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </TooltipProvider>
  );
}

// =============================================================================
// Rail — icon-only navigation
// =============================================================================
function Rail({
  isChat,
  userName,
  userEmail,
  onLogout,
}: {
  isChat: boolean;
  userName: string;
  userEmail: string;
  onLogout: () => void;
  planHint?: string;
}) {
  return (
    <aside
      className="z-30 flex h-full w-14 shrink-0 flex-col items-center border-r bg-sidebar py-3 text-sidebar-foreground"
      aria-label="Primary navigation"
    >
      {/* Brand → home */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/chat"
            className="group/logo flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent"
            aria-label="Filo home"
          >
            <LogoMark size={26} />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Filo</TooltipContent>
      </Tooltip>

      {/* New chat */}
      <RailItem href="/chat" label="New chat" active={isChat} matchExact>
        <MessageSquarePlus className="size-5" />
      </RailItem>

      {/* Documents library */}
      <RailItem href="/documents" label="Documents">
        <FileText className="size-5" />
      </RailItem>

      <div className="flex-1" />

      {/* Personal menu — compact, everything account-related in one place */}
      <PersonalMenu userName={userName} userEmail={userEmail} onLogout={onLogout} />
    </aside>
  );
}

function RailItem({
  href,
  label,
  active,
  matchExact,
  children,
}: {
  href: string;
  label: string;
  active?: boolean;
  matchExact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = active ?? (matchExact ? pathname === href : pathname === href || pathname.startsWith(href + "/"));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-current={isActive ? "page" : undefined}
          aria-label={label}
          className={cn(
            "mt-1.5 flex size-9 items-center justify-center rounded-lg transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          )}
        >
          {children}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// =============================================================================
// PersonalMenu — avatar trigger; profile, billing, theme, logout
// =============================================================================
function PersonalMenu({
  userName,
  userEmail,
  onLogout,
}: {
  userName: string;
  userEmail: string;
  onLogout: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent/60"
          aria-label="Account menu"
        >
          <Avatar className="size-7">
            <AvatarFallback className="text-[11px]">{initials(userName)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-60">
        <DropdownMenuLabel>
          <div className="truncate text-sm font-medium">{userName}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{userEmail}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setThemeAndClose(setTheme, "light")}>
          <Sun className="mr-2 size-4" /> Light {mounted && theme === "light" && <CheckDot />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setThemeAndClose(setTheme, "dark")}>
          <Moon className="mr-2 size-4" /> Dark {mounted && theme === "dark" && <CheckDot />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setThemeAndClose(setTheme, "system")}>
          <Monitor className="mr-2 size-4" /> System {mounted && theme === "system" && <CheckDot />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <MenuLink href="/settings" icon={<SettingsIcon className="mr-2 size-4" />}>
          Profile &amp; settings
        </MenuLink>
        <MenuLink href="/billing" icon={<CreditCard className="mr-2 size-4" />}>
          Billing
        </MenuLink>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} variant="destructive">
          <LogOut className="mr-2 size-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function setThemeAndClose(setTheme: (t: string) => void, t: string) {
  setTheme(t);
}

function MenuLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem asChild>
      <Link href={href} className="cursor-pointer">
        {icon}
        {children}
      </Link>
    </DropdownMenuItem>
  );
}

function CheckDot() {
  return <span className="ml-auto size-1.5 rounded-full bg-primary" aria-hidden />;
}
