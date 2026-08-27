"use client";

// =============================================================================
// ADMIN CONSOLE FRAME — sidebar nav + header, shared by all /admin sections.
// Uses the env-credential admin look but every data endpoint re-verifies the
// live DB admin flag server-side.
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
  Menu,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/payments", label: "Payments", icon: Receipt },
  { href: "/admin/webhooks", label: "Webhook monitor", icon: Webhook },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/plans", label: "Plans", icon: Layers },
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on navigation (state adjustment during render —
  // the React-endorsed alternative to an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  async function logout() {
    await fetch("/api/auth/admin/logout", { method: "POST" }).catch(() => {});
    router.push("/admin/login");
  }

  const nav = (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Admin sections">
      {NAV.map((item) => {
        const active = "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            <item.icon className="size-4.5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex h-14 items-center gap-2 border-b px-4">
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ShieldCheck className="size-4" />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">Filo Admin</p>
        <p className="text-[10px] text-muted-foreground">Operations console</p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar lg:flex">
        {brand}
        {nav}
        <div className="border-t p-3">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={() => void logout()}>
            <LogOut className="size-4" /> Log out
          </Button>
          <Button asChild variant="ghost" size="sm" className="mt-1 w-full justify-start gap-2 text-muted-foreground">
            <Link href="/">
              <Sparkles className="size-4" /> Back to app
            </Link>
          </Button>
        </div>
      </aside>
      <div className="hidden w-60 shrink-0 lg:block" />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open admin navigation">
            <Menu className="size-5" />
          </Button>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-primary" /> Filo Admin
          </span>
          <Button variant="ghost" size="sm" className="ml-auto gap-1.5 text-muted-foreground" onClick={() => void logout()}>
            <LogOut className="size-4" /> Log out
          </Button>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Admin navigation</SheetTitle>
          </SheetHeader>
          {brand}
          {nav}
        </SheetContent>
      </Sheet>
    </div>
  );
}
