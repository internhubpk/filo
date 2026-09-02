"use client";

// =============================================================================
// AppShell v3 — the rebuilt logged-in product frame.
// =============================================================================
// ONE sidebar, closed by default, openable — everything lives in it:
//
//   ┌─────────────────────────────────────────┬────┬──────┐
//   │  page content (full height)             │rail│menu  │   ← collapsed (56px)
//   │  page content  ←────────pushed──────────│  nav          │   ← expanded (288px)
//   └─────────────────────────────────────────┴──────────────┘
//
//   Collapsed = the icon rail (56px, right edge): logo · open-sidebar ·
//   new chat · documents · spacer · account avatar.
//   Expanded  = the same sidebar opened (pushes content left):
//     • brand row + close toggle
//     • nav rows (New chat, Documents)
//     • HISTORY — the user's conversations, below the other items
//     • account footer (profile & settings / billing / theme / log out)
//
//   Mobile: the same sidebar body opens as a right-hand sheet; the chat
//   header's menu button opens it via SidebarContext (useSidebar).
//
//   ⌘B / Ctrl+B toggles the sidebar anywhere in the shell.
//
// The old 8-item sidebar is gone; Filo stays a chat-centered workspace.
// Auth: unauthenticated visitors are redirected to /login?next=<path>.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronsUpDown,
  FileText,
  MessageSquarePlus,
  Settings as SettingsIcon,
  CreditCard,
  LogOut,
  Moon,
  Sun,
  Monitor,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CommandPalette } from "@/components/layout/command-palette";
import { LogoMark } from "@/components/shared/logo";
import { SidebarContext } from "@/components/layout/sidebar-context";
import { HistoryPanel } from "@/components/chat/history-panel";
import { QueryBoundary } from "@/components/chat/query-boundary";

// ---- Tooltip delay tuned for a dense rail ----
const RAIL_TOOLTIP = { delayDuration: 250, skipDelayDuration: 100 };

// ---- Sidebar geometry ----
const RAIL_WIDTH = 56; // w-14 — collapsed
const SIDEBAR_WIDTH = 288; // expanded

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, ready, clearSession } = useFiloSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // ONE sidebar — closed by default, opened on demand.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ---- Global shortcuts: ⌘K palette · ⌘B sidebar ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((o) => !o);
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

  const sidebar = useMemo(
    () => ({
      open: sidebarOpen,
      setOpen: setSidebarOpen,
      toggle: () => setSidebarOpen((v) => !v),
    }),
    [sidebarOpen]
  );

  // The active chat id lives in the URL — the sidebar highlights it on any page.
  const activeChatId = useMemo(() => {
    const match = /^\/chat\/([^/]+)/.exec(pathname ?? "");
    return match ? match[1] : null;
  }, [pathname]);

  const openChat = useCallback(
    (chatId: string) => {
      router.push(`/chat/${chatId}`);
    },
    [router]
  );

  const newChat = useCallback(() => {
    router.push("/chat");
  }, [router]);

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

  return (
    <TooltipProvider delayDuration={RAIL_TOOLTIP.delayDuration} skipDelayDuration={RAIL_TOOLTIP.skipDelayDuration}>
      <SidebarContext.Provider value={sidebar}>
        <div className="flex h-screen overflow-hidden bg-background">
          {/* Main column — pages own their full height (chat scrolls internally) */}
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>

          <AppSidebar
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            activeChatId={activeChatId}
            onOpenChat={openChat}
            onNewChat={newChat}
            userName={user.name}
            userEmail={user.email}
            onLogout={logout}
          />

          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        </div>
      </SidebarContext.Provider>
    </TooltipProvider>
  );
}

// =============================================================================
// AppSidebar — THE single sidebar: icon rail (collapsed) ⟷ full panel (open).
// =============================================================================

function AppSidebar({
  open,
  onOpenChange,
  activeChatId,
  onOpenChat,
  onNewChat,
  userName,
  userEmail,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeChatId: string | null;
  onOpenChat: (chatId: string) => void;
  onNewChat: () => void;
  userName: string;
  userEmail: string;
  onLogout: () => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Shared body — desktop expanded panel and the mobile sheet render the
  // same content; on mobile every navigation also dismisses the sheet.
  const body = (dismissOnNavigate: boolean) => (
    <SidebarBody
      activeChatId={activeChatId}
      onOpenChat={onOpenChat}
      onNewChat={onNewChat}
      userName={userName}
      userEmail={userEmail}
      onLogout={onLogout}
      onCollapse={close}
      onNavigate={dismissOnNavigate ? close : undefined}
    />
  );

  return (
    <>
      {/* Desktop — one collapsible aside at the right edge */}
      <motion.aside
        initial={false}
        animate={{ width: open ? SIDEBAR_WIDTH : RAIL_WIDTH }}
        transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-30 hidden h-full shrink-0 overflow-hidden border-l bg-sidebar text-sidebar-foreground md:block"
        aria-label="Workspace sidebar"
      >
        {/* Collapsed layer — the icon rail, anchored to the right edge */}
        <motion.div
          initial={false}
          animate={{ opacity: open ? 0 : 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.18 }}
          inert={open}
          className="absolute inset-y-0 right-0 flex w-14 flex-col items-center py-3"
        >
          <Rail open={open} onOpen={() => onOpenChange(true)} userName={userName} userEmail={userEmail} onLogout={onLogout} />
        </motion.div>

        {/* Expanded layer — nav + history + account, anchored to the right edge */}
        <motion.div
          initial={false}
          animate={{ opacity: open ? 1 : 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.22 }}
          inert={!open}
          className="absolute inset-y-0 right-0 flex w-72 flex-col"
        >
          {body(false)}
        </motion.div>
      </motion.aside>

      {/* Mobile — the same sidebar as a right-hand sheet */}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[300px] bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          {body(true)}
        </SheetContent>
      </Sheet>
    </>
  );
}

// =============================================================================
// SidebarBody — expanded content: brand · nav · history (below) · account
// =============================================================================

function SidebarBody({
  activeChatId,
  onOpenChat,
  onNewChat,
  userName,
  userEmail,
  onLogout,
  onCollapse,
  onNavigate,
}: {
  activeChatId: string | null;
  onOpenChat: (chatId: string) => void;
  onNewChat: () => void;
  userName: string;
  userEmail: string;
  onLogout: () => void;
  onCollapse: () => void;
  /** Called after any in-sidebar navigation — the mobile sheet closes itself. */
  onNavigate?: () => void;
}) {
  const handleOpenChat = useCallback(
    (chatId: string) => {
      onOpenChat(chatId);
      onNavigate?.();
    },
    [onOpenChat, onNavigate]
  );

  const handleNewChat = useCallback(() => {
    onNewChat();
    onNavigate?.();
  }, [onNewChat, onNavigate]);

  return (
    <div className="flex h-full flex-col">
      {/* Brand + collapse */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Link
          href="/chat"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2 rounded-md"
          aria-label="Filo home"
        >
          <LogoMark size={22} />
          <span className="truncate text-sm font-semibold">Filo</span>
        </Link>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onCollapse}
          aria-label="Close sidebar"
        >
          <PanelRightClose className="size-4.5" />
        </Button>
      </div>

      {/* Primary nav */}
      <nav className="shrink-0 px-2 pt-2" aria-label="Primary">
        <SidebarLink
          href="/chat"
          icon={<MessageSquarePlus className="size-4.5" />}
          label="New chat"
          matchExact
          onClick={handleNewChat}
        />
        <SidebarLink
          href="/documents"
          icon={<FileText className="size-4.5" />}
          label="Documents"
          onClick={onNavigate}
        />
      </nav>

      {/* History — below the other items */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col border-t">
        <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            History
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            onClick={handleNewChat}
            aria-label="Start a new chat"
          >
            <MessageSquarePlus className="size-3" /> New
          </Button>
        </div>
        <QueryBoundary>
          <HistoryPanel
            activeChatId={activeChatId}
            onOpenChat={handleOpenChat}
            onNewChat={handleNewChat}
            showHeader={false}
          />
        </QueryBoundary>
      </div>

      {/* Account footer */}
      <div className="shrink-0 border-t p-2">
        <PersonalMenu variant="full" userName={userName} userEmail={userEmail} onLogout={onLogout} />
      </div>
    </div>
  );
}

function SidebarLink({
  href,
  icon,
  label,
  matchExact,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  matchExact?: boolean;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const isActive = matchExact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

// =============================================================================
// Rail — collapsed sidebar layer: icon-only, 56px, right edge
// =============================================================================

function Rail({
  open,
  onOpen,
  userName,
  userEmail,
  onLogout,
}: {
  open: boolean;
  onOpen: () => void;
  userName: string;
  userEmail: string;
  onLogout: () => void;
}) {
  const pathname = usePathname();
  const isChat = pathname === "/chat" || pathname.startsWith("/chat/");

  return (
    <>
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
        <TooltipContent side="left">Filo</TooltipContent>
      </Tooltip>

      {/* Open sidebar */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onOpen}
            aria-label="Open sidebar"
            aria-expanded={open}
            className="mt-1.5 flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <PanelRightOpen className="size-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Open sidebar</TooltipContent>
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
      <PersonalMenu variant="rail" userName={userName} userEmail={userEmail} onLogout={onLogout} />
    </>
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
      <TooltipContent side="left" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// =============================================================================
// PersonalMenu — profile, billing, theme, logout
//   variant="rail"  → 36px avatar icon (collapsed sidebar)
//   variant="full"  → full-width row with name + email (expanded sidebar)
// =============================================================================

function PersonalMenu({
  variant,
  userName,
  userEmail,
  onLogout,
}: {
  variant: "rail" | "full";
  userName: string;
  userEmail: string;
  onLogout: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "rail" ? (
          <button
            className="flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent/60"
            aria-label="Account menu"
          >
            <Avatar className="size-7">
              <AvatarFallback className="text-[11px]">{initials(userName)}</AvatarFallback>
            </Avatar>
          </button>
        ) : (
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent/60"
            aria-label="Account menu"
          >
            <Avatar className="size-8">
              <AvatarFallback className="text-[11px]">{initials(userName)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{userName}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{userEmail}</span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" align="end" className="w-60">
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
