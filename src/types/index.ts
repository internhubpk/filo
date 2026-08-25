// ==================== CORE TYPES (Convex-based) ====================

// User Types
export interface User {
  id: string
  name: string
  email: string
  emailVerified?: boolean
  image?: string
  planId?: string
  stripeCustomerId?: string
  createdAt: number
  updatedAt: number
}

export type UserRole = 'user' | 'admin' | 'super_admin'
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'banned'

// Workspace Types
export interface Workspace {
  id: string
  name: string
  description?: string
  ownerId: string
  createdAt: number
  updatedAt: number
}

export interface WorkspaceMember {
  id: string
  workspaceId: string
  userId: string
  role: MemberRole
  joinedAt: number
}

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer'

// Artifact Types
export interface Artifact {
  id: string
  userId: string
  title: string
  type: ArtifactType
  format: OutputFormat
  prompt: string
  status: ArtifactStatus
  fileId?: string
  versionCount: number
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface ArtifactVersion {
  id: string
  artifactId: string
  version: number
  content: string
  changes?: string
  createdAt: number
}

export interface ArtifactComponent {
  id: string
  artifactVersionId: string
  type: ComponentType
  content: unknown
  order: number
  metadata?: Record<string, unknown>
}

export interface ArtifactJob {
  id: string
  artifactId: string
  type: JobType
  status: JobStatus
  progress: number
  input: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  startedAt?: number
  completedAt?: number
  createdAt: number
  updatedAt: number
}

export type ArtifactType = 
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'proposal'
  | 'invoice'
  | 'resume'
  | 'lesson_plan'
  | 'report'
  | 'contract'
  | 'email'
  | 'custom'

export type ArtifactStatus = 
  | 'draft'
  | 'generating'
  | 'completed'
  | 'error'
  | 'archived'

export type OutputFormat = 
  | 'DOCX'
  | 'PDF'
  | 'XLSX'
  | 'PPTX'
  | 'CSV'
  | 'TXT'
  | 'HTML'
  | 'MD'

export type ComponentType = 
  | 'text'
  | 'heading'
  | 'list'
  | 'table'
  | 'image'
  | 'chart'
  | 'code'
  | 'quote'
  | 'divider'
  | 'custom'

// File Types
export interface File {
  id: string
  userId: string
  artifactId?: string
  originalName: string
  mimeType: string
  size: number
  r2Key: string
  r2Bucket: string
  url?: string
  uploaded: boolean
  createdAt: number
}

// Knowledge Source Types
export interface KnowledgeSource {
  id: string
  userId: string
  name: string
  type: KnowledgeType
  content?: string
  fileId?: string
  url?: string
  embeddingGenerated: boolean
  createdAt: number
  updatedAt: number
}

export type KnowledgeType = 
  | 'document'
  | 'website'
  | 'text'
  | 'database'

// Brand Types
export interface Brand {
  id: string
  userId: string
  name: string
  logoUrl?: string
  colors?: Record<string, string>
  fonts?: Record<string, string>
  contactInfo?: Record<string, string>
  footerText?: string
  createdAt: number
  updatedAt: number
}

// Plan & Subscription Types
export interface Plan {
  id: string
  name: string
  description: string
  priceMonthly: number
  priceYearly: number
  features: string[]
  limitations: string[]
  popular: boolean
  active: boolean
  maxAiGenerations: number
  maxStorageMb: number
  icon: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface Subscription {
  id: string
  userId: string
  workspaceId?: string
  planId: string
  provider: 'safepay'
  status: SubscriptionStatus
  providerCustomerId?: string
  providerSubscriptionId?: string
  currentPeriodStart: number
  currentPeriodEnd: number
  cancelAtPeriodEnd: boolean
  createdAt: number
  updatedAt: number
}

export type SubscriptionStatus = 
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'trialing'
  | 'expired'

// Payment Types
export interface Payment {
  id: string
  userId: string
  subscriptionId?: string
  amount: number
  currency: string // PKR
  status: PaymentStatus
  provider: 'safepay'
  providerPaymentId?: string
  invoiceId?: string
  description: string
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type PaymentProvider = 'safepay'
export type PaymentStatus = 
  | 'pending'
  | 'completed'
  | 'failed'
  | 'refunded'
  | 'cancelled'

export interface Invoice {
  id: string
  paymentId: string
  invoiceNumber: string
  amount: number
  currency: string
  status: InvoiceStatus
  pdfUrl?: string
  createdAt: number
}

export type InvoiceStatus = 
  | 'draft'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'refunded'

// Usage Tracking Types
export interface UsageRecord {
  id: string
  userId: string
  type: UsageCategory
  amount: number
  periodStart: number
  periodEnd: number
  metadata?: Record<string, unknown>
  createdAt: number
}

export type UsageCategory = 
  | 'ai_generation'
  | 'file_upload'
  | 'storage_used'
  | 'api_call'
  | 'download'

// AI Request Types
export interface AiRequest {
  id: string
  userId: string
  provider: AiProvider
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
  success: boolean
  error?: string
  artifactId?: string
  createdAt: number
}

export type AiProvider = 
  | 'OPENROUTER'
  | 'OPENAI'
  | 'ANTHROPIC'
  | 'GOOGLE'
  | 'LOCAL'

// Webhook Event Types
export interface WebhookEvent {
  id: string
  provider: WebhookProvider
  eventId: string
  type: string
  data: Record<string, unknown>
  processed: boolean
  processingError?: string
  receivedAt: number
  processedAt?: number
}

export type WebhookProvider = 
  | 'safepay'
  | 'custom'

// Notification Types
export interface Notification {
  id: string
  userId: string
  type: NotificationType
  title: string
  message: string
  data?: Record<string, unknown>
  read: boolean
  actionUrl?: string
  createdAt: number
}

export type NotificationType = 
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'payment'
  | 'artifact_ready'
  | 'system'

// Job System Types
export type JobType = 
  | 'artifact_generation'
  | 'file_processing'
  | 'email_sending'
  | 'data_export'
  | 'backup'
  | 'cleanup'

export type JobStatus = 
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retrying'

// ==================== ARTIFACT SPECIFICATION TYPES ====================

export interface ArtifactSpecification {
  id: string
  type: ArtifactType
  title: string
  description?: string
  outputFormat: OutputFormat
  
  // Structure
  sections: ArtifactSection[]
  
  // Design
  design: DesignSpecification
  
  // Branding
  branding?: BrandingConfig
  
  // Metadata
  metadata: ArtifactMetadata
  
  // Validation rules
  validation: ValidationRules
}

export interface ArtifactSection {
  id: string
  type: SectionType
  title: string
  order: number
  content?: string
  components: SectionComponent[]
  config?: Record<string, unknown>
}

export type SectionType = 
  | 'cover'
  | 'title'
  | 'heading'
  | 'content'
  | 'table'
  | 'chart'
  | 'diagram'
  | 'image'
  | 'list'
  | 'footer'
  | 'header'
  | 'callout'
  | 'references'
  | 'appendix'

export interface SectionComponent {
  id: string
  type: ComponentType
  order: number
  content: unknown
  style?: Record<string, unknown>
  data?: unknown
}

export interface DesignSpecification {
  theme: ThemeConfig
  typography: TypographyConfig
  spacing: SpacingConfig
  colors: ColorPalette
  layout: LayoutConfig
}

export interface ThemeConfig {
  name: string
  variant: 'professional' | 'modern' | 'minimal' | 'creative' | 'academic'
  primaryStyle: 'formal' | 'casual' | 'technical' | 'persuasive'
}

export interface TypographyConfig {
  headingFont: string
  bodyFont: string
  monoFont?: string
  headingSizes: Record<string, number>
  bodySize: number
  lineHeight: number
  scale: number
}

export interface SpacingConfig {
  unit: string
  pageMargin: string
  sectionSpacing: string
  paragraphSpacing: string
  itemSpacing: string
}

export interface ColorPalette {
  primary: string
  secondary: string
  accent: string
  background: string
  foreground: string
  muted: string
  mutedForeground: string
  border: string
  card: string
  cardForeground: string
  // Semantic colors
  success: string
  warning: string
  error: string
  info: string
}

export interface LayoutConfig {
  pageSize: 'A4' | 'letter' | 'legal' | 'custom'
  orientation: 'portrait' | 'landscape'
  columns: number
  margins: {
    top: string
    right: string
    bottom: string
    left: string
  }
  headerEnabled: boolean
  footerEnabled: boolean
  pageNumberPosition: 'none' | 'top' | 'bottom' | 'both'
}

export interface BrandingConfig {
  brandId?: string
  companyName?: string
  logoUrl?: string
  colors?: {
    primary?: string
    secondary?: string
    accent?: string
  }
  fonts?: {
    heading?: string
    body?: string
  }
  contactInfo?: {
    address?: string
    website?: string
    email?: string
    phone?: string
  }
  footerText?: string
  applyToDocument: boolean
}

export interface ArtifactMetadata {
  author?: string
  createdAt: string
  updatedAt: string
  version: number
  language: string
  tags: string[]
  keywords: string[]
  customFields?: Record<string, unknown>
}

export interface ValidationRules {
  requireTitle: boolean
  maxSections?: number
  minSections?: number
  requiredSections?: string[]
  forbiddenContent?: string[]
  maxLength?: number
  mustIncludeBranding?: boolean
  validateCalculations?: boolean
  validateReferences?: boolean
}

// ==================== AI TYPES ====================

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | AiContentPart[]
  name?: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}

export interface AiContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
    detail?: 'auto' | 'low' | 'high'
  }
}

export interface ToolCall {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
}

export interface AiRequestOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  responseFormat?: 'text' | 'json_object'
  tools?: ToolDefinition[]
  stream?: boolean
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface AiResponse {
  id: string
  content: string
  toolCalls?: ToolCall[]
  usage: TokenUsage
  model: string
  provider: AiProvider
  latencyMs: number
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter'
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// ==================== AI PROVIDER ABSTRACTION ====================

export interface AiProviderInterface {
  readonly providerName: AiProvider
  readonly defaultModel: string
  availableModels: ModelDefinition[]
  
  generate(request: AiGenerateRequest): Promise<AiResponse>
  generateStream(request: AiGenerateRequest): AsyncGenerator<AiStreamChunk>
  validateConnection(): Promise<boolean>
}

export interface AiGenerateRequest {
  messages: AiMessage[]
  options?: AiRequestOptions
  artifactContext?: ArtifactGenerationContext
}

export interface AiStreamChunk {
  type: 'content' | 'error' | 'done' | 'metadata'
  content?: string
  error?: string
  metadata?: Record<string, unknown>
}

export interface ArtifactGenerationContext {
  artifactType: ArtifactType
  workspaceId: string
  userId: string
  knowledgeContext?: string
  brandContext?: BrandingConfig
  fileContents?: FileContent[]
}

export interface FileContent {
  fileId: string
  filename: string
  mimeType: string
  content: string
  metadata?: Record<string, unknown>
}

export interface ModelDefinition {
  id: string
  name: string
  provider: AiProvider
  capabilities: ModelCapabilities
  pricing: ModelPricing
  contextWindow: number
  maxOutputTokens: number
}

export interface ModelCapabilities {
  textGeneration: boolean
  longContext: boolean
  reasoning: boolean
  vision: boolean
  functionCalling: boolean
  jsonMode: boolean
  imageGeneration: boolean
  structuredOutput: boolean
}

export interface ModelPricing {
  inputPer1kTokens: number
  outputPer1kTokens: number
  currency: string
}

// ==================== MODEL ROUTING ====================

export interface ModelRoutingRule {
  id: string
  name: string
  description: string
  priority: number
  conditions: RoutingCondition[]
  selectedModel: string
  fallbackModels: string[]
  isActive: boolean
}

export interface RoutingCondition {
  field: RoutingField
  operator: RoutingOperator
  value: string | number | boolean
}

export type RoutingField = 
  | 'artifactType'
  | 'outputFormat'
  | 'estimatedTokens'
  | 'hasImages'
  | 'hasFiles'
  | 'requiresReasoning'
  | 'requiresLongContext'
  | 'isComplexTask'
  | 'userPlan'
  | 'timeOfDay'
  | 'priorityLevel'

export type RoutingOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'greaterThan'
  | 'lessThan'
  | 'in'
  | 'notIn'
  | 'exists'
  | 'notExists'

// ==================== JOB SYSTEM ====================

export interface JobDefinition<TInput = unknown, TOutput = unknown> {
  id: string
  type: JobType
  status: JobStatus
  progress: number
  currentStage: JobStage
  input: TInput
  output?: TOutput
  error?: JobError
  startedAt?: Date
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export type JobStage = 
  | 'queued'
  | 'validating_input'
  | 'reading_files'
  | 'planning_artifact'
  | 'generating_content'
  | 'creating_visuals'
  | 'formatting_document'
  | 'checking_quality'
  | 'repairing_issues'
  | 'finalizing'
  | 'uploading_output'
  | 'completed'
  | 'failed'

export interface JobError {
  code: string
  message: string
  details?: Record<string, unknown>
  recoverable: boolean
  retryCount: number
  maxRetries: number
}

// ==================== FILE TYPES ====================

export interface FileUploadOptions {
  workspaceId: string
  ownerId: string
  file: Blob | Buffer
  filename: string
  mimeType: string
  isPublic?: boolean
  maxSizeBytes?: number
}

export interface FileUploadResult {
  id: string
  filename: string
  originalName: string
  mimeType: string
  size: number
  r2Key: string
  url?: string
  signedUrl?: string
  expiresAt?: Date
}

export interface SignedUrlOptions {
  r2Key: string
  expiresInSeconds?: number
  purpose: 'download' | 'upload' | 'preview'
}

// ==================== PAYMENT TYPES (SAFEPAY) ====================

export interface SafepayConfig {
  publicKey: string
  secretKey: string
  webhookSecret: string
  isSandbox: boolean
  returnUrl: string
  cancelUrl: string
  webhookUrl: string
}

export interface SafepayPaymentRequest {
  amount: number
  currency: string // PKR
  itemName: string
  description?: string
  email?: string
  orderId?: string
}

export interface SafepayWebhookEvent {
  id: string
  type: string
  data: {
    id: string
    status: string
    amount: number
    currency: string
    metadata?: Record<string, unknown>
  }
  created_at: string
}

// ==================== API TYPES ====================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: ApiError
  meta?: ApiMeta
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown[]>
  statusCode: number
}

export interface ApiMeta {
  page?: number
  limit?: number
  total?: number
  totalPages?: number
  requestId?: string
  timestamp: string
}

export interface PaginationParams {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  search?: string
}

// ==================== UI/UX TYPES ====================

export interface ToastMessage {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  description?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

export interface ModalState {
  isOpen: boolean
  isLoading: boolean
  data?: unknown
  error?: string
}

export interface SidebarItem {
  id: string
  label: string
  icon: string
  href: string
  badge?: number
  children?: SidebarItem[]
  isActive?: boolean
  isDisabled?: boolean
}

export interface BreadcrumbItem {
  label: string
  href?: string
  icon?: string
}

// ==================== SEARCH TYPES ====================

export interface SearchQuery {
  query: string
  types?: SearchableType[]
  workspaceId: string
  userId: string
  filters?: SearchFilters
  pagination?: PaginationParams
}

export type SearchableType = 
  | 'artifacts'
  | 'files'
  | 'knowledge'
  | 'versions'

export interface SearchFilters {
  dateFrom?: Date
  dateTo?: Date
  artifactTypes?: ArtifactType[]
  mimeTypes?: string[]
  status?: ArtifactStatus[]
  sizeMin?: number
  sizeMax?: number
}

export interface SearchResult {
  id: string
  type: SearchableType
  title: string
  excerpt: string
  score: number
  highlight?: Record<string, string[]>
  url: string
  metadata: Record<string, unknown>
}

export interface SearchResults {
  results: SearchResult[]
  total: number
  query: string
  facets: SearchFacets
  tookMs: number
}

export interface SearchFacets {
  types: Record<string, number>
  artifactTypes: Record<string, number>
  dateRange: { from: Date; to: Date }
}

// ==================== GENERATED CONTENT TYPES ====================

export interface GeneratedComponent {
  sectionId: string
  componentId: string
  type: ComponentType
  content: unknown
  style?: Record<string, unknown>
  order: number
}

// ==================== ADMIN TYPES ====================

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'down'
  uptime: number
  version: string
  timestamp: Date
  services: ServiceHealth[]
}

export interface ServiceHealth {
  name: string
  status: 'operational' | 'degraded' | 'down'
  responseTimeMs: number
  lastChecked: Date
  error?: string
}

export interface AdminDashboardStats {
  totalUsers: number
  activeUsers: number
  totalArtifacts: number
  artifactsToday: number
  revenue: { today: number; thisMonth: number; allTime: number }
  storageUsed: number
  aiRequestsToday: number
  failedJobs: number
  pendingPayments: number
}

// ==================== PWA TYPES ====================

export interface PwaManifest {
  name: string
  short_name: string
  description: string
  start_url: string
  display: 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser'
  background_color: string
  theme_color: string
  orientation?: 'portrait' | 'landscape' | 'any'
  icons: PwaIcon[]
  categories: string[]
  screenshots?: PwaScreenshot[]
}

export interface PwaIcon {
  src: string
  sizes: string
  type: string
  purpose: 'any' | 'maskable' | 'any maskable'
}

export interface PwaScreenshot {
  src: string
  sizes: string
  type: string
  form_factor: 'narrow' | 'wide'
  label: string
}
