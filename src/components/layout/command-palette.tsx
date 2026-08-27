"use client";

// =============================================================================
// CommandPalette — ⌘K jump-to navigation + quick actions + recent artifacts.
// Recent artifacts are REAL data from /api/artifacts (no fake entries).
// =============================================================================

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  FolderOpen,
  Settings as SettingsIcon,
  LayoutDashboard,
  Sparkles,
  CreditCard,
  Moon,
  Sun,
  LogOut,
  CornerDownLeft,
} from "lucide-react";
import { useTheme } from "next-themes";
import { apiClient } from "@/lib/api-client";
import { useFiloSession } from "@/hooks/use-session";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useApi } from "@/hooks/use-api";

interface ArtifactRow {
  _id: string;
  title: string;
  type: string;
  format: string;
  createdAt: number;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const { user, clearSession } = useFiloSession();

  // Real recent artifacts (safe to fetch only while open — saves requests).
  const recent = useApi<{ artifacts?: ArtifactRow[] }>(
    open && user
      ? () => apiClient.listArtifacts({ limit: 6 }).then((r) => (r.success ? (r.data as any) : { artifacts: [] }))
      : null,
    { enabled: open }
  );

  const go = useMemo(
    () =>
      (href: string) => {
        onOpenChange(false);
        router.push(href);
      },
    [onOpenChange, router]
  );

  // ⌘K handled by AppShell; Escape closes (cmdk built-in).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, actions, recent documents…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Quick actions">
          <CommandItem onSelect={() => go("/create")}>
            <Sparkles className="mr-2 size-4" /> New AI generation
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/files")}>
            <FolderOpen className="mr-2 size-4" /> Upload a file
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard className="mr-2 size-4" /> Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/documents")}>
            <FileText className="mr-2 size-4" /> Documents
          </CommandItem>
          <CommandItem onSelect={() => go("/spreadsheets")}>
            <FileSpreadsheet className="mr-2 size-4" /> Spreadsheets
          </CommandItem>
          <CommandItem onSelect={() => go("/presentations")}>
            <Presentation className="mr-2 size-4" /> Presentations
          </CommandItem>
          <CommandItem onSelect={() => go("/files")}>
            <FolderOpen className="mr-2 size-4" /> Files
          </CommandItem>
          <CommandItem onSelect={() => go("/billing")}>
            <CreditCard className="mr-2 size-4" /> Billing & plan
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <SettingsIcon className="mr-2 size-4" /> Settings
          </CommandItem>
        </CommandGroup>

        {recent.data?.artifacts && recent.data.artifacts.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent documents">
              {recent.data.artifacts.map((a) => (
                <CommandItem key={a._id} onSelect={() => go(`/documents?artifact=${a._id}`)}>
                  {a.type === "spreadsheet" ? (
                    <FileSpreadsheet className="mr-2 size-4" />
                  ) : a.type === "presentation" ? (
                    <Presentation className="mr-2 size-4" />
                  ) : (
                    <FileText className="mr-2 size-4" />
                  )}
                  <span className="truncate">{a.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              onOpenChange(false);
            }}
          >
            {resolvedTheme === "dark" ? <Sun className="mr-2 size-4" /> : <Moon className="mr-2 size-4" />}
            Toggle {resolvedTheme === "dark" ? "light" : "dark"} mode
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              void apiClient.logout().catch(() => {});
              clearSession();
              router.push("/");
            }}
          >
            <LogOut className="mr-2 size-4" /> Log out
          </CommandItem>
        </CommandGroup>

        <div className="flex items-center gap-1.5 border-t px-3 py-2 text-[11px] text-muted-foreground">
          <CornerDownLeft className="size-3" /> to select · Esc to close
        </div>
      </CommandList>
    </CommandDialog>
  );
}
