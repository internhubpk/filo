'use client'

import React, { useState, useEffect } from 'react'
import { useQuery, useAction } from 'convex/react'
import { api } from '@convex/_generated/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { 
  FileText, 
  Table, 
  Presentation, 
  Download, 
  Eye,
  Trash2,
  Search,
  Filter,
  Plus,
  Calendar,
  Clock,
  HardDrive
} from 'lucide-react'
import Link from 'next/link'

// Types
interface Artifact {
  _id: string
  title: string
  type: string
  format: string
  status: string
  createdAt: number
  updatedAt: number
  versionCount: number
}

export default function DocumentsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')

  // TODO: Replace with actual Convex query when ready
  // const artifacts = useQuery(api.artifacts.getUserArtifacts)
  //
  // HYDRATION-SAFE INITIALIZATION:
  //   We must NOT call `Date.now()` inside `useState`'s initial value, because
  //   that value is computed on the server during SSR and re-computed on the
  //   client during hydration — with a different timestamp. The formatted
  //   output (especially the minute/hour granularity in `formatDate` below)
  //   then differs between server and client, and React throws the
  //   "Minified React error #418" hydration mismatch, which on a production
  //   Vercel build surfaces as the
  //   "Application error: a client-side exception has occurred" page.
  //
  //   Fix: start with an empty list and populate it inside `useEffect` (which
  //   only runs on the client, after hydration). The server-rendered HTML
  //   and the first client render both produce an empty list → no mismatch.
  const [artifacts, setArtifacts] = useState<Artifact[]>([])

  useEffect(() => {
    // Seed demo data only on the client, so server and client initial
    // renders agree (both render the empty list, then the client fills in).
    // NOTE: the synchronous setState below is intentional — it is the
    // documented fix for a hydration mismatch (see comment above) and runs
    // exactly once on mount, so it cannot cascade.
    const now = Date.now()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArtifacts([
      {
        _id: '1',
        title: 'Business Proposal Template',
        type: 'document',
        format: 'DOCX',
        status: 'completed',
        createdAt: now - 86400000,
        updatedAt: now - 3600000,
        versionCount: 3
      },
      {
        _id: '2',
        title: 'Q4 Financial Report',
        type: 'spreadsheet',
        format: 'XLSX',
        status: 'completed',
        createdAt: now - 172800000,
        updatedAt: now - 7200000,
        versionCount: 1
      },
      {
        _id: '3',
        title: 'Product Launch Deck',
        type: 'presentation',
        format: 'PPTX',
        status: 'generating',
        createdAt: now - 3600000,
        updatedAt: now - 3600000,
        versionCount: 1
      }
    ])
  }, [])

  // Filter artifacts
  const filteredArtifacts = artifacts.filter(artifact => {
    const matchesSearch = artifact.title.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesType = filterType === 'all' || artifact.type === filterType
    const matchesStatus = filterStatus === 'all' || artifact.status === filterStatus
    return matchesSearch && matchesType && matchesStatus
  })

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'document': return <FileText className="h-5 w-5" />
      case 'spreadsheet': return <Table className="h-5 w-5" />
      case 'presentation': return <Presentation className="h-5 w-5" />
      default: return <FileText className="h-5 w-5" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-500">Completed</Badge>
      case 'generating':
        return <Badge variant="secondary" className="bg-yellow-500 text-white">Generating</Badge>
      case 'error':
        return <Badge variant="destructive">Error</Badge>
      case 'draft':
        return <Badge variant="outline">Draft</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="min-h-screen bg-background p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
            <p className="text-muted-foreground mt-2">
              Manage your generated documents, spreadsheets, and presentations
            </p>
          </div>
          <Link href="/">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Create New
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Documents</p>
                <p className="text-2xl font-bold">{artifacts.length}</p>
              </div>
              <FileText className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold text-green-600">
                  {artifacts.filter(a => a.status === 'completed').length}
                </p>
              </div>
              <Eye className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Processing</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {artifacts.filter(a => a.status === 'generating').length}
                </p>
              </div>
              <Clock className="h-8 w-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Storage Used</p>
                <p className="text-2xl font-bold">24.5 MB</p>
              </div>
              <HardDrive className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 border rounded-md bg-background"
              >
                <option value="all">All Types</option>
                <option value="document">Documents</option>
                <option value="spreadsheet">Spreadsheets</option>
                <option value="presentation">Presentations</option>
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border rounded-md bg-background"
              >
                <option value="all">All Status</option>
                <option value="completed">Completed</option>
                <option value="generating">Generating</option>
                <option value="draft">Draft</option>
                <option value="error">Error</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      <div className="space-y-4">
        {filteredArtifacts.length === 0 ? (
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No documents found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || filterType !== 'all' || filterStatus !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Create your first document to get started'}
              </p>
              <Link href="/">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Document
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          filteredArtifacts.map((artifact) => (
            <Card key={artifact._id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 flex-1">
                    <div className="p-2 bg-primary/10 rounded-lg text-primary">
                      {getTypeIcon(artifact.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{artifact.title}</h3>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span className="uppercase">{artifact.format}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(artifact.createdAt)}
                        </span>
                        <span>•</span>
                        <span>v{artifact.versionCount}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getStatusBadge(artifact.status)}
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" disabled={artifact.status !== 'completed'}>
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
