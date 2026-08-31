"use client";

// =============================================================================
// REGISTER — real signup via /api/auth/signup.
// New accounts start on the FREE plan (25 generations/month). No paid
// subscription is granted at registration; the user's actual plan always
// comes from Convex.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function passwordScore(pw: string): { score: number; checks: Array<{ label: string; ok: boolean }> } {
  const checks = [
    { label: "8+ characters", ok: pw.length >= 8 },
    { label: "Upper & lowercase", ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: "A number", ok: /\d/.test(pw) },
  ];
  return { score: checks.filter((c) => c.ok).length, checks };
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (apiClient.isAuthenticated()) router.replace("/chat");
     
  }, []);

  const strength = useMemo(() => passwordScore(password), [password]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = "Enter your full name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid email address";
    if (password.length < 8) errs.password = "Use at least 8 characters";
    if (!accepted) errs.terms = "Please accept the terms to continue";
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.signup(name.trim(), email.trim(), password);
      if (!res.success || !res.data) {
        setError(res.error || "Registration failed");
        return;
      }
      apiClient.storeSession(res.data.user as any, res.data.sessionToken);
      toast.success("Account created — welcome to Filo");
      router.replace("/chat");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-display text-2xl">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Start free — 25 AI generations every month.{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Already have an account?
        </Link>
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            autoComplete="name"
            placeholder="Aisha Khan"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
            disabled={submitting}
            autoFocus
          />
          {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            disabled={submitting}
          />
          {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              disabled={submitting}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {password.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <Progress value={(strength.score / 3) * 100} className="h-1" aria-label="Password strength" />
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {strength.checks.map((c) => (
                  <span key={c.label} className={cn("inline-flex items-center gap-1 text-[11px]", c.ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                    {c.ok ? <Check className="size-3" /> : <X className="size-3" />}
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {fieldErrors.password && <p className="text-xs text-destructive">{fieldErrors.password}</p>}
        </div>

        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 size-4 rounded border-input accent-[var(--primary)]"
            disabled={submitting}
          />
          <span>
            I agree to the <span className="font-medium text-foreground">Terms of Service</span> and{" "}
            <span className="font-medium text-foreground">Privacy Policy</span>.
          </span>
        </label>
        {fieldErrors.terms && <p className="text-xs text-destructive">{fieldErrors.terms}</p>}

        <Button type="submit" className="h-10 w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" /> Creating account…
            </>
          ) : (
            "Create free account"
          )}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          No credit card required. Upgrade any time from Billing.
        </p>
      </form>
    </div>
  );
}
