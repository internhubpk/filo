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
  const [userData, setUserData] = useState<UserData | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Load user data from localStorage on mount
  useEffect(() => {
    try {
      const sessionData = localStorage.getItem('filo_session')
      if (sessionData) {
        const session = JSON.parse(sessionData)
        if (session.user) {
          setUserData(session.user)
        }
      }
    } catch (e) {
      console.error('Failed to load user session:', e)
    }

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
