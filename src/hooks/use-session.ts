'use client'

// =============================================================================
// useFiloSession — hydration-safe session store
// =============================================================================
// Reads the persisted localStorage session (`filo_session`) through
// useSyncExternalStore, which is React's canonical way to subscribe to
// external state:
//
//   • SSR / prerender   → getServerSnapshot() returns a stable empty snapshot,
//     so server HTML and the first client render MATCH (no React error #418
//     "text content does not match", which previously escalated to Next.js'
//     generic "Application error" screen).
//   • After mount       → React re-checks the client snapshot and updates if
//     a session exists — as a normal, legal post-hydration update.
//   • Live updates      → re-reads on `storage` events (other tabs) and on
//     `authStateChanged` custom events dispatched by ApiClient.storeSession /
//     clearSession on login/logout.
//
// Snapshots are cached per raw localStorage string so repeated reads return
// referentially-stable objects (a useSyncExternalStore requirement).
//
// This hook REPLACES the duplicated useState+useEffect localStorage loaders
// that used to live in (dashboard)/layout.tsx, header.tsx and sidebar.tsx.
// =============================================================================

import { useSyncExternalStore } from 'react'

export interface SessionUser {
  id: string
  name: string
  email: string
  status?: 'pending_activation' | 'active' | 'suspended'
  planId?: string | null
}

interface SessionSnapshot {
  user: SessionUser | null
  raw: string
}

const EMPTY_SNAPSHOT: SessionSnapshot = { user: null, raw: '' }

let cachedSnapshot: SessionSnapshot = EMPTY_SNAPSHOT

function readSnapshot(): SessionSnapshot {
  const raw = window.localStorage.getItem('filo_session') ?? ''
  if (raw !== cachedSnapshot.raw) {
    let user: SessionUser | null = null
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        user = parsed?.user ?? null
      } catch (e) {
        console.error('Failed to load user session:', e)
      }
    }
    cachedSnapshot = { user, raw }
  }
  return cachedSnapshot
}

function getServerSnapshot(): SessionSnapshot {
  return EMPTY_SNAPSHOT
}

function subscribe(onStoreChange: () => void): () => void {
  // Cross-tab changes
  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === 'filo_session') onStoreChange()
  }
  window.addEventListener('storage', handleStorage)

  // Same-tab login/logout notifications from ApiClient
  window.addEventListener('authStateChanged', onStoreChange)

  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener('authStateChanged', onStoreChange)
  }
}

/**
 * Subscribe to the persisted Filo session.
 * Returns `{ user }` where `user` is `null` during SSR/prerender and for
 * logged-out visitors. Never triggers hydration mismatches.
 */
export function useFiloSession(): { user: SessionUser | null } {
  return useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot)
}

/**
 * Hydration-safe `window.location.hostname`.
 * Returns '' on the server/first render, then the real hostname once mounted.
 */
export function useHostname(): string {
  const subscribeNoop = () => () => {}
  const getClientHostname = () => window.location.hostname
  return useSyncExternalStore(subscribeNoop, getClientHostname, () => '')
}
