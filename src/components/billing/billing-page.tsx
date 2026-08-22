'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
  DialogTrigger,
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
  Sparkles
} from 'lucide-react'
import { getDefaultPlans, currencyConfig, type PlanConfig } from '@/config/plans'

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

  // TODO: Replace with real usage data from API
  const usageData = {
    aiGenerations: { used: 23, limit: 50, percentage: 46 },
    storage: { used: 34, limit: 100, percentage: 34, unit: 'MB' },
    artifacts: { used: 8, limit: 20, percentage: 40 },
  }

  // TODO: Replace with real payment history from API
  const paymentHistory = [
    {
      id: 'pay_001',
      date: new Date('2024-01-15'),
      amount: 190,
      currency: currencyConfig.code,
      status: 'completed',
      description: 'Pro Plan - January 2024',
      invoiceId: 'inv_001',
    },
  ]

  const handleSubscribe = async (planId: string) => {
    setIsProcessing(true)
    
    try {
      console.log('Subscribing to plan:', planId)
      
      // In production:
      // 1. Call POST /api/payments/create with planId
      // 2. Get redirect URL to PayFast
      // 3. window.location.href = redirectUrl
      
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      alert(`In production, this would redirect to PayFast for plan: ${planId}`)
    } catch (error) {
      console.error('Subscription error:', error)
    } finally {
      setIsProcessing(false)
      setSelectedPlan(null)
    }
  }

  const handleCancelSubscription = async () => {
    setIsProcessing(true)
    
    try {
      // In production: call POST /api/subscriptions/cancel
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      setShowCancelDialog(false)
      alert('Subscription cancellation processed')
    } catch (error) {
      console.error('Cancellation error:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const formatPrice = (amount: number): string => {
    return `${currencyConfig.symbol}${amount}`
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <CreditCard className="h-8 w-8 text-primary" />
          Billing
        </h1>
        <p className="mt-2 text-muted-foreground">
          Manage your subscription, payment methods, and usage
        </p>
      </div>

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
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-semibold">Free Plan</span>
                  <Badge variant="secondary" className="cursor-default">Active</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  No payment required • Limited features
                </p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <Button 
                variant="outline"
                onClick={() => setShowCancelDialog(true)}
                disabled={true}
                className="cursor-pointer"
              >
                Cancel Plan
              </Button>
              <Button 
                onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' })}
                className="cursor-pointer"
              >
                Upgrade Plan
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
                <span>{usageData.aiGenerations.used} / {usageData.aiGenerations.limit}</span>
                <span className="text-muted-foreground">{usageData.aiGenerations.percentage}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden cursor-default">
                <div 
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${usageData.aiGenerations.percentage}%` }}
                />
              </div>
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
                This month's creations
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plans Section */}
      <section id="plans">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Star className="h-6 w-6 text-yellow-500" />
          Choose a Plan
        </h2>
        
        <div className="grid gap-8 md:grid-cols-3">
          {plans.map((plan) => {
            const IconComponent = iconMap[plan.icon] || Zap
            return (
              <Card 
                key={plan.id}
                className={`relative flex flex-col cursor-pointer transition-all duration-200 hover:shadow-lg ${
                  plan.popular ? 'border-primary shadow-lg scale-105' : ''
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="px-3 py-1 gap-1 cursor-default">
                      <Star className="h-3 w-3" />
                      Most Popular
                    </Badge>
                  </div>
                )}
                
                <CardHeader className="text-center pb-4">
                  <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-xl ${
                    plan.popular ? 'bg-primary/10' : 'bg-muted'
                  }`}>
                    <IconComponent className={`h-7 w-7 ${plan.popular ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  
                  <CardTitle className="mt-4">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  
                  <div className="mt-4">
                    {plan.price.monthly > 0 ? (
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="text-4xl font-bold">{formatPrice(plan.price.monthly)}</span>
                        <span className="text-muted-foreground">/month</span>
                      </div>
                    ) : plan.price.yearly > 0 ? (
                      <div className="text-center">
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-4xl font-bold">{formatPrice(plan.price.yearly)}</span>
                          <span className="text-muted-foreground">/year</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          ~{formatPrice(Math.round(plan.price.yearly / 12))}/month
                        </p>
                      </div>
                    ) : (
                      <div className="text-4xl font-bold">Free</div>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="flex-1 space-y-4">
                  {/* Features */}
                  <ul className="space-y-3">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                    
                    {plan.limitations && plan.limitations.length > 0 && (
                      <>
                        <Separator />
                        {plan.limitations.map((limitation, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <X className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                            <span className="text-sm text-muted-foreground">{limitation}</span>
                          </li>
                        ))}
                      </>
                    )}
                  </ul>

                  {/* CTA Button */}
                  <Button 
                    className="w-full mt-6 cursor-pointer hover:shadow-md transition-all"
                    variant={plan.id === 'free' ? "secondary" : plan.popular ? "default" : "outline"}
                    disabled={plan.id === 'free' || isProcessing}
                    onClick={() => plan.id !== 'free' && handleSubscribe(plan.id)}
                  >
                    {isProcessing && selectedPlan === plan.id ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        {plan.cta}
                        {!plan.id.includes('free') && <ArrowRight className="ml-2 h-4 w-4" />}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {/* Payment History */}
      <section>
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Calendar className="h-6 w-6" />
          Payment History
        </h2>
        
        <Card>
          <CardContent className="pt-6">
            {paymentHistory.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Invoice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentHistory.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium">
                        {payment.date.toLocaleDateString()}
                      </TableCell>
                      <TableCell>{payment.description}</TableCell>
                      <TableCell>
                        {formatPrice(payment.amount)} {payment.currency}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={payment.status === 'completed' ? 'default' : 'secondary'}
                          className="cursor-default"
                        >
                          {payment.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="gap-1 cursor-pointer">
                          <Download className="h-3.5 w-3.5" />
                          PDF
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-12 text-center">
                <CreditCard className="mx-auto h-12 w-12 text-muted-foreground/30" />
                <h3 className="mt-4 font-semibold">No payments yet</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Upgrade your plan to see payment history here
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Cancellation Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Cancel Subscription?
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel your subscription? You'll lose access to Pro features at the end of your billing period.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-muted p-4">
              <h4 className="font-semibold mb-2">What happens when you cancel:</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600" /> Access continues until end of current period</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600" /> Downgraded to Free plan automatically</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600" /> Data and artifacts are preserved</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600" /> Can re-subscribe anytime</li>
              </ul>
            </div>
          </div>

          <DialogFooter className="gap-3">
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
              {isProcessing ? 'Processing...' : 'Yes, Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
