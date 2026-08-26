'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { 
  Table, 
  Download, 
  Eye,
  Trash2,
  Search,
  Plus,
  Calendar,
  Clock,
  FileSpreadsheet
} from 'lucide-react'
import Link from 'next/link'

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

export default function SpreadsheetsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [artifacts, setArtifacts] = useState<Artifact[]>([])

  useEffect(() => {
    const now = Date.now()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArtifacts([
      {
        _id: 's1',
        title: 'Q4 Financial Report',
        type: 'spreadsheet',
        format: 'XLSX',
        status: 'completed',
        createdAt: now - 172800000,
        updatedAt: now - 7200000,
        versionCount: 1
      },
      {
        _id: 's2',
        title: 'Employee Attendance Tracker',
        type: 'spreadsheet',
        format: 'XLSX',
        status: 'completed',
        createdAt: now - 259200000,
        updatedAt: now - 86400000,
        versionCount: 2
      },
      {
        _id: 's3',
        title: 'Budget Forecast 2025',
        type: 'spreadsheet',
        format: 'CSV',
        status: 'generating',
        createdAt: now - 3600000,
        updatedAt: now - 3600000,
        versionCount: 1
      }
    ])
  }, [])

  const filteredArtifacts = artifacts.filter(artifact => {
    const matchesSearch = artifact.title.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = filterStatus === 'all' || artifact.status === filterStatus
    return matchesSearch && matchesStatus
  })

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-500">Completed</Badge>
      case 'generating':
        return <Badge variant="secondary" className="bg-yellow-500 text-white">Generating</Badge>
      case 'error':
        return <Badge variant="destructive">Error</Badge>
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

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Spreadsheets</h1>
            <p className="text-muted-foreground mt-2">
              Manage your generated spreadsheets and data tables
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Spreadsheets</p>
                <p className="text-2xl font-bold">{artifacts.length}</p>
              </div>
              <FileSpreadsheet className="h-8 w-8 text-green-500" />
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
              <Eye className="h-8 w-8 text-blue-500" />
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
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search spreadsheets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
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
        </CardContent>
      </Card>

      <div className="space-y-4">
        {filteredArtifacts.length === 0 ? (
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <Table className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No spreadsheets found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || filterStatus !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Create your first spreadsheet to get started'}
              </p>
              <Link href="/">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Spreadsheet
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
                    <div className="p-2 bg-green-500/10 rounded-lg text-green-600">
                      <Table className="h-5 w-5" />
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