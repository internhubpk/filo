'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { 
  HelpCircle,
  Search,
  BookOpen,
  MessageSquare,
  Mail,
  ExternalLink,
  FileText,
  Sparkles,
  CreditCard,
  Upload,
  Download,
  Settings
} from 'lucide-react'

const faqItems = [
  {
    question: 'How do I create a new document?',
    answer: 'Navigate to the Dashboard and use the creation form. Select your document type (document, spreadsheet, or presentation), provide a topic or description, and click Generate. Your file will be processed and available for download once complete.'
  },
  {
    question: 'What file formats are supported?',
    answer: 'Filo supports DOCX for documents, XLSX and CSV for spreadsheets, and PPTX for presentations. You can also upload PDF, DOCX, XLSX, and PPTX files as reference material.'
  },
  {
    question: 'How does billing work?',
    answer: 'After signing up, your account starts in pending_activation status. Submit your payment proof through the Billing page. Once verified by our team, your account will be activated with your selected plan limits.'
  },
  {
    question: 'What are the generation limits?',
    answer: 'Generation limits depend on your subscription plan. Visit the Billing page to see your current plan details, usage, and limits. You can upgrade your plan at any time for higher limits.'
  },
  {
    question: 'How do I download my generated files?',
    answer: 'Once a generation is complete, you can download it from the Documents page or directly from the generation result dialog. Click the Download button next to any completed file.'
  },
  {
    question: 'Can I upload reference files?',
    answer: 'Yes, you can upload reference files (PDF, DOCX, XLSX, PPTX) when generating new content. These files help the AI understand your context and produce better results.'
  }
]

const quickLinks = [
  { title: 'Getting Started Guide', icon: BookOpen, description: 'Learn the basics of using Filo', href: '#' },
  { title: 'Document Generation', icon: Sparkles, description: 'How to generate documents with AI', href: '/' },
  { title: 'Upload Files', icon: Upload, description: 'Upload and manage your reference files', href: '/files' },
  { title: 'Billing & Plans', icon: CreditCard, description: 'Manage your subscription and payments', href: '/billing' },
  { title: 'Settings', icon: Settings, description: 'Configure your account preferences', href: '/settings' },
  { title: 'Download Files', icon: Download, description: 'Access and download your documents', href: '/documents' },
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <HelpCircle className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Help Center</h1>
        </div>
        <p className="text-muted-foreground">
          Find answers to common questions and get support
        </p>
      </div>

      <Card className="mb-8">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search help articles..."
              className="pl-10 h-12 text-base"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        {quickLinks.map((link) => (
          <a key={link.title} href={link.href}>
            <Card className="hover:shadow-md transition-shadow h-full cursor-pointer hover:border-primary/50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-primary/10 rounded-lg text-primary">
                    <link.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{link.title}</h3>
                    <p className="text-sm text-muted-foreground">{link.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">Frequently Asked Questions</h2>
        <div className="space-y-4">
          {faqItems.map((item, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-start gap-3">
                  <HelpCircle className="h-4 w-4 mt-1 text-primary shrink-0" />
                  {item.question}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed pl-7">
                  {item.answer}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="flex items-center gap-3">
              <MessageSquare className="h-6 w-6 text-primary" />
              <div>
                <h3 className="font-semibold">Need more help?</h3>
                <p className="text-sm text-muted-foreground">
                  Can't find what you're looking for? Contact our support team.
                </p>
              </div>
            </div>
            <div className="md:ml-auto flex gap-3">
              <Button variant="outline" className="gap-2">
                <Mail className="h-4 w-4" />
                Email Support
              </Button>
              <Button className="gap-2">
                <MessageSquare className="h-4 w-4" />
                Live Chat
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}