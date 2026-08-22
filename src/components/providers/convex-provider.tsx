"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useState } from "react";

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

  // Only skip the provider if Convex isn't configured at all. The client
  // must be provided during SSR/prerender too, since child components
  // (e.g. main-dashboard) call Convex hooks like useAction/useQuery
  // unconditionally and those throw immediately without a provider in
  // the tree, regardless of whether we're on the server or the client.
  if (!client) {
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
