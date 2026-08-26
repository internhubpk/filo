'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { 
  FolderOpen,
  Download, 
  Trash2,
  Search,
  Upload,
  Calendar,
  HardDrive,
  FileText,
  Table,
  Presentation as PresentationIcon,
  File
} from 'lucide-react'

interface FileItem {
  _id: string
  fileName: string
  fileType: string
  fileSize: number
  uploadedAt: number
  status: string
}

export default function FilesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [files, setFiles] = useState<FileItem[]>([])

  useEffect(() => {
    const now = Date.now()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFiles([
      {
        _id: 'f1',
        fileName: 'brand-guidelines.pdf',
        fileType: 'pdf',
        fileSize: 2456000,
        uploadedAt: now - 86400000,
        status: 'ready'
      },
      {
        _id: 'f2',
        fileName: 'sales-data-q3.xlsx',
        fileType: 'xlsx',
        fileSize: 512000,
        uploadedAt: now - 172800000,
        status: 'ready'
      },
      {
        _id: 'f3',
        fileName: 'onboarding-deck.pptx',
        fileType: 'pptx',
        fileSize: 4890000,
        uploadedAt: now - 259200000,
        status: 'ready'
      },
      {
        _id: 'f4',
        fileName: 'project-brief.docx',
        fileType: 'docx',
        fileSize: 128000,
        uploadedAt: now - 345600000,
        status: 'ready'
      }
    ])
  }, [])

  const filteredFiles = files.filter(file =>
    file.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'pdf': return <FileText className="h-5 w-5 text-red-500" />
      case 'xlsx': case 'csv': return <Table className="h-5 w-5 text-green-500" />
      case 'pptx': return <PresentationIcon className="h-5 w-5 text-orange-500" />
      case 'docx': return <FileText className="h-5 w-5 text-blue-500" />
      default: return <File className="h-5 w-5 text-gray-500" />
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0)

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Files</h1>
            <p className="text-muted-foreground mt-2">
              Manage your uploaded and generated files
            </p>
          </div>
          <Button className="gap-2">
            <Upload className="h-4 w-4" />
            Upload File
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Files</p>
                <p className="text-2xl font-bold">{files.length}</p>
              </div>
              <FolderOpen className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Size</p>
                <p className="text-2xl font-bold">{formatFileSize(totalSize)}</p>
              </div>
              <HardDrive className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">File Types</p>
                <p className="text-2xl font-bold">
                  {new Set(files.map(f => f.fileType)).size}
                </p>
              </div>
              <FileText className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {filteredFiles.length === 0 ? (
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No files found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery
                  ? 'Try adjusting your search'
                  : 'Upload your first file to get started'}
              </p>
              <Button>
                <Upload className="h-4 w-4 mr-2" />
                Upload File
              </Button>
            </CardContent>
          </Card>
        ) : (
          filteredFiles.map((file) => (
            <Card key={file._id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 flex-1">
                    <div className="p-2 bg-muted rounded-lg">
                      {getFileIcon(file.fileType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{file.fileName}</h3>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <Badge variant="outline" className="uppercase text-xs">{file.fileType}</Badge>
                        <span>{formatFileSize(file.fileSize)}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(file.uploadedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm">
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
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