'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Check,
  X,
  CreditCard,
  Crown,
  Zap,
  Building2,
  ArrowRight,
  Download,
  Calendar,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Star,
  Rocket,
  Shield,
  Sparkles,
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Send
} from 'lucide-react'
import { getDefaultPlans, currencyConfig, type PlanConfig } from '@/config/plans'
import { ErrorDisplay } from '@/components/ui/error-boundary'
import { apiClient } from '@/lib/api-client'
import { toast } from '@/lib/toast'

// Icon mapping
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Zap,
  Crown,
  Star,
  Rocket,
  Shield,
  Sparkles,
}

// ==================== TYPES ====================

interface VerificationRecord {
  _id?: string
  id?: string
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
  adminNote?: string | null
  createdAt: number
  updatedAt: number
}

// ==================== COMPONENT ====================

export function BillingPage() {
  const [plans] = useState<PlanConfig[]>(getDefaultPlans())
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isYearly, setIsYearly] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  // Manual payment submission dialog state
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [submitForm, setSubmitForm] = useState({
    paymentMethod: 'bank_transfer' as 'bank_transfer' | 'easypaisa' | 'jazzcash' | 'other',
    transactionId: '',
    proofUrl: '',
    notes: '',
  })

  // Get user session from localStorage (same as dashboard)
  const [user, setUser] = useState<{ id: string; email: string; name: string; status?: string } | null>(null)

  // Account status fetched from /api/subscription/status (manual activation model)
  const [accountStatus, setAccountStatus] = useState<'pending_activation' | 'active' | 'suspended' | 'unknown'>('unknown')
  const [latestVerification, setLatestVerification] = useState<VerificationRecord | null>(null)
  const [verificationHistory, setVerificationHistory] = useState<VerificationRecord[]>([])

  // Reload user's account + verification status from the API.
  const refreshStatus = async () => {
    if (!user) return
    try {
      const resp = await apiClient.getSubscriptionStatus()
      if (resp.success && resp.data) {
        const data = resp.data as any
        setAccountStatus(data.accountStatus ?? 'pending_activation')
        setLatestVerification(data.latestVerification ?? null)
      }

      const histResp = await apiClient.getPaymentStatus()
      if (histResp.success && histResp.data) {
        const h = histResp.data as any
        // For now we only have the latest from the API; future iterations
        // can extend the API to return the full history.
        if (h.verificationId) {
          setVerificationHistory([{
            _id: h.verificationId,
            userId: user.id,
            amount: h.amount ?? 0,
            currency: h.currency ?? 'PKR',
            paymentMethod: h.paymentMethod ?? 'unknown',
            transactionId: h.transactionId ?? '',
            status: h.paymentStatus === 'none' ? 'pending' : (h.paymentStatus as any),
            adminNote: h.adminNote ?? null,
            reviewedAt: h.reviewedAt ?? null,
            createdAt: h.createdAt ?? Date.now(),
            updatedAt: h.reviewedAt ?? Date.now(),
          }])
        } else {
          setVerificationHistory([])
        }
      }
    } catch (err) {
      console.error('[BILLING] Failed to refresh status:', err)
    }
  }

  useEffect(() => {
    const savedSession = localStorage.getItem('filo_session')
    if (savedSession) {
      try {
        const sessionData = JSON.parse(savedSession)
        if (sessionData.user) {
          setUser(sessionData.user)
        }
      } catch {
        // Invalid session
      }
    }

    // Check URL params for legacy ?payment=success/cancelled and surface a
    // friendly message (the manual flow doesn't use these redirects but old
    // bookmarks may still hit them).
    const urlParams = new URLSearchParams(window.location.search)
    const paymentStatus = urlParams.get('payment')
    if (paymentStatus === 'success') {
      setPaymentError(null)
    } else if (paymentStatus === 'cancelled') {
      setPaymentError('Payment was cancelled. No charges were made.')
    }
  }, [])

  // Refresh account + verification status whenever user changes
  useEffect(() => {
    if (user) {
      refreshStatus()
    }
  }, [user?.id])

  // Calculate usage data - the manual activation model has no per-plan
  // quota tracking yet, so we show a friendly placeholder for pending
  // users and "unlimited" for active ones.
  const usageData = accountStatus === 'active'
    ? {
        aiGenerations: { used: 0, limit: -1, percentage: 0 },
        storage: { used: 0, limit: 5120, percentage: 0, unit: 'MB' },
        artifacts: { used: 0, limit: -1, percentage: 0 },
      }
    : {
        aiGenerations: { used: 0, limit: 0, percentage: 0 },
        storage: { used: 0, limit: 0, percentage: 0, unit: 'MB' },
        artifacts: { used: 0, limit: 0, percentage: 0 },
      }

  // Submit a manual payment. The user has already paid externally
  // (bank transfer, EasyPaisa, JazzCash, etc.) and just needs to submit
  // their transaction details for admin review.
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user) {
      setPaymentError('Please log in to submit a payment')
      return
    }

    if (!submitForm.transactionId.trim()) {
      setPaymentError('Transaction ID is required')
      return
    }

    setIsProcessing(true)
    setPaymentError(null)

    try {
      const plan = selectedPlan
        ? plans.find(p => p.id === selectedPlan)
        : plans.find(p => !p.contactSales) || plans[0]

      const amount = plan
        ? (isYearly ? plan.price.yearly : plan.price.monthly)
        : 0

      const response = await apiClient.submitPayment({
        planId: selectedPlan ?? plan?.id,
        isYearly,
        amount,
        paymentMethod: submitForm.paymentMethod,
        transactionId: submitForm.transactionId.trim(),
        proofUrl: submitForm.proofUrl.trim() || undefined,
        notes: submitForm.notes.trim() || undefined,
      })

      if (!response.success) {
        throw new Error(response.error || 'Failed to submit payment')
      }

      // Reset form + close dialog
      setSubmitForm({
        paymentMethod: 'bank_transfer',
        transactionId: '',
        proofUrl: '',
        notes: '',
      })
      setShowSubmitDialog(false)
      setSelectedPlan(null)

      toast.success('Payment submitted!', 'Your payment is being reviewed by our admin team. You will be able to generate documents once approved.',)

      // Refresh the verification status display
      await refreshStatus()
    } catch (error: any) {
      console.error('Payment submission error:', error)
      setPaymentError(error.message || 'Failed to submit payment. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  // No-op placeholder for the legacy "Cancel Plan" button. The manual
  // activation flow doesn't have a subscription record to cancel; users
  // who want to revoke access should contact support.
  const handleCancelSubscription = async () => {
    setShowCancelDialog(false)
    toast.success('Subscription cancellation', 'Please contact support to cancel your subscription.',)
  }

  const formatPrice = (amount: number): string => {
    return `${currencyConfig.symbol}${amount.toLocaleString()}`
  }

  const formatDate = (date: Date | number) => {
    return new Date(date).toLocaleDateString('en-PK', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'active':
      case 'approved':
        return <Badge variant="default" className="bg-green-600 cursor-default"><CheckCircle2 className="h-3 w-3 mr-1" />{status}</Badge>
      case 'pending':
      case 'pending_activation':
      case 'processing':
        return <Badge variant="secondary" className="cursor-default"><Clock className="h-3 w-3 mr-1" />{status}</Badge>
      case 'failed':
      case 'expired':
      case 'rejected':
      case 'suspended':
        return <Badge variant="destructive" className="cursor-default"><AlertCircle className="h-3 w-3 mr-1" />{status}</Badge>
      default:
        return <Badge variant="outline" className="cursor-default">{status}</Badge>
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <CreditCard className="h-8 w-8 text-primary" />
          Billing & Subscription
        </h1>
        <p className="mt-2 text-muted-foreground">
          Submit your payment for admin verification to unlock AI generation
        </p>
      </div>

      {/* Error Display */}
      {paymentError && (
        <ErrorDisplay
          error={paymentError}
          onDismiss={() => setPaymentError(null)}
        />
      )}

      {/* Current Plan Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5" />
            Account Status
          </CardTitle>
          <CardDescription>Your activation status and pending payment submissions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${
                accountStatus === 'active' ? 'bg-primary/10' : 'bg-muted'
              }`}>
                {accountStatus === 'active' ? (
                  <Crown className="h-6 w-6 text-primary" />
                ) : (
                  <Clock className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-semibold">
                    {accountStatus === 'active' ? 'Verified Account' : 'Pending Verification'}
                  </span>
                  {getStatusBadge(accountStatus === 'active' ? 'active' : 'pending_activation')}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {accountStatus === 'active'
                    ? 'Your account is active. You can generate documents.'
                    : accountStatus === 'suspended'
                      ? 'Your account is suspended. Contact support to restore access.'
                      : 'Submit your payment below to unlock AI generation. An admin will verify it shortly.'}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={() => {
                  const plan = plans.find(p => !p.contactSales)
                  if (plan) {
                    setSelectedPlan(plan.id)
                    setShowSubmitDialog(true)
                  }
                }}
                disabled={isProcessing || accountStatus === 'active'}
                className="cursor-pointer"
              >
                {accountStatus === 'active' ? 'Active' : 'Submit Payment'}
              </Button>
              <Button
                variant="outline"
                onClick={refreshStatus}
                disabled={isProcessing}
                className="cursor-pointer"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isProcessing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Latest Verification Status - shown when user has submitted a payment */}
      {latestVerification && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Latest Payment Submission
            </CardTitle>
            <CardDescription>The most recent payment you submitted for verification</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <div className="mt-1">{getStatusBadge(latestVerification.status)}</div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Transaction ID</p>
                  <p className="font-mono text-sm mt-1">{latestVerification.transactionId}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Method</p>
                  <p className="font-medium capitalize mt-1">{latestVerification.paymentMethod.replace('_', ' ')}</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p className="font-medium mt-1">
                    {latestVerification.currency} {latestVerification.amount.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Submitted</p>
                  <p className="font-medium mt-1">{formatDate(latestVerification.createdAt)}</p>
                </div>
                {latestVerification.reviewedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground">Reviewed</p>
                    <p className="font-medium mt-1">{formatDate(latestVerification.reviewedAt)}</p>
                  </div>
                )}
              </div>
            </div>

            {latestVerification.adminNote && (
              <div className={`mt-4 p-4 rounded-lg border ${
                latestVerification.status === 'approved'
                  ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
                  : latestVerification.status === 'rejected'
                    ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
                    : 'bg-muted/50'
              }`}>
                <p className="text-xs font-medium text-muted-foreground mb-1">Admin note:</p>
                <p className="text-sm font-medium">{latestVerification.adminNote}</p>
              </div>
            )}

            {latestVerification.status === 'rejected' && (
              <div className="mt-4 flex items-start gap-3 p-4 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800">
                <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Payment rejected</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Please review the admin note above and submit a new payment with the correct details.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Usage Overview */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="cursor-default">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Generations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{usageData.aiGenerations.used} / {usageData.aiGenerations.limit === -1 ? 'Unlimited' : usageData.aiGenerations.limit}</span>
                <span className="text-muted-foreground">{usageData.aiGenerations.limit === -1 ? 'Unlimited' : `${usageData.aiGenerations.percentage}%`}</span>
              </div>
              {usageData.aiGenerations.limit !== -1 && usageData.aiGenerations.limit !== 0 && (
                <div className="h-2 rounded-full bg-secondary overflow-hidden cursor-default">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${usageData.aiGenerations.percentage}%` }}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {accountStatus === 'active' ? 'Unlocked' : 'Locked - submit payment to unlock'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-default">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-500" />
              Storage Used
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{usageData.storage.used} / {usageData.storage.limit === -1 ? 'Unlimited' : usageData.storage.limit} {usageData.storage.unit}</span>
                <span className="text-muted-foreground">{usageData.storage.percentage}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden cursor-default">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${usageData.storage.percentage}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Files and artifacts
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-default">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-green-500" />
              Artifacts Created
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{usageData.artifacts.used} / {usageData.artifacts.limit === -1 ? 'Unlimited' : usageData.artifacts.limit}</span>
                <span className="text-muted-foreground">{usageData.artifacts.percentage}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden cursor-default">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${usageData.artifacts.percentage}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This month
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plans Section */}
      <div id="plans" className="scroll-mt-20">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Available Plans</h2>

          {/* Billing Toggle */}
          <div className="flex items-center gap-3 bg-muted p-1 rounded-lg">
            <button
              onClick={() => setIsYearly(false)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                !isYearly ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                isYearly ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Yearly
              <Badge variant="secondary" className="ml-2 text-xs cursor-default">Save ~17%</Badge>
            </button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
          {plans.filter(p => !p.contactSales).map((plan) => {
            const IconComponent = iconMap[plan.icon] || Zap
            const price = isYearly ? plan.price.yearly : plan.price.monthly
            const isActive = accountStatus === 'active' && selectedPlan === plan.id

            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col transition-all duration-300 ${
                  plan.popular ? 'border-primary shadow-lg md:scale-[1.02]' : ''
                } ${isActive ? 'ring-2 ring-primary bg-primary/5' : ''}`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-primary text-primary-foreground px-3 cursor-default">
                      Most Popular
                    </Badge>
                  </div>
                )}

                {isActive && (
                  <div className="absolute top-3 right-3 z-10">
                    <Badge variant="default" className="bg-green-600 cursor-default">
                      <CheckCircle2 className="h-3 w-3 mr-1" />Current
                    </Badge>
                  </div>
                )}

                <CardHeader className="text-center pb-4">
                  <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-xl ${
                    isActive ? 'bg-primary/20' : plan.popular ? 'bg-primary/10' : 'bg-muted'
                  }`}>
                    <IconComponent className={`h-7 w-7 ${isActive ? 'text-primary' : plan.popular ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>

                  <CardTitle className="mt-4 text-xl">{plan.name}</CardTitle>
                  <CardDescription className="text-sm mt-2">{plan.description}</CardDescription>

                  <div className="mt-4">
                    {price === 0 ? (
                      <div className="text-center">
                        <div className="text-3xl font-bold">Free</div>
                        <p className="text-sm text-muted-foreground mt-1">Forever</p>
                      </div>
                    ) : isYearly && plan.price.yearly > 0 ? (
                      <div className="text-center">
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-3xl font-bold">{formatPrice(price)}</span>
                          <span className="text-sm text-muted-foreground">/year</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          ~{formatPrice(Math.round(plan.price.yearly / 12))}/month
                        </p>
                        <Badge variant="secondary" className="mt-2 text-xs cursor-default">
                          Save {formatPrice(plan.price.monthly * 12 - plan.price.yearly)}/yr
                        </Badge>
                      </div>
                    ) : (
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="text-3xl font-bold">{formatPrice(price)}</span>
                        <span className="text-sm text-muted-foreground">/month</span>
                      </div>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="flex-1 space-y-4">
                  <ul className="space-y-3">
                    {plan.features.slice(0, 6).map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}

                    {plan.limitations && plan.limitations.length > 0 && (
                      <>
                        <Separator className="my-2" />
                        {plan.limitations.map((limitation, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <X className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                            <span className="text-sm text-muted-foreground">{limitation}</span>
                          </li>
                        ))}
                      </>
                    )}
                  </ul>

                  <Button
                    className="w-full mt-6 cursor-pointer hover:shadow-md transition-all min-h-[44px]"
                    variant={
                      isActive
                        ? "outline"
                        : plan.popular
                          ? "default"
                          : "secondary"
                    }
                    disabled={isProcessing || price === 0 || accountStatus === 'active'}
                    onClick={() => {
                      setSelectedPlan(plan.id)
                      setShowSubmitDialog(true)
                    }}
                  >
                    {isProcessing && selectedPlan === plan.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Submitting...
                      </>
                    ) : accountStatus === 'active' ? (
                      'Verified'
                    ) : price === 0 ? (
                      'Free'
                    ) : (
                      <>
                        Submit Payment
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Verification History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Payment Submission History
          </CardTitle>
          <CardDescription>Your submitted payment verifications and their status</CardDescription>
        </CardHeader>
        <CardContent>
          {verificationHistory.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verificationHistory.map((v) => (
                  <TableRow key={v._id || v.id}>
                    <TableCell className="text-sm">
                      {formatDate(v.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-mono text-xs">{v.transactionId}</span>
                        {v.adminNote && (
                          <span className="text-xs text-muted-foreground mt-1">
                            Note: {v.adminNote}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatPrice(v.amount)} {v.currency}
                    </TableCell>
                    <TableCell className="capitalize text-sm">
                      {v.paymentMethod.replace('_', ' ')}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(v.status)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No payment submissions yet</p>
              <p className="text-sm mt-1">
                Pick a plan above and submit your payment transaction details for admin verification.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancel Subscription Dialog - kept for legacy UI but
          the manual activation flow doesn't have a real subscription
          record to cancel. */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-6 w-6 text-yellow-500" />
              Cancel Subscription?
            </DialogTitle>
            <DialogDescription>
              In the manual activation flow, account access is managed by our team. Please contact support to cancel your subscription.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(false)}
              className="cursor-pointer"
            >
              Close
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelSubscription}
              disabled={isProcessing}
              className="cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancelling...
                </>
              ) : (
                'Contact Support'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Payment Submission Dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={(open) => {
        setShowSubmitDialog(open)
        if (!open) {
          setSubmitForm({
            paymentMethod: 'bank_transfer',
            transactionId: '',
            proofUrl: '',
            notes: '',
          })
          setSelectedPlan(null)
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              Submit Payment for Verification
            </DialogTitle>
            <DialogDescription>
              Pay externally (bank transfer, EasyPaisa, JazzCash) then submit your transaction details below. An admin will review and activate your account shortly.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitPayment} className="space-y-4 mt-2">
            {/* Plan summary */}
            {selectedPlan && (() => {
              const plan = plans.find(p => p.id === selectedPlan)
              if (!plan) return null
              const price = isYearly ? plan.price.yearly : plan.price.monthly
              return (
                <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Plan</span>
                    <span className="font-medium">{plan.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Billing</span>
                    <span className="font-medium">{isYearly ? 'Yearly' : 'Monthly'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount due</span>
                    <span className="font-bold text-primary">{formatPrice(price)}</span>
                  </div>
                </div>
              )
            })()}

            {/* Payment method */}
            <div className="space-y-2">
              <Label htmlFor="payment-method">Payment Method</Label>
              <Select
                value={submitForm.paymentMethod}
                onValueChange={(v) => setSubmitForm(prev => ({ ...prev, paymentMethod: v as any }))}
              >
                <SelectTrigger id="payment-method" className="cursor-pointer">
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer" className="cursor-pointer">Bank Transfer</SelectItem>
                  <SelectItem value="easypaisa" className="cursor-pointer">EasyPaisa</SelectItem>
                  <SelectItem value="jazzcash" className="cursor-pointer">JazzCash</SelectItem>
                  <SelectItem value="other" className="cursor-pointer">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Transaction ID */}
            <div className="space-y-2">
              <Label htmlFor="transaction-id">Transaction ID / Reference *</Label>
              <Input
                id="transaction-id"
                type="text"
                placeholder="e.g. TRX1234567890"
                value={submitForm.transactionId}
                onChange={(e) => setSubmitForm(prev => ({ ...prev, transactionId: e.target.value }))}
                required
                minLength={3}
                className="cursor-text"
              />
              <p className="text-xs text-muted-foreground">
                Enter the reference number from your payment confirmation.
              </p>
            </div>

            {/* Proof URL (optional) */}
            <div className="space-y-2">
              <Label htmlFor="proof-url">Receipt/Screenshot URL (optional)</Label>
              <Input
                id="proof-url"
                type="url"
                placeholder="https://..."
                value={submitForm.proofUrl}
                onChange={(e) => setSubmitForm(prev => ({ ...prev, proofUrl: e.target.value }))}
                className="cursor-text"
              />
              <p className="text-xs text-muted-foreground">
                Link to a screenshot of your payment receipt (Google Drive, Dropbox, etc.).
              </p>
            </div>

            {/* Notes (optional) */}
            <div className="space-y-2">
              <Label htmlFor="notes">Additional Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any additional information for the admin reviewer..."
                value={submitForm.notes}
                onChange={(e) => setSubmitForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={3}
                className="cursor-text"
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowSubmitDialog(false)}
                disabled={isProcessing}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isProcessing || !submitForm.transactionId.trim()}
                className="cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Submit for Verification
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
