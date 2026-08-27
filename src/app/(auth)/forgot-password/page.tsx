"use client";

// =============================================================================
// FORGOT PASSWORD
// =============================================================================
// Honest state: Filo does not yet operate an email delivery provider, so we
// do NOT pretend to send a reset link (no fake success). Self-service reset
// requires email delivery; until then, account recovery goes through
// support. This page explains exactly that and verifies the email format
// so the eventual flow is a drop-in.
// =============================================================================

import { useState } from "react";
import Link from "next/link";
import { Mail, MessageCircleWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [checked, setChecked] = useState(false);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  return (
    <div>
      <h1 className="text-display text-2xl">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Enter the email on your account and we&apos;ll take it from there.{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to login
        </Link>
      </p>

      <div className="mt-8 space-y-4">
        <Alert>
          <MessageCircleWarning className="size-4" />
          <AlertTitle>Password reset is assisted right now</AlertTitle>
          <AlertDescription>
            Filo doesn&apos;t send automated email yet, so automated reset links aren&apos;t
            available. Contact support from your account email and we&apos;ll verify
            ownership and reset it for you.
          </AlertDescription>
        </Alert>

        <div className="space-y-1.5">
          <Label htmlFor="email">Account email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setChecked(false);
            }}
          />
          {email.length > 3 && !valid && (
            <p className="text-xs text-muted-foreground">This doesn&apos;t look like a complete email address.</p>
          )}
        </div>

        <Button
          className="h-10 w-full"
          disabled={!valid}
          onClick={() => setChecked(true)}
        >
          <Mail className="mr-2 size-4" />
          Check recovery options
        </Button>

        {checked && (
          <Alert>
            <AlertDescription>
              Recovery is handled by support for <span className="font-medium text-foreground">{email}</span>.
              Write to <span className="font-medium text-foreground">support@filo.app</span> from that address
              and include the subject line &ldquo;Filo password reset&rdquo;.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
