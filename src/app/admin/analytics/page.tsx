'use client'

import React, { useState, useMemo } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
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
  Users,
  FileText,
  BarChart3,
  Download,
  ArrowLeft,
  Settings2,
  Shield,
  Eye,
  EyeOff,
  LogOut,
  Sun,
  Moon,
  Search,
  Filter,
  RefreshCw,
  Database,
  FileSpreadsheet,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Upload,
  FileSearch,
  Type,
  Presentation,
  ChevronDown,
  ChevronRight,
  Calendar,
  Mail,
  Phone,
  UserCheck,
  Zap,
  HardDrive,
  MessageSquare,
  MoreVertical
} from 'lucide-react'
import { useTheme } from 'next-themes'

// ==================== TYPES ====================

interface UserContext {
  id: string
  email: string
  name: string
  plan: string
  status: 'active' | 'trialing' | 'canceled' | 'past_due'
  createdAt: string
  lastActive: string
  totalAiGenerations: number
  totalStorageUsed: number
  totalFilesUploaded: number
}

interface UsageRecord {
  id: string
  userId: string
  userName: string
  type: 'ai_generation' | 'file_upload' | 'storage_used' | 'document_creation' | 'export' | 'login'
  amount: number
  description: string
  metadata: Record<string, any>
  timestamp: string
  ipAddress?: string
}

interface IoLogEntry {
  id: string
  userId: string
  userName: string
  inputType: 'prompt' | 'file_upload' | 'query'
  inputPreview: string
  outputType: 'document' | 'spreadsheet' | 'presentation' | 'analysis' | 'error'
  outputPreview: string
  format?: string
  feature: string
  duration: number // ms
  tokensUsed?: number
  timestamp: string
  success: boolean
}

interface FeatureUsage {
  featureId: string
  featureName: string
  category: 'ai' | 'documents' | 'storage' | 'collaboration' | 'admin'
  totalUses: number
  uniqueUsers: number
  avgDuration: number
  successRate: number
  lastUsed: string
}

// ==================== DEMO DATA ====================

const demoUsers: UserContext[] = [
  {
    id: 'user-001',
    email: 'john@company.co.za',
    name: 'John Smith',
    plan: 'Pro',
    status: 'active',
    createdAt: '2024-01-15T10:30:00Z',
    lastActive: '2024-01-20T14:22:00Z',
    totalAiGenerations: 342,
    totalStorageUsed: 2340, // MB
    totalFilesUploaded: 28,
  },
  {
    id: 'user-002',
    email: 'sarah@startup.io',
    name: 'Sarah Johnson',
    plan: 'Team',
    status: 'active',
    createdAt: '2024-02-01T09:15:00Z',
    lastActive: '2024-01-20T16:45:00Z',
    totalAiGenerations: 1256,
    totalStorageUsed: 8750,
    totalFilesUploaded: 87,
  },
  {
    id: 'user-003',
    email: 'mike@enterprise.co',
    name: 'Mike Chen',
    plan: 'Department',
    status: 'trialing',
    createdAt: '2024-03-10T14:00:00Z',
    lastActive: '2024-01-19T11:30:00Z',
    totalAiGenerations: 89,
    totalStorageUsed: 450,
    totalFilesUploaded: 12,
  },
  {
    id: 'user-004',
    email: 'lisa@design.studio',
    name: 'Lisa van der Berg',
    plan: 'Pro',
    status: 'past_due',
    createdAt: '2023-11-20T08:45:00Z',
    lastActive: '2024-01-18T09:12:00Z',
    totalAiGenerations: 567,
    totalStorageUsed: 3200,
    totalFilesUploaded: 42,
  },
]

const demoUsageRecords: UsageRecord[] = [
  { id: 'ur-001', userId: 'user-001', userName: 'John Smith', type: 'ai_generation', amount: 1, description: 'Generated business proposal', metadata: { format: 'DOCX', promptLength: 245 }, timestamp: '2024-01-20T14:20:00Z', ipAddress: '196.25.1.5' },
  { id: 'ur-002', userId: 'user-002', userName: 'Sarah Johnson', type: 'file_upload', amount: 2450000, description: 'Uploaded presentation.pdf', metadata: { fileType: 'application/pdf', fileName: 'Q4_Presentation.pdf' }, timestamp: '2024-01-20T16:40:00Z', ipAddress: '41.76.100.2' },
  { id: 'ur-003', userId: 'user-001', userName: 'John Smith', type: 'document_creation', amount: 1, description: 'Created financial report', metadata: { format: 'XLSX', template: 'financial_report' }, timestamp: '2024-01-20T14:35:00Z' },
  { id: 'ur-004', userId: 'user-003', userName: 'Mike Chen', type: 'ai_generation', amount: 1, description: 'Generated meeting summary', metadata: { format: 'PDF', promptLength: 890 }, timestamp: '2024-01-19T11:32:00Z', ipAddress: '102.50.0.1' },
  { id: 'ur-005', userId: 'user-002', userName: 'Sarah Johnson', type: 'ai_generation', amount: 1, description: 'Created marketing copy', metadata: { format: 'DOCX', promptLength: 156 }, timestamp: '2024-01-20T17:05:00Z', ipAddress: '41.76.100.2' },
  { id: 'ur-006', userId: 'user-004', userName: 'Lisa van der Berg', type: 'export', amount: 1, description: 'Exported design portfolio', metadata: { format: 'PDF', fileSize: 4500000 }, timestamp: '2024-01-18T09:15:00Z', ipAddress: '197.200.1.1' },
  { id: 'ur-007', userId: 'user-001', userName: 'John Smith', type: 'storage_used', amount: 5000000, description: 'Storage quota update', metadata: { previousUsage: 1800000000, currentUsage: 2300000000 }, timestamp: '2024-01-20T14:21:00Z' },
  { id: 'ur-008', userId: 'user-003', userName: 'Mike Chen', type: 'login', amount: 1, description: 'User login', metadata: { method: 'email', device: 'desktop' }, timestamp: '2024-01-19T11:28:00Z', ipAddress: '102.50.0.1' },
]

const demoIoLogs: IoLogEntry[] = [
  { id: 'io-001', userId: 'user-001', userName: 'John Smith', inputType: 'prompt', inputPreview: 'Create a professional business proposal for Q1 2024...', outputType: 'document', outputPreview: 'Business_Proposal_Q1_2024.docx generated successfully', format: 'DOCX', feature: 'document-generation', duration: 3200, tokensUsed: 1450, timestamp: '2024-01-20T14:20:00Z', success: true },
  { id: 'io-002', userId: 'user-002', userName: 'Sarah Johnson', inputType: 'file_upload', inputPreview: 'Q4_Presentation.pdf (2.4MB)', outputType: 'analysis', outputPreview: 'File analyzed - 24 slides detected', format: null, feature: 'file-analysis', duration: 1200, timestamp: '2024-01-20T16:40:00Z', success: true },
  { id: 'io-003', userId: 'user-001', userName: 'John Smith', inputType: 'prompt', inputPreview: 'Generate monthly financial report...', outputType: 'spreadsheet', outputPreview: 'Financial_Report_Jan.xlsx created', format: 'XLSX', feature: 'spreadsheet-generation', duration: 2800, tokensUsed: 2100, timestamp: '2024-01-20T14:35:00Z', success: true },
  { id: 'io-004', userId: 'user-003', userName: 'Mike Chen', inputType: 'prompt', inputPreview: 'Summarize the following meeting notes...', outputType: 'document', outputFormat: 'Meeting_Summary.pdf generated', format: 'PDF', feature: 'summarization', duration: 1500, tokensUsed: 890, timestamp: '2024-01-19T11:32:00Z', success: true },
  { id: 'io-005', userId: 'user-004', userName: 'Lisa van der Berg', inputType: 'query', inputPreview: 'Export all documents as PDF bundle', outputType: 'error', outputPreview: 'Error: Storage limit exceeded', format: null, feature: 'export', duration: 800, timestamp: '2024-01-18T09:15:00Z', success: false },
  { id: 'io-006', userId: 'user-002', userName: 'Sarah Johnson', inputType: 'prompt', inputPreview: 'Write compelling marketing copy for SaaS product launch...', outputType: 'document', outputPreview: 'Marketing_Copy_Final.docx created', format: 'DOCX', feature: 'copywriting', duration: 4200, tokensUsed: 1890, timestamp: '2024-01-20T17:05:00Z', success: true },
]

const demoFeatureUsage: FeatureUsage[] = [
  { featureId: 'feat-001', featureName: 'Document Generation', category: 'ai', totalUses: 1247, uniqueUsers: 45, avgDuration: 3100, successRate: 97.2, lastUsed: '2024-01-20T17:05:00Z' },
  { featureId: 'feat-002', featureName: 'Spreadsheet Generation', category: 'ai', totalUses: 856, uniqueUsers: 38, avgDuration: 2900, successRate: 98.1, lastUsed: '2024-01-20T14:35:00Z' },
  { featureId: 'feat-003', featureName: 'Presentation Creation', category: 'ai', totalUses: 423, uniqueUsers: 29, avgDuration: 3800, successRate: 96.5, lastUsed: '2024-01-19T15:20:00Z' },
  { featureId: 'feat-004', featureName: 'File Analysis', category: 'ai', totalUses: 678, uniqueUsers: 52, avgDuration: 1100, successRate: 99.2, lastUsed: '2024-01-20T16:40:00Z' },
  { featureId: 'feat-005', featureName: 'Text Summarization', category: 'ai', totalUses: 234, uniqueUsers: 18, avgDuration: 1500, successRate: 98.7, lastUsed: '2024-01-19T11:32:00Z' },
  { featureId: 'feat-006', featureName: 'Copywriting', category: 'ai', totalUses: 189, uniqueUsers: 24, avgDuration: 4200, successRate: 94.8, lastUsed: '2024-01-20T17:05:00Z' },
  { featureId: 'feat-007', featureName: 'File Upload', category: 'storage', totalUses: 1234, uniqueUsers: 67, avgDuration: 850, successRate: 99.5, lastUsed: '2024-01-20T16:40:00Z' },
  { featureId: 'feat-008', featureName: 'Export to PDF/Excel', category: 'documents', totalUses: 456, uniqueUsers: 43, avgDuration: 1200, successRate: 92.3, lastUsed: '2024-01-18T09:15:00Z' },
  { featureId: 'feat-009', featureName: 'Template Usage', category: 'documents', totalUses: 678, uniqueUsers: 51, avgDuration: 600, successRate: 99.8, lastUsed: '2024-01-20T14:20:00Z' },
  { featureId: 'feat-010', featureName: 'Team Collaboration', category: 'collaboration', totalUses: 234, uniqueUsers: 12, avgDuration: 2200, successRate: 95.1, lastUsed: '2024-01-19T13:45:00Z' },
]

// ==================== COMPONENT ====================

export default function AdminAnalyticsPage() {
  const { theme, setTheme } = useTheme()
  
  // State
  const [activeTab, setActiveTab] = useState('overview')
  const [searchTerm, setSearchTerm] = useState('')
  const [planFilter, setPlanFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('week')
  const [isExporting, setIsExporting] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Show notification
  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 4000)
  }

  // Logout handler
  const handleLogout = async () => {
    try { await fetch('/api/auth/admin/logout', { method: 'DELETE' }) }
    catch (e) { console.error(e) }
    window.location.href = '/admin/login'
  }

  // Filtered data
  const filteredUsers = useMemo(() => {
    return demoUsers.filter(user => {
      const matchesSearch = !searchTerm || 
        user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesPlan = planFilter === 'all' || user.plan === planFilter
      const matchesStatus = statusFilter === 'all' || user.status === statusFilter
      return matchesSearch && matchesPlan && matchesStatus
    })
  }, [searchTerm, planFilter, statusFilter])

  const filteredUsageRecords = useMemo(() => {
    return demoUsageRecords.filter(record => {
      if (!searchTerm) return true
      return record.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
             record.description.toLowerCase().includes(searchTerm.toLowerCase())
    })
  }, [searchTerm])

  const filteredIoLogs = useMemo(() => {
    return demoIoLogs.filter(log => {
      if (!searchTerm) return true
      return log.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
             log.inputPreview.toLowerCase().includes(searchTerm.toLowerCase()) ||
             log.outputPreview.toLowerCase().includes(searchTerm.toLowerCase())
    })
  }, [searchTerm])

  // Stats calculations
  const stats = useMemo(() => ({
    totalUsers: demoUsers.length,
    activeUsers: demoUsers.filter(u => u.status === 'active').length,
    trialUsers: demoUsers.filter(u => u.status === 'trialing').length,
    pastDueUsers: demoUsers.filter(u => u.status === 'past_due').length,
    totalAiGenerations: demoUsers.reduce((sum, u) => sum + u.totalAiGenerations, 0),
    totalStorageUsed: demoUsers.reduce((sum, u) => sum + u.totalStorageUsed, 0),
    totalFiles: demoUsers.reduce((sum, u) => sum + u.totalFilesUploaded, 0),
    avgGenerationsPerUser: Math.round(demoUsers.reduce((sum, u) => sum + u.totalAiGenerations, 0) / demoUsers.length),
    successRate: ((demoIoLogs.filter(l => l.success).length / demoIoLogs.length) * 100).toFixed(1),
  }), [])

  // Format helpers
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const formatBytes = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`
  const formatDuration = (ms: number) => ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`

  // Export to Excel function
  const exportToExcel = async (dataType: 'users' | 'usage' | 'logs' | 'features') => {
    setIsExporting(true)
    
    try {
      // Dynamic import xlsx
      const XLSX = await import('xlsx')
      
      let data: any[] = []
      let filename = ''
      
      switch (dataType) {
        case 'users':
          data = filteredUsers.map(user => ({
            'User ID': user.id,
            'Name': user.name,
            'Email': user.email,
            'Plan': user.plan,
            'Status': user.status,
            'AI Generations': user.totalAiGenerations,
            'Storage Used (MB)': Math.round(user.totalStorageUsed / 1024),
            'Files Uploaded': user.totalFilesUploaded,
            'Member Since': formatDate(user.createdAt),
            'Last Active': formatDate(user.lastActive),
          }))
          filename = `filo_users_export_${new Date().toISOString().split('T')[0]}`
          break
          
        case 'usage':
          data = filteredUsageRecords.map(record => ({
            'Record ID': record.id,
            'User': record.userName,
            'Email': demoUsers.find(u => u.id === record.userId)?.email || '',
            'Action Type': record.type.replace('_', ' ').replace(/\b\w/g, (w: string) => w.charAt(0).toUpperCase() + w.slice(1)),
            'Description': record.description,
            'Amount': record.amount,
            'Metadata': JSON.stringify(record.metadata),
            'IP Address': record.ipAddress || '',
            'Timestamp': formatDate(record.timestamp),
          }))
          filename = `filo_usage_records_${new Date().toISOString().split('T')[0]}`
          break
          
        case 'logs':
          data = filteredIoLogs.map(log => ({
            'Log ID': log.id,
            'User': log.userName,
            'Email': demoUsers.find(u => u.id === log.userId)?.email || '',
            'Input Type': log.inputType,
            'Input Preview': log.inputPreview.substring(0, 100) + (log.inputPreview.length > 100 ? '...' : ''),
            'Output Type': log.outputType,
            'Output Preview': log.outputPreview.substring(0, 100) + (log.outputPreview.length > 100 ? '...' : ''),
            'Format': log.format || '',
            'Feature': log.feature,
            'Duration (ms)': log.duration,
            'Tokens Used': log.tokensUsed || 0,
            'Success': log.success ? 'Yes' : 'No',
            'Timestamp': formatDate(log.timestamp),
          }))
          filename = `filo_io_logs_${new Date().toISOString().split('T')[0]}`
          break
          
        case 'features':
          data = demoFeatureUsage.map(feature => ({
            'Feature ID': feature.featureId,
            'Feature Name': feature.featureName,
            'Category': feature.category,
            'Total Uses': feature.totalUses,
            'Unique Users': feature.uniqueUsers,
            'Avg Duration (ms)': feature.avgDuration,
            'Success Rate (%)': feature.successRate,
            'Last Used': formatDate(feature.lastUsed),
          }))
          filename = `filo_feature_usage_${new Date().toISOString().split('T')[0]}`
          break
      }
      
      // Create workbook
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.json_to_sheet(data)
      XLSX.utils.book_append_sheet(wb, ws, 'Data')
      
      // Auto-size columns
      const colWidths = Object.keys(data[0] || {}).map(key => ({ wch: Math.max(key.length * 1.2, 12) }))
      ws['!cols'] = colWidths
      
      // Generate file
      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      
      // Download
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      showNotification('success', `Exported ${data.length} records to ${filename}.xlsx`)
      
    } catch (error) {
      console.error('Export error:', error)
      showNotification('error', 'Failed to export data')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3 md:gap-4">
            <Link href="/admin" className="flex items-center gap-2 md:gap-3 hover:opacity-80 transition-opacity cursor-pointer">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-lg md:text-xl font-bold tracking-tight">Filo</span>
            </Link>
            
            <Separator orientation="vertical" className="h-8 hidden sm:block" />
            
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-base md:text-lg font-semibold hidden sm:inline">Analytics</h1>
              <h1 className="text-base md:text-lg font-semibold sm:hidden">Stats</h1>
            </div>
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            <Badge variant="secondary" className="hidden sm:flex gap-1 cursor-default bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 text-xs px-2 py-0.5">
              <Database className="h-3 w-3" />
              Live Data
            </Badge>

            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="cursor-pointer">
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>

            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5 cursor-pointer text-red-600 hover:text-red-700 border-red-200 dark:border-red-800 text-xs px-2 md:px-3 h-8 md:h-9">
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>

            <Button variant="ghost" size="sm" asChild className="cursor-pointer gap-1.5">
              <Link href="/admin"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Admin</span></Link>
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
        {/* Overview Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
          <Card className="p-3 md:p-6">
            <CardContent className="p-0 pt-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Total Users</p>
                  <p className="text-2xl md:text-3xl font-bold">{stats.totalUsers}</p>
                </div>
                <Users className="h-8 w-8 md:h-10 md:w-10 text-muted-foreground opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card className="p-3 md:p-6">
            <CardContent className="p-0 pt-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Active</p>
                  <p className="text-2xl md:text-3xl font-bold text-green-600">{stats.activeUsers}</p>
                </div>
                <UserCheck className="h-8 w-8 md:h-10 md:w-10 text-green-600 opacity-80" />
              </div>
            </CardContent>
          </Card>

          <Card className="p-3 md:p-6">
            <CardContent className="p-0 pt-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">AI Gen Total</p>
                  <p className="text-2xl md:text-3xl font-bold">{stats.totalAiGenerations.toLocaleString()}</p>
                </div>
                <Zap className="h-8 w-8 md:h-10 md:w-10 text-primary opacity-60" />
              </div>
            </CardContent>
          </Card>

          <Card className="p-3 md:p-6">
            <CardContent className="p-0 pt-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Success Rate</p>
                  <p className="text-2xl md:text-3xl font-bold">{stats.successRate}%</p>
                </div>
                <TrendingUp className="h-8 w-8 md:h-10 md:w-10 text-green-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
          <Card className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Trial Users</span>
            </div>
            <p className="text-lg md:text-xl font-semibold">{stats.trialUsers}</p>
          </Card>

          <Card className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Past Due</span>
            </div>
            <p className="text-lg md:text-xl font-semibold text-orange-600">{stats.pastDueUsers}</p>
          </Card>

          <Card className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Storage</span>
            </div>
            <p className="text-lg md:text-xl font-semibold">{formatBytes(stats.totalStorageUsed)}</p>
          </Card>

          <Card className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Files</span>
            </div>
            <p className="text-lg md:text-xl font-semibold">{stats.totalFiles.toLocaleString()}</p>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 lg:w-fit bg-muted p-1 rounded-lg overflow-x-auto">
            <TabsTrigger value="overview" className="cursor-pointer gap-1.5 text-xs md:text-sm"><BarChart3 className="h-4 w-4" /> Overview</TabsTrigger>
            <TabsTrigger value="users" className="cursor-pointer gap-1.5 text-xs md:text-sm"><Users className="h-4 w-4" /> Users</TabsTrigger>
            <TabsTrigger value="activity" className="cursor-pointer gap-1.5 text-xs md:text-sm"><Activity className="h-4 w-4" /> Activity</TabsTrigger>
            <TabsTrigger value="io-logs" className="cursor-pointer gap-1.5 text-xs md:text-sm"><MessageSquare className="h-4 w-4" /> I/O Logs</TabsTrigger>
            <TabsTrigger value="features" className="cursor-pointer gap-1.5 text-xs md:text-sm"><Zap className="h-4 w-4" /> Features</TabsTrigger>
          </TabsList>

          {/* OVERVIEW TAB */}
          <TabsContent value="overview" className="mt-4 space-y-4 md:space-y-6">
            <div className="grid md:grid-cols-2 gap-4 md:gap-6">
              {/* Recent Activity */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base md:text-lg flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" /> Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {demoUsageRecords.slice(0, 5).map(record => (
                      <div key={record.id} className="flex items-start gap-3 p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                          record.type === 'ai_generation' ? 'bg-purple-100 text-purple-600' :
                          record.type === 'file_upload' ? 'bg-blue-100 text-blue-600' :
                          record.type === 'export' ? 'green-100 text-green-600' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {record.type === 'ai_generation' && <Zap className="h-4 w-4" />}
                          {record.type === 'file_upload' && <Upload className="h-4 w-4" />}
                          {record.type === 'export' && <Download className="h-4 w-4" />}
                          {record.type === 'login' && <Eye className="h-4 w-4" />}
                          {record.type === 'storage_used' && <HardDrive className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm truncate">{record.userName}</span>
                            <Badge variant="outline" className="text-xs shrink-0">{record.type.replace('_', ' ')}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-1">{record.description}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(record.timestamp)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Top Users */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base md:text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" /> Top Users by Usage
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[...demoUsers].sort((a, b) => b.totalAiGenerations - a.totalAiGenerations).slice(0, 5).map((user, idx) => (
                      <div key={user.id} className="flex items-center gap-3">
                        <span className="text-sm font-medium text-muted-foreground w-6">#{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{user.name}</div>
                          <div className="text-xs text-muted-foreground">{user.plan} • {user.totalAiGenerations} gens</div>
                        </div>
                        <Badge variant={user.status === 'active' ? "default" : "secondary"} className="shrink-0 text-xs">
                          {user.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Feature Usage Summary */}
            <Card className="md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base md:text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" /> Feature Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {demoFeatureUsage.slice(0, 6).map(feature => (
                    <div key={feature.featureId} className="p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium truncate">{feature.featureName}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{feature.category}</Badge>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Uses:</span>
                          <span className="font-medium text-foreground">{feature.totalUses}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Users:</span>
                          <span className="font-medium text-foreground">{feature.uniqueUsers}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Success:</span>
                          <span className={`font-medium ${parseFloat(feature.successRate) >= 95 ? 'text-green-600' : 'text-orange-600'}`}>{feature.successRate}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
        </TabsContent>

          {/* USERS TAB */}
          <TabsContent value="users" className="mt-4 space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search users..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  
                  <Select value={planFilter} onValueChange={setPlanFilter}>
                    <SelectTrigger className="w-full sm:w-[140px]">
                      <SelectValue placeholder="All Plans" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Plans</SelectItem>
                      <SelectItem value="Pro">Pro</SelectItem>
                      <SelectItem value="Team">Team</SelectItem>
                      <SelectItem value="Department">Department</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-[140px]">
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="trialing">Trial</SelectItem>
                      <SelectItem value="past_due">Past Due</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => exportToExcel('users')}
                    disabled={isExporting}
                    className="gap-2 cursor-pointer w-full sm:w-auto"
                  >
                    {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    Export Excel
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Users Table */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base md:text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" /> 
                    Users ({filteredUsers.length})
                  </span>
                  <Badge variant="secondary">{planFilter !== 'all' ? planFilter : 'All'} • {statusFilter !== 'all' ? statusFilter : 'All'}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead className="hidden sm:table-cell">Plan</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden md:table-cell">AI Gens</TableHead>
                        <TableHead className="hidden md:table-cell">Storage</TableHead>
                        <TableHead className="hidden lg:table-cell">Files</TableHead>
                        <TableHead>Last Active</TableHead>
                        <TableHead className="w-[70px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((user) => (
                        <TableRow key={user.id} className="hover:bg-muted/30">
                          <TableCell>
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                                <span className="text-xs font-bold text-primary">{user.name.charAt(0)}</span>
                              </div>
                              <div>
                                <div className="font-medium text-sm">{user.name}</div>
                                <div className="text-xs text-muted-foreground truncate max-w-[120px]">{user.email}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <Badge variant="outline">{user.plan}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              user.status === 'active' ? 'default' :
                              user.status === 'trialing' ? 'secondary' :
                              'destructive'
                            }>
                              {user.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{user.totalAiGenerations}</TableCell>
                          <TableCell className="hidden md:table-cell">{formatBytes(user.totalStorageUsed)}</TableCell>
                          <TableCell className="hidden lg:table-cell">{user.totalFilesUploaded}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(user.lastActive)}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 cursor-pointer">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => exportToExcel('users')} className="gap-2 cursor-pointer">
                                  <Download className="h-4 w-4" /> Export User Data
                                </DropdownMenuItem>
                                <DropdownMenuItem className="gap-2 cursor-pointer text-muted">
                                  <Eye className="h-4 w-4" /> View Details
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ACTIVITY TAB */}
          <TabsContent value="activity" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base md:text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" /> 
                    Usage Records ({filteredUsageRecords.length})
                  </span>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => exportToExcel('usage')}
                    disabled={isExporting}
                    className="gap-2 cursor-pointer"
                  >
                    {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    Export All Records
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Details</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsageRecords.map((record) => (
                        <TableRow key={record.id} className="hover:bg-muted/30">
                          <TableCell className="font-medium text-sm">{record.userName}</TableCell>
                          <TableCell>
                            <Badge variant={
                              record.type === 'ai_generation' ? 'default' :
                              record.type === 'file_upload' ? 'secondary' :
                              record.type === 'export' ? 'outline' : 'secondary'
                            } className="text-xs">
                              {record.type.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-sm">{record.description}</TableCell>
                          <TableCell className="text-sm">
                            {record.type === 'storage_used' ? formatBytes(record.amount) : record.amount}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(record.timestamp)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* I/O LOGS TAB */}
          <TabsContent value="io-logs" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base md:text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-primary" /> 
                    Input/Output Logs ({filteredIoLogs.length})
                  </span>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => exportToExcel('logs')}
                    disabled={isExporting}
                    className="gap-2 cursor-pointer"
                  >
                    {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    Export Logs
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Input</TableHead>
                        <TableHead>Output</TableHead>
                        <TableHead>Feature</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredIoLogs.map((log) => (
                        <TableRow key={log.id} className={`${!log.success ? 'bg-red-50/30' : ''}`}>
                          <TableCell className="font-medium text-sm">{log.userName}</TableCell>
                          <TableCell>
                            <div className="flex items-start gap-1">
                              <Badge variant={log.inputType === 'prompt' ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                                {log.inputType === 'prompt' ? 'Prompt' : 'File'}
                              </Badge>
                              <div className="text-xs text-muted-foreground max-w-[150px] truncate" title={log.inputPreview}>
                                {log.inputPreview}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-start gap-1">
                              <Badge variant={log.success ? 'default' : 'destructive'} className="text-[10px] shrink-0">
                                {log.success ? '✓' : '✗'}
                              </Badge>
                              <div className="text-xs text-muted-foreground max-w-[150px] truncate" title={log.outputPreview}>
                                {log.outputPreview}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{log.feature}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{formatDuration(log.duration)}</TableCell>
                          <TableCell>
                            {log.success ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(log.timestamp)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* FEATURES TAB */}
          <TabsContent value="features" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base md:text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-primary" /> 
                    Feature Analytics ({demoFeatureUsage.length})
                  </span>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => exportToExcel('features')}
                    disabled={isExporting}
                    className="gap-2 cursor-pointer"
                  >
                    {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    Export Features
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Feature</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Total Uses</TableHead>
                        <TableHead>Unique Users</TableHead>
                        <TableHead>Avg Duration</TableHead>
                        <TableHead>Success Rate</TableHead>
                        <TableHead>Last Used</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {demoFeatureUsage.map((feature) => (
                        <TableRow key={feature.featureId} className="hover:bg-muted/30">
                          <TableCell>
                            <div className="font-medium text-sm">{feature.featureName}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              feature.category === 'ai' ? 'default' :
                              feature.category === 'documents' ? 'secondary' :
                              feature.category === 'storage' ? 'outline' :
                              feature.category === 'collaboration' ? 'default' : 'secondary'
                            } className="text-xs">
                              {feature.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{feature.totalUses.toLocaleString()}</TableCell>
                          <TableCell>{feature.uniqueUsers}</TableCell>
                          <TableCell className="text-sm">{formatDuration(feature.avgDuration)}</TableCell>
                          <TableCell>
                            <span className={`font-medium ${parseFloat(feature.successRate) >= 95 ? 'text-green-600' : 'text-orange-600'}`}>
                              {feature.successRate}%
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(feature.lastUsed)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Category Breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {['ai', 'documents', 'storage', 'collaboration'].map(category => {
                const features = demoFeatureUsage.filter(f => f.category === category)
                const totalUses = features.reduce((sum, f) => sum + f.totalUses, 0)
                const totalUsers = features.reduce((sum, f) => sum + f.uniqueUsers, 0)
                
                return (
                  <Card key={category} className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      {category === 'ai' && <Zap className="h-5 w-5 text-purple-500" />}
                      {category === 'documents' && <FileText className="h-5 w-5 text-blue-500" />}
                      {category === 'storage' && <HardDrive className="h-5 w-5 text-green-500" />}
                      {category === 'collaboration' && <Users className="h-5 w-5 text-orange-500" />}
                      <span className="font-semibold text-sm capitalize">{category}</span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Uses:</span>
                        <span className="font-medium">{totalUses.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Users:</span>
                        <span className="font-medium">{totalUsers}</span>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t py-6 mt-8">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          <p>Filo Admin Analytics • Data exported for AI analysis • {new Date().toLocaleDateString('en-ZA')}</p>
        </div>
      </footer>
    </div>
  )
}
