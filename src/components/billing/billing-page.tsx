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
  ExternalLink
} from 'lucide-react'

// ==================== PLAN DATA ====================

const plans = [
  {
    id: 'free',
    name: 'Free',
    description: 'Perfect for trying Filo',
    price: { monthly: 0, yearly: 0 },
    icon: Zap,
    features: [
      '50 AI generations per month',
      '100MB cloud storage',
      'Basic document types',
      'Standard exports (DOCX, PDF)',
      'Community support',
    ],
    limitations: [
      'Limited AI models',
      'No brand profiles',
      'Watermark on exports',
      'Standard processing priority',
    ],
    cta: 'Current Plan',
    current: true,
    popular: false,
  },
  {
    id: 'pro-monthly',
    name: 'Pro Monthly',
    description: 'For professionals and power users',
    price: { monthly: 190, yearly: 0 }, // R190/month
    icon: Crown,
    features: [
      '500 AI generations per month',
      '5GB cloud storage',
      'All document types',
      'Priority processing',
      'Brand profiles',
      'Advanced exports (XLSX, PPTX, CSV)',
      'Email support',
      'No watermarks',
    ],
    limitations: [],
    cta: 'Upgrade to Pro',
    current: false,
    popular: true,
  },
  {
    id: 'pro-yearly',
    name: 'Pro Yearly',
    description: 'Best value - save 2 months',
    price: { monthly: 0, yearly: 1900 }, // R1900/year
    icon: Crown,
    features: [
      '600 AI generations per month',
      '5GB cloud storage',
      'All document types',
      'Priority processing',
      'Brand profiles',
      'Advanced exports',
      'Priority email support',
      'No watermarks',
      'Save ~R380 vs monthly',
    ],
    limitations: [],
    cta: 'Upgrade & Save',
    current: false,
    popular: false,
  },
]

// ==================== USAGE DATA ====================

const usageData = {
  aiGenerations: { used: 23, limit: 50, percentage: 46 },
  storage: { used: 34, limit: 100, percentage: 34, unit: 'MB' },
  artifacts: { used: 8, limit: 20, percentage: 40 },
}

// ==================== PAYMENT HISTORY ====================

const paymentHistory = [
  {
    id: 'pay_001',
    date: new Date('2024-01-15'),
    amount: 190,
    currency: 'ZAR',
    status: 'completed',
    description: 'Pro Plan - January 2024',
    invoiceId: 'inv_001',
  },
  {
    id: 'pay_002',
    date: new Date('2023-12-15'),
    amount: 190,
    currency: 'ZAR',
    status: 'completed',
    description: 'Pro Plan - December 2023',
    invoiceId: 'inv_002',
  },
]

export function BillingPage() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleSubscribe = async (planId: string) => {
    setIsProcessing(true)
    
    try {
      // In production, this would:
      // 1. Create PayFast payment request
      // 2. Redirect to PayFast or show payment modal
      // 3. Handle callback via webhook
      
      console.log('Subscribing to plan:', planId)
      
      // Simulate payment redirect
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
      // In production, cancel via PayFast API
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      setShowCancelDialog(false)
      alert('Subscription cancellation processed')
    } catch (error) {
      console.error('Cancellation error:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
        <p className="mt-2 text-muted-foreground">
          Manage your subscription, payment methods, and usage
        </p>
      </div>

      {/* Current Plan Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Current Plan
          </CardTitle>
          <CardDescription>Your subscription status and next billing date</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Crown className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-semibold">Free Plan</span>
                  <Badge variant="secondary">Active</Badge>
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
                disabled={true} // No active subscription to cancel
              >
                Cancel Plan
              </Button>
              <Button onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' })}>
                Upgrade Plan
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage Overview */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">AI Generations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{usageData.aiGenerations.used} / {usageData.aiGenerations.limit}</span>
                <span className="text-muted-foreground">{usageData.aiGenerations.percentage}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Storage Used</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{usageData.storage.used} / {usageData.storage.limit} {usageData.storage.unit}</span>
                <span className="text-muted-foreground">{usageData.storage.percentage}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Artifacts Created</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{usageData.artifacts.used} / {usageData.artifacts.limit}</span>
                <span className="text-muted-foreground">{usageData.artifacts.percentage}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
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
        <h2 className="text-2xl font-bold mb-6">Choose a Plan</h2>
        
        <div className="grid gap-8 md:grid-cols-3">
          {plans.map((plan) => (
            <Card 
              key={plan.id}
              className={`relative flex flex-col ${
                plan.popular ? 'border-primary shadow-lg scale-105' : ''
              } ${plan.current ? 'bg-muted/30' : ''}`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="px-3 py-1">Most Popular</Badge>
                </div>
              )}
              
              <CardHeader className="text-center pb-4">
                <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-xl ${
                  plan.popular ? 'bg-primary/10' : 'bg-muted'
                }`}>
                  <plan.icon className={`h-7 w-7 ${plan.popular ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                
                <CardTitle className="mt-4">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                
                <div className="mt-4">
                  {plan.price.monthly > 0 ? (
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-4xl font-bold">R{plan.price.monthly}</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                  ) : plan.price.yearly > 0 ? (
                    <div className="text-center">
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="text-4xl font-bold">R{plan.price.yearly}</span>
                        <span className="text-muted-foreground">/year</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        ~R{(plan.price.yearly / 12).toFixed(0)}/month
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
                  
                  {plan.limitations.length > 0 && (
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
                  className="w-full mt-6"
                  variant={plan.current ? "secondary" : plan.popular ? "default" : "outline"}
                  disabled={plan.current || isProcessing}
                  onClick={() => !plan.current && handleSubscribe(plan.id)}
                >
                  {isProcessing && selectedPlan === plan.id ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : plan.cta}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Payment History */}
      <section>
        <h2 className="text-2xl font-bold mb-6">Payment History</h2>
        
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
                        R{payment.amount} {payment.currency}
                      </TableCell>
                      <TableCell>
                        <Badge variant={payment.status === 'completed' ? 'default' : 'secondary'}>
                          {payment.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="gap-1">
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
                <li>• Access continues until end of current period</li>
                <li>• Downgraded to Free plan automatically</li>
                <li>• Data and artifacts are preserved</li>
                <li>• Can re-subscribe anytime</li>
              </ul>
            </div>
          </div>

          <DialogFooter className="gap-3">
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
              Keep Subscription
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleCancelSubscription}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Yes, Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
