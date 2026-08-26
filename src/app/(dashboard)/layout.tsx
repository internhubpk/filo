'use client'

import React, { useState, useEffect } from 'react'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'

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
  // Read initial session from localStorage synchronously during state
  // initialization so we don't trigger a cascading setState-in-effect render.
  // The useEffect below subscribes to auth/storage events for subsequent updates.
  const [userData, setUserData] = useState<UserData | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const sessionData = localStorage.getItem('filo_session')
      if (sessionData) {
        const session = JSON.parse(sessionData)
        return session?.user || null
      }
    } catch (e) {
      console.error('Failed to load user session:', e)
    }
    return null
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Subscribe to auth state changes (after mount)
  useEffect(() => {

    // Listen for auth state changes
    const handleStorageChange = () => {
      try {
        const sessionData = localStorage.getItem('filo_session')
        if (sessionData) {
          const session = JSON.parse(sessionData)
          setUserData(session.user || null)
        } else {
          setUserData(null)
        }
      } catch (e) {
        console.error('Failed to parse updated session:', e)
      }
    }

    window.addEventListener('storage', handleStorageChange)
    
    // Also listen for custom auth events (from login/signup)
    const handleAuthChange = (event: CustomEvent) => {
      if (event.detail?.user) {
        setUserData(event.detail.user)
      } else if (event.detail === 'logout') {
        setUserData(null)
      }
    }

    window.addEventListener('authStateChanged', handleAuthChange as EventListener)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('authStateChanged', handleAuthChange as EventListener)
    }
  }, [])

  // Dispatch auth state when userData changes (for child components)
  useEffect(() => {
    if (userData) {
      window.dispatchEvent(new CustomEvent('authStateUpdated', { detail: { user: userData } }))
    }
  }, [userData])

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
