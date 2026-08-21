// ==================== CORE TYPES ====================

export type { 
  User, 
  Workspace, 
  WorkspaceMember, 
  Artifact, 
  ArtifactVersion,
  ArtifactComponent,
  ArtifactJob,
  File,
  KnowledgeSource,
  Brand,
  Plan,
  Subscription,
  Payment,
  Invoice,
  UsageRecord,
  AiRequest,
  WebhookEvent,
  Notification
} from '@prisma/client'

export type {
  UserRole,
  UserStatus,
  MemberRole,
  ArtifactType,
  ArtifactStatus,
  OutputFormat,
  ComponentType,
  JobType,
  JobStatus,
  KnowledgeType,
  SubscriptionStatus,
  PaymentProvider,
  PaymentStatus,
  InvoiceStatus,
  UsageCategory,
  AiProvider,
  WebhookProvider,
  NotificationType
} from '@prisma/client'

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

// ==================== PAYMENT TYPES ====================

export interface PayFastConfig {
  merchantId: string
  merchantKey: string
  passphrase: string
  isSandbox: boolean
  baseUrl: string
  returnUrl: string
  cancelUrl: string
  notifyUrl: string
}

export interface PayFastPaymentRequest {
  amount: number
  itemName: string
  description?: string
  paymentMethod?: string
  emailConfirmation?: boolean
  confirmationAddress?: string
  customIntegers?: Record<string, number>
  customStrings?: Record<string, string>
  subscriptionType?: 'subscription' | 'once-off'
}

export interface PayFastNotificationPayload {
  // Payment details
  m_payment_id: string
  pf_payment_id: string
  payment_status: string
  payment_amount: string
  payment_currency: string
  sandBox: string
  
  // Merchant info
  merchant_id: string
  
  // Transaction details
  item_name: string
  item_description: string
  amount_gross: string
  amount_fee: string
  amount_net: string
  
  // Custom fields
  custom_int1?: string
  custom_int2?: string
  custom_int3?: string
  custom_int4?: string
  custom_int5?: string
  custom_str1?: string
  custom_str2?: string
  custom_str3?: string
  custom_str4?: string
  custom_str5?: string
  
  // Token for subscriptions
  tokenization?: string
  
  // Security
  signature: string
  email_address?: string
  merchant_transaction_id?: string
  billing_date?: string
  recurring_billing?: string
  
  // Timestamps
  date?: string
  time?: string
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
