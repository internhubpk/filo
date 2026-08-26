'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
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
  EyeOff,
  Edit3,
  History,
  LogIn,
  UserPlus,
  Mail,
  Lock,
  ArrowLeft,
  Wand2,
  FileSpreadsheet,
  Image as ImageIcon,
  Code2,
  Type,
  LayoutGrid,
  Settings2,
  CreditCard,
  Star,
  Rocket,
  Target,
  Lightbulb,
  ChevronRight,
  CircleDollarSign,
  Moon,
  Sun,
  Crown,
  Shield,
  HardDrive,
  Clock
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { apiClient, User as ApiUser } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { 
  ErrorCode, 
  createAppError, 
  getErrorDisplay,
  parseError 
} from '@/lib/error-handler'
import { ErrorDisplay, useErrorHandler } from '@/components/ui/error-boundary'

// ==================== AUTH TYPES ====================

interface User {
  id: string
  email: string
  name: string
  avatar?: string
  // Manual activation flow: "pending_activation" means admin hasn't
  // verified the user's payment yet, so AI generation is blocked.
  status?: 'pending_activation' | 'active' | 'suspended'
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
  { value: 'auto', label: 'Auto', icon: Wand2, color: 'text-purple-500' },
  { value: 'DOCX', label: 'DOCX', icon: FileText, color: 'text-blue-600' },
  { value: 'PDF', label: 'PDF', icon: FileText, color: 'text-red-500' },
  { value: 'XLSX', label: 'XLSX', icon: FileSpreadsheet, color: 'text-green-600' },
  { value: 'PPTX', label: 'PPTX', icon: Presentation, color: 'text-orange-500' },
  { value: 'CSV', label: 'CSV', icon: Table, color: 'text-teal-600' },
]

// ==================== MAIN COMPONENT ====================

export function MainDashboard() {
  const { theme, setTheme } = useTheme()
  
  // Auth State
  const [user, setUser] = useState<User | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)
  
  // Login Form State
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  
  // Signup Form State
  const [signupName, setSignupName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [showSignupPassword, setShowSignupPassword] = useState(false)
  const [isSigningUp, setIsSigningUp] = useState(false)

  // Creation State
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [selectedFormat, setSelectedFormat] = useState('auto')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showResultDialog, setShowResultDialog] = useState(false)
  const [generationStages, setGenerationStages] = useState<GenerationStage[]>([])
  // Artifact state with file data for download
  const [currentArtifact, setCurrentArtifact] = useState<ArtifactPreview & {
    fileData?: string
    fileName?: string
    fileSize?: number
    mimeType?: string
  } | null>(null)
  const [lastResponseData, setLastResponseData] = useState<any>(null)
  const [dragActive, setDragActive] = useState(false)
  
  // Error handling with proper types (using our error system)
  const [appError, setAppError] = useState<import('@/lib/error-handler').AppError | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)

  // Helper to set user-friendly errors
  const setError = useCallback((code: ErrorCode, originalError?: unknown) => {
    setAppError(createAppError(code, originalError))
  }, [])
  
  const clearError = useCallback(() => {
    setAppError(null)
  }, [])

  // Subscription/Pro status check
  // In the manual activation model, "hasActive" is true only when the
  // user's status is "active" - i.e. an admin has approved their payment.
  // pending_activation and suspended both block AI generation.
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [showPendingActivationModal, setShowPendingActivationModal] = useState(false)
  const [subscriptionStatus, setSubscriptionStatus] = useState<{
    hasActive: boolean
    remaining: number
    limit: number
    reason?: string
    accountStatus?: 'pending_activation' | 'active' | 'suspended'
    latestVerification?: {
      id: string
      status: 'pending' | 'approved' | 'rejected'
      amount: number
      currency: string
      paymentMethod: string
      transactionId: string
      adminNote: string | null
      createdAt: number
      reviewedAt: number | null
    } | null
  } | null>(null)

  // Load saved session on mount (REAL session, not fake user)
  useEffect(() => {
    const savedPrompt = localStorage.getItem('filo_draft_prompt')
    if (savedPrompt) {
      setPrompt(savedPrompt)
    }
    
    // Check for existing REAL session
    const savedSession = localStorage.getItem('filo_session')
    if (savedSession) {
      try {
        const sessionData = JSON.parse(savedSession)
        if (sessionData.user && sessionData.token) {
          setUser(sessionData.user)
          setSessionToken(sessionData.token)
        } else {
          localStorage.removeItem('filo_session')
        }
      } catch {
        localStorage.removeItem('filo_session')
      }
    }
  }, [])

  // Load subscription status when user logs in
  useEffect(() => {
    if (user?.id && sessionToken) {
      apiClient.getSubscriptionStatus()
        .then(response => {
          if (response.success && response.data) {
            const accountStatus = (response.data as any).accountStatus ?? 'pending_activation'
            const latestVerification = (response.data as any).latestVerification ?? null
            setSubscriptionStatus({
              hasActive: response.data.hasActiveSubscription,
              remaining: response.data.remainingGenerations,
              limit: response.data.planLimit,
              accountStatus,
              latestVerification,
              reason: undefined,
            })
            // Also sync the user object's status field so the UI can branch
            // on `user.status` directly (used for the banner + gating).
            if (user.status !== accountStatus) {
              setUser(prev => prev ? { ...prev, status: accountStatus } : prev)
              // Persist back to localStorage so other components see it.
              try {
                const raw = localStorage.getItem('filo_session')
                if (raw) {
                  const parsed = JSON.parse(raw)
                  if (parsed?.user) {
                    parsed.user.status = accountStatus
                    localStorage.setItem('filo_session', JSON.stringify(parsed))
                  }
                }
              } catch {
                // ignore
              }
            }
          }
        })
        .catch(err => {
          console.error('[DASHBOARD] Failed to load subscription:', err)
          // Default to pending - DO NOT silently unlock generation
          setSubscriptionStatus({
            hasActive: false,
            remaining: 0,
            limit: 0,
            accountStatus: 'pending_activation',
            latestVerification: null,
            reason: 'status_check_failed',
          })
        })
    }
  }, [user?.id, sessionToken])

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

  // Auth Handlers - Using Proxy API (NO DIRECT CONVEX!)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    
    if (!loginEmail.trim() || !loginPassword.trim()) {
      toast.error('Please fill in all fields', 'Email and password are required')
      setError(ErrorCode.AUTH_MISSING_FIELDS)
      return
    }

    setIsLoggingIn(true)
    
    // Show loading toast
    const loadingToastId = toast.loading('Signing you in...')
    
    try {
      // Call PROXY API which calls Convex server-side
      const response = await apiClient.login(loginEmail, loginPassword)

      if (!response.success || !response.data?.user || !response.data?.sessionToken) {
        // Dismiss loading toast
        toast.dismiss(loadingToastId)
        
        // Map error codes to user-friendly errors with toasts
        if (response.code === 'USER_NOT_FOUND') {
          toast.loginError('No account found with this email. Please sign up first.')
          setError(ErrorCode.AUTH_USER_NOT_FOUND)
        } else if (response.code === 'INVALID_PASSWORD') {
          toast.loginError('Incorrect password. Please try again or reset your password.')
          setError(ErrorCode.AUTH_INVALID_PASSWORD)
        } else if (response.code === 'INVALID_EMAIL') {
          toast.loginError('Invalid email format')
          setError(ErrorCode.AUTH_INVALID_EMAIL)
        } else if (response.code === 'SERVICE_UNAVAILABLE') {
          toast.loginError('Authentication service is unavailable. Please try again later.')
          setError(ErrorCode.AUTH_LOGIN_FAILED, response.error)
        } else {
          toast.loginError(response.error || 'Login failed. Please check your credentials and try again.')
          setError(ErrorCode.AUTH_LOGIN_FAILED, response.error)
        }
        return
      }

      // Store session using API client helper
      const userData = response.data.user
      const token = response.data.sessionToken
      
      setUser(userData as unknown as User)
      setSessionToken(token)
      apiClient.storeSession(userData, token)
      
      // Dismiss loading and show success
      toast.dismiss(loadingToastId)
      toast.loginSuccess(userData.name || 'there')
      
      setShowLoginModal(false)
      setLoginEmail('')
      setLoginPassword('')
    } catch (err) {
      toast.dismiss(loadingToastId)
      toast.loginError(err instanceof Error ? err.message : 'Network error')
      setError(ErrorCode.AUTH_LOGIN_FAILED, err)
    } finally {
      setIsLoggingIn(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    
    if (!signupName.trim() || !signupEmail.trim() || !signupPassword.trim()) {
      toast.error('Please fill in all fields', 'Name, email, and password are required')
      setError(ErrorCode.AUTH_MISSING_FIELDS)
      return
    }

    if (signupPassword.length < 6) {
      toast.error('Password too short', 'Password must be at least 6 characters')
      setError(ErrorCode.AUTH_PASSWORD_TOO_SHORT)
      return
    }

    setIsSigningUp(true)
    
    // Show loading toast with animation
    const loadingToastId = toast.loading('Creating your account...')
    
    try {
      // Call PROXY API which calls Convex server-side
      const response = await apiClient.signup(signupName, signupEmail, signupPassword)

      console.log('[DASHBOARD] Signup response:', response)

      if (!response.success || !response.data?.user) {
        // Dismiss loading toast
        toast.dismiss(loadingToastId)
        
        // Map error codes to user-friendly errors with toasts
        if (response.code === 'EMAIL_EXISTS') {
          toast.signupError('An account already exists with this email')
          setError(ErrorCode.AUTH_EMAIL_EXISTS)
        } else if (response.code === 'INVALID_EMAIL') {
          toast.signupError('Invalid email format')
          setError(ErrorCode.AUTH_INVALID_EMAIL)
        } else if (response.code === 'PASSWORD_TOO_SHORT') {
          toast.signupError('Password must be at least 6 characters')
          setError(ErrorCode.AUTH_PASSWORD_TOO_SHORT)
        } else {
          toast.signupError(response.error || 'Account creation failed')
          setError(ErrorCode.AUTH_SIGNUP_FAILED, response.error)
        }
        return
      }

      // Store session after successful signup
      const userData = response.data.user
      const token = response.data.sessionToken
      
      setUser(userData as unknown as User)
      setSessionToken(token || null)
      apiClient.storeSession(userData, token || '')
      
      // Dismiss loading and show success
      toast.dismiss(loadingToastId)
      toast.signupSuccess(userData.name || signupName)
      
      setShowSignupModal(false)
      setSignupName('')
      setSignupEmail('')
      setSignupPassword('')
    } catch (err) {
      console.error('[DASHBOARD] Signup error:', err)
      toast.dismiss(loadingToastId)
      toast.signupError(err instanceof Error ? err.message : 'Network error')
      setError(ErrorCode.AUTH_SIGNUP_FAILED, err)
    } finally {
      setIsSigningUp(false)
    }
  }

  const handleLogout = async () => {
    // Show loading toast
    const loadingToastId = toast.loading('Logging out...')
    
    try {
      await apiClient.logout()
    } catch (err) {
      console.error('Logout error:', err)
      // Don't show error for logout - just clear locally
    }
    
    // Clear local state
    setUser(null)
    setSessionToken(null)
    apiClient.clearSession()
    
    // Dismiss loading and show success
    toast.dismiss(loadingToastId)
    toast.logoutSuccess()
  }

  // Handle generation
  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.warning('Please enter a prompt', 'Describe what you want to create')
      return
    }
    
    // Require login for generation
    if (!user) {
      toast.sessionExpired()
      setShowLoginModal(true)
      setError(ErrorCode.AUTH_UNAUTHORIZED)
      return
    }

    // MANUAL ACTIVATION GATE: user must have status === "active" before
    // they can perform AI generation. New signups are "pending_activation"
    // and only flip to "active" after an admin verifies their payment.
    const accountStatus = user.status ?? subscriptionStatus?.accountStatus ?? 'pending_activation'
    if (accountStatus !== 'active') {
      toast.warning('Account pending activation', accountStatus === 'suspended'
            ? 'Your account has been suspended. Please contact support.'
            : 'Please complete payment and wait for admin verification to unlock AI generation.',)
      setShowPendingActivationModal(true)
      return
    }

    // Defensive: subscriptionStatus should agree with accountStatus.
    // If it doesn't (e.g. stale), block generation rather than silently unlock.
    if (!subscriptionStatus?.hasActive && subscriptionStatus?.reason !== 'status_check_failed') {
      // Status check itself succeeded but says no active sub - block.
      toast.warning('Account pending activation', 'Please complete payment and wait for admin verification to unlock AI generation.',)
      setShowPendingActivationModal(true)
      return
    }

    setIsGenerating(true)
    clearError()
    
    // Show generation started toast with loading animation
    const loadingToastId = toast.generationStarted(prompt)
    
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
      // Call AGENT ROUTER for real document generation (produces downloadable files)
      const response = await apiClient.agentGenerate({
        prompt,
        artifactType: detectArtifactType(prompt),
        outputFormat: selectedFormat === 'auto' ? undefined : selectedFormat,
        workspaceId: user.id, // Use user's default workspace
      })

      // Check for errors from API
      if (!response.success || !response.data?.artifact) {
        // Dismiss loading toast
        toast.dismiss(loadingToastId)
        
        // Map error codes to user-friendly messages with toasts
        if (response.code === 'API_KEY_MISSING') {
          toast.generationError('AI service not configured')
          setError(ErrorCode.AI_API_KEY_MISSING, response.error)
        } else if (response.code === 'PROVIDER_ERROR') {
          toast.generationError('AI provider error')
          setError(ErrorCode.AI_PROVIDER_ERROR, response.error)
        } else if (response.code === 'RATE_LIMITED') {
          toast.generationError('Rate limit exceeded. Please wait a moment.')
          setError(ErrorCode.AI_RATE_LIMITED, response.error)
        } else if (response.code === 'TIMEOUT') {
          toast.generationError('Generation timed out')
          setError(ErrorCode.AI_TIMEOUT, response.error)
        } else if (response.code === 'PLANNING_FAILED') {
          toast.generationError('Failed to plan your artifact')
          setError(ErrorCode.AI_PLANNING_FAILED, response.error)
        } else if (response.code === 'GENERATION_FAILED') {
          toast.generationError(response.error || 'Generation failed')
          setError(ErrorCode.AI_GENERATION_FAILED, response.error)
        } else {
          toast.generationError(response.error || 'Something went wrong')
          setError(ErrorCode.AI_GENERATION_FAILED, response.error)
        }
        
        // Mark current stage as error
        setGenerationStages(prev =>
          prev.map(stage => ({
            ...stage,
            status: stage.status === 'active' ? 'error' as const : stage.status,
            detail: response.error ? String(response.error) : undefined,
          }))
        )
        return
      }

      const data = response.data

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

      // Store full response data for download
      setLastResponseData(data)

      // Create artifact preview from response or fallback
      // EXTRA DEFENSIVE: Handle any shape of response data safely
      let artifact: ArtifactPreview & {
        fileData?: string
        fileName?: string
        fileSize?: number
        mimeType?: string
      }
      
      try {
        const safeData = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
        const safeArtifact = (safeData.artifact && typeof safeData.artifact === 'object' ? safeData.artifact : {}) as Record<string, unknown>
        
        artifact = {
          id: (safeArtifact.id && typeof safeArtifact.id === 'string') ? safeArtifact.id : crypto.randomUUID(),
          title: (safeArtifact.title && typeof safeArtifact.title === 'string') ? safeArtifact.title : extractTitle(prompt),
          type: (safeArtifact.type && typeof safeArtifact.type === 'string') ? safeArtifact.type : detectArtifactType(prompt),
          format: (safeArtifact.format && typeof safeArtifact.format === 'string') ? safeArtifact.format : (selectedFormat === 'auto' ? 'DOCX' : selectedFormat),
          status: 'completed' as const,
          createdAt: new Date(),
          // Capture file data for download
          fileData: (safeArtifact.fileData && typeof safeArtifact.fileData === 'string') ? safeArtifact.fileData : undefined,
          fileName: (safeArtifact.fileName && typeof safeArtifact.fileName === 'string') ? safeArtifact.fileName : undefined,
          fileSize: (safeArtifact.fileSize && typeof safeArtifact.fileSize === 'number') ? safeArtifact.fileSize : undefined,
          mimeType: (safeArtifact.mimeType && typeof safeArtifact.mimeType === 'string') ? safeArtifact.mimeType : undefined,
        }
      } catch (constructErr) {
        // Ultimate fallback if anything goes wrong
        console.error('Artifact construction error:', constructErr)
        artifact = {
          id: crypto.randomUUID(),
          title: extractTitle(prompt),
          type: detectArtifactType(prompt),
          format: selectedFormat === 'auto' ? 'DOCX' : selectedFormat,
          status: 'completed' as const,
          createdAt: new Date(),
        }
      }

      setCurrentArtifact(artifact)
      setShowResultDialog(true)
      
      // Dismiss loading and show success toast
      toast.dismiss(loadingToastId)
      toast.generationSuccess(artifact.title || 'Your artifact')
      
      // Clear draft after successful generation
      localStorage.removeItem('filo_draft_prompt')
      
    } catch (err) {
      console.error('Generation failed:', err)
      
      // Dismiss loading toast on error
      toast.dismiss(loadingToastId)
      
      // Show error toast
      toast.generationError(err instanceof Error ? err.message : 'Generation failed')
      
      // Parse error and set user-friendly message
      const parsedError = parseError(err)
      setAppError(parsedError)
      
      // Mark current stage as error
      setGenerationStages(prev =>
        prev.map(stage =>
          stage.status === 'active'
            ? { ...stage, status: 'error' as const, detail: parsedError.message }
            : stage
        )
      )
    } finally {
      setIsGenerating(false)
    }
  }

  // Retry generation (for error recovery)
  // Handle file download from base64 data
  const handleDownload = () => {
    if (!currentArtifact?.fileData) {
      toast.warning('No file data available', 'The file could not be downloaded. Please try regenerating.')
      return
    }

    try {
      // Decode base64 to binary
      const binaryString = atob(currentArtifact.fileData)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      // Create blob and trigger download
      const blob = new Blob([bytes], { type: currentArtifact.mimeType || 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = currentArtifact.fileName || `${currentArtifact.title || 'document'}.${(currentArtifact.format || 'docx').toLowerCase()}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success('Download started!', `${link.download} (${currentArtifact.fileSize ? `${(currentArtifact.fileSize / 1024).toFixed(1)} KB` : 'unknown size'})`)
    } catch (err) {
      console.error('Download failed:', err)
      toast.error('Download failed', 'Could not process the file. Please try again.')
    }
  }

  const handleRetryGeneration = () => {
    clearError()
    handleGenerate()
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

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleExampleClick = (examplePrompt: string) => {
    setPrompt(examplePrompt)
    // Scroll to the textarea and focus it so the user sees the prompt was set
    setTimeout(() => {
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      textareaRef.current?.focus()
    }, 100)
    // Auto-generate after a brief delay so the user sees the prompt first
    setTimeout(() => {
      handleGenerate()
    }, 400)
  }

  const switchToSignup = () => {
    setShowLoginModal(false)
    clearError()
    // Delay opening signup dialog to avoid Radix UI Dialog ref race condition
    // ("r.title is undefined" when two dialogs toggle in the same tick)
    setTimeout(() => setShowSignupModal(true), 150)
  }

  const switchToLogin = () => {
    setShowSignupModal(false)
    clearError()
    // Delay opening login dialog to avoid Radix UI Dialog ref race condition
    setTimeout(() => setShowLoginModal(true), 150)
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
            {/* Theme Toggle */}
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

            {/* Pricing Link */}
            <Link href="/pricing" className="hidden sm:flex">
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2 cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <CreditCard className="h-4 w-4" />
                <span>Pricing</span>
              </Button>
            </Link>

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

            {/* Error Message - User-friendly with retry option */}
            {appError && (
              <div className="mx-auto mb-6 max-w-3xl">
                <ErrorDisplay 
                  error={appError} 
                  onRetry={appError.retryable ? handleRetryGeneration : undefined}
                  onDismiss={clearError}
                />
              </div>
            )}

            {/* Main Input */}
            <div className="mx-auto max-w-3xl">
              <div className="rounded-xl border bg-card p-2 shadow-lg">
                <Textarea
                  ref={textareaRef}
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
                        className="gap-2 cursor-pointer hover:bg-accent transition-colors h-9 min-w-[100px] justify-center"
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
                      className="w-[180px] cursor-pointer hover:bg-accent transition-colors h-9 min-w-[100px] justify-center" 
                      disabled={isGenerating}
                    >
                      <SelectValue placeholder="Output format" />
                    </SelectTrigger>
                    <SelectContent>
                      {outputFormats.map(format => {
                        const IconComponent = format.icon
                        return (
                          <SelectItem 
                            key={format.value} 
                            value={format.value}
                            className="cursor-pointer gap-2 py-2.5"
                          >
                            <div className="flex items-center gap-2.5">
                              <IconComponent className={`h-4.5 w-4.5 ${format.color}`} />
                              <span className="font-medium text-sm">{format.label}</span>
                            </div>
                          </SelectItem>
                        )
                      })}
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

          {currentArtifact ? (
            <div className="space-y-6 mt-4">
              {/* Preview card */}
              <Card className="overflow-hidden">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                        {(currentArtifact.type === 'Document' || !currentArtifact.type) && <FileText className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Spreadsheet' && <Table className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Presentation' && <Presentation className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Proposal' && <Briefcase className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Lesson Plan' && <GraduationCap className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Invoice' && <Receipt className="h-8 w-8 text-primary" />}
                        {currentArtifact.type === 'Resume' && <UserCircle className="h-8 w-8 text-primary" />}
                        {!['Document', 'Spreadsheet', 'Presentation', 'Proposal', 'Lesson Plan', 'Invoice', 'Resume'].includes(currentArtifact?.type || '') && <FileText className="h-8 w-8 text-primary" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-lg truncate">{currentArtifact.title || 'Generated Artifact'}</h3>
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <Badge className="cursor-default">{currentArtifact.type || 'Document'}</Badge>
                          <Badge variant="outline" className="cursor-default font-mono">{currentArtifact.format || 'DOCX'}</Badge>
                          <span className="text-sm text-muted-foreground cursor-default">
                            {(currentArtifact.createdAt instanceof Date ? currentArtifact.createdAt : new Date()).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex flex-wrap gap-3">
                <Button 
                  className="gap-2 cursor-pointer hover:shadow-md transition-all min-h-[44px]"
                  onClick={handleDownload}
                  disabled={!currentArtifact?.fileData}
                >
                  <Download className="h-4 w-4" />
                  {currentArtifact?.fileData ? `Download ${currentArtifact.format}` : 'Download'}
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
          ) : (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Unable to Display Artifact</h3>
              <p className="text-muted-foreground">
                The artifact data is incomplete or corrupted. Please try generating again.
              </p>
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={() => {
                  setShowResultDialog(false)
                  setCurrentArtifact(null)
                }}
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Login Modal */}
      <Dialog open={showLoginModal} onOpenChange={(open) => { setShowLoginModal(open); clearError(); }}>
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
              <div className="relative">
                <Input
                  id="login-password"
                  type={showLoginPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  minLength={6}
                  className="cursor-text pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  tabIndex={-1}
                >
                  {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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
      <Dialog open={showSignupModal} onOpenChange={(open) => { setShowSignupModal(open); clearError(); }}>
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
              <div className="relative">
                <Input
                  id="signup-password"
                  type={showSignupPassword ? 'text' : 'password'}
                  placeholder="Min. 6 characters"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  required
                  minLength={6}
                  className="cursor-text pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowSignupPassword(!showSignupPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  tabIndex={-1}
                >
                  {showSignupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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

      {/* Upgrade to Pro Modal */}
      <Dialog open={showUpgradeModal} onOpenChange={(open) => { setShowUpgradeModal(open); clearError(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5">
                <Crown className="h-6 w-6 text-primary" />
              </div>
              Upgrade to Pro
            </DialogTitle>
            <DialogDescription className="text-base">
              Unlock unlimited AI generation and premium features
            </DialogDescription>
          </DialogHeader>

          {appError?.code === ErrorCode.SUBSCRIPTION_REQUIRED && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-sm">Pro Required</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    AI generation is exclusive to Pro subscribers. Upgrade to continue.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4 py-4">
            {/* Pro Benefits */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Sparkles, text: 'Unlimited AI Generation' },
                { icon: Rocket, text: 'Priority Processing' },
                { icon: FileSpreadsheet, text: 'All Export Formats' },
                { icon: Shield, text: 'No Watermarks' },
                { icon: HardDrive, text: '5GB Cloud Storage' },
                { icon: Mail, text: 'Priority Support' },
              ].map((benefit, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                  <benefit.icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-xs font-medium">{benefit.text}</span>
                </div>
              ))}
            </div>

            {/* Pricing */}
            <div className="border rounded-xl p-4 bg-gradient-to-br from-primary/5 to-transparent">
              <div className="text-center space-y-2">
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-bold">Rs. 190</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  or Rs. 1,900/year (save 2 months)
                </p>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="space-y-2">
              <Button 
                className="w-full cursor-pointer hover:shadow-md transition-all min-h-[48px] text-base font-semibold"
                onClick={() => {
                  window.location.href = '/pricing?upgrade=true'
                }}
              >
                <CreditCard className="mr-2 h-5 w-5" />
                View Plans & Subscribe
              </Button>
              
              <Button 
                variant="outline" 
                className="w-full cursor-pointer"
                onClick={() => setShowUpgradeModal(false)}
              >
                Maybe Later
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Cancel anytime. 7-day free trial on all plans.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pending Activation Modal - shown when user is logged in but their
          account hasn't been activated by an admin yet. AI generation is
          blocked until activation. */}
      <Dialog open={showPendingActivationModal} onOpenChange={setShowPendingActivationModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-100 dark:bg-yellow-950">
                <Clock className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
              </div>
              Account Pending Activation
            </DialogTitle>
            <DialogDescription className="text-base">
              {user?.status === 'suspended'
                ? 'Your account has been suspended. Please contact support to restore access.'
                : 'Your payment is being reviewed by our admin team. AI generation will unlock automatically once your account is activated.'}
            </DialogDescription>
          </DialogHeader>

          {/* Latest verification state - shows user what's happening */}
          {subscriptionStatus?.latestVerification && (
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Submission status</span>
                <Badge
                  variant={
                    subscriptionStatus.latestVerification.status === 'approved' ? 'default' :
                    subscriptionStatus.latestVerification.status === 'rejected' ? 'destructive' :
                    'secondary'
                  }
                  className="cursor-default"
                >
                  {subscriptionStatus.latestVerification.status}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Transaction ID</span>
                <span className="font-mono text-xs">{subscriptionStatus.latestVerification.transactionId}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-medium">
                  {subscriptionStatus.latestVerification.currency} {subscriptionStatus.latestVerification.amount.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Method</span>
                <span className="font-medium capitalize">{subscriptionStatus.latestVerification.paymentMethod.replace('_', ' ')}</span>
              </div>
              {subscriptionStatus.latestVerification.adminNote && (
                <div className="border-t pt-2 mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Admin note:</p>
                  <p className="text-sm font-medium">{subscriptionStatus.latestVerification.adminNote}</p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2 py-2">
            <Button
              className="w-full cursor-pointer hover:shadow-md transition-all min-h-[48px]"
              onClick={() => {
                setShowPendingActivationModal(false)
                window.location.href = '/billing'
              }}
            >
              <CreditCard className="mr-2 h-5 w-5" />
              {subscriptionStatus?.latestVerification ? 'View Billing' : 'Submit Payment'}
            </Button>
            <Button
              variant="outline"
              className="w-full cursor-pointer"
              onClick={() => setShowPendingActivationModal(false)}
            >
              Close
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Activations are typically completed within 24 hours of submission.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
