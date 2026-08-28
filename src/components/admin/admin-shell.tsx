"use client";

// =============================================================================
// ADMIN CONSOLE FRAME — sticky top navbar, shared by every /admin section.
// =============================================================================
// One horizontal navbar gives the admin:
//   • brand + "Admin" badge (links back to /admin overview)
//   • every admin-only route as a tab (active state follows the URL)
//   • exits: Home (/), Open app (/dashboard), Log out
// Mobile collapses the SAME tab row into a swipeable strip — no hidden
// hamburger needed, navigation is always one glance away.
// Every data endpoint re-verifies the live DB admin flag server-side; this
// frame is presentation only.
// =============================================================================

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Receipt,
  Webhook,
  ScrollText,
  Layers,
  LogOut,
  House,
  AppWindow,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/payments", label: "Payments", icon: Receipt },
  { href: "/admin/plans", label: "Plans", icon: Layers },
  { href: "/admin/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/admin/logout", { method: "POST" }).catch(() => {});
    router.push("/admin/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/85 shadow-[0_1px_12px_-6px_rgba(0,0,0,0.12)] backdrop-blur-md">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          {/* Row 1 — brand + exits */}
          <div className="flex h-14 items-center gap-3">
            <Logo href="/admin" size={30} badge="Admin" className="min-w-0" />
            <span className="ml-1 hidden items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary md:inline-flex">
              <ShieldCheck className="size-3.5" /> Operations console
            </span>

            <div className="ml-auto flex items-center gap-1">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Link href="/">
                  <House className="size-4" />
                  <span className="hidden sm:inline">Home</span>
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Link href="/dashboard">
                  <AppWindow className="size-4" />
                  <span className="hidden sm:inline">Open app</span>
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                disabled={loggingOut}
                onClick={() => void logout()}
              >
                <LogOut className="size-4" />
                <span className="hidden sm:inline">
                  {loggingOut ? "Logging out…" : "Log out"}
                </span>
              </Button>
            </div>
          </div>

          {/* Row 2 — section tabs (scrollable strip on small screens) */}
          <nav
            className="scrollbar-none -mx-1 flex h-11 items-stretch gap-1 overflow-x-auto px-1"
            aria-label="Admin sections"
          >
            {NAV.map((item) => {
              const active = "exact" in item && item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative inline-flex shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-all duration-200 hover:cursor-pointer",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  )}
                >
                  <item.icon
                    className={cn(
                      "size-4 shrink-0 transition-transform duration-200 group-hover:-translate-y-px",
                      active && "text-primary"
                    )}
                  />
                  {item.label}
                  {active ? (
                    <span className="absolute inset-x-2 -bottom-[5px] h-[2px] rounded-full bg-primary" />
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>

      <footer className="border-t py-4">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 text-xs text-muted-foreground sm:px-6">
          <p>Filo admin console — restricted area. All actions are audit-logged.</p>
          <p>© {new Date().getFullYear()} Filo</p>
        </div>
      </footer>
    </div>
  );
}
