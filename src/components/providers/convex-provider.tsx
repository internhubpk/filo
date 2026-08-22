"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useState, useSyncExternalStore } from "react";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    // Return null if no URL provided (for builds without Convex)
    return null;
  }
  return new ConvexReactClient(convexUrl);
}

const emptySubscribe = () => () => {};

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => getConvexClient());
  // Returns false on the server and during the first client render (avoiding
  // hydration mismatches), then true on subsequent client renders.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  // Don't render with Convex provider during SSR or if not configured
  if (!client || !mounted) {
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
