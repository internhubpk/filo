'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { 
  LayoutDashboard, 
  FileText, 
  Table, 
  Presentation,
  FolderOpen,
  Settings,
  HelpCircle,
  LogOut,
  Menu,
  X,
  Sparkles,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { useFiloSession, type SessionUser } from '@/hooks/use-session'
import { apiClient } from '@/lib/api-client'

// User interface
interface UserData {
  id: string
  name: string
  email: string
}

interface SidebarProps {
  className?: string
  userData?: UserData | null
}

const mainNavItems = [
  {
    title: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    badge: null,
  },
  {
    title: 'Documents',
    href: '/documents',
    icon: FileText,
    badge: null,
  },
  {
    title: 'Spreadsheets',
    href: '/spreadsheets',
    icon: Table,
    badge: null,
  },
  {
    title: 'Presentations',
    href: '/presentations',
    icon: Presentation,
    badge: null,
  },
  {
    title: 'Files',
    href: '/files',
    icon: FolderOpen,
    badge: null,
  },
]

const secondaryNavItems = [
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
  },
  {
    title: 'Help',
    href: '/help',
    icon: HelpCircle,
  },
]

function SidebarContent({ 
  collapsed, 
  pathname, 
  onCloseMobile,
  userData 
}: { 
  collapsed: boolean; 
  pathname: string; 
  onCloseMobile?: () => void;
  userData?: UserData | null;
}) {
  const router = useRouter()

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

  const handleLogout = () => {
    // Clear session via the API client so subscribers of the shared
    // session store (header, layout, other tabs) update too.
    apiClient.clearSession()

    // Redirect to home
    router.push('/')
    router.refresh()

    // Close mobile menu if open
    if (onCloseMobile) {
      onCloseMobile()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn(
        "flex h-16 items-center border-b px-4",
        collapsed ? "justify-center" : "gap-2"
      )}>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="text-xl font-bold tracking-tight">Filo</span>
          )}
        </div>
        
        {/* Mobile close button */}
        {onCloseMobile && (
          <button
            className="ml-auto lg:hidden"
            onClick={onCloseMobile}
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Main Navigation */}
      <ScrollArea className="flex-1 px-3 py-2">
        <nav className="space-y-1">
          {mainNavItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/' && pathname.startsWith(item.href))
            
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive 
                    ? "bg-accent text-accent-foreground" 
                    : "text-muted-foreground",
                  collapsed && "justify-center px-2"
                )}
                title={collapsed ? item.title : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.title}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Secondary Navigation */}
        <div className="mt-8">
          <p className={cn(
            "mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
            collapsed && "text-center"
          )}>
            {!collapsed ? 'Account' : '...'}
          </p>
          <nav className="space-y-1">
            {secondaryNavItems.map((item) => {
              const isActive = pathname === item.href
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onCloseMobile}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                    isActive 
                      ? "bg-accent text-accent-foreground" 
                      : "text-muted-foreground",
                    collapsed && "justify-center px-2"
                  )}
                  title={collapsed ? item.title : undefined}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.title}</span>}
                </Link>
              )
            })}
          </nav>
        </div>
      </ScrollArea>

      {/* User section */}
      <div className={cn(
        "border-t p-4",
        collapsed ? "flex justify-center" : ""
      )}>
        <div className={cn("flex items-center gap-3", collapsed && "flex-col")}>
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
              {userData ? getInitials(userData.name) : 'U'}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {userData?.name || 'Guest'}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {userData?.email || 'Not signed in'}
              </p>
            </div>
          )}
          
          {/* Logout button when not collapsed */}
          {!collapsed && userData && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleLogout}
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function Sidebar({ className, userData: propUserData }: SidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // HYDRATION-SAFE session via shared external store (see src/hooks/use-session.ts).
  // Applied as a post-mount update so SSR HTML always matches hydration.
  const storedUser = useFiloSession().user
  const userData: UserData | SessionUser | null = propUserData ?? storedUser

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform bg-background border-r transition-transform duration-300 ease-in-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent 
          collapsed={false} 
          pathname={pathname} 
          onCloseMobile={() => setMobileOpen(false)}
          userData={userData}
        />
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:block relative border-r bg-background transition-all duration-300",
          collapsed ? "w-[70px]" : "w-64",
          className
        )}
      >
        <SidebarContent 
          collapsed={collapsed} 
          pathname={pathname} 
          userData={userData}
        />
        
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 hidden h-6 w-6 items-center justify-center rounded-full border bg-background shadow-md lg:flex"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </button>
      </aside>

      {/* Mobile menu button */}
      {!mobileOpen && (
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed left-4 top-4 z-30 rounded-lg bg-background p-2 shadow-md lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}
    </>
  )
}
