import { AdminShell } from "@/components/admin/admin-shell";

// =============================================================================
// ADMIN CONSOLE LAYOUT — mounts the shared admin navbar frame around every
// console section (overview, users, subscriptions, payments, plans, webhooks,
// audit). /admin/login lives OUTSIDE this group on purpose: the login screen
// renders its own centered chrome.
// Route access is enforced by middleware (signed admin cookie) AND re-verified
// against the live DB admin flag on every admin API endpoint.
// =============================================================================

export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
