"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useState, useEffect } from "react";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    // Return null if no URL provided (for builds without Convex)
    return null;
  }
  return new ConvexReactClient(convexUrl);
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => getConvexClient());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render with Convex provider during SSR or if not configured
  if (!client || !mounted) {
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
