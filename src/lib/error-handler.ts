// =============================================================================
// FILO Error Handling System
// =============================================================================
// Centralized, user-friendly error handling for the entire application
// - Maps technical errors to human-readable messages
// - Provides consistent error display components
// - Handles retry logic and error recovery
// =============================================================================

// ==================== ERROR CODES ====================

export enum ErrorCode {
  // Auth errors (1xxx)
  AUTH_MISSING_FIELDS = 'AUTH_1001',
  AUTH_INVALID_EMAIL = 'AUTH_1002',
  AUTH_USER_NOT_FOUND = 'AUTH_1003',
  AUTH_INVALID_PASSWORD = 'AUTH_1004',
  AUTH_EMAIL_EXISTS = 'AUTH_1005',
  AUTH_PASSWORD_TOO_SHORT = 'AUTH_1006',
  AUTH_SESSION_EXPIRED = 'AUTH_1007',
  AUTH_LOGIN_FAILED = 'AUTH_1008',
  AUTH_SIGNUP_FAILED = 'AUTH_1009',
  AUTH_LOGOUT_FAILED = 'AUTH_1010',
  AUTH_UNAUTHORIZED = 'AUTH_1011',
  
  // AI/Generation errors (2xxx)
  AI_API_KEY_MISSING = 'AI_2001',
  AI_PROVIDER_ERROR = 'AI_2002',
  AI_RATE_LIMITED = 'AI_2003',
  AI_TIMEOUT = 'AI_2004',
  AI_PLANNING_FAILED = 'AI_2005',
  AI_GENERATION_FAILED = 'AI_2006',
  AI_VALIDATION_ERROR = 'AI_2007',
  AI_MODEL_ERROR = 'AI_2008',
  AI_CONTENT_FILTERED = 'AI_2009',
  
  // File errors (3xxx)
  FILE_NO_FILE = 'FILE_3001',
  FILE_TOO_LARGE = 'FILE_3002',
  FILE_INVALID_TYPE = 'FILE_3003',
  FILE_UPLOAD_FAILED = 'FILE_3004',
  FILE_DOWNLOAD_FAILED = 'FILE_3005',
  FILE_QUOTA_EXCEEDED = 'FILE_3006',
  
  // Subscription errors (4xxx)
  SUBSCRIPTION_REQUIRED = 'SUB_4000',
  PAYMENT_FAILED = 'PAYMENT_4001',
  PAYMENT_CANCELLED = 'PAYMENT_4002',
  PAYMENT_WEBHOOK_ERROR = 'PAYMENT_4003',
  PAYMENT_SUBSCRIPTION_FAILED = 'PAYMENT_4004',
  PAYMENT_PLAN_NOT_FOUND = 'PAYMENT_4005',
  
  // Network errors (5xxx)
  NETWORK_OFFLINE = 'NETWORK_5001',
  NETWORK_TIMEOUT = 'NETWORK_5002',
  NETWORK_SERVER_ERROR = 'NETWORK_5003',
  NETWORK_NOT_FOUND = 'NETWORK_5004',
  
  // Validation errors (6xxx)
  VALIDATION_REQUIRED = 'VALIDATION_6001',
  VALIDATION_INVALID_FORMAT = 'VALIDATION_6002',
  VALIDATION_TOO_SHORT = 'VALIDATION_6003',
  VALIDATION_TOO_LONG = 'VALIDATION_6004',
  
  // General errors (9xxx)
  UNKNOWN_ERROR = 'ERROR_9001',
  PERMISSION_DENIED = 'ERROR_9002',
  RATE_LIMITED = 'ERROR_9003',
  MAINTENANCE_MODE = 'ERROR_9004',
}

// ==================== ERROR MESSAGES ====================
// User-friendly messages for each error code

const ErrorMessages: Record<ErrorCode, { title: string; message: string; suggestion?: string; retryable: boolean }> = {
  // Auth errors
  [ErrorCode.AUTH_MISSING_FIELDS]: {
    title: 'Information Missing',
    message: 'Please fill in all required fields.',
    suggestion: 'Make sure you\'ve entered your email and password.',
    retryable: false,
  },
  [ErrorCode.AUTH_INVALID_EMAIL]: {
    title: 'Invalid Email',
    message: 'Please enter a valid email address.',
    suggestion: 'Email should look like: example@domain.com',
    retryable: false,
  },
  [ErrorCode.AUTH_USER_NOT_FOUND]: {
    title: 'Account Not Found',
    message: 'No account exists with this email address.',
    suggestion: 'Would you like to create a new account?',
    retryable: false,
  },
  [ErrorCode.AUTH_INVALID_PASSWORD]: {
    title: 'Incorrect Password',
    message: 'The password you entered is incorrect.',
    suggestion: 'Double-check your password or reset it if you\'ve forgotten.',
    retryable: true,
  },
  [ErrorCode.AUTH_EMAIL_EXISTS]: {
    title: 'Email Already Registered',
    message: 'An account with this email already exists.',
    suggestion: 'Try logging in instead, or use a different email.',
    retryable: false,
  },
  [ErrorCode.AUTH_PASSWORD_TOO_SHORT]: {
    title: 'Password Too Short',
    message: 'Your password must be at least 6 characters long.',
    suggestion: 'Use a longer password for better security.',
    retryable: false,
  },
  [ErrorCode.AUTH_SESSION_EXPIRED]: {
    title: 'Session Expired',
    message: 'Your login session has expired.',
    suggestion: 'Please log in again to continue.',
    retryable: true,
  },
  [ErrorCode.AUTH_LOGIN_FAILED]: {
    title: 'Login Failed',
    message: 'We couldn\'t sign you in. Please try again.',
    suggestion: 'Check your internet connection and try again.',
    retryable: true,
  },
  [ErrorCode.AUTH_SIGNUP_FAILED]: {
    title: 'Signup Failed',
    message: 'We couldn\'t create your account. Please try again.',
    suggestion: 'This might be a temporary issue. Please wait a moment and retry.',
    retryable: true,
  },
  [ErrorCode.AUTH_LOGOUT_FAILED]: {
    title: 'Logout Issue',
    message: 'There was a problem signing you out.',
    suggestion: 'Your session may have already ended. You can close this tab safely.',
    retryable: false,
  },
  [ErrorCode.AUTH_UNAUTHORIZED]: {
    title: 'Access Denied',
    message: 'You need to be logged in to do this.',
    suggestion: 'Please sign in to continue.',
    retryable: false,
  },

  // AI Errors
  [ErrorCode.AI_API_KEY_MISSING]: {
    title: 'AI Service Unavailable',
    message: 'The AI service is not properly configured.',
    suggestion: 'Please contact support about this issue.',
    retryable: false,
  },
  [ErrorCode.AI_PROVIDER_ERROR]: {
    title: 'AI Service Error',
    message: 'The AI service encountered an error.',
    suggestion: 'This is usually temporary. Please try again in a moment.',
    retryable: true,
  },
  [ErrorCode.AI_RATE_LIMITED]: {
    title: 'Too Many Requests',
    message: 'You\'ve made too many requests. Please wait a moment.',
    suggestion: 'We limit requests to ensure fair usage for everyone.',
    retryable: true,
  },
  [ErrorCode.AI_TIMEOUT]: {
    title: 'Request Timed Out',
    message: 'The AI took too long to respond.',
    suggestion: 'Your request might be complex. Try simplifying it or retry.',
    retryable: true,
  },
  [ErrorCode.AI_PLANNING_FAILED]: {
    title: 'Planning Failed',
    message: 'We couldn\'t plan your document structure.',
    suggestion: 'Try rephrasing your request or starting over.',
    retryable: true,
  },
  [ErrorCode.AI_GENERATION_FAILED]: {
    title: 'Generation Failed',
    message: 'We couldn\'t generate your content.',
    suggestion: 'This might be due to content restrictions. Try a different prompt.',
    retryable: true,
  },
  [ErrorCode.AI_VALIDATION_ERROR]: {
    title: 'Invalid Request',
    message: 'Your request couldn\'t be processed.',
    suggestion: 'Check that your input follows our guidelines.',
    retryable: false,
  },
  [ErrorCode.AI_MODEL_ERROR]: {
    title: 'AI Model Error',
    message: 'The AI model encountered an internal error.',
    suggestion: 'This is a temporary issue. Please try again.',
    retryable: true,
  },
  [ErrorCode.AI_CONTENT_FILTERED]: {
    title: 'Content Filtered',
    message: 'Your request was filtered by our safety systems.',
    suggestion: 'Please rephrase your request following our content guidelines.',
    retryable: true,
  },

  // File Errors
  [ErrorCode.FILE_NO_FILE]: {
    title: 'No File Selected',
    message: 'Please select a file to upload.',
    suggestion: 'Choose a file from your device and try again.',
    retryable: false,
  },
  [ErrorCode.FILE_TOO_LARGE]: {
    title: 'File Too Large',
    message: 'This file exceeds our size limit.',
    suggestion: 'Maximum file size is 10MB. Try compressing it first.',
    retryable: false,
  },
  [ErrorCode.FILE_INVALID_TYPE]: {
    title: 'Invalid File Type',
    message: 'This file type is not supported.',
    suggestion: 'Supported formats: PDF, DOCX, TXT, CSV, XLSX, PPTX',
    retryable: false,
  },
  [ErrorCode.FILE_UPLOAD_FAILED]: {
    title: 'Upload Failed',
    message: 'We couldn\'t upload your file.',
    suggestion: 'Check your connection and try again.',
    retryable: true,
  },
  [ErrorCode.FILE_DOWNLOAD_FAILED]: {
    title: 'Download Failed',
    message: 'We couldn\'t download this file.',
    suggestion: 'The file may have been removed. Contact support if this persists.',
    retryable: true,
  },
  [ErrorCode.FILE_QUOTA_EXCEEDED]: {
    title: 'Storage Full',
    message: 'You\'ve reached your storage limit.',
    suggestion: 'Upgrade your plan for more storage, or delete some files.',
    retryable: false,
  },

  // Subscription Errors
  [ErrorCode.SUBSCRIPTION_REQUIRED]: {
    title: 'Pro Subscription Required',
    message: 'AI generation requires an active Pro subscription.',
    suggestion: 'Upgrade to Pro to unlock unlimited AI generation and premium features.',
    retryable: false,
  },

  // Payment Errors
  [ErrorCode.PAYMENT_FAILED]: {
    title: 'Payment Failed',
    message: 'We couldn\'t process your payment.',
    suggestion: 'Check your payment details or try a different method.',
    retryable: true,
  },
  [ErrorCode.PAYMENT_CANCELLED]: {
    title: 'Payment Cancelled',
    message: 'Your payment was cancelled.',
    suggestion: 'No charges were made. You can try again whenever you\'re ready.',
    retryable: true,
  },
  [ErrorCode.PAYMENT_WEBHOOK_ERROR]: {
    title: 'Payment Processing Error',
    message: 'There was an issue confirming your payment.',
    suggestion: 'Don\'t worry - we\'ll retry automatically. Contact support if needed.',
    retryable: false,
  },
  [ErrorCode.PAYMENT_SUBSCRIPTION_FAILED]: {
    title: 'Subscription Error',
    message: 'We couldn\'t update your subscription.',
    suggestion: 'Please try again or contact support.',
    retryable: true,
  },
  [ErrorCode.PAYMENT_PLAN_NOT_FOUND]: {
    title: 'Plan Not Found',
    message: 'The selected plan doesn\'t exist.',
    suggestion: 'Please choose a valid plan from our pricing page.',
    retryable: false,
  },

  // Network Errors
  [ErrorCode.NETWORK_OFFLINE]: {
    title: 'No Internet Connection',
    message: 'You appear to be offline.',
    suggestion: 'Check your internet connection and try again.',
    retryable: true,
  },
  [ErrorCode.NETWORK_TIMEOUT]: {
    title: 'Connection Timeout',
    message: 'The server took too long to respond.',
    suggestion: 'This might be a network issue. Please check your connection.',
    retryable: true,
  },
  [ErrorCode.NETWORK_SERVER_ERROR]: {
    title: 'Server Error',
    message: 'Our servers are having trouble.',
    suggestion: 'We\'re working on it! Please try again in a few minutes.',
    retryable: true,
  },
  [ErrorCode.NETWORK_NOT_FOUND]: {
    title: 'Page Not Found',
    message: 'The requested resource doesn\'t exist.',
    suggestion: 'This link may be broken or the page was moved.',
    retryable: false,
  },

  // Validation Errors
  [ErrorCode.VALIDATION_REQUIRED]: {
    title: 'Required Field',
    message: 'This field is required.',
    suggestion: 'Please fill in this field to continue.',
    retryable: false,
  },
  [ErrorCode.VALIDATION_INVALID_FORMAT]: {
    title: 'Invalid Format',
    message: 'This value is not in the correct format.',
    suggestion: 'Please check the format and try again.',
    retryable: false,
  },
  [ErrorCode.VALIDATION_TOO_SHORT]: {
    title: 'Too Short',
    message: 'This value is too short.',
    suggestion: 'Please provide more information.',
    retryable: false,
  },
  [ErrorCode.VALIDATION_TOO_LONG]: {
    title: 'Too Long',
    message: 'This value is too long.',
    suggestion: 'Please shorten your input.',
    retryable: false,
  },

  // General Errors
  [ErrorCode.UNKNOWN_ERROR]: {
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred.',
    suggestion: 'Please try again. If this persists, contact support.',
    retryable: true,
  },
  [ErrorCode.PERMISSION_DENIED]: {
    title: 'Access Denied',
    message: 'You don\'t have permission to do this.',
    suggestion: 'Contact your administrator if you think this is a mistake.',
    retryable: false,
  },
  [ErrorCode.RATE_LIMITED]: {
    title: 'Slow Down',
    message: 'You\'re doing that too fast.',
    suggestion: 'Please wait a moment before trying again.',
    retryable: true,
  },
  [ErrorCode.MAINTENANCE_MODE]: {
    title: 'Under Maintenance',
    message: 'We\'re currently performing maintenance.',
    suggestion: 'We\'ll be back soon! Thanks for your patience.',
    retryable: true,
  },
};

// ==================== ERROR INTERFACE ====================

export interface AppError {
  code: ErrorCode;
  title: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
  originalError?: unknown;
  timestamp: number;
}

// ==================== ERROR FACTORY ====================

/**
 * Create a standardized application error
 */
export function createAppError(
  code: ErrorCode,
  originalError?: unknown,
  overrides?: Partial<Pick<AppError, 'message' | 'suggestion' | 'retryable'>>
): AppError {
  const base = ErrorMessages[code];
  
  return {
    code,
    title: base.title,
    message: overrides?.message || base.message,
    suggestion: overrides?.suggestion || base.suggestion,
    retryable: overrides?.retryable !== undefined ? overrides.retryable : base.retryable,
    originalError,
    timestamp: Date.now(),
  };
}

/**
 * Parse any error into a user-friendly AppError
 */
export function parseError(error: unknown): AppError {
  // If it's already an AppError, return it
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return error as AppError;
  }

  // Extract error message
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Map common error patterns to error codes
  if (errorMessage.includes('API key') || errorMessage.includes('not configured')) {
    return createAppError(ErrorCode.AI_API_KEY_MISSING, error);
  }
  
  if (errorMessage.includes('rate limit') || errorMessage.includes('too many')) {
    return createAppError(ErrorCode.AI_RATE_LIMITED, error);
  }
  
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return createAppError(ErrorCode.AI_TIMEOUT, error);
  }
  
  if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
    return createAppError(ErrorCode.NETWORK_OFFLINE, error);
  }
  
  if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
    return createAppError(ErrorCode.AUTH_UNAUTHORIZED, error);
  }
  
  if (errorMessage.includes('404') || errorMessage.includes('not found')) {
    return createAppError(ErrorCode.NETWORK_NOT_FOUND, error);
  }
  
  if (errorMessage.includes('500') || errorMessage.includes('server error')) {
    return createAppError(ErrorCode.NETWORK_SERVER_ERROR, error);
  }
  
  if (errorMessage.includes('password') || errorMessage.includes('credentials')) {
    return createAppError(ErrorCode.AUTH_INVALID_PASSWORD, error);
  }
  
  if (errorMessage.includes('email') && errorMessage.includes('exists')) {
    return createAppError(ErrorCode.AUTH_EMAIL_EXISTS, error);
  }
  
  if (errorMessage.includes('email') && errorMessage.includes('found')) {
    return createAppError(ErrorCode.AUTH_USER_NOT_FOUND, error);
  }
  
  if (errorMessage.includes('file') && errorMessage.includes('upload')) {
    return createAppError(ErrorCode.FILE_UPLOAD_FAILED, error);
  }
  
  if (errorMessage.includes('payment') || errorMessage.includes('billing')) {
    return createAppError(ErrorCode.PAYMENT_FAILED, error);
  }

  // Default to unknown error
  return createAppError(
    ErrorCode.UNKNOWN_ERROR,
    error,
    { message: errorMessage }
  );
}

// ==================== ERROR DISPLAY HELPERS ====================

/**
 * Get user-friendly display text for an error
 */
export function getErrorDisplay(error: AppError | ErrorCode | unknown): {
  title: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
} {
  let appError: AppError;
  
  if (typeof error === 'string' && Object.values(ErrorCode).includes(error as ErrorCode)) {
    appError = createAppError(error as ErrorCode);
  } else if (error instanceof Error || typeof error === 'object') {
    appError = parseError(error);
  } else {
    appError = createAppError(ErrorCode.UNKNOWN_ERROR, error);
  }
  
  return {
    title: appError.title,
    message: appError.message,
    suggestion: appError.suggestion,
    retryable: appError.retryable,
  };
}

/**
 * Check if error is retryable
 */
export function isRetryable(error: unknown): boolean {
  const display = getErrorDisplay(error);
  return display.retryable;
}

// ==================== TOAST NOTIFICATION HELPERS ====================

export interface ToastOptions {
  variant?: 'default' | 'destructive' | 'success' | 'warning';
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Format error for toast notification
 */
export function formatErrorForToast(
  error: AppError | ErrorCode | unknown,
  options?: ToastOptions
): {
  title: string;
  description: string;
  variant: 'default' | 'destructive' | 'success' | 'warning';
  action?: ToastOptions['action'];
} {
  const display = getErrorDisplay(error);
  
  let description = display.message;
  if (display.suggestion) {
    description += ` ${display.suggestion}`;
  }
  
  return {
    title: display.title,
    description,
    variant: options?.variant || 'destructive',
    action: options?.action,
  };
}
