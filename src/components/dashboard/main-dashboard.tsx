'use client'

import React, { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { 
  Sparkles,
  Upload,
  FileText,
  Table,
  Presentation,
  FileSpreadsheet,
  BarChart3,
  PenTool,
  BookOpen,
  Briefcase,
  GraduationCap,
  Receipt,
  UserCircle,
  ArrowRight,
  Loader2,
  Check,
  AlertCircle,
  X,
  Download,
  Copy,
  Eye,
  Edit3,
  History
} from 'lucide-react'

// ==================== TYPES ====================

interface CreationRequest {
  prompt: string
  files?: File[]
  outputFormat?: string
}

interface GenerationStage {
  id: string
  label: string
  status: 'pending' | 'active' | 'completed' | 'error'
  detail?: string
}

interface ArtifactPreview {
  id: string
  title: string
  type: string
  format: string
  status: 'completed' | 'generating' | 'failed'
  createdAt: Date
  thumbnail?: string
}

// ==================== EXAMPLE PROMPTS ====================

const examplePrompts = [
  {
    icon: Briefcase,
    title: 'Business Proposal',
    prompt: 'Create a professional business proposal for a digital marketing agency targeting small businesses',
    category: 'business',
  },
  {
    icon: GraduationCap,
    title: 'Lesson Plan',
    prompt: 'Design a comprehensive 16-week lesson plan for an introductory Python programming course',
    category: 'education',
  },
  {
    icon: Receipt,
    title: 'Invoice',
    prompt: 'Generate a professional invoice for consulting services with hourly rates and itemized billing',
    category: 'finance',
  },
  {
    icon: PenTool,
    title: 'Resume',
    prompt: 'Create a modern, professional resume for a senior software engineer with 8 years of experience',
    category: 'career',
  },
  {
    icon: Presentation,
    title: 'Presentation',
    prompt: 'Turn this quarterly business report into an engaging 12-slide executive presentation',
    category: 'presentation',
  },
  {
    icon: BarChart3,
    title: 'Financial Report',
    prompt: 'Analyze this spreadsheet data and create a professional financial report with charts and insights',
    category: 'analytics',
  },
]

// ==================== OUTPUT FORMATS ====================

const outputFormats = [
  { value: 'auto', label: 'Auto-detect', description: 'Let Filo choose the best format' },
  { value: 'DOCX', label: 'Word Document', description: '.docx - Best for text documents' },
  { value: 'PDF', label: 'PDF', description: '.pdf - Universal format' },
  { value: 'XLSX', label: 'Excel Spreadsheet', description: '.xlsx - For data and calculations' },
  { value: 'PPTX', label: 'PowerPoint', description: '.pptx - For presentations' },
  { value: 'CSV', label: 'CSV', description: '.csv - For data export' },
]

// ==================== MAIN COMPONENT ====================

export function MainDashboard() {
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [selectedFormat, setSelectedFormat] = useState('auto')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showResultDialog, setShowResultDialog] = useState(false)
  const [generationStages, setGenerationStages] = useState<GenerationStage[]>([])
  const [currentArtifact, setCurrentArtifact] = useState<ArtifactPreview | null>(null)
  const [dragActive, setDragActive] = useState(false)

  // Handle file upload
  const handleFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return
    
    const fileArray = Array.from(newFiles)
    setFiles(prev => [...prev, ...fileArray])
  }, [])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Handle generation
  const handleGenerate = async () => {
    if (!prompt.trim()) return

    setIsGenerating(true)
    
    // Initialize generation stages
    const stages: GenerationStage[] = [
      { id: '1', label: 'Understanding request', status: 'pending' },
      { id: '2', label: 'Reading files', status: 'pending' },
      { id: '3', label: 'Planning artifact', status: 'pending' },
      { id: '4', label: 'Generating content', status: 'pending' },
      { id: '5', label: 'Creating visuals', status: 'pending' },
      { id: '6', label: 'Formatting document', status: 'pending' },
      { id: '7', label: 'Checking quality', status: 'pending' },
      { id: '8', label: 'Finalizing', status: 'pending' },
    ]
    setGenerationStages(stages)

    try {
      // Simulate generation stages (in production, these would be real API calls)
      for (let i = 0; i < stages.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200))
        
        setGenerationStages(prev => 
          prev.map(stage => 
            stage.id === String(i + 1) 
              ? { ...stage, status: 'completed' }
              : stage
          )
        )
        
        if (i < stages.length - 1) {
          setGenerationStages(prev =>
            prev.map(stage =>
              stage.id === String(i + 2)
                ? { ...stage, status: 'active' }
                : stage
            )
          )
        }
      }

      // Create artifact preview
      const artifact: ArtifactPreview = {
        id: crypto.randomUUID(),
        title: extractTitle(prompt),
        type: detectArtifactType(prompt),
        format: selectedFormat === 'auto' ? 'DOCX' : selectedFormat,
        status: 'completed',
        createdAt: new Date(),
      }

      setCurrentArtifact(artifact)
      setShowResultDialog(true)
    } catch (error) {
      console.error('Generation failed:', error)
      setGenerationStages(prev =>
        prev.map(stage =>
          stage.status === 'active'
            ? { ...stage, status: 'error', detail: 'Generation failed' }
            : stage
        )
      )
    } finally {
      setIsGenerating(false)
    }
  }

  // Helper functions
  const extractTitle = (text: string): string => {
    const words = text.split(' ').slice(0, 8).join(' ')
    return words.length > 50 ? words + '...' : words
  }

  const detectArtifactType = (text: string): string => {
    const lower = text.toLowerCase()
    if (lower.includes('proposal') || lower.includes('business')) return 'Proposal'
    if (lower.includes('lesson') || lower.includes('course')) return 'Lesson Plan'
    if (lower.includes('invoice')) return 'Invoice'
    if (lower.includes('resume') || lower.includes('cv')) return 'Resume'
    if (lower.includes('presentation') || lower.includes('slide')) return 'Presentation'
    if (lower.includes('spreadsheet') || lower.includes('excel') || lower.includes('budget')) return 'Spreadsheet'
    if (lower.includes('report')) return 'Report'
    return 'Document'
  }

  const handleExampleClick = (examplePrompt: string) => {
    setPrompt(examplePrompt)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b bg-gradient-to-br from-background via-background to-muted/30">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8882_1px,transparent_1px),linear-gradient(to_bottom,#8882_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        
        <div className="container relative mx-auto px-4 py-16 lg:py-24">
          <div className="mx-auto max-w-4xl text-center">
            {/* Badge */}
            <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm">
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              AI-Powered Artifact Generation
            </Badge>

            {/* Headline */}
            <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Describe what you need.
              <br />
              <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Filo creates it.
              </span>
            </h1>

            {/* Subheadline */}
            <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground">
              Transform your ideas into professional documents, spreadsheets, presentations, and more. 
              No templates. No formatting. Just describe what you want.
            </p>

            {/* Main Input */}
            <div className="mx-auto max-w-3xl">
              <div className="rounded-xl border bg-card p-2 shadow-lg">
                <Textarea
                  placeholder="What do you want to create? Be specific about what you need..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[120px] resize-none border-0 bg-transparent text-base focus-visible:ring-0"
                  disabled={isGenerating}
                />

                {/* Files area */}
                {(files.length > 0 || dragActive) && (
                  <div
                    className={`mx-2 mb-2 rounded-lg border-2 border-dashed p-4 transition-colors ${
                      dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
                    }`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                  >
                    {files.length > 0 ? (
                      <div className="space-y-2">
                        {files.map((file, index) => (
                          <div key={index} className="flex items-center gap-2 rounded bg-muted/50 p-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="flex-1 truncate text-sm">{file.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {(file.size / 1024).toFixed(1)} KB
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => removeFile(index)}
                              disabled={isGenerating}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        <label>
                          <span className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                            + Add more files
                          </span>
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => handleFiles(e.target.files)}
                            disabled={isGenerating}
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-4 text-sm text-muted-foreground">
                        <Upload className="mb-2 h-8 w-8" />
                        <p>Drop files here or click to upload</p>
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => handleFiles(e.target.files)}
                          disabled={isGenerating}
                        />
                        <label className="mt-2 cursor-pointer text-xs text-primary hover:underline">
                          Browse files
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                  {!files.length && (
                    <label className="cursor-pointer">
                      <Button variant="outline" size="sm" className="gap-2" asChild>
                        <>
                          <Upload className="h-4 w-4" />
                          Add files
                        </>
                      </Button>
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => handleFiles(e.target.files)}
                        disabled={isGenerating}
                      />
                    </label>
                  )}

                  <Select value={selectedFormat} onValueChange={setSelectedFormat}>
                    <SelectTrigger className="w-[180px]" disabled={isGenerating}>
                      <SelectValue placeholder="Output format" />
                    </SelectTrigger>
                    <SelectContent>
                      {outputFormats.map(format => (
                        <SelectItem key={format.value} value={format.value}>
                          <div className="flex flex-col items-start">
                            <span>{format.label}</span>
                            <span className="text-xs text-muted-foreground">{format.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="ml-auto flex gap-2">
                    <Button variant="ghost" onClick={() => { setPrompt(''); setFiles([]); }} disabled={isGenerating}>
                      Clear
                    </Button>
                    <Button
                      onClick={handleGenerate}
                      disabled={!prompt.trim() || isGenerating}
                      className="gap-2 min-w-[120px]"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          Create
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Progress Section */}
      {isGenerating && (
        <section className="border-b bg-muted/30">
          <div className="container mx-auto px-4 py-8">
            <div className="mx-auto max-w-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold">Generating your artifact</h3>
                <Badge variant="secondary">
                  {generationStages.filter(s => s.status === 'completed').length}/{generationStages.length}
                </Badge>
              </div>
              
              <Progress 
                value={(generationStages.filter(s => s.status === 'completed').length / generationStages.length) * 100} 
                className="mb-6"
              />

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {generationStages.map(stage => (
                  <div
                    key={stage.id}
                    className={`flex items-center gap-2 rounded-lg border p-3 transition-colors ${
                      stage.status === 'active' ? 'border-primary bg-primary/5' :
                      stage.status === 'completed' ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950' :
                      stage.status === 'error' ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950' :
                      'border-transparent'
                    }`}
                  >
                    {stage.status === 'active' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    {stage.status === 'completed' && <Check className="h-4 w-4 text-green-600" />}
                    {stage.status === 'error' && <AlertCircle className="h-4 w-4 text-red-600" />}
                    {stage.status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/20" />}
                    
                    <span className={`text-sm ${
                      stage.status === 'active' ? 'font-medium text-primary' :
                      stage.status === 'completed' ? 'text-green-700 dark:text-green-400' :
                      stage.status === 'error' ? 'text-red-700 dark:text-red-400' :
                      'text-muted-foreground'
                    }`}>
                      {stage.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Example Prompts */}
      <section className="py-12 lg:py-16">
        <div className="container mx-auto px-4">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight">What can you create?</h2>
            <p className="mt-2 text-muted-foreground">
              Click any example to get started, or describe your own needs above
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {examplePrompts.map((example, index) => (
              <Card
                key={index}
                className="group cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
                onClick={() => handleExampleClick(example.prompt)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/20">
                      <example.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{example.title}</CardTitle>
                      <Badge variant="secondary" className="mt-1 text-xs capitalize">
                        {example.category}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="line-clamp-2 text-sm">
                    {example.prompt}
                  </CardDescription>
                  <div className="mt-3 flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Use this example
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="border-t bg-muted/30 py-12 lg:py-16">
        <div className="container mx-auto px-4">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight">Professional outputs</h2>
            <p className="mt-2 text-muted-foreground">
              Every artifact is formatted, designed, and ready to use
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: FileText,
                title: 'Documents',
                formats: ['DOCX', 'PDF'],
                description: 'Reports, proposals, plans, research papers with proper formatting',
              },
              {
                icon: Table,
                title: 'Spreadsheets',
                formats: ['XLSX', 'CSV'],
                description: 'Budgets, trackers, schedules with formulas and calculations',
              },
              {
                icon: Presentation,
                title: 'Presentations',
                formats: ['PPTX'],
                description: 'Engaging slides with consistent design and visuals',
              },
              {
                icon: BarChart3,
                title: 'Charts & Diagrams',
                formats: ['Embedded'],
                description: 'Data visualizations, flowcharts, org charts, and more',
              },
            ].map((capability, index) => (
              <Card key={index} className="text-center">
                <CardContent className="pt-6">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                    <capability.icon className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="mb-2 font-semibold">{capability.title}</h3>
                  <div className="mb-2 flex justify-center gap-1">
                    {capability.formats.map(format => (
                      <Badge key={format} variant="secondary" className="text-xs">
                        {format}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">{capability.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Result Dialog */}
      <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" />
              Artifact Ready!
            </DialogTitle>
            <DialogDescription>
              Your artifact has been generated and is ready to download or edit.
            </DialogDescription>
          </DialogHeader>

          {currentArtifact && (
            <div className="space-y-6">
              {/* Preview card */}
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
                        {currentArtifact.type === 'Document' && <FileText className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Spreadsheet' && <Table className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Presentation' && <Presentation className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Proposal' && <Briefcase className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Lesson Plan' && <GraduationCap className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Invoice' && <Receipt className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Resume' && <UserCircle className="h-8 w-8 text-primary" />}
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">{currentArtifact.title}</h3>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge>{currentArtifact.type}</Badge>
                          <Badge variant="outline">{currentArtifact.format}</Badge>
                          <span className="text-sm text-muted-foreground">
                            {currentArtifact.createdAt.toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex flex-wrap gap-3">
                <Button className="gap-2">
                  <Download className="h-4 w-4" />
                  Download {currentArtifact.format}
                </Button>
                <Button variant="outline" className="gap-2">
                  <Eye className="h-4 w-4" />
                  Preview
                </Button>
                <Button variant="outline" className="gap-2">
                  <Edit3 className="h-4 w-4" />
                  Edit
                </Button>
                <Button variant="outline" className="gap-2">
                  <Copy className="h-4 w-4" />
                  Duplicate
                </Button>
                <Button variant="outline" className="gap-2">
                  <History className="h-4 w-4" />
                  Version History
                </Button>
              </div>

              {/* AI Edit suggestion */}
              <div className="rounded-lg border bg-muted/50 p-4">
                <p className="text-sm font-medium mb-2">Want to make changes?</p>
                <p className="text-sm text-muted-foreground mb-3">
                  Ask AI to modify your artifact using natural language:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder='E.g., "Make the cover more professional" or "Add a pricing section"'
                    className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                  />
                  <Button size="sm" variant="outline">
                    Apply
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
