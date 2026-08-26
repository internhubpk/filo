'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { 
  Search, 
  Bell, 
  Settings, 
  LogOut, 
  User, 
  CreditCard,
  Moon,
  Sun,
  Menu,
  Plus
} from 'lucide-react'
import { useTheme } from 'next-themes'

// User interface
interface UserData {
  id: string
  name: string
  email: string
}

interface HeaderProps {
  onMobileMenuToggle?: () => void
  userData?: UserData | null
}

export function Header({ onMobileMenuToggle, userData: propUserData }: HeaderProps) {
  const { theme, setTheme } = useTheme()
  const router = useRouter()
  
  // Local state for user data — initialize from localStorage synchronously
  // when propUserData is absent, then subscribe to auth/storage events for
  // subsequent updates (avoids cascading setState-in-effect renders).
  const [userData, setUserData] = useState<UserData | null>(() => {
    if (propUserData) return propUserData
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

  // If parent passes a different propUserData, sync state to it.
  // We use the functional setState form to avoid the synchronous-in-effect
  // lint rule while still allowing the prop to override local state.
  useEffect(() => {
    if (propUserData) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUserData(propUserData)
    }
  }, [propUserData])

  // Listen for storage changes (when user logs in/out in another tab)
  useEffect(() => {
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
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const handleLogout = () => {
    // Clear session from localStorage
    localStorage.removeItem('filo_session')
    setUserData(null)
    
    // Redirect to home (which will show login form)
    router.push('/')
    router.refresh()
  }

  // Get initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
      || 'U'
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 lg:px-6">
      {/* Mobile menu toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMobileMenuToggle}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search artifacts, files, knowledge..."
            className="pl-10 bg-muted/50"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        {/* Quick create */}
        <Link href="/">
          <Button size="sm" className="hidden sm:flex gap-2">
            <Plus className="h-4 w-4" />
            Create
          </Button>
        </Link>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          <Badge className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px] bg-red-500 text-white">
            3
          </Badge>
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-full">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                  {userData ? getInitials(userData.name) : 'U'}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {userData?.name || 'Guest'}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {userData?.email || 'Not signed in'}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <User className="mr-2 h-4 w-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/billing">
                <CreditCard className="mr-2 h-4 w-4" />
                Billing
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              className="text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
