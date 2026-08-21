'use client'

import React, { useState } from 'react'
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
  ExternalLink,
  Sun,
  Moon,
  Star,
  LogOut,
  Shield,
  Loader2,
  Database
} from 'lucide-react'
import { useTheme } from 'next-themes'

// Icon mapping
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Crown,
  Users,
  Building2,
}

// Plan types
interface PlanDisplay {
  _id?: string
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

// Default plans (used when Convex not connected)
const defaultPlans: PlanDisplay[] = [
  {
    _id: 'demo-pro',
    name: 'Pro',
    description: 'For individual professionals and power users',
    priceMonthly: 190,
    priceYearly: 1900,
    features: ['500 AI generations/mo', '5GB storage', 'All document types', 'Priority support'],
    limitations: ['Single user'],
    popular: true,
    active: true,
    maxAiGenerations: 500,
    maxStorageMb: 5120,
    icon: 'Crown',
    order: 1,
  },
  {
    _id: 'demo-team',
    name: 'Team',
    description: 'For small teams and growing businesses',
    priceMonthly: 490,
    priceYearly: 4900,
    features: ['2,500 AI generations/mo', '25GB storage', 'Up to 5 members', 'Admin dashboard'],
    limitations: [],
    popular: false,
    active: true,
    maxAiGenerations: 2500,
    maxStorageMb: 25600,
    icon: 'Users',
    order: 2,
  },
  {
    _id: 'demo-dept',
    name: 'Department',
    description: 'For departments and large organizations',
    priceMonthly: 0,
    priceYearly: 0,
    features: ['Unlimited everything', 'SSO/SAML', 'Dedicated support', 'Custom integrations'],
    limitations: [],
    popular: false,
    active: true,
    maxAiGenerations: -1,
    maxStorageMb: -1,
    icon: 'Building2',
    order: 3,
  },
]

export default function AdminPage() {
  const { theme, setTheme } = useTheme()
  
  // State
  const [plans, setPlans] = useState<PlanDisplay[]>(defaultPlans)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<PlanDisplay | null>(null)
  const [formData, setFormData] = useState<PlanFormData>({ ...emptyForm })
  const [newFeature, setNewFeature] = useState('')
  const [newLimitation, setNewLimitation] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [planToDelete, setPlanToDelete] = useState<PlanDisplay | null>(null)

  // Notifications
  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 4000)
  }

  // Logout
  const handleLogout = async () => {
    try { await fetch('/api/auth/admin/logout', { method: 'DELETE' }) }
    catch (e) { console.error(e) }
    window.location.href = '/admin/login'
  }

  // CRUD Operations
  const handleCreate = () => {
    setEditingPlan(null)
    setFormData({ ...emptyForm, features: [] })
    setNewFeature('')
    setNewLimitation('')
    setIsDialogOpen(true)
  }

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

  const confirmDelete = (plan: PlanDisplay) => {
    setPlanToDelete(plan)
    setDeleteConfirmOpen(true)
  }

  const executeDelete = () => {
    if (!planToDelete) return
    setPlans(prev => prev.filter(p => p._id !== planToDelete._id))
    showNotification('success', `Deleted "${planToDelete.name}"`)
    setDeleteConfirmOpen(false)
    setPlanToDelete(null)
  }

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
    showNotification('success', `Duplicated "${plan.name}"`)
  }

  const handleSave = () => {
    if (!formData.name.trim()) {
      showNotification('error', 'Plan name required')
      return
    }

    setIsLoading(true)
    
    setTimeout(() => {
      const planData: PlanDisplay = {
        _id: editingPlan?._id || `local-${Date.now()}`,
        name: formData.name.trim(),
        description: formData.description.trim(),
        priceMonthly: formData.priceMonthly,
        priceYearly: formData.priceYearly,
        features: formData.features.filter(f => f.trim()),
        limitations: formData.limitations?.filter(l => l.trim()) || [],
        popular: formData.popular,
        active: formData.active,
        maxAiGenerations: formData.maxAiGenerations,
        maxStorageMb: formData.maxStorageMb,
        icon: formData.icon,
        order: formData.order,
      }

      if (editingPlan) {
        setPlans(prev => prev.map(p => p._id === editingPlan._id ? planData : p))
        showNotification('success', `"${planData.name}" updated`)
      } else {
        setPlans(prev => [...prev, planData])
        showNotification('success', `"${planData.name}" created`)
      }

      setIsLoading(false)
      setIsDialogOpen(false)
      setEditingPlan(null)
    }, 500)
  }

  const toggleStatus = (plan: PlanDisplay) => {
    setPlans(prev => prev.map(p => 
      p._id === plan._id ? { ...p, active: !p.active } : p
    ))
    showNotification('success', `"${plan.name}" ${!plan.active ? 'activated' : 'deactivated'}`)
  }

  const togglePopular = (plan: PlanDisplay) => {
    setPlans(prev => prev.map(p => 
      p._id === plan._id ? { ...p, popular: !p.popular } : p
    ))
    showNotification('success', `"${plan.name}" ${!plan.popular ? 'marked popular' : 'unmarked'}`)
  }

  // Feature/Limitation helpers
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
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
            <Badge variant="secondary" className="hidden sm:flex gap-1 cursor-default bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800 text-xs px-2 py-0.5">
              <Shield className="h-3 w-3" /> Admin
            </Badge>

            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="cursor-pointer h-8 w-8 md:h-9 md:w-9">
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>

            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5 md:gap-2 cursor-pointer text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 dark:border-red-800 text-xs px-2 md:px-3 h-8 md:h-9">
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>

            <Button variant="ghost" size="sm" asChild className="cursor-pointer gap-1.5 md:gap-2">
              <Link href="/"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Back</span></Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Notification */}
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

      <main className="container mx-auto px-4 py-6 md:py-8">
        {/* Demo Mode Banner */}
        <Card className="mb-6 border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <Database className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-sm text-yellow-800 dark:text-yellow-200">Demo Mode</h3>
                  <Badge variant="outline" className="text-xs border-yellow-300 dark:border-yellow-700">Local Storage</Badge>
                </div>
                <p className="text-xs text-yellow-700 dark:text-yellow-300">
                  Connect Convex for persistent database storage.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Plan Management</h2>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">{plans.length} plans configured</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={handleCreate} className="gap-2 cursor-pointer text-xs md:text-sm" size="sm">
                  <Plus className="h-4 w-4" /> New Plan
                </Button>
              </DialogTrigger>
              
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-0">
                <DialogHeader>
                  <DialogTitle>{editingPlan ? 'Edit Plan' : 'Create Plan'}</DialogTitle>
                  <DialogDescription>{editingPlan ? `Editing "${editingPlan.name}"` : 'Configure subscription plan'}</DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Name *</Label>
                      <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="Pro, Team..." disabled={isLoading} />
                    </div>
                    <div className="space-y-2">
                      <Label>Icon</Label>
                      <Select value={formData.icon} onValueChange={(v) => setFormData({...formData, icon: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Crown"><div className="flex items-center gap-2"><Crown className="h-4 w-4" /> Crown</div></SelectItem>
                          <SelectItem value="Users"><div className="flex items-center gap-2"><Users className="h-4 w-4" /> Users</div></SelectItem>
                          <SelectItem value="Building2"><div className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Building</div></SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2} disabled={isLoading} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Monthly (R)</Label>
                      <Input type="number" value={formData.priceMonthly || ''} onChange={(e) => setFormData({...formData, priceMonthly: parseInt(e.target.value) || 0})} disabled={isLoading} />
                    </div>
                    <div className="space-y-2">
                      <Label>Yearly (R)</Label>
                      <Input type="number" value={formData.priceYearly || ''} onChange={(e) => setFormData({...formData, priceYearly: parseInt(e.target.value) || 0})} disabled={isLoading} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>AI Generations/mo</Label>
                      <Input type="number" value={formData.maxAiGenerations || ''} onChange={(e) => setFormData({...formData, maxAiGenerations: parseInt(e.target.value) || 0})} disabled={isLoading} />
                    </div>
                    <div className="space-y-2">
                      <Label>Storage (MB)</Label>
                      <Input type="number" value={formData.maxStorageMb || ''} onChange={(e) => setFormData({...formData, maxStorageMb: parseInt(e.target.value) || 0})} disabled={isLoading} />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={formData.active} onChange={(e) => setFormData({...formData, active: e.target.checked})} className="rounded" />
                      <span>Active</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={formData.popular} onChange={(e) => setFormData({...formData, popular: e.target.checked})} className="rounded" />
                      <span>Popular</span>
                    </label>
                  </div>

                  {/* Features */}
                  <div className="space-y-2">
                    <Label>Features ({formData.features.length})</Label>
                    <div className="space-y-2">
                      {formData.features.map((f, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-muted p-2 rounded">
                          <Check className="h-4 w-4 text-green-600 shrink-0" />
                          <span className="flex-1 text-sm truncate">{f}</span>
                          <Button variant="ghost" size="sm" onClick={() => removeFeature(idx)} className="h-6 w-6 p-0 cursor-pointer hover:text-red-500" disabled={isLoading}><X className="h-3.5 w-3.5" /></Button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Input value={newFeature} onChange={(e) => setNewFeature(e.target.value)} placeholder="Add feature..." onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())} className="flex-1" disabled={isLoading} />
                        <Button variant="outline" size="sm" onClick={addFeature} disabled={!newFeature.trim() || isLoading} className="cursor-pointer"><Plus className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </div>

                  {/* Limitations */}
                  <div className="space-y-2">
                    <Label>Limitations ({formData.limitations?.length || 0})</Label>
                    <div className="space-y-2">
                      {(formData.limitations || []).map((l, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-muted p-2 rounded">
                          <X className="h-4 w-4 text-red-500 shrink-0" />
                          <span className="flex-1 text-sm truncate text-muted-foreground">{l}</span>
                          <Button variant="ghost" size="sm" onClick={() => removeLimitation(idx)} className="h-6 w-6 p-0 cursor-pointer hover:text-red-500" disabled={isLoading}><X className="h-3.5 w-3.5" /></Button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Input value={newLimitation} onChange={(e) => setNewLimitation(e.target.value)} placeholder="Add limitation..." onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLimitation())} className="flex-1" disabled={isLoading} />
                        <Button variant="outline" size="sm" onClick={addLimitation} disabled={!newLimitation.trim() || isLoading} className="cursor-pointer"><Plus className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-end">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isLoading} className="w-full sm:w-auto cursor-pointer">Cancel</Button>
                  <Button onClick={handleSave} disabled={isLoading || !formData.name.trim()} className="w-full sm:w-auto gap-2 cursor-pointer">
                    {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : <><Save className="h-4 w-4" /> {editingPlan ? 'Update' : 'Create'}</>}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
          <Card className="p-3 md:p-6"><CardContent className="pt-0 p-0"><div className="flex justify-between"><div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl md:text-2xl font-bold">{plans.length}</p></div><Settings2 className="h-6 w-6 md:h-8 md:w-8 opacity-30" /></div></CardContent></Card>
          <Card className="p-3 md:p-6"><CardContent className="pt-0 p-0"><div className="flex justify-between"><div><p className="text-xs text-muted-foreground">Active</p><p className="text-xl md:text-2xl font-bold">{plans.filter(p => p.active).length}</p></div><Check className="h-6 w-6 md:h-8 md:w-8 text-green-600" /></div></CardContent></Card>
          <Card className="p-3 md:p-6"><CardContent className="pt-0 p-0"><div className="flex justify-between"><div><p className="text-xs text-muted-foreground">Popular</p><p className="text-xl md:text-2xl font-bold">{plans.find(p => p.popular)?.name || '-'}</p></div><Star className="h-6 w-6 md:h-8 md:w-8 text-yellow-500" /></div></CardContent></Card>
          <Card className="p-3 md:p-6"><CardContent className="pt-0 p-0"><div className="flex justify-between"><div><p className="text-xs text-muted-foreground">Inactive</p><p className="text-xl md:text-2xl font-bold">{plans.filter(p => !p.active).length}</p></div><AlertCircle className="h-6 w-6 md:h-8 md:w-8 opacity-30" /></div></CardContent></Card>
        </div>

        {/* Plans Table/Cards */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-4 px-4 md:px-6">
            <CardTitle className="text-base md:text-lg">All Plans</CardTitle>
          </CardHeader>
          <CardContent className="px-0 md:px-6 pb-0 md:pb-6">
            {/* Mobile Cards */}
            <div className="md:hidden space-y-3 px-4 pb-4">
              {plans.map((plan) => {
                const IconComp = iconMap[plan.icon] || Crown
                return (
                  <Card key={plan._id} className={`${!plan.active ? 'opacity-60' : ''}`}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${plan.popular ? 'bg-primary/10' : 'bg-muted'}`}>
                            <IconComp className={`h-5 w-5 ${plan.popular ? 'text-primary' : 'text-muted-foreground'}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{plan.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{plan.description}</div>
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 w-8 p-0 cursor-pointer"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(plan)} className="gap-2 cursor-pointer"><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicate(plan)} className="gap-2 cursor-pointer"><Copy className="h-4 w-4" /> Duplicate</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => togglePopular(plan)} className="gap-2 cursor-pointer"><Star className="h-4 w-4" /> Toggle Popular</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleStatus(plan)} className="gap-2 cursor-pointer"><RefreshCw className="h-4 w-4" /> Toggle Active</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => confirmDelete(plan)} className="gap-2 cursor-pointer text-red-600"><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                        <div><span className="text-muted-foreground">Mo:</span> <strong>R{plan.priceMonthly}</strong></div>
                        <div><span className="text-muted-foreground">Yr:</span> <strong>R{plan.priceYearly}</strong></div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        <Badge variant={plan.popular ? "default" : "secondary"} className="text-xs">{plan.popular ? '⭐ Popular' : 'Standard'}</Badge>
                        <Badge variant={!plan.active ? "outline" : "secondary"} className="text-xs">{!plan.active ? 'Inactive' : 'Active'}</Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleEdit(plan)} className="flex-1 gap-1.5 cursor-pointer text-xs"><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                        <Button variant="outline" size="sm" onClick={() => toggleStatus(plan)} className="cursor-pointer text-xs">{!plan.active ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}</Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Monthly</TableHead>
                    <TableHead>Yearly</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="w-[70px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((plan) => {
                    const IconComp = iconMap[plan.icon] || Crown
                    return (
                      <TableRow key={plan._id} className={`${!plan.active ? 'opacity-60' : ''}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${plan.popular ? 'bg-primary/10' : 'bg-muted'}`}>
                              <IconComp className={`h-5 w-5 ${plan.popular ? 'text-primary' : 'text-muted-foreground'}`} />
                            </div>
                            <div>
                              <div className="font-medium">{plan.name}</div>
                              <div className="text-xs text-muted-foreground max-w-[200px] truncate">{plan.description}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><span className="font-medium">R{plan.priceMonthly}</span></TableCell>
                        <TableCell><span className="font-medium">R{plan.priceYearly}</span></TableCell>
                        <TableCell>
                          <button onClick={() => toggleStatus(plan)} className="cursor-pointer">
                            <Badge variant={!plan.active ? "outline" : "default"} className={`cursor-pointer ${!plan.active ? 'hover:bg-accent' : ''}`}>{!plan.active ? 'Inactive' : 'Active'}</Badge>
                          </button>
                        </TableCell>
                        <TableCell>
                          <button onClick={() => togglePopular(plan)} className="cursor-pointer">
                            {plan.popular ? <Badge className="bg-gradient-to-r from-primary/80 to-primary/60 cursor-default">⭐ Popular</Badge> : <Badge variant="secondary" className="cursor-default">Standard</Badge>}
                          </button>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 w-8 p-0 cursor-pointer"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleEdit(plan)} className="gap-2 cursor-pointer"><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicate(plan)} className="gap-2 cursor-pointer"><Copy className="h-4 w-4" /> Duplicate</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => confirmDelete(plan)} className="gap-2 cursor-pointer text-red-600"><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
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
      </main>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="mx-4 sm:mx-0 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600"><Trash2 className="h-5 w-5" /> Delete Plan</DialogTitle>
            <DialogDescription>Are you sure you want to delete <strong>{planToDelete?.name}</strong>? This cannot be undone.</DialogDescription>
          </DialogHeader>
          {planToDelete && (
            <div className="bg-muted p-3 rounded-lg text-sm mb-4">
              <p><strong>ID:</strong> {planToDelete._id}</p>
              <p><strong>Price:</strong> R{planToDelete.priceMonthly}/mo</p>
              <p><strong>Features:</strong> {planToDelete.features.length}</p>
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} className="w-full sm:w-auto cursor-pointer">Cancel</Button>
            <Button variant="destructive" onClick={executeDelete} className="w-full sm:w-auto gap-2 cursor-pointer">
              <Trash2 className="h-4 w-4" /> Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
