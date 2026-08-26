'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  MoreVertical,
  Crown,
  Users,
  Building2,
  ArrowLeft,
  Settings2,
  Save,
  X,
  Check,
  AlertCircle,
  RefreshCw,
  Copy,
  Sun,
  Moon,
  Star,
  LogOut,
  Shield,
  Loader2,
  Wifi,
  WifiOff,
  UserCheck,
  UserX,
  Clock,
  Send,
  ExternalLink
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@convex/_generated/api'
import { Id } from '../../../convex/_generated/dataModel'
import { apiClient } from '@/lib/api-client'

// Icon mapping for plan icons
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Crown,
  Users,
  Building2,
}

// Plan display interface (matches Convex schema)
interface PlanDisplay {
  _id: Id<'plans'>
  name: string
  description: string
  priceMonthly: number
  priceYearly: number
  features: string[]
  limitations: string[]
  popular: boolean
  active: boolean
  maxAiGenerations: number
  maxStorageMb: number
  icon: string
  order: number
  createdAt?: number
  updatedAt?: number
}

// Form data interface for create/edit
interface PlanFormData {
  name: string
  description: string
  priceMonthly: number
  priceYearly: number
  features: string[]
  limitations: string[]
  popular: boolean
  active: boolean
  maxAiGenerations: number
  maxStorageMb: number
  icon: string
  order: number
}

// Empty form template
const emptyForm: PlanFormData = {
  name: '',
  description: '',
  priceMonthly: 0,
  priceYearly: 0,
  features: [],
  limitations: [],
  popular: false,
  active: true,
  maxAiGenerations: 0,
  maxStorageMb: 0,
  icon: 'Crown',
  order: 0,
}

export default function AdminPage() {
  const { theme, setTheme } = useTheme()

  // REAL Convex queries - fetching actual data from database
  const plans = useQuery(api.plans.getAllPlans) as PlanDisplay[] | undefined

  // REAL Convex mutations for CRUD operations
  const createPlan = useMutation(api.admin.createPlan)
  const updatePlan = useMutation(api.admin.updatePlan)
  const deletePlan = useMutation(api.admin.deletePlan)

  // UI State
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<PlanDisplay | null>(null)
  const [formData, setFormData] = useState<PlanFormData>({ ...emptyForm })
  const [newFeature, setNewFeature] = useState('')
  const [newLimitation, setNewLimitation] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [planToDelete, setPlanToDelete] = useState<PlanDisplay | null>(null)

  // ===== Manual activation flow state =====
  // Active tab: "plans" (legacy plan management) or "verifications"
  // (manual payment verification + user activation).
  const [activeTab, setActiveTab] = useState<'plans' | 'verifications'>('plans')

  // Verifications data - fetched from /api/admin/verifications (cookie-auth)
  interface AdminVerification {
    _id: string
    userId: string
    planId?: string
    amount: number
    currency: string
    paymentMethod: string
    transactionId: string
    proofUrl?: string
    notes?: string
    status: 'pending' | 'approved' | 'rejected'
    reviewedBy?: string
    reviewedAt?: number
    adminNote?: string
    createdAt: number
    updatedAt: number
  }
  interface AdminUser {
    id: string
    name: string
    email: string
    role: 'admin' | 'user'
    status: 'pending_activation' | 'active' | 'suspended'
    planId: string | null
    activatedAt: number | null
    activationNote: string | null
    createdAt: number
    updatedAt: number
  }
  const [verifications, setVerifications] = useState<AdminVerification[]>([])
  const [allUsers, setAllUsers] = useState<AdminUser[]>([])
  const [verificationsLoading, setVerificationsLoading] = useState(false)
  const [verificationsError, setVerificationsError] = useState<string | null>(null)
  const [verificationsFilter, setVerificationsFilter] = useState<'pending' | 'all'>('pending')

  // Approve/reject dialog state
  const [reviewDialog, setReviewDialog] = useState<{
    open: boolean
    verification: AdminVerification | null
    action: 'approve' | 'reject'
    adminNote: string
  }>({ open: false, verification: null, action: 'approve', adminNote: '' })

  // Manual activate-by-user dialog state (admin can also bypass verifications
  // and activate a user directly without a payment submission)
  const [userActionDialog, setUserActionDialog] = useState<{
    open: boolean
    user: AdminUser | null
    action: 'activate' | 'suspend'
    note: string
  }>({ open: false, user: null, action: 'activate', note: '' })

  // Fetch the verifications list + all users list from the admin API.
  const refreshVerifications = async () => {
    setVerificationsLoading(true)
    setVerificationsError(null)
    try {
      const [verifResp, usersResp] = await Promise.all([
        apiClient.adminListVerifications(verificationsFilter),
        apiClient.adminListUsers(),
      ])
      if (verifResp.success && verifResp.data) {
        setVerifications(verifResp.data as AdminVerification[])
      } else {
        setVerificationsError(verifResp.error || 'Failed to load verifications')
      }
      if (usersResp.success && usersResp.data) {
        setAllUsers((usersResp.data as any).all ?? [])
      }
    } catch (err: any) {
      setVerificationsError(err.message || 'Failed to load admin data')
    } finally {
      setVerificationsLoading(false)
    }
  }

  // Load verifications on first tab open and whenever filter changes
  useEffect(() => {
    if (activeTab === 'verifications') {
      refreshVerifications()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, verificationsFilter])

  // Show notification helper
  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 4000)
  }

  // ===== Verification review handlers (manual activation flow) =====

  // Approve a payment verification. This unlocks the user's account
  // so they can immediately perform AI generation.
  const handleApproveVerification = async () => {
    if (!reviewDialog.verification) return
    setIsSaving(true)
    try {
      const v = reviewDialog.verification
      const resp = await apiClient.adminApproveVerification(
        v._id,
        reviewDialog.adminNote.trim() || undefined,
      )
      if (!resp.success) {
        showNotification('error', resp.error || 'Failed to approve verification')
      } else {
        showNotification('success', `Approved ${v.transactionId} - user activated`)
        // Optimistically update the local list
        setVerifications(prev =>
          prev.map(x => x._id === v._id ? { ...x, status: 'approved', adminNote: reviewDialog.adminNote, reviewedAt: Date.now() } : x)
        )
        // Refresh to pull fresh user status too
        await refreshVerifications()
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to approve verification')
    } finally {
      setIsSaving(false)
      setReviewDialog({ open: false, verification: null, action: 'approve', adminNote: '' })
    }
  }

  // Reject a payment verification with a reason. The user remains in
  // their current status (typically pending_activation) and the reason
  // is surfaced back to them on /billing so they can re-submit.
  const handleRejectVerification = async () => {
    if (!reviewDialog.verification) return
    if (!reviewDialog.adminNote.trim()) {
      showNotification('error', 'A reason is required when rejecting a verification')
      return
    }
    setIsSaving(true)
    try {
      const v = reviewDialog.verification
      const resp = await apiClient.adminRejectVerification(
        v._id,
        reviewDialog.adminNote.trim(),
      )
      if (!resp.success) {
        showNotification('error', resp.error || 'Failed to reject verification')
      } else {
        showNotification('success', `Rejected ${v.transactionId} - reason sent to user`)
        setVerifications(prev =>
          prev.map(x => x._id === v._id ? { ...x, status: 'rejected', adminNote: reviewDialog.adminNote, reviewedAt: Date.now() } : x)
        )
        await refreshVerifications()
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to reject verification')
    } finally {
      setIsSaving(false)
      setReviewDialog({ open: false, verification: null, action: 'approve', adminNote: '' })
    }
  }

  // Toggle user role (admin ↔ user)
  const handleToggleRole = async (user: AdminUser) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin'
    const actionText = newRole === 'admin' ? 'promote to admin' : 'demote from admin'
    if (!confirm(`Are you sure you want to ${actionText} ${user.name} (${user.email})?`)) return

    setIsSaving(true)
    try {
      const resp = await fetch(`/api/admin/users/${user.id}/set-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      const data = await resp.json()
      if (!data.success) {
        showNotification('error', data.error || `Failed to ${actionText}`)
      } else {
        showNotification('success', `${user.name} is now ${newRole}${newRole === 'admin' ? ' (auto-activated)' : ''}`)
        await refreshVerifications()
      }
    } catch (err: any) {
      showNotification('error', err.message || `Failed to ${actionText}`)
    } finally {
      setIsSaving(false)
    }
  }

  // Direct user status management (bypassing the verification flow).
  // Useful for granting access to internal/team users or revoking access.
  const handleUserAction = async () => {
    if (!userActionDialog.user) return
    setIsSaving(true)
    try {
      const u = userActionDialog.user
      const resp = userActionDialog.action === 'activate'
        ? await apiClient.adminActivateUser(u.id, { note: userActionDialog.note.trim() || undefined })
        : await apiClient.adminSuspendUser(u.id, userActionDialog.note.trim() || undefined)
      if (!resp.success) {
        showNotification('error', resp.error || `Failed to ${userActionDialog.action} user`)
      } else {
        showNotification('success', `${u.email} ${userActionDialog.action === 'activate' ? 'activated' : 'suspended'}`)
        await refreshVerifications()
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to update user')
    } finally {
      setIsSaving(false)
      setUserActionDialog({ open: false, user: null, action: 'activate', note: '' })
    }
  }

  // Logout handler
  const handleLogout = async () => {
    try { await fetch('/api/auth/admin/logout', { method: 'DELETE' }) }
    catch (e) { console.error(e) }
    window.location.href = '/admin/login'
  }

  // CREATE: Open dialog for new plan
  const handleCreate = () => {
    setEditingPlan(null)
    setFormData({ ...emptyForm, features: [] })
    setNewFeature('')
    setNewLimitation('')
    setIsDialogOpen(true)
  }

  // EDIT: Open dialog with existing plan data
  const handleEdit = (plan: PlanDisplay) => {
    setEditingPlan(plan)
    setFormData({
      name: plan.name,
      description: plan.description || '',
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      features: [...(plan.features || [])],
      limitations: [...(plan.limitations || [])],
      popular: plan.popular || false,
      active: plan.active !== false,
      maxAiGenerations: plan.maxAiGenerations || 0,
      maxStorageMb: plan.maxStorageMb || 0,
      icon: plan.icon || 'Crown',
      order: plan.order || 0,
    })
    setNewFeature('')
    setNewLimitation('')
    setIsDialogOpen(true)
  }

  // DELETE: Confirm deletion
  const confirmDelete = (plan: PlanDisplay) => {
    setPlanToDelete(plan)
    setDeleteConfirmOpen(true)
  }

  // EXECUTE DELETE: Call real Convex mutation
  const executeDelete = async () => {
    if (!planToDelete?._id) return
    
    try {
      setIsSaving(true)
      await deletePlan({ planId: planToDelete._id })
      showNotification('success', `Deleted "${planToDelete.name}"`)
      setDeleteConfirmOpen(false)
      setPlanToDelete(null)
    } catch (error: unknown) {
      const err = error as Error
      showNotification('error', err.message || 'Failed to delete plan')
    } finally {
      setIsSaving(false)
    }
  }

  // DUPLICATE: Create copy of existing plan
  const handleDuplicate = (plan: PlanDisplay) => {
    setEditingPlan(null)
    setFormData({
      name: `${plan.name} (Copy)`,
      description: plan.description || '',
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      features: [...(plan.features || [])],
      limitations: [...(plan.limitations || [])],
      popular: false,
      active: true,
      maxAiGenerations: plan.maxAiGenerations || 0,
      maxStorageMb: plan.maxStorageMb || 0,
      icon: plan.icon || 'Crown',
      order: (plan.order || 0) + 1,
    })
    setIsDialogOpen(true)
    showNotification('success', `Duplicated "${plan.name}" - ready to save`)
  }

  // SAVE: Real Convex mutation for create or update
  const handleSave = async () => {
    if (!formData.name.trim()) {
      showNotification('error', 'Plan name is required')
      return
    }

    setIsSaving(true)
    
    try {
      if (editingPlan?._id) {
        // UPDATE existing plan via Convex
        await updatePlan({
          planId: editingPlan._id,
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          priceMonthly: formData.priceMonthly,
          priceYearly: formData.priceYearly,
          currency: 'PKR',
          features: formData.features.filter(f => f.trim()),
          limitations: formData.limitations?.filter(l => l.trim()) || [],
          popular: formData.popular,
          active: formData.active,
          maxAiGenerations: formData.maxAiGenerations,
          maxStorageMb: formData.maxStorageMb,
          icon: formData.icon,
          order: formData.order,
        })
        showNotification('success', `"${formData.name}" updated successfully`)
      } else {
        // CREATE new plan via Convex
        await createPlan({
          name: formData.name.trim(),
          description: formData.description.trim(),
          priceMonthly: formData.priceMonthly,
          priceYearly: formData.priceYearly,
          currency: 'PKR',
          features: formData.features.filter(f => f.trim()),
          limitations: formData.limitations?.filter(l => l.trim()) || [],
          popular: formData.popular,
          active: formData.active,
          maxAiGenerations: formData.maxAiGenerations,
          maxStorageMb: formData.maxStorageMb,
          icon: formData.icon,
          order: formData.order,
        })
        showNotification('success', `"${formData.name}" created successfully`)
      }
      
      setIsDialogOpen(false)
      setEditingPlan(null)
      setFormData({ ...emptyForm })
    } catch (error: unknown) {
      const err = error as Error
      showNotification('error', err.message || 'Failed to save plan')
    } finally {
      setIsSaving(false)
    }
  }

  // TOGGLE STATUS: Update active/inactive via Convex
  const toggleStatus = async (plan: PlanDisplay) => {
    if (!plan._id) return
    
    try {
      await updatePlan({
        planId: plan._id,
        active: !plan.active,
      })
      showNotification('success', `"${plan.name}" ${!plan.active ? 'activated' : 'deactivated'}`)
    } catch (error: unknown) {
      const err = error as Error
      showNotification('error', err.message || 'Failed to update status')
    }
  }

  // TOGGLE POPULAR: Update popular flag via Convex
  const togglePopular = async (plan: PlanDisplay) => {
    if (!plan._id) return
    
    try {
      await updatePlan({
        planId: plan._id,
        popular: !plan.popular,
      })
      showNotification('success', `"${plan.name}" ${!plan.popular ? 'marked as popular' : 'unmarked as popular'}`)
    } catch (error: unknown) {
      const err = error as Error
      showNotification('error', err.message || 'Failed to update popularity')
    }
  }

  // Feature management helpers
  const addFeature = () => {
    if (newFeature.trim()) {
      setFormData(prev => ({ ...prev, features: [...prev.features, newFeature.trim()] }))
      setNewFeature('')
    }
  }

  const removeFeature = (idx: number) => {
    setFormData(prev => ({ ...prev, features: prev.features.filter((_, i) => i !== idx) }))
  }

  const addLimitation = () => {
    if (newLimitation.trim()) {
      setFormData(prev => ({ ...prev, limitations: [...(prev.limitations || []), newLimitation.trim()] }))
      setNewLimitation('')
    }
  }

  const removeLimitation = (idx: number) => {
    setFormData(prev => ({ ...prev, limitations: prev.limitations?.filter((_, i) => i !== idx) || [] }))
  }

  // Loading state while Convex connects (only required for plans tab;
  // verifications tab fetches its own data via the admin API).
  if (activeTab === 'plans' && plans === undefined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Connecting to database...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 md:gap-4">
            <Link href="/" className="flex items-center gap-2 md:gap-3 hover:opacity-80 transition-opacity cursor-pointer">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-lg md:text-xl font-bold tracking-tight">Filo</span>
            </Link>
            <Separator orientation="vertical" className="h-8 hidden sm:block" />
            <div className="flex items-center gap-1 md:gap-2">
              <Settings2 className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground" />
              <span className="text-base md:text-lg font-semibold hidden sm:inline">Admin Dashboard</span>
              <span className="text-base md:text-lg font-semibold sm:hidden">Admin</span>
            </div>
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            {/* Connection Status Indicator */}
            <Badge variant="secondary" className="hidden sm:flex gap-1 cursor-default bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800 text-xs px-2 py-0.5">
              <Wifi className="h-3 w-3" /> Connected
            </Badge>

            {/* Theme Toggle */}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
              className="cursor-pointer h-8 w-8 md:h-9 md:w-9"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>

            {/* Logout Button */}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleLogout} 
              className="gap-1.5 md:gap-2 cursor-pointer text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 border-red-200 dark:border-red-800 text-xs px-2 md:px-3 h-8 md:h-9"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>

            {/* Back to Site */}
            <Button variant="ghost" size="sm" asChild className="cursor-pointer gap-1.5 md:gap-2">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Back</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Notification Toast */}
      {notification && (
        <div className={`fixed top-20 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in slide-in-from-right max-w-sm mx-4 ${
          notification.type === 'success' 
            ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200' 
            : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
        }`}>
          {notification.type === 'success' ? <Check className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
          <span className="font-medium text-sm">{notification.message}</span>
        </div>
      )}

      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        {/* Tab Switcher */}
        <div className="flex items-center gap-2 mb-6 border-b">
          <button
            onClick={() => setActiveTab('plans')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-md transition-colors cursor-pointer ${
              activeTab === 'plans'
                ? 'bg-background text-foreground border border-b-0'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Settings2 className="h-4 w-4" />
            Plans
          </button>
          <button
            onClick={() => setActiveTab('verifications')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-md transition-colors cursor-pointer ${
              activeTab === 'verifications'
                ? 'bg-background text-foreground border border-b-0'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <UserCheck className="h-4 w-4" />
            User Verifications
            {verifications.filter(v => v.status === 'pending').length > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs cursor-default">
                {verifications.filter(v => v.status === 'pending').length}
              </Badge>
            )}
          </button>
        </div>

        {/* ===== VERIFICATIONS TAB ===== */}
        {activeTab === 'verifications' && (
          <div className="space-y-6">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight">User Verifications</h2>
                <p className="text-muted-foreground mt-1 text-sm md:text-base">
                  Review payment submissions and activate user accounts
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Pending / All filter */}
                <Select
                  value={verificationsFilter}
                  onValueChange={(v) => setVerificationsFilter(v as 'pending' | 'all')}
                >
                  <SelectTrigger className="w-[140px] cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending" className="cursor-pointer">Pending only</SelectItem>
                    <SelectItem value="all" className="cursor-pointer">All submissions</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshVerifications}
                  disabled={verificationsLoading}
                  className="gap-2 cursor-pointer"
                >
                  <RefreshCw className={`h-4 w-4 ${verificationsLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>

            {verificationsError && (
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg p-4 text-sm">
                <AlertCircle className="h-4 w-4 inline mr-2" />
                {verificationsError}
              </div>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
              <Card className="p-3 md:p-6">
                <CardContent className="pt-0 p-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Users</p>
                      <p className="text-xl md:text-2xl font-bold">{allUsers.length}</p>
                    </div>
                    <Users className="h-6 w-6 md:h-8 md:w-8 text-primary/30" />
                  </div>
                </CardContent>
              </Card>
              <Card className="p-3 md:p-6">
                <CardContent className="pt-0 p-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Pending</p>
                      <p className="text-xl md:text-2xl font-bold text-yellow-600">
                        {allUsers.filter(u => u.status === 'pending_activation').length}
                      </p>
                    </div>
                    <Clock className="h-6 w-6 md:h-8 md:w-8 text-yellow-500" />
                  </div>
                </CardContent>
              </Card>
              <Card className="p-3 md:p-6">
                <CardContent className="pt-0 p-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Active</p>
                      <p className="text-xl md:text-2xl font-bold text-green-600">
                        {allUsers.filter(u => u.status === 'active').length}
                      </p>
                    </div>
                    <Check className="h-6 w-6 md:h-8 md:w-8 text-green-600" />
                  </div>
                </CardContent>
              </Card>
              <Card className="p-3 md:p-6">
                <CardContent className="pt-0 p-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Suspended</p>
                      <p className="text-xl md:text-2xl font-bold text-red-600">
                        {allUsers.filter(u => u.status === 'suspended').length}
                      </p>
                    </div>
                    <UserX className="h-6 w-6 md:h-8 md:w-8 text-red-500" />
                  </div>
                </CardContent>
              </Card>
              <Card className="p-3 md:p-6">
                <CardContent className="pt-0 p-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Admins</p>
                      <p className="text-xl md:text-2xl font-bold text-purple-600">
                        {allUsers.filter(u => u.role === 'admin').length}
                      </p>
                    </div>
                    <Shield className="h-6 w-6 md:h-8 md:w-8 text-purple-500" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Verifications table */}
            <Card className="overflow-hidden">
              <CardHeader className="pb-4 px-4 md:px-6">
                <CardTitle className="text-base md:text-lg flex items-center gap-2">
                  Payment Verifications
                  <Badge variant="secondary" className="text-xs ml-2 cursor-default">
                    {verificationsFilter === 'pending' ? 'Pending' : 'All'}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Review each submission and approve (activates user) or reject (with reason)
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0 md:px-6 pb-0 md:pb-6">
                {verificationsLoading ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mt-3">Loading verifications...</p>
                  </div>
                ) : verifications.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                      <Check className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-medium mb-2">No {verificationsFilter === 'pending' ? 'pending ' : ''}submissions</h3>
                    <p className="text-muted-foreground text-sm">
                      {verificationsFilter === 'pending'
                        ? 'New payment submissions will appear here for your review.'
                        : 'No payment verifications have been submitted yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">User</TableHead>
                          <TableHead className="w-[160px]">Transaction</TableHead>
                          <TableHead className="w-[120px]">Amount</TableHead>
                          <TableHead className="w-[120px]">Method</TableHead>
                          <TableHead className="w-[100px]">Status</TableHead>
                          <TableHead className="w-[120px]">Submitted</TableHead>
                          <TableHead className="w-[180px] text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {verifications.map((v) => {
                          const user = allUsers.find(u => u.id === v.userId)
                          return (
                            <TableRow key={v._id}>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium text-sm">{user?.name ?? 'Unknown user'}</span>
                                  <span className="text-xs text-muted-foreground">{user?.email ?? v.userId}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-mono text-xs">{v.transactionId}</span>
                                  {v.notes && (
                                    <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                                      {v.notes}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="font-medium text-sm">
                                  {v.currency} {v.amount.toLocaleString()}
                                </span>
                              </TableCell>
                              <TableCell className="capitalize text-sm">
                                {v.paymentMethod.replace('_', ' ')}
                              </TableCell>
                              <TableCell>
                                {v.status === 'approved' ? (
                                  <Badge className="bg-green-600 cursor-default">approved</Badge>
                                ) : v.status === 'rejected' ? (
                                  <Badge variant="destructive" className="cursor-default">rejected</Badge>
                                ) : (
                                  <Badge variant="secondary" className="cursor-default">pending</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {new Date(v.createdAt).toLocaleDateString('en-PK', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1.5">
                                  {v.proofUrl && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      asChild
                                      className="cursor-pointer h-8 w-8 p-0"
                                      title="View receipt"
                                    >
                                      <a href={v.proofUrl} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </a>
                                    </Button>
                                  )}
                                  {v.status === 'pending' && (
                                    <>
                                      <Button
                                        size="sm"
                                        className="gap-1.5 cursor-pointer h-8 text-xs"
                                        onClick={() => setReviewDialog({
                                          open: true,
                                          verification: v,
                                          action: 'approve',
                                          adminNote: '',
                                        })}
                                      >
                                        <Check className="h-3.5 w-3.5" /> Approve
                                      </Button>
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        className="gap-1.5 cursor-pointer h-8 text-xs"
                                        onClick={() => setReviewDialog({
                                          open: true,
                                          verification: v,
                                          action: 'reject',
                                          adminNote: '',
                                        })}
                                      >
                                        <X className="h-3.5 w-3.5" /> Reject
                                      </Button>
                                    </>
                                  )}
                                  {v.status !== 'pending' && v.adminNote && (
                                    <span className="text-xs text-muted-foreground italic max-w-[160px] truncate">
                                      "{v.adminNote}"
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Mobile cards view */}
                {!verificationsLoading && verifications.length > 0 && (
                  <div className="md:hidden space-y-3 px-4 pb-4">
                    {verifications.map((v) => {
                      const user = allUsers.find(u => u.id === v.userId)
                      return (
                        <Card key={v._id} className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="font-medium text-sm">{user?.name ?? 'Unknown user'}</div>
                              <div className="text-xs text-muted-foreground">{user?.email ?? v.userId}</div>
                            </div>
                            {v.status === 'approved' ? (
                              <Badge className="bg-green-600 cursor-default">approved</Badge>
                            ) : v.status === 'rejected' ? (
                              <Badge variant="destructive" className="cursor-default">rejected</Badge>
                            ) : (
                              <Badge variant="secondary" className="cursor-default">pending</Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                            <div>
                              <div className="text-muted-foreground text-xs">Transaction</div>
                              <div className="font-mono text-xs">{v.transactionId}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground text-xs">Amount</div>
                              <div className="font-medium">{v.currency} {v.amount.toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground text-xs">Method</div>
                              <div className="font-medium capitalize">{v.paymentMethod.replace('_', ' ')}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground text-xs">Submitted</div>
                              <div className="font-medium text-xs">
                                {new Date(v.createdAt).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' })}
                              </div>
                            </div>
                          </div>
                          {v.adminNote && (
                            <div className="text-xs italic text-muted-foreground bg-muted/50 p-2 rounded mb-3">
                              "{v.adminNote}"
                            </div>
                          )}
                          {v.status === 'pending' && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="gap-1.5 cursor-pointer flex-1"
                                onClick={() => setReviewDialog({
                                  open: true,
                                  verification: v,
                                  action: 'approve',
                                  adminNote: '',
                                })}
                              >
                                <Check className="h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="gap-1.5 cursor-pointer flex-1"
                                onClick={() => setReviewDialog({
                                  open: true,
                                  verification: v,
                                  action: 'reject',
                                  adminNote: '',
                                })}
                              >
                                <X className="h-3.5 w-3.5" /> Reject
                              </Button>
                            </div>
                          )}
                        </Card>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* All users table - direct activate/suspend */}
            <Card className="overflow-hidden">
              <CardHeader className="pb-4 px-4 md:px-6">
                <CardTitle className="text-base md:text-lg flex items-center gap-2">
                  All Users
                  <Badge variant="secondary" className="text-xs ml-2 cursor-default">
                    {allUsers.length} total
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Direct account management (bypasses the verification flow)
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0 md:px-6 pb-0 md:pb-6">
                {allUsers.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground opacity-50 mb-3" />
                    <p className="text-sm text-muted-foreground">No users yet</p>
                  </div>
                ) : (
                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[200px]">Name</TableHead>
                          <TableHead className="w-[220px]">Email</TableHead>
                          <TableHead className="w-[80px]">Role</TableHead>
                          <TableHead className="w-[120px]">Status</TableHead>
                          <TableHead className="w-[100px]">Plan</TableHead>
                          <TableHead className="w-[120px]">Activated</TableHead>
                          <TableHead className="w-[250px] text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allUsers.map((u) => (
                          <TableRow key={u.id} className={u.role === 'admin' ? 'bg-primary/5' : ''}>
                            <TableCell className="font-medium text-sm">{u.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                            <TableCell>
                              {u.role === 'admin' ? (
                                <Badge className="bg-purple-600 cursor-default gap-1">
                                  <Shield className="h-3 w-3" /> admin
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="cursor-default text-xs">user</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {u.status === 'active' ? (
                                <Badge className="bg-green-600 cursor-default">active</Badge>
                              ) : u.status === 'suspended' ? (
                                <Badge variant="destructive" className="cursor-default">suspended</Badge>
                              ) : (
                                <Badge variant="secondary" className="cursor-default">pending</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{u.planId ?? '—'}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {u.activatedAt ? new Date(u.activatedAt).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' }) : '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1.5 flex-wrap">
                                {u.role !== 'admin' ? (
                                  <Button
                                    size="sm"
                                    variant={u.status === 'active' ? 'outline' : 'default'}
                                    disabled={u.status === 'active' || isSaving}
                                    className="gap-1.5 cursor-pointer h-8 text-xs"
                                    onClick={() => setUserActionDialog({
                                      open: true,
                                      user: u,
                                      action: 'activate',
                                      note: '',
                                    })}
                                  >
                                    <UserCheck className="h-3.5 w-3.5" /> Activate
                                  </Button>
                                ) : null}
                                {u.status !== 'suspended' && u.role !== 'admin' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isSaving}
                                    className="gap-1.5 cursor-pointer h-8 text-xs ml-1.5 text-red-600 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => setUserActionDialog({
                                      open: true,
                                      user: u,
                                      action: 'suspend',
                                      note: '',
                                    })}
                                  >
                                    <UserX className="h-3.5 w-3.5" /> Suspend
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant={u.role === 'admin' ? 'outline' : 'default'}
                                  disabled={isSaving}
                                  className={`gap-1.5 cursor-pointer h-8 text-xs ${u.role === 'admin' ? 'text-purple-700 border-purple-300 hover:bg-purple-50' : 'bg-purple-600 hover:bg-purple-700'}`}
                                  onClick={() => handleToggleRole(u)}
                                >
                                  <Shield className="h-3.5 w-3.5" /> {u.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===== PLANS TAB (legacy content) ===== */}
        {activeTab === 'plans' && (
          <>
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Plan Management</h2>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">
              {plans?.length ?? 0} plan{plans && plans.length !== 1 ? 's' : ''} configured in database
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {/* Create New Plan Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={handleCreate} className="gap-2 cursor-pointer text-xs md:text-sm" size="sm">
                  <Plus className="h-4 w-4" /> New Plan
                </Button>
              </DialogTrigger>
              
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-0">
                <DialogHeader>
                  <DialogTitle>{editingPlan ? 'Edit Plan' : 'Create Plan'}</DialogTitle>
                  <DialogDescription>
                    {editingPlan 
                      ? `Editing "${editingPlan.name}" - changes saved to database` 
                      : 'Configure a new subscription plan - saved to database'
                    }
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                  {/* Name & Icon Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="plan-name">Name *</Label>
                      <Input 
                        id="plan-name"
                        value={formData.name} 
                        onChange={(e) => setFormData({...formData, name: e.target.value})} 
                        placeholder="Pro, Team, Enterprise..." 
                        disabled={isSaving} 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plan-icon">Icon</Label>
                      <Select value={formData.icon} onValueChange={(v) => setFormData({...formData, icon: v})}>
                        <SelectTrigger id="plan-icon"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Crown">
                            <div className="flex items-center gap-2"><Crown className="h-4 w-4" /> Crown</div>
                          </SelectItem>
                          <SelectItem value="Users">
                            <div className="flex items-center gap-2"><Users className="h-4 w-4" /> Users</div>
                          </SelectItem>
                          <SelectItem value="Building2">
                            <div className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Building</div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <Label htmlFor="plan-desc">Description</Label>
                    <Textarea 
                      id="plan-desc"
                      value={formData.description} 
                      onChange={(e) => setFormData({...formData, description: e.target.value})} 
                      rows={2} 
                      disabled={isSaving}
                      placeholder="Brief description of this plan..."
                    />
                  </div>

                  {/* Pricing Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="price-monthly">Monthly Price (R)</Label>
                      <Input 
                        id="price-monthly"
                        type="number" 
                        value={formData.priceMonthly || ''} 
                        onChange={(e) => setFormData({...formData, priceMonthly: parseInt(e.target.value) || 0})} 
                        disabled={isSaving}
                        placeholder="190"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="price-yearly">Yearly Price (R)</Label>
                      <Input 
                        id="price-yearly"
                        type="number" 
                        value={formData.priceYearly || ''} 
                        onChange={(e) => setFormData({...formData, priceYearly: parseInt(e.target.value) || 0})} 
                        disabled={isSaving}
                        placeholder="1900"
                      />
                    </div>
                  </div>

                  {/* Limits Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ai-generations">AI Generations/mo</Label>
                      <Input 
                        id="ai-generations"
                        type="number" 
                        value={formData.maxAiGenerations || ''} 
                        onChange={(e) => setFormData({...formData, maxAiGenerations: parseInt(e.target.value) || 0})} 
                        disabled={isSaving}
                        placeholder="500 (-1 for unlimited)"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="storage">Storage (MB)</Label>
                      <Input 
                        id="storage"
                        type="number" 
                        value={formData.maxStorageMb || ''} 
                        onChange={(e) => setFormData({...formData, maxStorageMb: parseInt(e.target.value) || 0})} 
                        disabled={isSaving}
                        placeholder="5120 (-1 for unlimited)"
                      />
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={formData.active} 
                        onChange={(e) => setFormData({...formData, active: e.target.checked})} 
                        className="rounded border-input" 
                      />
                      <span className="text-sm">Active</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={formData.popular} 
                        onChange={(e) => setFormData({...formData, popular: e.target.checked})} 
                        className="rounded border-input" 
                      />
                      <span className="text-sm">Mark as Popular</span>
                    </label>
                  </div>

                  {/* Features List */}
                  <div className="space-y-2">
                    <Label>Features ({formData.features.length})</Label>
                    <div className="space-y-2">
                      {formData.features.map((f, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-muted p-2 rounded-md">
                          <Check className="h-4 w-4 text-green-600 shrink-0" />
                          <span className="flex-1 text-sm truncate">{f}</span>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => removeFeature(idx)} 
                            className="h-6 w-6 p-0 cursor-pointer hover:text-red-500" 
                            disabled={isSaving}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Input 
                          value={newFeature} 
                          onChange={(e) => setNewFeature(e.target.value)} 
                          placeholder="Add feature..." 
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())} 
                          className="flex-1" 
                          disabled={isSaving}
                        />
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={addFeature} 
                          disabled={!newFeature.trim() || isSaving} 
                          className="cursor-pointer shrink-0"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Limitations List */}
                  <div className="space-y-2">
                    <Label>Limitations ({formData.limitations?.length || 0})</Label>
                    <div className="space-y-2">
                      {(formData.limitations || []).map((l, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-muted p-2 rounded-md">
                          <X className="h-4 w-4 text-orange-500 shrink-0" />
                          <span className="flex-1 text-sm truncate text-muted-foreground">{l}</span>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => removeLimitation(idx)} 
                            className="h-6 w-6 p-0 cursor-pointer hover:text-red-500" 
                            disabled={isSaving}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Input 
                          value={newLimitation} 
                          onChange={(e) => setNewLimitation(e.target.value)} 
                          placeholder="Add limitation..." 
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLimitation())} 
                          className="flex-1" 
                          disabled={isSaving}
                        />
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={addLimitation} 
                          disabled={!newLimitation.trim() || isSaving} 
                          className="cursor-pointer shrink-0"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-end">
                  <Button 
                    variant="outline" 
                    onClick={() => setIsDialogOpen(false)} 
                    disabled={isSaving} 
                    className="w-full sm:w-auto cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleSave} 
                    disabled={isSaving || !formData.name.trim()} 
                    className="w-full sm:w-auto gap-2 cursor-pointer"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" /> {editingPlan ? 'Update Plan' : 'Create Plan'}
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats Cards - Real Data */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
          <Card className="p-3 md:p-6">
            <CardContent className="pt-0 p-0">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-muted-foreground">Total Plans</p>
                  <p className="text-xl md:text-2xl font-bold">{plans?.length ?? 0}</p>
                </div>
                <Settings2 className="h-6 w-6 md:h-8 md:w-8 text-primary/30" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="p-3 md:p-6">
            <CardContent className="pt-0 p-0">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-muted-foreground">Active</p>
                  <p className="text-xl md:text-2xl font-bold text-green-600">
                    {(plans ?? []).filter(p => p.active).length}
                  </p>
                </div>
                <Check className="h-6 w-6 md:h-8 md:w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="p-3 md:p-6">
            <CardContent className="pt-0 p-0">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-muted-foreground">Popular</p>
                  <p className="text-xl md:text-2xl font-bold text-yellow-600">
                    {(plans ?? []).find(p => p.popular)?.name || '-'}
                  </p>
                </div>
                <Star className="h-6 w-6 md:h-8 md:w-8 text-yellow-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="p-3 md:p-6">
            <CardContent className="pt-0 p-0">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-muted-foreground">Inactive</p>
                  <p className="text-xl md:text-2xl font-bold text-muted-foreground">
                    {(plans ?? []).filter(p => !p.active).length}
                  </p>
                </div>
                <AlertCircle className="h-6 w-6 md:h-8 md:w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Plans Display - Mobile Cards / Desktop Table */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-4 px-4 md:px-6">
            <CardTitle className="text-base md:text-lg flex items-center gap-2">
              All Plans
              <Badge variant="secondary" className="text-xs ml-2">
                Live Data
              </Badge>
            </CardTitle>
            <CardDescription>
              Changes are persisted to the database in real-time
            </CardDescription>
          </CardHeader>
          
          <CardContent className="px-0 md:px-6 pb-0 md:pb-6">
            {/* Empty State */}
            {(plans ?? []).length === 0 && (
              <div className="text-center py-12 px-4">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <Settings2 className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">No Plans Yet</h3>
                <p className="text-muted-foreground mb-4 text-sm">
                  Get started by creating your first subscription plan.
                </p>
                <Button onClick={handleCreate} className="gap-2 cursor-pointer">
                  <Plus className="h-4 w-4" /> Create Your First Plan
                </Button>
              </div>
            )}

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3 px-4 pb-4">
              {(plans ?? []).map((plan) => {
                const IconComp = iconMap[plan.icon] || Crown
                return (
                  <Card key={plan._id} className={`${!plan.active ? 'opacity-60' : ''}`}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${plan.popular ? 'bg-primary/10' : 'bg-muted'}`}>
                            <IconComp className={`h-5 w-5 ${plan.popular ? 'text-primary' : 'text-muted-foreground'}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{plan.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{plan.description}</div>
                          </div>
                        </div>
                        
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 cursor-pointer shrink-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleEdit(plan)} className="gap-2 cursor-pointer">
                              <Pencil className="h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicate(plan)} className="gap-2 cursor-pointer">
                              <Copy className="h-4 w-4" /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => togglePopular(plan)} className="gap-2 cursor-pointer">
                              <Star className="h-4 w-4" /> Toggle Popular
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleStatus(plan)} className="gap-2 cursor-pointer">
                              <RefreshCw className="h-4 w-4" /> Toggle Active
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => confirmDelete(plan)} className="gap-2 cursor-pointer text-red-600 focus:text-red-600">
                              <Trash2 className="h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      
                      {/* Pricing Info */}
                      <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                        <div className="bg-muted/50 p-2 rounded">
                          <span className="text-muted-foreground text-xs block">Monthly</span>
                          <strong>R{plan.priceMonthly.toLocaleString()}</strong>
                        </div>
                        <div className="bg-muted/50 p-2 rounded">
                          <span className="text-muted-foreground text-xs block">Yearly</span>
                          <strong>R{plan.priceYearly.toLocaleString()}</strong>
                        </div>
                      </div>
                      
                      {/* Badges */}
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {plan.popular && (
                          <Badge className="text-xs bg-gradient-to-r from-yellow-400 to-yellow-500 text-black border-0">
                            Popular
                          </Badge>
                        )}
                        <Badge variant={plan.active ? "default" : "outline"} className="text-xs">
                          {plan.active ? 'Active' : 'Inactive'}
                        </Badge>
                        {plan.maxAiGenerations === -1 && (
                          <Badge variant="secondary" className="text-xs">
                            Unlimited AI
                          </Badge>
                        )}
                      </div>
                      
                      {/* Quick Actions */}
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => handleEdit(plan)} 
                          className="flex-1 gap-1.5 cursor-pointer text-xs"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => toggleStatus(plan)} 
                          className="cursor-pointer text-xs px-3"
                          title={plan.active ? 'Deactivate' : 'Activate'}
                        >
                          {plan.active ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[250px]">Plan</TableHead>
                    <TableHead className="w-[100px]">Monthly</TableHead>
                    <TableHead className="w-[100px]">Yearly</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[100px]">Type</TableHead>
                    <TableHead className="w-[70px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(plans ?? []).map((plan) => {
                    const IconComp = iconMap[plan.icon] || Crown
                    return (
                      <TableRow key={plan._id} className={`${!plan.active ? 'opacity-60' : ''}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${plan.popular ? 'bg-primary/10' : 'bg-muted'}`}>
                              <IconComp className={`h-5 w-5 ${plan.popular ? 'text-primary' : 'text-muted-foreground'}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium">{plan.name}</div>
                              <div className="text-xs text-muted-foreground max-w-[180px] truncate">
                                {plan.description}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">R{plan.priceMonthly.toLocaleString()}</span>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">R{plan.priceYearly.toLocaleString()}</span>
                        </TableCell>
                        <TableCell>
                          <button 
                            onClick={() => toggleStatus(plan)} 
                            className="cursor-pointer"
                            title="Click to toggle status"
                          >
                            <Badge 
                              variant={!plan.active ? "outline" : "default"} 
                              className={`cursor-pointer hover:opacity-80 transition-opacity ${!plan.active ? 'hover:bg-accent' : ''}`}
                            >
                              {!plan.active ? 'Inactive' : 'Active'}
                            </Badge>
                          </button>
                        </TableCell>
                        <TableCell>
                          <button 
                            onClick={() => togglePopular(plan)} 
                            className="cursor-pointer"
                            title="Click to toggle popularity"
                          >
                            {plan.popular ? (
                              <Badge className="bg-gradient-to-r from-yellow-400 to-yellow-500 text-black border-0 cursor-default">
                                Popular
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="cursor-default">
                                Standard
                              </Badge>
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 cursor-pointer">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleEdit(plan)} className="gap-2 cursor-pointer">
                                <Pencil className="h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicate(plan)} className="gap-2 cursor-pointer">
                                <Copy className="h-4 w-4" /> Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                onClick={() => confirmDelete(plan)} 
                                className="gap-2 cursor-pointer text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="h-4 w-4" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
          </>
        )}

        {/* ===== Review Verification Dialog (approve/reject) ===== */}
        <Dialog open={reviewDialog.open} onOpenChange={(open) => {
          setReviewDialog(prev => ({ ...prev, open }))
          if (!open) {
            setReviewDialog({ open: false, verification: null, action: 'approve', adminNote: '' })
          }
        }}>
          <DialogContent className="mx-4 sm:mx-0 max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                {reviewDialog.action === 'approve' ? (
                  <>
                    <UserCheck className="h-5 w-5 text-green-600" />
                    Approve Verification
                  </>
                ) : (
                  <>
                    <UserX className="h-5 w-5 text-red-600" />
                    Reject Verification
                  </>
                )}
              </DialogTitle>
              <DialogDescription>
                {reviewDialog.action === 'approve'
                  ? 'This will activate the user account and unlock AI generation immediately.'
                  : 'Provide a reason for rejection. The user will see this note on their billing page.'}
              </DialogDescription>
            </DialogHeader>

            {reviewDialog.verification && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2 my-4 border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Transaction</span>
                  <span className="font-mono">{reviewDialog.verification.transactionId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium">
                    {reviewDialog.verification.currency} {reviewDialog.verification.amount.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Method</span>
                  <span className="font-medium capitalize">
                    {reviewDialog.verification.paymentMethod.replace('_', ' ')}
                  </span>
                </div>
                {reviewDialog.verification.notes && (
                  <div className="border-t pt-2 mt-2">
                    <p className="text-xs text-muted-foreground mb-1">User notes:</p>
                    <p className="text-sm">{reviewDialog.verification.notes}</p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="admin-note">
                {reviewDialog.action === 'approve' ? 'Note (optional)' : 'Reason for rejection *'}
              </Label>
              <Textarea
                id="admin-note"
                placeholder={
                  reviewDialog.action === 'approve'
                    ? 'Optional note for the user (e.g. "Welcome to Filo!")'
                    : 'Required - e.g. "Transaction ID not found in our records. Please verify and resubmit."'
                }
                value={reviewDialog.adminNote}
                onChange={(e) => setReviewDialog(prev => ({ ...prev, adminNote: e.target.value }))}
                rows={3}
                className="cursor-text"
              />
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setReviewDialog({ open: false, verification: null, action: 'approve', adminNote: '' })}
                disabled={isSaving}
                className="w-full sm:w-auto cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                variant={reviewDialog.action === 'approve' ? 'default' : 'destructive'}
                onClick={reviewDialog.action === 'approve' ? handleApproveVerification : handleRejectVerification}
                disabled={isSaving || (reviewDialog.action === 'reject' && !reviewDialog.adminNote.trim())}
                className="w-full sm:w-auto gap-2 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {reviewDialog.action === 'approve' ? 'Approving...' : 'Rejecting...'}
                  </>
                ) : (
                  <>
                    {reviewDialog.action === 'approve' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    {reviewDialog.action === 'approve' ? 'Approve & Activate' : 'Reject with Reason'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== User Action Dialog (direct activate/suspend) ===== */}
        <Dialog open={userActionDialog.open} onOpenChange={(open) => {
          setUserActionDialog(prev => ({ ...prev, open }))
          if (!open) {
            setUserActionDialog({ open: false, user: null, action: 'activate', note: '' })
          }
        }}>
          <DialogContent className="mx-4 sm:mx-0 max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                {userActionDialog.action === 'activate' ? (
                  <>
                    <UserCheck className="h-5 w-5 text-green-600" />
                    Activate User
                  </>
                ) : (
                  <>
                    <UserX className="h-5 w-5 text-red-600" />
                    Suspend User
                  </>
                )}
              </DialogTitle>
              <DialogDescription>
                {userActionDialog.action === 'activate'
                  ? 'Manually activate this user account. They will be able to perform AI generation immediately.'
                  : 'Suspend this user account. They will lose access to AI generation until reactivated.'}
              </DialogDescription>
            </DialogHeader>

            {userActionDialog.user && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2 my-4 border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{userActionDialog.user.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium">{userActionDialog.user.email}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current status</span>
                  <span className="font-medium capitalize">{userActionDialog.user.status.replace('_', ' ')}</span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="user-action-note">Note (optional)</Label>
              <Textarea
                id="user-action-note"
                placeholder={
                  userActionDialog.action === 'activate'
                    ? 'Optional note (e.g. "Internal team member")'
                    : 'Optional reason shown to the user (e.g. "Suspicious activity detected")'
                }
                value={userActionDialog.note}
                onChange={(e) => setUserActionDialog(prev => ({ ...prev, note: e.target.value }))}
                rows={3}
                className="cursor-text"
              />
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setUserActionDialog({ open: false, user: null, action: 'activate', note: '' })}
                disabled={isSaving}
                className="w-full sm:w-auto cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                variant={userActionDialog.action === 'activate' ? 'default' : 'destructive'}
                onClick={handleUserAction}
                disabled={isSaving}
                className="w-full sm:w-auto gap-2 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {userActionDialog.action === 'activate' ? 'Activating...' : 'Suspending...'}
                  </>
                ) : (
                  <>
                    {userActionDialog.action === 'activate' ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
                    {userActionDialog.action === 'activate' ? 'Activate Account' : 'Suspend Account'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="mx-4 sm:mx-0 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" /> 
              Delete Plan
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{planToDelete?.name}</strong>? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          {planToDelete && (
            <div className="bg-muted/50 p-4 rounded-lg text-sm space-y-2 my-4 border">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan ID:</span>
                <code className="text-xs bg-background px-2 py-1 rounded">{planToDelete._id.slice(0, 12)}...</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Price:</span>
                <span className="font-medium">R{planToDelete.priceMonthly}/mo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Features:</span>
                <span className="font-medium">{planToDelete.features.length} features</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Active Subscriptions:</span>
                <span className="font-medium text-yellow-600">Will be checked</span>
              </div>
            </div>
          )}
          
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button 
              variant="outline" 
              onClick={() => setDeleteConfirmOpen(false)} 
              disabled={isSaving}
              className="w-full sm:w-auto cursor-pointer"
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={executeDelete} 
              disabled={isSaving}
              className="w-full sm:w-auto gap-2 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" /> Delete Permanently
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
