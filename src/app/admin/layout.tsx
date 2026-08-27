import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Console",
  robots: { index: false, follow: false },
};

// Page-level guard is enforced by middleware (/admin/* requires a signed
// admin cookie) AND again on every admin API endpoint (live DB admin check).
// This layout renders the console frame with section navigation.
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
