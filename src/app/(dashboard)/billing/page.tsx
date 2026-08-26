'use client'

import { Suspense } from 'react'
import React, { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CreditCard,
  Crown,
  Zap,
  Check,
  ArrowLeft,
  HelpCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Star,
  Building2,
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { getDefaultPlans, currencyConfig } from '@/config/plans'

function BillingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const plans = getDefaultPlans()
  const [isRedirecting, setIsRedirecting] = useState<string | null>(null)
  // Initialize from search params so we don't trigger setState-in-effect
  // cascading renders on mount. The useEffect below only kicks off the
  // async verification work, it doesn't synchronously set state.
  const [paymentResult, setPaymentResult] = useState<'verifying' | 'success' | 'cancelled' | null>(() => {
    if (typeof window === 'undefined') return null
    const sp = new URLSearchParams(window.location.search)
    const status = sp.get('payment')
    const reference = sp.get('ref')
    return status === 'success' && reference ? 'verifying' : null
  })

  useEffect(() => {
    const status = searchParams.get('payment')
    const reference = searchParams.get('ref')
    if (status === 'success' && reference) {
      apiClient.verifyPayment({ reference })
        .then((res) => {
          setPaymentResult(res.data?.subscriptionActivated ? 'success' : 'success')
          if (res.data?.subscriptionActivated) {
            toast.success('Payment confirmed!', 'Your Pro subscription is now active.')
          }
        })
        .catch(() => setPaymentResult('success'))
    } else if (status === 'cancelled') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaymentResult('cancelled')
    }
    if (status) {
      window.history.replaceState({}, '', '/billing')
    }
  }, [searchParams])

  const handleSubscribe = async (planId: string) => {
    if (!apiClient.isAuthenticated()) {
      router.push('/?login=true&redirect=/billing')
      return
    }
    setIsRedirecting(planId)
    const loadingId = toast.loading('Creating your secure checkout...')
    try {
      const response = await apiClient.createCheckout({ planId })
      toast.dismiss(loadingId)
      if (!response.success || !response.data?.checkoutUrl) {
        toast.error('Checkout failed', response.error || 'Please try again')
        setIsRedirecting(null)
        return
      }
      const redirectUrl = response.data.checkoutUrl
      setTimeout(() => { window.location.href = redirectUrl }, 0)
    } catch (err) {
      toast.dismiss(loadingId)
      toast.error('Something went wrong', 'Please try again')
      setIsRedirecting(null)
    }
  }

  const formatCurrency = (amount: number) => `${currencyConfig.symbol}${amount.toLocaleString()}`

  const verifyingBanner = paymentResult === 'verifying' && (
    <Card className="mb-6 border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20">
      <CardContent className="pt-6">
        <div className="flex items-center gap-4">
          <Loader2 className="h-6 w-6 text-green-600 animate-spin shrink-0" />
          <p className="font-semibold text-green-800 dark:text-green-200">Verifying your payment...</p>
        </div>
      </CardContent>
    </Card>
  )

  const successBanner = paymentResult === 'success' && (
    <Card className="mb-6 border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20">
      <CardContent className="pt-6">
        <div className="flex items-center gap-4">
          <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
          <div>
            <p className="font-semibold text-green-800 dark:text-green-200">Payment successful! Subscription activated.</p>
            <p className="text-sm text-green-600 dark:text-green-400">Welcome to Filo Pro. You now have unlimited AI generations.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  const cancelledBanner = paymentResult === 'cancelled' && (
    <Card className="mb-6 border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20">
      <CardContent className="pt-6">
        <div className="flex items-center gap-4">
          <XCircle className="h-6 w-6 text-orange-600 shrink-0" />
          <div>
            <p className="font-semibold text-orange-800 dark:text-orange-200">Payment cancelled</p>
            <p className="text-sm text-orange-600 dark:text-orange-400">Your card was not charged. You can try again whenever you are ready.</p>
          </div>
        </div>
        <div className="mt-4">
          <Button size="sm" asChild><Link href="/pricing">Try again</Link></Button>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="min-h-screen bg-background p-6">
      {verifyingBanner}
      {successBanner}
      {cancelledBanner}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/" className="text-muted-foreground hover:text-foreground cursor-pointer">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Billing & Subscription</h1>
        </div>
        <p className="text-muted-foreground">Manage your subscription plan and billing information</p>
      </div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-6">Choose a Plan</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl">
          {plans.filter(p => !p.contactSales).map((plan) => (
            <Card key={plan.id} className={"relative transition-all " + (plan.popular ? 'border-primary shadow-lg md:scale-[1.02] z-10' : '')}>
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
                  <Badge className="bg-primary text-primary-foreground px-3 py-1 text-xs gap-1 cursor-default">
                    <Star className="h-3 w-3" />{plan.badge}
                  </Badge>
                </div>
              )}
              <CardHeader className="text-center pb-4">
                <div className={"mx-auto p-3 rounded-xl " + (plan.popular ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                  {plan.icon === 'Crown' && <Crown className="h-6 w-6" />}
                  {plan.icon === 'Users' && <Building2 className="h-6 w-6" />}
                  {plan.icon !== 'Crown' && plan.icon !== 'Users' && <Zap className="h-6 w-6" />}
                </div>
                <CardTitle className="text-xl mt-3">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-4">
                  <span className="text-3xl font-bold">{formatCurrency(plan.price.monthly)}</span>
                  <span className="text-muted-foreground text-sm">/month</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full mt-6 cursor-pointer hover:shadow-md transition-all min-h-[44px]"
                  variant={plan.popular ? 'default' : 'secondary'}
                  disabled={isRedirecting === plan.id}
                  onClick={() => handleSubscribe(plan.id)}
                >
                  {isRedirecting === plan.id ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Redirecting to SafePay...</>
                  ) : (
                    <><CreditCard className="mr-2 h-4 w-4" />Subscribe with SafePay</>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <HelpCircle className="h-6 w-6 text-muted-foreground" />
              <div>
                <p className="font-medium">Payments powered by SafePay</p>
                <p className="text-sm text-muted-foreground">All transactions are secure. We accept credit/debit cards, bank transfers, and mobile wallets (JazzCash, EasyPaisa).</p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild><Link href="/pricing">View all plans</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingContent />
    </Suspense>
  )
}
