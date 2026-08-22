'use client'

import React, { useState, useEffect } from 'react'
import { useQuery, useAction } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { 
  CreditCard, 
  Crown, 
  Zap,
  Check,
  X,
  Calendar,
  DollarSign,
  TrendingUp,
  ArrowLeft,
  RefreshCw,
  Download,
  AlertTriangle,
  Rocket,
  Star,
  Building2,
  HelpCircle
} from 'lucide-react'
import Link from 'next/link'

// Plan types
interface Plan {
  _id?: string
  name: string
  description: string
  priceMonthly: number
  priceYearly: number
  currency: string
  features: string[]
  limitations: string[]
  popular: boolean
  active: boolean
  maxAiGenerations: number
  maxStorageMb: number
  icon: string
}

interface Subscription {
  _id: string
  planId: string
  status: string
  currentPeriodStart: number
  currentPeriodEnd: number
  cancelAtPeriodEnd: boolean
}

interface Payment {
  _id: string
  amount: number
  currency: string
  status: string
  description: string
  createdAt: number
}

export default function BillingPage() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  
  // Mock data - replace with actual Convex queries
  const plans: Plan[] = [
    {
      name: 'Free',
      description: 'Perfect for trying out Filo',
      priceMonthly: 0,
      priceYearly: 0,
      currency: 'PKR',
      features: [
        '5 AI generations per month',
        'Basic document templates',
        'Community support',
        '1 GB storage'
      ],
      limitations: [
        'No custom branding',
        'No priority generation',
        'Watermark on exports'
      ],
      popular: false,
      active: true,
      maxAiGenerations: 5,
      maxStorageMb: 1024,
      icon: 'zap'
    },
    {
      name: 'Pro',
      description: 'For professionals and small teams',
      priceMonthly: 2999,
      priceYearly: 29900,
      currency: 'PKR',
      features: [
        '100 AI generations per month',
        'All document formats',
        'Custom branding',
        'Priority email support',
        '10 GB storage',
        'No watermarks',
        'API access'
      ],
      limitations: [],
      popular: true,
      active: true,
      maxAiGenerations: 100,
      maxStorageMb: 10240,
      icon: 'crown'
    },
    {
      name: 'Enterprise',
      description: 'For large teams with advanced needs',
      priceMonthly: 9999,
      priceYearly: 99900,
      currency: 'PKR',
      features: [
        'Unlimited AI generations',
        'All Pro features +',
        'Dedicated account manager',
        'Custom integrations',
        'SLA guarantee',
        '100 GB storage',
        'Team collaboration',
        'Advanced analytics',
        'SSO/SAML authentication'
      ],
      limitations: [],
      popular: false,
      active: true,
      maxAiGenerations: -1, // unlimited
      maxStorageMb: 102400,
      icon: 'building'
    }
  ]

  const currentSubscription: Subscription | null = {
    _id: 'sub_123',
    planId: 'pro', // This would be the actual plan ID
    status: 'active',
    currentPeriodStart: Date.now() - 15 * 24 * 60 * 60 * 1000,
    currentPeriodEnd: Date.now() + 15 * 24 * 60 * 60 * 1000,
    cancelAtPeriodEnd: false
  }

  const recentPayments: Payment[] = [
    {
      _id: 'pay_1',
      amount: 2999,
      currency: 'PKR',
      status: 'completed',
      description: 'Pro Plan - Monthly',
      createdAt: Date.now() - 15 * 24 * 60 * 60 * 1000
    },
    {
      _id: 'pay_2',
      amount: 2999,
      currency: 'PKR',
      status: 'completed',
      description: 'Pro Plan - Monthly',
      createdAt: Date.now() - 45 * 24 * 60 * 60 * 1000
    }
  ]

  const currentPlan = plans.find(p => p.name.toLowerCase() === currentSubscription?.planId)

  const handleSubscribe = async (planName: string) => {
    setSelectedPlan(planName)
    
    // In real implementation, this would call Safepay checkout
    console.log(`Subscribing to ${planName} plan...`)
    
    // Simulate redirect to payment
    alert(`Redirecting to Safepay checkout for ${planName} plan...`)
  }

  const handleCancelSubscription = async () => {
    // In real implementation, this would call cancel mutation
    console.log('Cancelling subscription...')
    setShowCancelDialog(false)
    alert('Subscription will be cancelled at the end of the billing period.')
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const formatCurrency = (amount: number, currency: string = 'PKR') => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0
    }).format(amount)
  }

  const getPlanIcon = (iconName: string) => {
    switch (iconName) {
      case 'zap': return <Zap className="h-6 w-6" />
      case 'crown': return <Crown className="h-6 w-6" />
      case 'building': return <Building2 className="h-6 w-6" />
      default: return <Star className="h-6 w-6" />
    }
  }

  return (
    <div className="min-h-screen bg-background p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link href="/" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <h1 className="text-3xl font-bold tracking-tight">Billing & Subscription</h1>
            </div>
            <p className="text-muted-foreground">
              Manage your subscription plan and billing information
            </p>
          </div>
          {currentSubscription && (
            <Badge 
              variant={currentSubscription.status === 'active' ? 'default' : 'secondary'}
              className={currentSubscription.status === 'active' ? 'bg-green-500' : ''}
            >
              {currentSubscription.status === 'active' ? 'Active' : currentSubscription.status}
            </Badge>
          )}
        </div>
      </div>

      {/* Current Plan Overview */}
      {currentSubscription && currentPlan && (
        <Card className="mb-8 border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-xl text-primary">
                  {getPlanIcon(currentPlan.icon)}
                </div>
                <div>
                  <h2 className="text-xl font-bold">{currentPlan.name} Plan</h2>
                  <p className="text-muted-foreground">{currentPlan.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-sm">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      Next billing: {formatDate(currentSubscription.currentPeriodEnd)}
                    </span>
                    {currentSubscription.cancelAtPeriodEnd && (
                      <Badge variant="outline" className="text-orange-600 border-orange-600">
                        Cancels on {formatDate(currentSubscription.currentPeriodEnd)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">
                  {formatCurrency(
                    billingCycle === 'monthly' ? currentPlan.priceMonthly : currentPlan.priceYearly / 12
                  )}
                  <span className="text-sm font-normal text-muted-foreground">/{billingCycle === 'monthly' ? 'mo' : 'mo'}</span>
                </p>
                {!currentSubscription.cancelAtPeriodEnd && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2 text-destructive hover:text-destructive"
                    onClick={() => setShowCancelDialog(true)}
                  >
                    Cancel Plan
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Usage Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">AI Generations</p>
                <p className="text-2xl font-bold">
                  23<span className="text-sm font-normal text-muted-foreground">/100</span>
                </p>
              </div>
              <Zap className="h-8 w-8 text-blue-500" />
            </div>
            <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full" style={{ width: '23%' }}></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Storage Used</p>
                <p className="text-2xl font-bold">
                  2.4<span className="text-sm font-normal text-muted-foreground">/10 GB</span>
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-500" />
            </div>
            <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full" style={{ width: '24%' }}></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">This Month</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(currentPlan?.priceMonthly || 0)}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plan Selection */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">{currentSubscription ? 'Change Plan' : 'Choose a Plan'}</h2>
          
          {/* Billing Cycle Toggle */}
          <div className="flex items-center gap-3 bg-muted p-1 rounded-lg">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                billingCycle === 'monthly' ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                billingCycle === 'yearly' ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
            >
              Yearly
              <Badge variant="secondary" className="ml-2 text-green-600 bg-green-100">
                Save 17%
              </Badge>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <Card 
              key={plan.name} 
              className={`relative ${plan.popular ? 'border-primary shadow-lg scale-105 z-10' : ''} ${
                currentPlan?.name === plan.name ? 'ring-2 ring-primary' : ''
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground px-3">
                    <Star className="h-3 w-3 mr-1" />
                    Most Popular
                  </Badge>
                </div>
              )}
              
              <CardHeader className="text-center pb-4">
                <div className={`mx-auto p-3 rounded-xl ${plan.popular ? 'bg-primary/10 text-primary' : 'bg-muted'}`}>
                  {getPlanIcon(plan.icon)}
                </div>
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-4">
                  <span className="text-3xl font-bold">
                    {formatCurrency(billingCycle === 'monthly' ? plan.priceMonthly : plan.priceYearly)}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    /{billingCycle === 'monthly' ? 'month' : 'year'}
                  </span>
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
                  {plan.limitations.map((limitation, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-muted-foreground">
                      <X className="h-5 w-5 text-gray-400 mt-0.5 shrink-0" />
                      <span className="text-sm">{limitation}</span>
                    </li>
                  ))}
                </ul>

                <Button 
                  className="w-full mt-6"
                  variant={currentPlan?.name === plan.name ? 'outline' : plan.popular ? 'default' : 'secondary'}
                  disabled={currentPlan?.name === plan.name}
                  onClick={() => handleSubscribe(plan.name)}
                >
                  {currentPlan?.name === plan.name ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Current Plan
                    </>
                  ) : plan.priceMonthly === 0 ? (
                    'Downgrade to Free'
                  ) : (
                    <>
                      <Rocket className="h-4 w-4 mr-2" />
                      Upgrade to {plan.name}
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Payment History */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Payment History</CardTitle>
              <CardDescription>Your recent transactions and invoices</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentPayments.map((payment) => (
              <div key={payment._id} className="flex items-center justify-between py-3 border-b last:border-0">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${
                    payment.status === 'completed' ? 'bg-green-100' : 'bg-red-100'
                  }`}>
                    <CreditCard className={`h-5 w-5 ${
                      payment.status === 'completed' ? 'text-green-600' : 'text-red-600'
                    }`} />
                  </div>
                  <div>
                    <p className="font-medium">{payment.description}</p>
                    <p className="text-sm text-muted-foreground">{formatDate(payment.createdAt)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatCurrency(payment.amount, payment.currency)}</p>
                  <Badge 
                    variant={payment.status === 'completed' ? 'secondary' : 'destructive'}
                    className={payment.status === 'completed' ? 'bg-green-100 text-green-700' : ''}
                  >
                    {payment.status}
                  </Badge>
                </div>
              </div>
            ))}
            
            {recentPayments.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No payment history yet
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cancel Dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="max-w-md w-full mx-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-orange-600">
                <AlertTriangle className="h-5 w-5" />
                Cancel Subscription?
              </CardTitle>
              <CardDescription>
                Are you sure you want to cancel your subscription? You'll lose access to Pro features at the end of your billing period.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
                  Keep Subscription
                </Button>
                <Button variant="destructive" onClick={handleCancelSubscription}>
                  Yes, Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Help Section */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <HelpCircle className="h-6 w-6 text-muted-foreground" />
              <div>
                <p className="font-medium">Need help with billing?</p>
                <p className="text-sm text-muted-foreground">
                  Contact our support team for assistance with payments, refunds, or plan changes
                </p>
              </div>
            </div>
            <Button variant="outline">
              Contact Support
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
