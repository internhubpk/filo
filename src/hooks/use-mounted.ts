"use client";

// =============================================================================
// useMounted — hydration-safe "has the client hydrated?" flag.
// =============================================================================
// Replaces the legacy `useEffect(() => setMounted(true), [])` pattern, which
// React 19's react-hooks/set-state-in-effect lint rule rejects (cascading
// renders). useSyncExternalStore gives identical semantics:
//   - server render + first client (hydration) render -> false
//   - every render after hydration                    -> true
// No extra render pass, no lint violation.
// =============================================================================

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
