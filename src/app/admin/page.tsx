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
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  Sun,
  Moon,
  Star,
  LogOut,
  Shield
} from 'lucide-react'
import { useTheme } from 'next-themes'
import type { PlanConfig } from '@/config/plans'

// Icon mapping for plans
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Crown,
  Users,
  Building2,
}

// Mock data - in production this would come from Convex/API
const initialPlans: PlanConfig[] = [
  {
    id: 'pro',
    name: 'Pro',
    description: 'For individual professionals and power users',
    price: { monthly: 190, yearly: 1900 },
    features: [
      '500 AI generations per month',
      '5GB cloud storage',
      'All document types (DOCX, PDF, XLSX, PPTX)',
      'Priority processing queue',
      'Custom brand profiles',
      'Advanced export formats',
      'Email support (48hr response)',
      'No watermarks on exports',
    ],
    limitations: ['Single user account', 'Standard API access'],
    cta: 'Get Started',
    popular: true,
    icon: 'Crown',
    badge: 'Most Popular',
  },
  {
    id: 'team',
    name: 'Team',
    description: 'For small teams and growing businesses',
    price: { monthly: 490, yearly: 4900 },
    features: [
      '2,500 AI generations per month (shared)',
      '25GB cloud storage (shared)',
      'Up to 5 team members',
      'All document types + custom templates',
      'Team collaboration features',
      'Admin dashboard & controls',
      'Priority email support (24hr response)',
      'API access with higher rate limits',
      'Shared brand profiles & assets',
      'Usage analytics & reporting',
    ],
    cta: 'Start Team Trial',
    popular: false,
    icon: 'Users',
    badge: 'Best for Teams',
  },
  {
    id: 'department',
    name: 'Department',
    description: 'For departments and large organizations',
    price: { monthly: 0, yearly: 0 },
    features: [
      'Unlimited AI generations',
      'Unlimited cloud storage',
      'Unlimited team members',
      'SSO & advanced security (SAML, OAuth)',
      'Dedicated account manager',
      'Custom integrations & API',
      'SLA guarantee (99.9% uptime)',
      'Priority phone & chat support',
      'On-premise deployment option',
      'Custom training & onboarding',
      'Advanced audit logs & compliance',
      'White-label options available',
    ],
    cta: 'Contact Sales',
    popular: false,
    icon: 'Building2',
    contactSales: true,
    badge: 'Enterprise',
  },
]

interface PlanFormData extends Omit<PlanConfig, 'id'> {
  id?: string
}

const emptyForm: PlanFormData = {
  name: '',
  description: '',
  price: { monthly: 0, yearly: 0 },
  features: [''],
  limitations: [],
  cta: '',
  popular: false,
  icon: 'Crown',
  badge: '',
  contactSales: false,
}

export default function AdminPage() {
  const { theme, setTheme } = useTheme()
  const [plans, setPlans] = useState<PlanConfig[]>(initialPlans)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<PlanConfig | null>(null)
  const [formData, setFormData] = useState<PlanFormData>({ ...emptyForm })
  const [newFeature, setNewFeature] = useState('')
  const [newLimitation, setNewLimitation] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Show notification
  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 3000)
  }

  // Handle admin logout
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/admin/logout', { method: 'DELETE' })
      window.location.href = '/admin/login'
    } catch (error) {
      console.error('Logout error:', error)
      // Force redirect even if API fails
      window.location.href = '/admin/login'
    }
  }

  // Open dialog for creating new plan
  const handleCreate = () => {
    setEditingPlan(null)
    setFormData({ ...emptyForm })
    setIsDialogOpen(true)
  }

  // Open dialog for editing plan
  const handleEdit = (plan: PlanConfig) => {
    setEditingPlan(plan)
    setFormData({
      name: plan.name,
      description: plan.description,
      price: { ...plan.price },
      features: [...plan.features],
      limitations: [...(plan.limitations || [])],
      cta: plan.cta,
      popular: plan.popular,
      icon: plan.icon,
      badge: plan.badge || '',
      contactSales: plan.contactSales || false,
    })
    setIsDialogOpen(true)
  }

  // Delete plan
  const handleDelete = (planId: string) => {
    if (confirm('Are you sure you want to delete this plan? This action cannot be undone.')) {
      setPlans(plans.filter(p => p.id !== planId))
      showNotification('success', `Plan deleted successfully`)
    }
  }

  // Duplicate plan
  const handleDuplicate = (plan: PlanConfig) => {
    const newPlan: PlanConfig = {
      ...plan,
      id: `${plan.id}-copy-${Date.now()}`,
      name: `${plan.name} (Copy)`,
    }
    setPlans([...plans, newPlan])
    showNotification('success', `Plan duplicated as "${newPlan.name}"`)
  }

  // Save plan (create or update)
  const handleSave = async () => {
    if (!formData.name.trim()) {
      showNotification('error', 'Plan name is required')
      return
    }

    setIsLoading(true)

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500))

    const planData: PlanConfig = {
      id: editingPlan?.id || formData.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
      ...formData,
      features: formData.features.filter(f => f.trim()),
      limitations: formData.limitations?.filter(l => l.trim()) || [],
    }

    if (editingPlan) {
      // Update existing plan
      setPlans(plans.map(p => p.id === editingPlan.id ? planData : p))
      showNotification('success', `"${planData.name}" updated successfully`)
    } else {
      // Create new plan
      setPlans([...plans, planData])
      showNotification('success', `"${planData.name}" created successfully`)
    }

    setIsLoading(false)
    setIsDialogOpen(false)
    setEditingPlan(null)
  }

  // Add feature to form
  const addFeature = () => {
    if (newFeature.trim()) {
      setFormData({
        ...formData,
        features: [...formData.features, newFeature.trim()]
      })
      setNewFeature('')
    }
  }

  // Remove feature from form
  const removeFeature = (index: number) => {
    setFormData({
      ...formData,
      features: formData.features.filter((_, i) => i !== index)
    })
  }

  // Add limitation to form
  const addLimitation = () => {
    if (newLimitation.trim()) {
      setFormData({
        ...formData,
        limitations: [...(formData.limitations || []), newLimitation.trim()]
      })
      setNewLimitation('')
    }
  }

  // Remove limitation from form
  const removeLimitation = (index: number) => {
    setFormData({
      ...formData,
      limitations: formData.limitations?.filter((_, i) => i !== index) || []
    })
  }

  // Toggle plan active status
  const togglePlanStatus = (planId: string) => {
    setPlans(plans.map(p => 
      p.id === planId 
        ? { ...p, popular: !p.popular }
        : p
    ))
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold tracking-tight">Filo</span>
            </Link>
            <Separator orientation="vertical" className="h-8" />
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-lg font-semibold">Admin Dashboard</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Admin Badge */}
            <Badge variant="secondary" className="gap-1.5 cursor-default bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800">
              <Shield className="h-3.5 w-3.5" />
              Admin
            </Badge>

            {/* Theme toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="cursor-pointer"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>

            <Button 
              variant="ghost" 
              size="sm" 
              asChild
              className="gap-2 cursor-pointer"
            >
              <Link href="/pricing">
                <ExternalLink className="h-4 w-4" />
                View Pricing
              </Link>
            </Button>

            {/* Logout Button */}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleLogout}
              className="gap-2 cursor-pointer text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 border-red-200 dark:border-red-800"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>

            <Button 
              variant="ghost" 
              size="sm" 
              asChild
              className="gap-2 cursor-pointer"
            >
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Back to App
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Notification */}
      {notification && (
        <div className={`fixed top-20 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in slide-in-from-right ${
          notification.type === 'success' 
            ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200' 
            : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
        }`}>
          {notification.type === 'success' ? (
            <Check className="h-5 w-5 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0" />
          )}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}

      <main className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Plan Management</h2>
            <p className="text-muted-foreground mt-1">
              Manage your subscription plans, pricing, and features
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setPlans(initialPlans)
                showNotification('success', 'Plans reset to defaults')
              }}
              className="gap-2 cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
              Reset
            </Button>
            
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={handleCreate} className="gap-2 cursor-pointer">
                  <Plus className="h-4 w-4" />
                  New Plan
                </Button>
              </DialogTrigger>
              
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {editingPlan ? 'Edit Plan' : 'Create New Plan'}
                  </DialogTitle>
                  <DialogDescription>
                    {editingPlan 
                      ? `Editing "${editingPlan.name}"` 
                      : 'Configure a new subscription plan'
                    }
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                  {/* Basic Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Plan Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., Pro, Team, Enterprise"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="icon">Icon</Label>
                      <Select 
                        value={formData.icon} 
                        onValueChange={(value) => setFormData({ ...formData, icon: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select icon" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Crown">
                            <div className="flex items-center gap-2">
                              <Crown className="h-4 w-4" /> Crown
                            </div>
                          </SelectItem>
                          <SelectItem value="Users">
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4" /> Users
                            </div>
                          </SelectItem>
                          <SelectItem value="Building2">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4" /> Building
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Brief description of who this plan is for..."
                      rows={2}
                    />
                  </div>

                  {/* Pricing */}
                  <div className="space-y-3">
                    <Label>Pricing</Label>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="monthly">Monthly Price ({formData.contactSales ? 'N/A' : ''})</Label>
                        <Input
                          id="monthly"
                          type="number"
                          value={formData.price.monthly}
                          onChange={(e) => setFormData({
                            ...formData,
                            price: { ...formData.price, monthly: parseInt(e.target.value) || 0 }
                          })}
                          disabled={formData.contactSales}
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="yearly">Yearly Price ({formData.contactSales ? 'N/A' : ''})</Label>
                        <Input
                          id="yearly"
                          type="number"
                          value={formData.price.yearly}
                          onChange={(e) => setFormData({
                            ...formData,
                            price: { ...formData.price, yearly: parseInt(e.target.value) || 0 }
                          })}
                          disabled={formData.contactSales}
                          placeholder="0"
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="contactSales"
                        checked={formData.contactSales}
                        onChange={(e) => setFormData({ ...formData, contactSales: e.target.checked })}
                        className="rounded"
                      />
                      <Label htmlFor="contactSales">Contact Sales (Custom Pricing)</Label>
                    </div>
                  </div>

                  {/* CTA Button */}
                  <div className="space-y-2">
                    <Label htmlFor="cta">CTA Button Text</Label>
                    <Input
                      id="cta"
                      value={formData.cta}
                      onChange={(e) => setFormData({ ...formData, cta: e.target.value })}
                      placeholder="e.g., Get Started, Contact Sales"
                    />
                  </div>

                  {/* Badge */}
                  <div className="space-y-2">
                    <Label htmlFor="badge">Badge (Optional)</Label>
                    <Input
                      id="badge"
                      value={formData.badge}
                      onChange={(e) => setFormData({ ...formData, badge: e.target.value })}
                      placeholder="e.g., Most Popular, Best Value, Enterprise"
                    />
                  </div>

                  {/* Features */}
                  <div className="space-y-3">
                    <Label>Features</Label>
                    <div className="space-y-2">
                      {formData.features.map((feature, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-green-600 shrink-0" />
                          <span className="flex-1 text-sm">{feature}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFeature(idx)}
                            className="h-7 w-7 p-0 cursor-pointer hover:text-red-500"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      
                      <div className="flex gap-2">
                        <Input
                          value={newFeature}
                          onChange={(e) => setNewFeature(e.target.value)}
                          placeholder="Add a feature..."
                          onKeyDown={(e) => e.key === 'Enter' && addFeature()}
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={addFeature}
                          disabled={!newFeature.trim()}
                          className="cursor-pointer"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Limitations */}
                  <div className="space-y-3">
                    <Label>Limitations (Optional)</Label>
                    <div className="space-y-2">
                      {(formData.limitations || []).map((limitation, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <X className="h-4 w-4 text-red-500 shrink-0" />
                          <span className="flex-1 text-sm text-muted-foreground">{limitation}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLimitation(idx)}
                            className="h-7 w-7 p-0 cursor-pointer hover:text-red-500"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      
                      <div className="flex gap-2">
                        <Input
                          value={newLimitation}
                          onChange={(e) => setNewLimitation(e.target.value)}
                          placeholder="Add a limitation..."
                          onKeyDown={(e) => e.key === 'Enter' && addLimitation()}
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={addLimitation}
                          disabled={!newLimitation.trim()}
                          className="cursor-pointer"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Options */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="popular"
                        checked={formData.popular}
                        onChange={(e) => setFormData({ ...formData, popular: e.target.checked })}
                        className="rounded"
                      />
                      <Label htmlFor="popular">Mark as Popular</Label>
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="cursor-pointer">
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleSave} 
                    disabled={isLoading || !formData.name.trim()}
                    className="gap-2 cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        {editingPlan ? 'Update Plan' : 'Create Plan'}
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Plans</p>
                  <p className="text-2xl font-bold">{plans.length}</p>
                </div>
                <Settings2 className="h-8 w-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Plans</p>
                  <p className="text-2xl font-bold">{plans.length}</p>
                </div>
                <Check className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Popular Plan</p>
                  <p className="text-2xl font-bold">{plans.find(p => p.popular)?.name || 'None'}</p>
                </div>
                <Star className="h-8 w-8 text-yellow-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Contact Sales</p>
                  <p className="text-2xl font-bold">{plans.filter(p => p.contactSales).length}</p>
                </div>
                <Building2 className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Plans Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Plans</CardTitle>
            <CardDescription>
              View and manage all subscription plans
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Monthly</TableHead>
                  <TableHead>Yearly</TableHead>
                  <TableHead>Features</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="w-[70px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => {
                  const IconComponent = iconMap[plan.icon] || Crown
                  
                  return (
                    <TableRow key={plan.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                            plan.popular ? 'bg-primary/10' : 'bg-muted'
                          }`}>
                            <IconComponent className={`h-5 w-5 ${
                              plan.popular ? 'text-primary' : 'text-muted-foreground'
                            }`} />
                          </div>
                          <div>
                            <div className="font-medium">{plan.name}</div>
                            <div className="text-xs text-muted-foreground max-w-[200px] truncate">
                              {plan.description}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      
                      <TableCell>
                        {plan.contactSales ? (
                          <Badge variant="secondary">Custom</Badge>
                        ) : (
                          <span className="font-medium">
                            R{plan.price.monthly}
                          </span>
                        )}
                      </TableCell>
                      
                      <TableCell>
                        {plan.contactSales ? (
                          <Badge variant="secondary">Custom</Badge>
                        ) : (
                          <span className="font-medium">
                            R{plan.price.yearly}
                          </span>
                        )}
                      </TableCell>
                      
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="cursor-default">
                            {plan.features.length} features
                          </Badge>
                          {(plan.limitations?.length || 0) > 0 && (
                            <Badge variant="secondary" className="cursor-default">
                              {plan.limitations?.length} limits
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      
                      <TableCell>
                        <button
                          onClick={() => togglePlanStatus(plan.id)}
                          className="cursor-pointer"
                        >
                          <Badge 
                            variant={plan.popular ? "default" : "outline"} 
                            className={`cursor-pointer ${!plan.popular ? 'hover:bg-accent' : ''}`}
                          >
                            {plan.popular ? 'Popular' : 'Standard'}
                          </Badge>
                        </button>
                      </TableCell>
                      
                      <TableCell>
                        {plan.contactSales ? (
                          <Badge className="bg-gradient-to-r from-primary/80 to-primary/60 cursor-default">
                            Enterprise
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="cursor-default">
                            Self-Serve
                          </Badge>
                        )}
                      </TableCell>
                      
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 cursor-pointer">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={() => handleEdit(plan)}
                              className="gap-2 cursor-pointer"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleDuplicate(plan)}
                              className="gap-2 cursor-pointer"
                            >
                              <Copy className="h-4 w-4" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => window.open('/pricing', '_blank')}
                              className="gap-2 cursor-pointer"
                            >
                              <Eye className="h-4 w-4" />
                              Preview
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={() => handleDelete(plan.id)}
                              className="gap-2 cursor-pointer text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
                
                {plans.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Settings2 className="h-12 w-12 opacity-30" />
                        <p className="font-medium">No plans yet</p>
                        <p className="text-sm">Create your first plan to get started</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Environment Variables Reference */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Environment Variables Reference</CardTitle>
            <CardDescription>
              Configure plans via environment variables in production
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-4 overflow-x-auto">
              <pre className="text-xs font-mono space-y-1">
{`# PRO PLAN
NEXT_PUBLIC_PLAN_PRO_ID=pro
NEXT_PUBLIC_PLAN_PRO_NAME=Pro
NEXT_PUBLIC_PLAN_PRO_DESC=For individual professionals
NEXT_PUBLIC_PLAN_PRO_MONTHLY_PRICE=190
NEXT_PUBLIC_PLAN_PRO_YEARLY_PRICE=1900

# TEAM PLAN  
NEXT_PUBLIC_PLAN_TEAM_ID=team
NEXT_PUBLIC_PLAN_TEAM_NAME=Team
NEXT_PUBLIC_PLAN_TEAM_DESC=For small teams
NEXT_PUBLIC_PLAN_TEAM_MONTHLY_PRICE=490
NEXT_PUBLIC_PLAN_TEAM_YEARLY_PRICE=4900

# DEPARTMENT PLAN
NEXT_PUBLIC_PLAN_DEPARTMENT_ID=department
NEXT_PUBLIC_PLAN_DEPARTMENT_NAME=Department
NEXT_PUBLIC_PLAN_DEPARTMENT_DESC=For enterprises

# CURRENCY
NEXT_PUBLIC_CURRENCY_SYMBOL=R
NEXT_PUBLIC_CURRENCY_CODE=ZAR

# CONTACT SALES URL
NEXT_PUBLIC_CONTACT_SALES_URL=mailto:sales@filo.ai`}
              </pre>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
