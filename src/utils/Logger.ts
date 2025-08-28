/**
 * Comprehensive Logging Infrastructure for ControlVector Microservices
 * Provides structured, contextual logging with user-friendly error translation
 */

export interface LogContext {
  service: string
  operation: string
  userId?: string
  workspaceId?: string
  conversationId?: string
  requestId?: string
  sessionId?: string
  correlationId?: string
}

export interface ErrorDetail {
  code: string
  message: string
  userMessage: string
  suggestions?: string[]
  metadata?: Record<string, any>
  stack?: string
  cause?: any
}

export interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  service: string
  operation: string
  message: string
  context: LogContext
  error?: ErrorDetail
  data?: Record<string, any>
  duration?: number
}

export class Logger {
  private service: string
  private defaultContext: Partial<LogContext>

  constructor(service: string, defaultContext?: Partial<LogContext>) {
    this.service = service
    this.defaultContext = defaultContext || {}
  }

  /**
   * Create a contextual logger for an operation
   */
  operation(operation: string, context: Partial<LogContext> = {}): OperationLogger {
    return new OperationLogger(this.service, operation, {
      service: this.service,
      operation,
      ...this.defaultContext,
      ...context
    } as LogContext)
  }

  /**
   * Log debug information
   */
  debug(message: string, data?: Record<string, any>, context: Partial<LogContext> = {}) {
    this.log('debug', message, data, context)
  }

  /**
   * Log informational messages
   */
  info(message: string, data?: Record<string, any>, context: Partial<LogContext> = {}) {
    this.log('info', message, data, context)
  }

  /**
   * Log warnings
   */
  warn(message: string, data?: Record<string, any>, context: Partial<LogContext> = {}) {
    this.log('warn', message, data, context)
  }

  /**
   * Log errors with comprehensive details
   */
  error(message: string, error?: any, context: Partial<LogContext> = {}, userMessage?: string) {
    const errorDetail = error ? this.parseError(error, userMessage) : undefined
    this.log('error', message, undefined, context, errorDetail)
  }

  /**
   * Log fatal errors
   */
  fatal(message: string, error?: any, context: Partial<LogContext> = {}) {
    const errorDetail = error ? this.parseError(error) : undefined
    this.log('fatal', message, undefined, context, errorDetail)
  }

  private log(
    level: LogEntry['level'],
    message: string,
    data?: Record<string, any>,
    context: Partial<LogContext> = {},
    error?: ErrorDetail
  ) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      operation: context.operation || 'unknown',
      message,
      context: {
        service: this.service,
        operation: context.operation || 'unknown',
        ...this.defaultContext,
        ...context
      } as LogContext,
      ...(data && { data }),
      ...(error && { error })
    }

    // Console output with colors
    this.outputToConsole(entry)

    // TODO: Send to centralized logging system
    // this.sendToCentralizedLogger(entry)
  }

  private outputToConsole(entry: LogEntry) {
    const colors = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m',  // green
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
      fatal: '\x1b[35m'  // magenta
    }
    const reset = '\x1b[0m'

    const prefix = `${colors[entry.level]}[${entry.level.toUpperCase()}]${reset}`
    const service = `${entry.service}:${entry.operation}`
    const context = entry.context.userId ? ` (user:${entry.context.userId})` : ''
    
    console.log(`${prefix} ${service}${context} - ${entry.message}`)

    if (entry.data) {
      console.log(`  Data:`, JSON.stringify(entry.data, this.sanitizer, 2))
    }

    if (entry.error) {
      console.log(`  Error Code: ${entry.error.code}`)
      console.log(`  Technical: ${entry.error.message}`)
      console.log(`  User Message: ${entry.error.userMessage}`)
      
      if (entry.error.suggestions) {
        console.log(`  Suggestions:`)
        entry.error.suggestions.forEach((suggestion, i) => {
          console.log(`    ${i + 1}. ${suggestion}`)
        })
      }

      if (entry.error.metadata) {
        console.log(`  Metadata:`, JSON.stringify(entry.error.metadata, this.sanitizer, 2))
      }
    }

    console.log() // Empty line for readability
  }

  private parseError(error: any, customUserMessage?: string): ErrorDetail {
    let code = 'UNKNOWN_ERROR'
    let message = 'An unknown error occurred'
    let userMessage = customUserMessage || 'Something went wrong. Please try again.'
    let suggestions: string[] = []
    let metadata: Record<string, any> = {}

    if (error?.response?.status) {
      // HTTP error
      const status = error.response.status
      code = `HTTP_${status}`
      message = error.message || `HTTP ${status} error`
      
      if (error.response.data) {
        metadata.responseData = error.response.data
        
        // Parse specific provider errors
        if (error.response.data.message) {
          message = error.response.data.message
        }
      }

      // User-friendly messages for common HTTP errors
      switch (status) {
        case 400:
          userMessage = 'Invalid request. Please check your input parameters.'
          suggestions = [
            'Verify all required fields are provided',
            'Check that values are in the correct format',
            'Ensure resource names follow naming conventions'
          ]
          break
        case 401:
          userMessage = 'Authentication failed. Please check your API credentials.'
          suggestions = [
            'Verify your API keys are correctly configured',
            'Check that your account has the necessary permissions',
            'Try refreshing your authentication tokens'
          ]
          break
        case 403:
          userMessage = 'Access denied. You don\'t have permission for this operation.'
          suggestions = [
            'Contact your administrator for access',
            'Verify your account has the required permissions',
            'Check if your plan supports this feature'
          ]
          break
        case 404:
          userMessage = 'Resource not found. The requested item doesn\'t exist.'
          suggestions = [
            'Check that the resource name is correct',
            'Verify the resource hasn\'t been deleted',
            'Ensure you\'re looking in the correct region/account'
          ]
          break
        case 422:
          userMessage = 'Validation failed. Please check your input data.'
          suggestions = [
            'Review the validation errors in the response',
            'Check that all required fields are provided',
            'Ensure data formats match the expected schema'
          ]
          break
        case 429:
          userMessage = 'Rate limit exceeded. Please slow down your requests.'
          suggestions = [
            'Wait a few minutes before trying again',
            'Implement exponential backoff in your requests',
            'Consider upgrading your plan for higher limits'
          ]
          break
        case 500:
          userMessage = 'Server error occurred. This is likely a temporary issue.'
          suggestions = [
            'Try again in a few minutes',
            'Check the service status page',
            'Contact support if the issue persists'
          ]
          break
      }
    } else if (error?.code) {
      // System error (network, etc.)
      code = error.code
      message = error.message || 'System error occurred'
      
      switch (error.code) {
        case 'ECONNREFUSED':
          userMessage = 'Unable to connect to the service. Please check your network connection.'
          suggestions = [
            'Verify your internet connection',
            'Check if the service is running',
            'Try again in a few minutes'
          ]
          break
        case 'ETIMEDOUT':
          userMessage = 'Request timed out. The service may be overloaded.'
          suggestions = [
            'Try again with a smaller request',
            'Check your network connection',
            'Contact support if timeouts persist'
          ]
          break
        case 'ENOTFOUND':
          userMessage = 'Service not found. There may be a configuration issue.'
          suggestions = [
            'Check the service URL configuration',
            'Verify DNS resolution',
            'Contact your system administrator'
          ]
          break
      }
    }

    return {
      code,
      message,
      userMessage: customUserMessage || userMessage,
      suggestions,
      metadata,
      stack: error?.stack,
      cause: error?.cause
    }
  }

  private sanitizer(key: string, value: any): any {
    // Sanitize sensitive data
    const sensitiveKeys = [
      'password', 'token', 'key', 'secret', 'auth', 'credential',
      'api_key', 'apikey', 'authorization', 'bearer'
    ]
    
    if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
      if (typeof value === 'string' && value.length > 8) {
        return value.substring(0, 4) + '****' + value.substring(value.length - 4)
      }
      return '****'
    }
    
    return value
  }
}

export class OperationLogger {
  private service: string
  private operation: string
  private context: LogContext
  private startTime: number
  private logger: Logger

  constructor(service: string, operation: string, context: LogContext) {
    this.service = service
    this.operation = operation
    this.context = context
    this.startTime = Date.now()
    this.logger = new Logger(service, context)
    
    this.info('Operation started')
  }

  /**
   * Log debug information for this operation
   */
  debug(message: string, data?: Record<string, any>) {
    this.logger.debug(message, data, this.context)
  }

  /**
   * Log informational messages for this operation
   */
  info(message: string, data?: Record<string, any>) {
    this.logger.info(message, data, this.context)
  }

  /**
   * Log warnings for this operation
   */
  warn(message: string, data?: Record<string, any>) {
    this.logger.warn(message, data, this.context)
  }

  /**
   * Log errors for this operation
   */
  error(message: string, error?: any, userMessage?: string) {
    this.logger.error(message, error, this.context, userMessage)
  }

  /**
   * Log successful completion of the operation
   */
  success(message: string, data?: Record<string, any>) {
    const duration = Date.now() - this.startTime
    this.logger.info(`${message} (completed in ${duration}ms)`, data, this.context)
  }

  /**
   * Log failed completion of the operation
   */
  failure(message: string, error?: any, userMessage?: string) {
    const duration = Date.now() - this.startTime
    this.logger.error(`${message} (failed after ${duration}ms)`, error, this.context, userMessage)
  }

  /**
   * Create a child operation logger
   */
  child(operation: string, additionalContext?: Partial<LogContext>): OperationLogger {
    return new OperationLogger(
      this.service,
      `${this.operation}:${operation}`,
      { ...this.context, ...additionalContext }
    )
  }
}

// Service-specific logger factories
export const createLogger = (service: string, defaultContext?: Partial<LogContext>) => {
  return new Logger(service, defaultContext)
}

// Common error types for consistent handling
export const ErrorCodes = {
  // Authentication & Authorization
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Validation
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  
  // Resources
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_IN_USE: 'RESOURCE_IN_USE',
  
  // External Services
  PROVIDER_API_ERROR: 'PROVIDER_API_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Infrastructure
  DEPLOYMENT_FAILED: 'DEPLOYMENT_FAILED',
  PROVISIONING_FAILED: 'PROVISIONING_FAILED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR'
}

export default Logger