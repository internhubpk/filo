'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Check,
  Crown,
  Users,
  Building2,
  ArrowLeft,
  ArrowRight,
  Star,
  Rocket,
  Shield,
  Sparkles,
  CreditCard,
  Phone,
  Mail,
  Sun,
  Moon,
  X
} from 'lucide-react'
import { getDefaultPlans, currencyConfig, contactSalesUrl, type PlanConfig } from '@/config/plans'
import { useTheme } from 'next-themes'

// Icon mapping for plans
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Crown,
  Users,
  Building2,
  Star,
  Rocket,
  Shield,
  Sparkles,
}

export default function PricingPage() {
  const router = useRouter()
  const [plans] = useState<PlanConfig[]>(getDefaultPlans())
  const [isAnnual, setIsAnnual] = useState(false)
  const { theme, setTheme } = useTheme()

  const handleSubscribe = (planId: string) => {
    // Redirect to signup/login with plan selection
    router.push(`/?signup=true&plan=${planId}`)
  }

  const handleContactSales = () => {
    window.open(contactSalesUrl, '_blank')
  }

  const formatPrice = (amount: number): string => {
    if (amount === 0) return ''
    return `${currencyConfig.symbol}${amount}`
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight">Filo</span>
          </Link>

          {/* Right side actions */}
          <div className="flex items-center gap-3">
            {/* Theme toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="cursor-pointer"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
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

            <Button 
              size="sm" 
              asChild
              className="gap-2 cursor-pointer"
            >
              <Link href="/?signup=true">
                Get Started
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b bg-gradient-to-br from-background via-background to-muted/30 py-16 lg:py-24">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8882_1px,transparent_1px),linear-gradient(to_bottom,#8882_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        
        <div className="container relative mx-auto px-4 text-center">
          <Badge 
            variant="secondary" 
            className="mb-6 px-4 py-1.5 text-sm cursor-default select-none"
          >
            <Star className="mr-2 h-3.5 w-3.5 text-yellow-500" />
            Simple, Transparent Pricing
          </Badge>

          <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl leading-tight">
            Choose Your
            <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent"> Perfect Plan</span>
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground leading-relaxed">
            All plans include core features. No hidden fees, cancel anytime.
          </p>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <span className={`text-sm font-medium ${!isAnnual ? 'text-foreground' : 'text-muted-foreground'}`}>
              Monthly
            </span>
            <button
              onClick={() => setIsAnnual(!isAnnual)}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors cursor-pointer ${
                isAnnual ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-sm ${
                  isAnnual ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-sm font-medium ${isAnnual ? 'text-foreground' : 'text-muted-foreground'}`}>
              Annual
              <Badge variant="secondary" className="ml-2 text-xs cursor-default">Save ~17%</Badge>
            </span>
          </div>
        </div>
      </section>

      {/* Plans Grid */}
      <section className="py-12 md:py-16 lg:py-20">
        <div className="container mx-auto px-4">
          <div className="grid gap-6 md:gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto items-start">
            {plans.map((plan) => {
              const IconComponent = iconMap[plan.icon] || Crown

              return (
                <Card 
                  key={plan.id}
                  className={`relative flex flex-col cursor-pointer transition-all duration-300 hover:shadow-xl ${
                    plan.popular ? 'border-primary shadow-lg md:scale-[1.02] z-10' : ''
                  } ${plan.contactSales ? 'border-dashed border-primary/30' : ''}`}
                >
                  {/* Badge */}
                  {plan.badge && (
                    <div className={`absolute -top-3 left-1/2 -translate-x-1/2 z-20 ${
                      plan.contactSales 
                        ? '' 
                        : ''
                    }`}>
                      <Badge 
                        className={`px-2 sm:px-3 py-1 gap-1 cursor-default text-xs ${
                          plan.popular 
                            ? 'bg-primary text-primary-foreground' 
                            : plan.contactSales
                              ? 'bg-gradient-to-r from-primary/80 to-primary/60 text-primary-foreground'
                              : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        {plan.badge === 'Enterprise' && <Building2 className="h-3 w-3 mr-1" />}
                        {plan.badge === 'Most Popular' && <Star className="h-3 w-3 mr-1" />}
                        <span className="hidden xs:inline">{plan.badge}</span>
                        <span className="xs:hidden">{plan.badge === 'Enterprise' ? 'Ent.' : plan.badge}</span>
                      </Badge>
                    </div>
                  )}
                  
                  <CardHeader className="text-center pb-4 px-4 sm:px-6">
                    <div className={`mx-auto flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-xl transition-all duration-200 ${
                      plan.popular ? 'bg-primary/10' : plan.contactSales ? 'bg-gradient-to-br from-primary/10 to-primary/5' : 'bg-muted'
                    }`}>
                      <IconComponent className={`h-6 w-6 sm:h-7 sm:w-7 ${
                        plan.popular ? 'text-primary' : plan.contactSales ? 'text-primary/80' : 'text-muted-foreground'
                      }`} />
                    </div>
                    
                    <CardTitle className="mt-3 sm:mt-4 text-lg sm:text-xl">{plan.name}</CardTitle>
                    <CardDescription className="text-xs sm:text-sm">{plan.description}</CardDescription>
                    
                    <div className="mt-3 sm:mt-4">
                      {plan.contactSales ? (
                        <div className="text-center space-y-1">
                          <div className="text-2xl sm:text-3xl font-bold">Custom Pricing</div>
                          <p className="text-xs sm:text-sm text-muted-foreground">Tailored to your needs</p>
                        </div>
                      ) : isAnnual ? (
                        <div className="text-center">
                          <div className="flex items-baseline justify-center gap-1">
                            <span className="text-3xl sm:text-4xl font-bold">{formatPrice(plan.price.yearly)}</span>
                            <span className="text-xs sm:text-sm text-muted-foreground">/year</span>
                          </div>
                          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                            ~{formatPrice(Math.round(plan.price.yearly / 12))}/month
                          </p>
                          <Badge variant="secondary" className="mt-2 text-xs cursor-default">
                            Save {formatPrice(plan.price.monthly * 12 - plan.price.yearly)}/yr
                          </Badge>
                        </div>
                      ) : (
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-3xl sm:text-4xl font-bold">{formatPrice(plan.price.monthly)}</span>
                          <span className="text-xs sm:text-sm text-muted-foreground">/month</span>
                        </div>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 space-y-4">
                    {/* Features */}
                    <ul className="space-y-3">
                      {plan.features.slice(0, plan.contactSales ? 8 : 6).map((feature, idx) => (
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

                    {/* CTA Button */}
                    <Button 
                      className="w-full mt-6 cursor-pointer hover:shadow-md transition-all min-h-[44px]"
                      variant={
                        plan.contactSales 
                          ? "outline" 
                          : plan.popular 
                            ? "default" 
                            : "secondary"
                      }
                      onClick={() => plan.contactSales ? handleContactSales() : handleSubscribe(plan.id)}
                    >
                      {plan.contactSales ? (
                        <>
                          <Phone className="mr-2 h-4 w-4" />
                          {plan.cta}
                          <Mail className="ml-2 h-4 w-4" />
                        </>
                      ) : (
                        <>
                          {plan.cta}
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
      </section>

      {/* FAQ Section */}
      <section id="faq" className="border-t py-12 md:py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center mb-8 md:mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4 flex items-center justify-center gap-2">
              <Shield className="h-7 w-7 sm:h-8 sm:w-8 text-primary" />
              Frequently Asked Questions
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Everything you need to know about Filo's pricing
            </p>
          </div>

          <div className="grid gap-4 sm:gap-6 md:grid-cols-2 max-w-4xl mx-auto">
            {[
              {
                q: 'Is there a free trial available?',
                a: 'Yes! All paid plans come with a 7-day free trial so you can experience Filo\'s full capabilities before committing.',
                icon: Sparkles
              },
              {
                q: 'What payment methods do you accept?',
                a: 'We accept all major credit and debit cards through PayFast, South Africa\'s leading payment gateway.',
                icon: CreditCard
              },
              {
                q: 'Can I change my plan later?',
                a: 'Absolutely! You can upgrade or downgrade your plan at any time. Changes take effect at your next billing cycle.',
                icon: Crown
              },
              {
                q: 'Is there a long-term contract?',
                a: 'No contracts. You can cancel your subscription at any time. We believe in earning your business every month.',
                icon: Shield
              },
              {
                q: 'What happens to my data if I cancel?',
                a: 'Your artifacts and data are preserved for 30 days after cancellation. You can export everything or re-subscribe anytime.',
                icon: Rocket
              },
              {
                q: 'Do you offer custom enterprise solutions?',
                a: 'Yes! Our Department plan includes custom pricing with dedicated support, SSO, advanced security, and tailored features.',
                icon: Building2
              },
            ].map((faq, idx) => (
              <Card key={idx} className="cursor-default hover:shadow-md transition-shadow">
                <CardContent className="pt-4 sm:pt-6 px-4 sm:px-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                      <faq.icon className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1.5 sm:mb-2 text-sm sm:text-base">{faq.q}</h3>
                      <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 md:py-16 lg:py-20">
        <div className="container mx-auto px-4 text-center">
          <Card className="max-w-2xl mx-auto overflow-hidden">
            <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 sm:p-8 lg:p-12">
              <Sparkles className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-primary mb-3 sm:mb-4" />
              <h2 className="text-2xl sm:text-3xl font-bold mb-3 sm:mb-4">Ready to get started?</h2>
              <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-8 max-w-md mx-auto">
                Join thousands of professionals creating amazing documents with AI.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" asChild className="cursor-pointer gap-2 min-h-[48px]">
                  <Link href="/?signup=true">
                    Start Your Free Trial
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" onClick={handleContactSales} className="cursor-pointer gap-2 min-h-[48px]">
                  <Phone className="mr-2 h-5 w-5" />
                  Contact Sales
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4" />
              © 2024 Filo. All rights reserved.
            </div>
            <div className="flex items-center gap-6 text-sm">
              <Link href="#" className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                Privacy
              </Link>
              <Link href="#" className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                Terms
              </Link>
              <Link href="#" className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                Contact
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
