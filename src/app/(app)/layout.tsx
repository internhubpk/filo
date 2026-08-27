import { AppShell } from "@/components/layout/app-shell";

// Authenticated product surface. AppShell performs the client-side session
// guard (redirect to /login when unauthenticated) and renders the sidebar /
// header / command palette frame around every page below.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
