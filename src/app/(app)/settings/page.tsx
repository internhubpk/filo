"use client";

// =============================================================================
// SETTINGS — Profile / Security / Appearance / Usage / Storage.
// Every save calls a real endpoint and only reports success when the backend
// mutation actually succeeded (never a simulated "Saved").
// =============================================================================

import { useState } from "react";
import { Loader2, Check, Eye, EyeOff, Palette, User, Lock, Gauge, HardDrive } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useMounted } from "@/hooks/use-mounted";
import { useFiloSession } from "@/hooks/use-session";
import { useTheme } from "next-themes";
import { formatBytes } from "@/lib/format";
import { PageHeader, UsageBar } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { FadeIn } from "@/components/animations";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function SettingsPage() {
  const { user, ready } = useFiloSession();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Settings" description="Your account, security, and workspace preferences." />
      {!ready ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton-shimmer h-44 rounded-xl border bg-card" />
          ))}
        </div>
      ) : (
        <>
          <ProfileSection name={user?.name ?? ""} email={user?.email ?? ""} />
          <SecuritySection />
          <AppearanceSection />
          <UsageSection />
        </>
      )}
    </div>
  );
}

// ============================ PROFILE ============================
function ProfileSection({ name: initialName, email }: { name: string; email: string }) {
  const [name, setName] = useState(initialName);
  const [state, setState] = useState<SaveState>("idle");
  const dirty = name !== initialName && name.trim().length >= 2;

  async function save() {
    setState("saving");
    try {
      const res = await apiClient.updateProfile({ name: name.trim() });
      if (!res.success) {
        setState("error");
        toast.error(res.error || "Could not save your profile");
        return;
      }
      // Keep the stored session's user in sync.
      try {
        const raw = localStorage.getItem("filo_session");
        if (raw) {
          const session = JSON.parse(raw);
          session.user = { ...session.user, name: name.trim() };
          localStorage.setItem("filo_session", JSON.stringify(session));
          window.dispatchEvent(new Event("authStateChanged"));
        }
      } catch {}
      setState("saved");
      toast.success("Profile updated");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      toast.error("Could not reach the server");
    }
  }

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="size-4 text-primary" /> Profile
          </CardTitle>
          <CardDescription>How your name appears across Filo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="settings-name">Full name</Label>
            <Input id="settings-name" value={name} onChange={(e) => { setName(e.target.value); setState("idle"); }} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={email} disabled />
            <p className="text-xs text-muted-foreground">Your email is your login and can&apos;t be changed.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => void save()} disabled={!dirty || state === "saving"}>
              {state === "saving" && <Loader2 className="mr-2 size-4 animate-spin" />}
              {state === "saved" && <Check className="mr-2 size-4" />}
              Save changes
            </Button>
            {state === "error" && <span className="text-xs text-destructive">Save failed — try again.</span>}
          </div>
        </CardContent>
      </Card>
    </FadeIn>
  );
}

// ============================ SECURITY ============================
function SecuritySection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<SaveState>("idle");

  async function save() {
    setState("saving");
    try {
      const res = await apiClient.changePassword({ currentPassword: current, newPassword: next });
      if (!res.success) {
        setState("error");
        toast.error(res.error || "Could not change password");
        return;
      }
      setState("saved");
      setCurrent("");
      setNext("");
      toast.success("Password updated");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      toast.error("Could not reach the server");
    }
  }

  const valid = current.length > 0 && next.length >= 8;

  return (
    <FadeIn delay={0.04}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="size-4 text-primary" /> Security
          </CardTitle>
          <CardDescription>Change your password. You&apos;ll need your current one.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <PasswordInput id="current-password" value={current} onChange={setCurrent} show={show} toggle={() => setShow((v) => !v)} autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput id="new-password" value={next} onChange={setNext} show={show} toggle={() => setShow((v) => !v)} autoComplete="new-password" placeholder="At least 8 characters" />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => void save()} disabled={!valid || state === "saving"}>
              {state === "saving" && <Loader2 className="mr-2 size-4 animate-spin" />}
              {state === "saved" && <Check className="mr-2 size-4" />}
              Update password
            </Button>
            {state === "error" && <span className="text-xs text-destructive">Update failed — check your current password.</span>}
          </div>
        </CardContent>
      </Card>
    </FadeIn>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  show,
  toggle,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  toggle: () => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        onClick={toggle}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

// ============================ APPEARANCE ============================
function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const options = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "System" },
  ];
  return (
    <FadeIn delay={0.08}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="size-4 text-primary" /> Appearance
          </CardTitle>
          <CardDescription>Choose how Filo looks on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 sm:max-w-sm">
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => setTheme(o.id)}
                className={cn(
                  "rounded-lg border p-3 text-center text-sm transition-colors",
                  mounted && theme === o.id ? "border-primary/60 bg-primary/5 font-medium text-primary" : "hover:bg-accent/40"
                )}
                aria-pressed={mounted && theme === o.id}
              >
                {o.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </FadeIn>
  );
}

// ============================ USAGE & STORAGE ============================
function UsageSection() {
  const { ready } = useFiloSession();
  const billing = useApi<Record<string, any>>(
    ready
      ? () => apiClient.getBillingOverview().then((r) => (r.success ? ((r.data ?? null) as Record<string, any> | null) : null))
      : null,
    { pollMs: 60_000 }
  );
  const used = billing.data?.usedGenerations ?? 0;
  const limit = billing.data?.planLimit ?? 0;
  const storageBytes = billing.data?.usage?.storageBytes ?? 0;
  const storageLimit = (billing.data?.planStorageMb ?? 0) * 1024 * 1024;

  return (
    <FadeIn delay={0.12}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-primary" /> Usage &amp; storage
          </CardTitle>
          <CardDescription>Live numbers from your workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <UsageBar label="AI generations (this month)" used={used} limit={limit} />
          <UsageBar label="Storage" used={storageBytes} limit={storageLimit} />
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border p-3">
              <p className="text-lg font-semibold tabular-nums">{billing.data?.usage?.artifactCount ?? 0}</p>
              <p className="text-xs text-muted-foreground">Documents</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-lg font-semibold tabular-nums">{billing.data?.usage?.fileCount ?? 0}</p>
              <p className="text-xs text-muted-foreground">Files</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-lg font-semibold tabular-nums">{formatBytes(storageBytes)}</p>
              <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                <HardDrive className="size-3" /> Stored
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </FadeIn>
  );
}
