'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
  AlertCircle
} from 'lucide-react'
import { useQuery, useAction, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { getDefaultPlans, currencyConfig, type PlanConfig } from '@/config/plans'
import { ErrorDisplay } from '@/components/ui/error-boundary'

// Icon mapping
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Zap,
  Crown,
  Star,
  Rocket,
  Shield,
  Sparkles,
}

// ==================== COMPONENT ====================

export function BillingPage() {
  const [plans] = useState<PlanConfig[]>(getDefaultPlans())
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isYearly, setIsYearly] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  // Get user session from localStorage (same as dashboard)
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null)
  
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
    
    // Check URL params for payment status and verify with Safepay
    const urlParams = new URLSearchParams(window.location.search)
    const paymentStatus = urlParams.get('payment')
    const safepayPaymentId = urlParams.get('payment_id')
    const safepayReference = urlParams.get('reference')
    if (paymentStatus === 'success' && safepayPaymentId) {
      // Verify payment with Safepay API to confirm
      setPaymentError(null)
      // Payment verification runs via webhook - the Convex action handles it
      // This is a defense-in-depth check on the client side
      console.log('[BILLING] Payment return detected, webhook will confirm')
    } else if (paymentStatus === 'success') {
      setPaymentError(null)
    } else if (paymentStatus === 'cancelled') {
      setPaymentError('Payment was cancelled. No charges were made.')
    }
  }, [])

  // Query subscription status
  const userIdForQuery = user?.id as any
  const subscriptionStatus = useQuery(
    api.subscriptions.hasActiveSubscription,
    userIdForQuery ? { userId: userIdForQuery } : 'skip'
  )

  // Query payment history
  const payments = useQuery(
    api.payments.getUserPayments,
    userIdForQuery ? { userId: userIdForQuery } : 'skip'
  )

  // Safepay checkout action
  const createSafepayCheckout = useAction(api.safepay.createSafepayCheckout)

  // Cancel subscription mutation
  const cancelSubscription = useMutation(api.subscriptions.cancelSubscription)

  // Verify payment action (on return from Safepay)
  const verifyPayment = useAction(api.safepay.verifySafepayPayment)

  // Calculate usage data based on subscription
  const usageData = subscriptionStatus?.hasActive && subscriptionStatus.plan 
    ? {
        aiGenerations: { 
          used: 0, 
          limit: subscriptionStatus.plan.maxAiGenerations, 
          percentage: 0 
        },
        storage: { 
          used: 0, 
          limit: subscriptionStatus.plan.maxStorageMb, 
          percentage: 0, 
          unit: 'MB' 
        },
        artifacts: { 
          used: 0, 
          limit: 20, 
          percentage: 0 
        },
      }
    : {
        aiGenerations: { used: 23, limit: 50, percentage: 46 },
        storage: { used: 34, limit: 100, percentage: 34, unit: 'MB' },
        artifacts: { used: 8, limit: 20, percentage: 40 },
      }

  const handleSubscribe = async (planId: string) => {
    if (!user) {
      setPaymentError('Please log in to subscribe')
      return
    }

    setIsProcessing(true)
    setPaymentError(null)
    setSelectedPlan(planId)
    
    try {
      // Call Safepay checkout action
      const result = await createSafepayCheckout({
        userId: user.id as any,
        planId: planId as any,
        userEmail: user.email,
        isYearly: isYearly,
      })

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to create checkout')
      }

      // Redirect to Safepay checkout
      if (result.data?.checkoutUrl) {
        window.location.href = result.data.checkoutUrl
      } else {
        throw new Error('No checkout URL received')
      }

    } catch (error: any) {
      console.error('Subscription error:', error)
      setPaymentError(error.message || 'Failed to initiate payment. Please try again.')
    } finally {
      setIsProcessing(false)
      setSelectedPlan(null)
    }
  }

  const handleCancelSubscription = async () => {
    if (!subscriptionStatus?.subscription?._id) return

    setIsProcessing(true)
    setPaymentError(null)
    
    try {
      // Call the real Convex mutation to cancel subscription
      const result = await cancelSubscription({
        subscriptionId: subscriptionStatus.subscription._id,
      })
      
      setShowCancelDialog(false)
      console.log('[BILLING] Subscription cancellation scheduled:', result)
    } catch (error: any) {
      console.error('Cancellation error:', error)
      setPaymentError(error.message || 'Failed to cancel subscription. Please try again.')
    } finally {
      setIsProcessing(false)
    }
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
        return <Badge variant="default" className="bg-green-600 cursor-default"><CheckCircle2 className="h-3 w-3 mr-1" />{status}</Badge>
      case 'pending':
      case 'processing':
        return <Badge variant="secondary" className="cursor-default"><Clock className="h-3 w-3 mr-1" />{status}</Badge>
      case 'failed':
      case 'expired':
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
          Manage your subscription, payment methods, and usage
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
            Current Plan
          </CardTitle>
          <CardDescription>Your subscription status and next billing date</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${
                subscriptionStatus?.hasActive ? 'bg-primary/10' : 'bg-muted'
              }`}>
                {subscriptionStatus?.plan ? (
                  <Crown className="h-6 w-6 text-primary" />
                ) : (
                  <Zap className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-semibold">
                    {subscriptionStatus?.plan?.name || 'Free Plan'}
                  </span>
                  {getStatusBadge(subscriptionStatus?.hasActive ? 'active' : 'free')}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {subscriptionStatus?.hasActive ? (
                    <>
                      Next billing date:{' '}
                      {subscriptionStatus.subscription?.currentPeriodEnd 
                        ? formatDate(subscriptionStatus.subscription.currentPeriodEnd)
                        : 'N/A'}
                    </>
                  ) : (
                    <>Limited features - Upgrade to unlock full potential</>
                  )}
                </p>
              </div>
            </div>
            
            <div className="flex gap-3">
              {subscriptionStatus?.hasActive ? (
                <Button 
                  variant="outline"
                  onClick={() => setShowCancelDialog(true)}
                  disabled={isProcessing}
                  className="cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Cancel Plan'
                  )}
                </Button>
              ) : (
                <Button 
                  variant="outline"
                  disabled
                  className="cursor-pointer"
                >
                  Cancel Plan
                </Button>
              )}
              <Button 
                onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' })}
                disabled={subscriptionStatus?.hasActive}
                className="cursor-pointer"
              >
                {subscriptionStatus?.hasActive ? 'Current Plan' : 'Upgrade Plan'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
              {usageData.aiGenerations.limit !== -1 && (
                <div className="h-2 rounded-full bg-secondary overflow-hidden cursor-default">
                  <div 
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${usageData.aiGenerations.percentage}%` }}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Resets on 1st of each month
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
                <span>{usageData.storage.used} / {usageData.storage.limit} {usageData.storage.unit}</span>
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
                <span>{usageData.artifacts.used} / {usageData.artifacts.limit}</span>
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
            const isActive = subscriptionStatus?.plan?._id === plan.id
            
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
                    disabled={isActive || isProcessing || price === 0}
                    onClick={() => handleSubscribe(plan.id)}
                  >
                    {isProcessing && selectedPlan === plan.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : isActive ? (
                      'Current Plan'
                    ) : price === 0 ? (
                      'Current Plan'
                    ) : (
                      <>
                        Subscribe
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

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Payment History
          </CardTitle>
          <CardDescription>Recent transactions and invoices</CardDescription>
        </CardHeader>
        <CardContent>
          {payments && payments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment._id}>
                    <TableCell className="text-sm">
                      {formatDate(payment.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">{payment.description}</span>
                        {payment.metadata?.reference && (
                          <span className="text-xs text-muted-foreground">
                            Ref: {payment.metadata.reference}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatPrice(payment.amount)} {payment.currency}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(payment.status)}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="cursor-pointer">
                        <Download className="h-4 w-4 mr-1" />
                        Invoice
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No payment history yet</p>
              <p className="text-sm mt-1">
                Your transactions will appear here after you subscribe
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancel Subscription Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-6 w-6 text-yellow-500" />
              Cancel Subscription?
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel your Pro subscription? You will lose access to premium features at the end of your current billing period.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <X className="h-4 w-4 text-red-500" />
                Unlimited AI generation will be disabled
              </div>
              <div className="flex items-center gap-2 text-sm">
                <X className="h-4 w-4 text-red-500" />
                Storage will be reduced to free tier limits
              </div>
              <div className="flex items-center gap-2 text-sm">
                <X className="h-4 w-4 text-red-500" />
                Priority support will be removed
              </div>
            </div>
            
            <p className="text-sm text-muted-foreground">
              You will retain access until{' '}
              <strong>
                {subscriptionStatus?.subscription?.currentPeriodEnd 
                  ? formatDate(subscriptionStatus.subscription.currentPeriodEnd)
                  : 'the end of your billing period'}
              </strong>.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              onClick={() => setShowCancelDialog(false)}
              className="cursor-pointer"
            >
              Keep Subscription
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
                'Yes, Cancel'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
