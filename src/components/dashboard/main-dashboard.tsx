'use client'

import React, { useState, useCallback, useEffect } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  Sparkles,
  Upload,
  FileText,
  Table,
  Presentation,
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
  History,
  LogIn,
  UserPlus,
  Mail,
  Lock,
  ArrowLeft
} from 'lucide-react'

// ==================== AUTH TYPES ====================

interface User {
  id: string
  email: string
  name: string
  avatar?: string
}

// ==================== CREATION TYPES ====================

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
  // Auth State
  const [user, setUser] = useState<User | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)
  
  // Login Form State
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  
  // Signup Form State
  const [signupName, setSignupName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [isSigningUp, setIsSigningUp] = useState(false)

  // Creation State
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [selectedFormat, setSelectedFormat] = useState('auto')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showResultDialog, setShowResultDialog] = useState(false)
  const [generationStages, setGenerationStages] = useState<GenerationStage[]>([])
  const [currentArtifact, setCurrentArtifact] = useState<ArtifactPreview | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load saved prompt on mount
  useEffect(() => {
    const savedPrompt = localStorage.getItem('filo_draft_prompt')
    if (savedPrompt) {
      setPrompt(savedPrompt)
    }
    
    // Check for existing session
    const savedUser = localStorage.getItem('filo_user')
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser))
      } catch {
        localStorage.removeItem('filo_user')
      }
    }
  }, [])

  // Save prompt to localStorage whenever it changes
  useEffect(() => {
    if (prompt.trim()) {
      localStorage.setItem('filo_draft_prompt', prompt)
    } else {
      localStorage.removeItem('filo_draft_prompt')
    }
  }, [prompt])

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

  // Auth Handlers
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setError('Please fill in all fields')
      return
    }

    setIsLoggingIn(true)
    
    try {
      // Simulate API call - replace with real auth
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const newUser: User = {
        id: crypto.randomUUID(),
        email: loginEmail,
        name: loginEmail.split('@')[0],
      }
      
      setUser(newUser)
      localStorage.setItem('filo_user', JSON.stringify(newUser))
      setShowLoginModal(false)
      setLoginEmail('')
      setLoginPassword('')
    } catch (err) {
      setError('Invalid credentials. Please try again.')
    } finally {
      setIsLoggingIn(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    if (!signupName.trim() || !signupEmail.trim() || !signupPassword.trim()) {
      setError('Please fill in all fields')
      return
    }

    if (signupPassword.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setIsSigningUp(true)
    
    try {
      // Simulate API call - replace with real auth
      await new Promise(resolve => setTimeout(resolve, 1200))
      
      const newUser: User = {
        id: crypto.randomUUID(),
        email: signupEmail,
        name: signupName,
      }
      
      setUser(newUser)
      localStorage.setItem('filo_user', JSON.stringify(newUser))
      setShowSignupModal(false)
      setSignupName('')
      setSignupEmail('')
      setSignupPassword('')
    } catch (err) {
      setError('Account creation failed. Please try again.')
    } finally {
      setIsSigningUp(false)
    }
  }

  const handleLogout = () => {
    setUser(null)
    localStorage.removeItem('filo_user')
  }

  // Handle generation
  const handleGenerate = async () => {
    if (!prompt.trim()) return
    
    // Require login for generation
    if (!user) {
      setShowLoginModal(true)
      return
    }

    setIsGenerating(true)
    setError(null)
    
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
      // Call actual API endpoint
      const response = await fetch('/api/artifacts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          artifactType: detectArtifactType(prompt),
          outputFormat: selectedFormat === 'auto' ? undefined : selectedFormat,
          files: files.map(f => ({ name: f.name, size: f.size, type: f.type })),
          workspaceId: user.id, // Use user's default workspace
          brandConfig: null,
          knowledgeContext: null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Generation failed')
      }

      const data = await response.json()

      // Simulate progress stages based on actual processing
      for (let i = 0; i < stages.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 800))
        
        setGenerationStages(prev => 
          prev.map(stage => 
            stage.id === String(i + 1) 
              ? { ...stage, status: 'completed' as const }
              : stage
          )
        )
        
        if (i < stages.length - 1) {
          setGenerationStages(prev =>
            prev.map(stage =>
              stage.id === String(i + 2)
                ? { ...stage, status: 'active' as const }
                : stage
            )
          )
        }
      }

      // Create artifact preview from response or fallback
      const artifact: ArtifactPreview = data.artifact || {
        id: crypto.randomUUID(),
        title: extractTitle(prompt),
        type: detectArtifactType(prompt),
        format: selectedFormat === 'auto' ? 'DOCX' : selectedFormat,
        status: 'completed' as const,
        createdAt: new Date(),
      }

      setCurrentArtifact(artifact)
      setShowResultDialog(true)
      
      // Clear draft after successful generation
      localStorage.removeItem('filo_draft_prompt')
      
    } catch (err) {
      console.error('Generation failed:', err)
      const errorMessage = err instanceof Error ? err.message : 'Generation failed'
      setError(errorMessage)
      
      // Mark current stage as error
      setGenerationStages(prev =>
        prev.map(stage =>
          stage.status === 'active'
            ? { ...stage, status: 'error' as const, detail: errorMessage }
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

  const switchToSignup = () => {
    setShowLoginModal(false)
    setShowSignupModal(true)
    setError(null)
  }

  const switchToLogin = () => {
    setShowSignupModal(false)
    setShowLoginModal(true)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header with Auth */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight">Filo</span>
          </div>

          {/* Auth Section */}
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-3">
                <span className="hidden sm:block text-sm text-muted-foreground">
                  Welcome, <span className="font-medium text-foreground">{user.name}</span>
                </span>
                <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2 cursor-pointer">
                  <LogIn className="h-4 w-4" />
                  <span className="hidden sm:inline">Logout</span>
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowLoginModal(true)}
                  className="gap-2 cursor-pointer"
                >
                  <LogIn className="h-4 w-4" />
                  <span className="hidden sm:inline">Log in</span>
                </Button>
                <Button 
                  size="sm" 
                  onClick={() => setShowSignupModal(true)}
                  className="gap-2 cursor-pointer"
                >
                  <UserPlus className="h-4 w-4" />
                  Sign up
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b bg-gradient-to-br from-background via-background to-muted/30">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8882_1px,transparent_1px),linear-gradient(to_bottom,#8882_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        
        <div className="container relative mx-auto px-4 py-12 lg:py-20">
          <div className="mx-auto max-w-4xl text-center">
            {/* Badge */}
            <Badge 
              variant="secondary" 
              className="mb-6 px-4 py-1.5 text-sm cursor-default select-none"
            >
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              AI-Powered Artifact Generation
            </Badge>

            {/* Headline */}
            <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl leading-tight">
              Describe what you need.
              <br />
              <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Filo creates it.
              </span>
            </h1>

            {/* Subheadline */}
            <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground leading-relaxed">
              Transform your ideas into professional documents, spreadsheets, presentations, and more.
            </p>

            {/* Error Message */}
            {error && (
              <div className="mx-auto mb-6 max-w-3xl flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
                <AlertCircle className="h-5 w-5 text-red-600 shrink-0 cursor-default" />
                <span className="text-sm text-red-800 dark:text-red-200">{error}</span>
                <button 
                  onClick={() => setError(null)}
                  className="ml-auto p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Main Input */}
            <div className="mx-auto max-w-3xl">
              <div className="rounded-xl border bg-card p-2 shadow-lg">
                <Textarea
                  placeholder="What do you want to create? Be specific about what you need..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[120px] resize-none border-0 bg-transparent text-base focus-visible:ring-0 focus-visible:ring-offset-0 px-3 py-3 cursor-text"
                  disabled={isGenerating}
                />

                {/* Files area */}
                {(files.length > 0 || dragActive) && (
                  <div
                    className={`mx-2 mb-2 rounded-lg border-2 border-dashed p-4 transition-all duration-200 ${
                      dragActive ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-muted-foreground/25'
                    }`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                  >
                    {files.length > 0 ? (
                      <div className="space-y-2">
                        {files.map((file, index) => (
                          <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-md bg-muted/50 p-2.5 transition-colors hover:bg-muted">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="flex-1 truncate text-sm font-medium cursor-default">{file.name}</span>
                            <span className="text-xs text-muted-foreground cursor-default">
                              {(file.size / 1024).toFixed(1)} KB
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors"
                              onClick={() => removeFile(index)}
                              disabled={isGenerating}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                        <label>
                          <span className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
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
                      <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
                        <Upload className="mb-3 h-10 w-10 opacity-50" />
                        <p className="font-medium mb-1">Drop files here</p>
                        <p className="text-xs mb-3">or click to browse</p>
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => handleFiles(e.target.files)}
                          disabled={isGenerating}
                          id="file-upload-input"
                        />
                        <label 
                          htmlFor="file-upload-input"
                          className="cursor-pointer text-xs text-primary hover:underline font-medium transition-colors"
                        >
                          Browse files
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3 border-t pt-3 mt-2">
                  {!files.length && (
                    <label className="cursor-pointer">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="gap-2 cursor-pointer hover:bg-accent transition-colors"
                        asChild
                      >
                        <span className="inline-flex items-center gap-2">
                          <Upload className="h-4 w-4" />
                          Add files
                        </span>
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
                    <SelectTrigger 
                      className="w-[180px] cursor-pointer hover:bg-accent transition-colors" 
                      disabled={isGenerating}
                    >
                      <SelectValue placeholder="Output format" />
                    </SelectTrigger>
                    <SelectContent>
                      {outputFormats.map(format => (
                        <SelectItem 
                          key={format.value} 
                          value={format.value}
                          className="cursor-pointer"
                        >
                          <div className="flex flex-col items-start py-1">
                            <span className="font-medium">{format.label}</span>
                            <span className="text-xs text-muted-foreground leading-tight mt-0.5">{format.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="ml-auto flex gap-2">
                    <Button 
                      variant="ghost" 
                      onClick={() => { setPrompt(''); setFiles([]); }} 
                      disabled={isGenerating}
                      className="cursor-pointer hover:bg-accent transition-colors"
                    >
                      Clear
                    </Button>
                    <Button
                      onClick={handleGenerate}
                      disabled={!prompt.trim() || isGenerating}
                      className="gap-2 min-w-[120px] cursor-pointer transition-all hover:shadow-md active:scale-[0.98]"
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
        <section className="border-b bg-muted/30 animate-in slide-in-from-top-2 duration-300">
          <div className="container mx-auto px-4 py-8">
            <div className="mx-auto max-w-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold text-lg">Generating your artifact</h3>
                <Badge variant="secondary" className="cursor-default">
                  {generationStages.filter(s => s.status === 'completed').length}/{generationStages.length}
                </Badge>
              </div>
              
              <Progress 
                value={(generationStages.filter(s => s.status === 'completed').length / generationStages.length) * 100} 
                className="mb-6 h-2 cursor-default"
              />

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {generationStages.map(stage => (
                  <div
                    key={stage.id}
                    className={`flex items-center gap-2 rounded-lg border p-3 transition-all duration-300 cursor-default ${
                      stage.status === 'active' ? 'border-primary bg-primary/5 shadow-sm scale-[1.02]' :
                      stage.status === 'completed' ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950' :
                      stage.status === 'error' ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950' :
                      'border-transparent opacity-60'
                    }`}
                  >
                    {stage.status === 'active' && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
                    {stage.status === 'completed' && <Check className="h-4 w-4 text-green-600 shrink-0" />}
                    {stage.status === 'error' && <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />}
                    {stage.status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/20 shrink-0" />}
                    
                    <span className={`text-sm font-medium truncate ${
                      stage.status === 'active' ? 'text-primary' :
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
            <h2 className="text-2xl font-bold tracking-tight mb-2">What can you create?</h2>
            <p className="text-muted-foreground">
              Click any example to get started, or describe your own needs above
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {examplePrompts.map((example, index) => (
              <Card
                key={index}
                className="group cursor-pointer transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:-translate-y-0.5"
                onClick={() => handleExampleClick(example.prompt)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 transition-all duration-200 group-hover:bg-primary/20 group-hover:scale-110">
                      <example.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base group-hover:text-primary transition-colors">{example.title}</CardTitle>
                      <Badge variant="secondary" className="mt-1 text-xs capitalize cursor-default">
                        {example.category}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="line-clamp-2 text-sm leading-relaxed">
                    {example.prompt}
                  </CardDescription>
                  <div className="mt-3 flex items-center text-sm font-medium text-primary opacity-0 translate-x-[-8px] transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
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
            <h2 className="text-2xl font-bold tracking-tight mb-2">Professional outputs</h2>
            <p className="text-muted-foreground">
              Every artifact is formatted, designed, and ready to use
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 max-w-5xl mx-auto">
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
              <Card 
                key={index} 
                className="text-center transition-all duration-200 hover:shadow-lg hover:-translate-y-1 cursor-default group"
              >
                <CardContent className="pt-6 pb-6">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 transition-transform duration-200 group-hover:scale-110 group-hover:bg-primary/15">
                    <capability.icon className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="mb-2 font-semibold text-lg">{capability.title}</h3>
                  <div className="mb-3 flex justify-center gap-1.5 flex-wrap">
                    {capability.formats.map(format => (
                      <Badge 
                        key={format} 
                        variant="secondary" 
                        className="text-xs font-mono cursor-default"
                      >
                        {format}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{capability.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Result Dialog */}
      <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <DialogContent className="max-w-3xl sm:max-w-[90vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Check className="h-6 w-6 text-green-600" />
              Artifact Ready!
            </DialogTitle>
            <DialogDescription className="text-base">
              Your artifact has been generated and is ready to download or edit.
            </DialogDescription>
          </DialogHeader>

          {currentArtifact && (
            <div className="space-y-6 mt-4">
              {/* Preview card */}
              <Card className="overflow-hidden">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                        {currentArtifact.type === 'Document' && <FileText className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Spreadsheet' && <Table className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Presentation' && <Presentation className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Proposal' && <Briefcase className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Lesson Plan' && <GraduationCap className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Invoice' && <Receipt className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Resume' && <UserCircle className="h-8 w-8 text-primary" />}
                        {!['Document', 'Spreadsheet', 'Presentation', 'Proposal', 'Lesson Plan', 'Invoice', 'Resume'].includes(currentArtifact.type) && <FileText className="h-8 w-8 text-primary" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-lg truncate">{currentArtifact.title}</h3>
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <Badge className="cursor-default">{currentArtifact.type}</Badge>
                          <Badge variant="outline" className="cursor-default font-mono">{currentArtifact.format}</Badge>
                          <span className="text-sm text-muted-foreground cursor-default">
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
                <Button className="gap-2 cursor-pointer hover:shadow-md transition-all min-h-[44px]">
                  <Download className="h-4 w-4" />
                  Download {currentArtifact.format}
                </Button>
                <Button variant="outline" className="gap-2 cursor-pointer hover:bg-accent transition-colors min-h-[44px]">
                  <Eye className="h-4 w-4" />
                  Preview
                </Button>
                <Button variant="outline" className="gap-2 cursor-pointer hover:bg-accent transition-colors min-h-[44px]">
                  <Edit3 className="h-4 w-4" />
                  Edit
                </Button>
                <Button variant="outline" className="gap-2 cursor-pointer hover:bg-accent transition-colors min-h-[44px]">
                  <Copy className="h-4 w-4" />
                  Duplicate
                </Button>
                <Button variant="outline" className="gap-2 cursor-pointer hover:bg-accent transition-colors min-h-[44px]">
                  <History className="h-4 w-4" />
                  Version History
                </Button>
              </div>

              {/* AI Edit suggestion */}
              <div className="rounded-lg border bg-muted/50 p-5">
                <p className="text-sm font-semibold mb-2">Want to make changes?</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Ask AI to modify your artifact using natural language:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder='E.g., "Make the cover more professional" or "Add a pricing section"'
                    className="flex-1 rounded-md border bg-background px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all cursor-text"
                  />
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="cursor-pointer hover:bg-accent transition-colors shrink-0"
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Login Modal */}
      <Dialog open={showLoginModal} onOpenChange={(open) => { setShowLoginModal(open); setError(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <LogIn className="h-5 w-5" />
              Welcome back
            </DialogTitle>
            <DialogDescription>
              Sign in to your Filo account to continue creating artifacts
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleLogin} className="space-y-4 mt-4">
            {error && (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="login-email" className="cursor-pointer">Email</Label>
              <Input
                id="login-email"
                type="email"
                placeholder="you@example.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
                className="cursor-text"
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-password" className="cursor-pointer">Password</Label>
              <Input
                id="login-password"
                type="password"
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
                minLength={6}
                className="cursor-text"
                autoComplete="current-password"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full cursor-pointer hover:shadow-md transition-all min-h-[44px]" 
              disabled={isLoggingIn}
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  Sign In
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <button
                onClick={switchToSignup}
                className="text-primary hover:underline font-medium cursor-pointer transition-colors"
              >
                Sign up
              </button>
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Signup Modal */}
      <Dialog open={showSignupModal} onOpenChange={(open) => { setShowSignupModal(open); setError(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Create your account
            </DialogTitle>
            <DialogDescription>
              Join Filo and start creating professional artifacts in seconds
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSignup} className="space-y-4 mt-4">
            {error && (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="signup-name" className="cursor-pointer">Full Name</Label>
              <Input
                id="signup-name"
                type="text"
                placeholder="John Doe"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                required
                className="cursor-text"
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-email" className="cursor-pointer">Email</Label>
              <Input
                id="signup-email"
                type="email"
                placeholder="you@example.com"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                required
                className="cursor-text"
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-password" className="cursor-pointer">Password</Label>
              <Input
                id="signup-password"
                type="password"
                placeholder="Min. 6 characters"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                required
                minLength={6}
                className="cursor-text"
                autoComplete="new-password"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full cursor-pointer hover:shadow-md transition-all min-h-[44px]" 
              disabled={isSigningUp}
            >
              {isSigningUp ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Create Account
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <button
                onClick={switchToLogin}
                className="text-primary hover:underline font-medium cursor-pointer transition-colors"
              >
                Sign in
              </button>
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
