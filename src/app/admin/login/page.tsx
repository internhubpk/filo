"use client";

// =============================================================================
// ADMIN LOGIN — env-credential flow (ADMIN_USERNAME / ADMIN_PASSWORD).
// The login route ALSO bootstraps a DB admin identity so the console can
// verify the live isAdmin flag server-side. Plain, focused, trustworthy.
// =============================================================================

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, ShieldCheck, ArrowLeft, Sparkles } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogoMark } from "@/components/shared/logo";

function AdminLoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionError = search.get("error") === "session_expired";

  // Already holding a valid admin session? Straight in.
  useEffect(() => {
    fetch("/api/auth/admin/check", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.authenticated) router.replace("/admin");
      })
      .catch(() => {});
  }, [router]);

  // Logged in as a DB admin with a regular session? Offer one-click entry.
  useEffect(() => {
    if (apiClient.isAuthenticated()) {
      apiClient
        .adminStats()
        .then((res) => {
          if (res.success) router.replace("/admin");
        })
        .catch(() => {});
    }
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username || !password) {
      setError("Both fields are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || "Login failed");
        return;
      }
      router.replace("/admin");
    } catch {
      setError("Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="group relative mx-auto flex size-11 items-center justify-center rounded-xl">
            <LogoMark size={44} rounded="rounded-xl" />
            <span className="absolute -bottom-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
              <ShieldCheck className="size-3" />
            </span>
          </span>
          <h1 className="text-display mt-4 text-xl">Filo Admin Console</h1>
          <p className="mt-1 text-sm text-muted-foreground">Restricted to authorized operators.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border bg-card p-6" noValidate>
          {sessionError && (
            <Alert>
              <AlertDescription>Your previous session expired — please sign in again.</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="admin-username">Username</Label>
            <Input
              id="admin-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Password</Label>
            <div className="relative">
              <Input
                id="admin-password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={show ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="h-10 w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Sign in to console
          </Button>
        </form>

        <div className="mt-4 text-center">
          <Link href="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" /> Back to Filo
          </Link>
        </div>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
          <Sparkles className="size-3" />
          Filo operators with admin roles can also sign in from the normal login.
        </p>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  );
}
