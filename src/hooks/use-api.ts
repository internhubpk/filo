"use client";

// =============================================================================
// useApi — tiny SWR-style data hook with polling support
// =============================================================================
// Convex realtime is available for public queries only; auth-gated data flows
// through Next.js API routes (HMAC session verified server-side). For those,
// this hook provides lightweight polling + refetch-on-focus + manual refresh.
// Poll intervals are opt-in per call site (e.g. 15s admin tables, 2s active
// generation progress).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";

interface UseApiOptions {
  /** Poll every N ms while the tab is visible. 0 = no polling. */
  pollMs?: number;
  /** Skip the initial fetch (e.g. waiting for a jobId). */
  enabled?: boolean;
}

interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Manual refetch. Returns the fresh data (or null on failure). */
  refresh: () => Promise<T | null>;
}

export function useApi<T = unknown>(
  fetcher: (() => Promise<T | null>) | null,
  options: UseApiOptions = {}
): UseApiResult<T> {
  const { pollMs = 0, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(fetcher) && enabled);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const mounted = useRef(true);

  const run = useCallback(async (quiet: boolean): Promise<T | null> => {
    const fetch = fetcherRef.current;
    if (!fetch) return null;
    if (!quiet) setLoading(true);
    try {
      const result = await fetch();
      if (mounted.current) {
        setData(result);
        setError(null);
      }
      return result;
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "Request failed");
      }
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!fetcher || !enabled) {
      setLoading(false);
      return;
    }
    void run(false);

    let interval: ReturnType<typeof setInterval> | null = null;
    if (pollMs > 0) {
      interval = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          void run(true);
        }
      }, pollMs);
    }

    const onFocus = () => {
      if (document.visibilityState === "visible") void run(true);
    };
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      mounted.current = false;
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [Boolean(fetcher), enabled, pollMs]);

  return { data, error, loading, refresh: () => run(true) };
}

/** Typed convenience wrappers over apiClient for common endpoints. */
export const fetchers = {
  subscriptionStatus: () => apiClient.getSubscriptionStatus(),
  billingOverview: () => apiClient.getBillingOverview(),
  plans: () => apiClient.getPlans(),
  artifacts: () => apiClient.listArtifacts(),
  files: () => apiClient.listFiles(),
};
