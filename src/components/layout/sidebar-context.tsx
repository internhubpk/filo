"use client";

// =============================================================================
// SidebarContext — the single workspace sidebar's controller.
// =============================================================================
// The sidebar belongs to the AppShell (nav + history + account in ONE panel,
// closed by default). Anything rendered inside the shell — the chat header's
// menu/toggle buttons, pages, widgets — can open/close/toggle it through
// `useSidebar()` instead of owning duplicate panel state.
//
// The provider is always mounted by AppShell; the hook's fallback keeps
// isolated renders (tests, storybook) from crashing.
// =============================================================================

import { createContext, useContext } from "react";

export interface SidebarController {
  /** Whether the sidebar is currently open (expanded on desktop, sheet on mobile). */
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const noop = () => {};

export const SidebarContext = createContext<SidebarController>({
  open: false,
  setOpen: noop,
  toggle: noop,
});

export function useSidebar(): SidebarController {
  return useContext(SidebarContext);
}
