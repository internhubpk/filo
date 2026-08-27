'use client'

import React, { useState } from 'react'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import { useFiloSession } from '@/hooks/use-session'

// User interface
interface UserData {
  id: string
  name: string
  email: string
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // HYDRATION-SAFE: session is read through the shared external store, so the
  // hydration render matches the server HTML exactly and the persisted user
  // (if any) is applied right after mount as a normal update. This replaces a
  // synchronous localStorage read inside useState — the root cause of React
  // error #418 on every dashboard route for logged-in users.
  const storedUser = useFiloSession().user

  // Kept so the mobile toggle button in Header stays wired up.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const userData: UserData | null = storedUser as UserData | null

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar - hidden on mobile unless toggled */}
      <Sidebar userData={userData} />

      {/* Main content area */}
      <div className="lg:pl-64">
        {/* Header */}
        <Header
          onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
          userData={userData}
        />

        {/* Page content */}
        <main className="p-6 pt-4">
          {children}
        </main>
      </div>
    </div>
  )
}
