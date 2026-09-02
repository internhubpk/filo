"use client";

// =============================================================================
// QueryBoundary — error boundary for Convex reactive subscriptions.
// =============================================================================
// Convex `useQuery` throws when a subscription errors (expired session,
// dropped connection, function failure). Without a boundary that error would
// unmount the whole tree. This component catches it and renders an honest,
// recoverable state: what went wrong + retry (and sign-in when the session
// expired). Shared by the chat workspace transcript and the app sidebar.
// =============================================================================

import React, { type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export class QueryBoundary extends React.Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[QueryBoundary] subscription error:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      const auth = this.state.error.message.includes("Unauthorized");
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <TriangleAlert className="size-8 text-destructive" />
          <p className="text-sm font-medium">
            {auth ? "Your session has expired" : "Could not load this content"}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {auth
              ? "Sign in again to keep going — your data is safe."
              : this.state.error.message || "The connection to the live database failed."}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
              Retry
            </Button>
            {auth ? (
              <Button size="sm" onClick={() => (window.location.href = "/login")}>
                Sign in
              </Button>
            ) : null}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
