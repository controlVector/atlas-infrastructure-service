import { EventEmitter } from 'events'
import axios from 'axios'
import { createLogger, ErrorDetail } from '../utils/Logger'

interface ErrorStreamEvent {
  timestamp: string
  service: string
  operation: string
  level: 'warn' | 'error' | 'fatal'
  message: string
  error?: ErrorDetail
  context: {
    workspace_id?: string
    user_id?: string
    request_id?: string
    session_id?: string
  }
  suggestions?: string[]
  recovery_actions?: string[]
}

interface WatsonNotification {
  type: 'error' | 'warning' | 'recovery_needed'
  service: 'atlas'
  error: ErrorStreamEvent
  recovery_suggestions: string[]
  user_visible: boolean
}

export class ErrorStreamingService extends EventEmitter {
  private logger = createLogger('atlas-error-streaming')
  private watsonUrl: string
  private streamBuffer: ErrorStreamEvent[] = []
  private maxBufferSize = 100
  private retryAttempts = 3
  private retryDelay = 1000

  constructor(watsonUrl?: string) {
    super()
    this.watsonUrl = watsonUrl || process.env.WATSON_URL || 'http://localhost:3004'
  }

  async streamError(event: Omit<ErrorStreamEvent, 'timestamp'>): Promise<void> {
    const errorEvent: ErrorStreamEvent = {
      ...event,
      timestamp: new Date().toISOString()
    }

    this.addToBuffer(errorEvent)
    this.emit('error-streamed', errorEvent)

    try {
      await this.sendToWatson(errorEvent)
    } catch (error) {
      this.logger.warn('Failed to stream error to Watson', error as any, {
        operation: 'stream-error',
        userId: event.context.user_id,
        workspaceId: event.context.workspace_id
      })
    }
  }

  async streamInfrastructureError(
    operation: string,
    error: any,
    context: ErrorStreamEvent['context'],
    userMessage?: string
  ): Promise<void> {
    const errorDetail = this.parseInfrastructureError(error, userMessage)
    
    const errorEvent: Omit<ErrorStreamEvent, 'timestamp'> = {
      service: 'atlas',
      operation,
      level: 'error',
      message: errorDetail.message,
      error: errorDetail,
      context,
      suggestions: errorDetail.suggestions,
      recovery_actions: this.generateRecoveryActions(errorDetail.code)
    }

    await this.streamError(errorEvent)
  }

  private async sendToWatson(errorEvent: ErrorStreamEvent): Promise<void> {
    const notification: WatsonNotification = {
      type: this.getNotificationType(errorEvent.level),
      service: 'atlas',
      error: errorEvent,
      recovery_suggestions: errorEvent.recovery_actions || [],
      user_visible: this.isUserVisibleError(errorEvent)
    }

    let attempts = 0
    while (attempts < this.retryAttempts) {
      try {
        await axios.post(`${this.watsonUrl}/api/v1/notifications/error`, notification, {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
            'X-Service': 'atlas',
            'X-Error-Level': errorEvent.level
          }
        })
        
        this.logger.debug('Error streamed to Watson successfully', {
          operation: 'watson-notification',
          error_level: errorEvent.level,
          user_id: errorEvent.context.user_id
        })
        return

      } catch (error) {
        attempts++
        if (attempts === this.retryAttempts) {
          this.logger.error('Failed to notify Watson after all retries', error as any, {
            operation: 'watson-notification-failed',
            userId: errorEvent.context.user_id
          })
          throw error
        }
        
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempts))
      }
    }
  }

  private parseInfrastructureError(error: any, customUserMessage?: string): ErrorDetail {
    let code = 'INFRASTRUCTURE_ERROR'
    let message = 'Infrastructure operation failed'
    let userMessage = customUserMessage || 'There was an issue with your infrastructure operation.'
    let suggestions: string[] = []

    if (error?.response?.status) {
      const status = error.response.status
      code = `HTTP_${status}`
      message = error.message || `HTTP ${status} error`
      
      switch (status) {
        case 400:
          userMessage = 'Invalid request parameters for infrastructure operation.'
          suggestions = [
            'Check that resource specifications are valid',
            'Verify region supports requested resource types',
            'Ensure all required fields are provided'
          ]
          break
        case 401:
          userMessage = 'Authentication failed with cloud provider.'
          suggestions = [
            'Verify your cloud provider API credentials',
            'Check if credentials have expired',
            'Confirm account has necessary permissions'
          ]
          break
        case 403:
          userMessage = 'Access denied for infrastructure operation.'
          suggestions = [
            'Verify account permissions for this resource type',
            'Check if account has billing configured',
            'Contact your cloud provider administrator'
          ]
          break
        case 429:
          userMessage = 'Rate limit exceeded with cloud provider.'
          suggestions = [
            'Wait a few minutes before retrying',
            'Consider upgrading your cloud provider plan',
            'Implement request throttling'
          ]
          break
        case 500:
        case 502:
        case 503:
          userMessage = 'Cloud provider service is temporarily unavailable.'
          suggestions = [
            'Try again in a few minutes',
            'Check cloud provider status page',
            'Switch to a different region if available'
          ]
          break
      }
    } else if (error?.code) {
      code = error.code
      switch (error.code) {
        case 'ECONNREFUSED':
          userMessage = 'Unable to connect to cloud provider.'
          suggestions = [
            'Check your internet connection',
            'Verify cloud provider service status',
            'Try again in a few minutes'
          ]
          break
        case 'ETIMEDOUT':
          userMessage = 'Request to cloud provider timed out.'
          suggestions = [
            'Check your network connection',
            'Try again with a smaller request',
            'Contact support if timeouts persist'
          ]
          break
      }
    }

    return {
      code,
      message,
      userMessage: customUserMessage || userMessage,
      suggestions,
      metadata: {
        httpStatus: error?.response?.status,
        responseData: error?.response?.data
      },
      stack: error?.stack,
      cause: error?.cause
    }
  }

  private generateRecoveryActions(errorCode: string): string[] {
    const recoveryMap: Record<string, string[]> = {
      'HTTP_400': [
        'Review and correct request parameters',
        'Validate resource specifications against provider limits',
        'Check API documentation for required fields'
      ],
      'HTTP_401': [
        'Update cloud provider credentials',
        'Regenerate API tokens if expired',
        'Verify account permissions'
      ],
      'HTTP_403': [
        'Check account billing status',
        'Verify resource quotas and limits',
        'Contact provider support for access issues'
      ],
      'HTTP_429': [
        'Wait 5-10 minutes before retrying',
        'Reduce concurrent request volume',
        'Consider upgrading provider plan'
      ],
      'HTTP_500': [
        'Wait 2-5 minutes and retry',
        'Check provider status page',
        'Try alternative region if available'
      ],
      'ECONNREFUSED': [
        'Verify network connectivity',
        'Check provider service status',
        'Restart network connection'
      ],
      'ETIMEDOUT': [
        'Increase request timeout',
        'Check network stability',
        'Try smaller batch operations'
      ]
    }

    return recoveryMap[errorCode] || [
      'Review error details and try again',
      'Contact support if issue persists',
      'Check service documentation'
    ]
  }

  private getNotificationType(level: string): WatsonNotification['type'] {
    switch (level) {
      case 'warn': return 'warning'
      case 'error': 
      case 'fatal': return 'error'
      default: return 'error'
    }
  }

  private isUserVisibleError(event: ErrorStreamEvent): boolean {
    const userVisibleOperations = [
      'provision_infrastructure',
      'create_droplet',
      'destroy_infrastructure',
      'scale_infrastructure',
      'infrastructure_overview'
    ]
    
    return userVisibleOperations.includes(event.operation) || 
           event.level === 'error' || 
           event.level === 'fatal'
  }

  private addToBuffer(event: ErrorStreamEvent): void {
    this.streamBuffer.push(event)
    
    if (this.streamBuffer.length > this.maxBufferSize) {
      this.streamBuffer.shift()
    }
  }

  getRecentErrors(limit = 10): ErrorStreamEvent[] {
    return this.streamBuffer.slice(-limit)
  }

  getErrorsByContext(context: Partial<ErrorStreamEvent['context']>): ErrorStreamEvent[] {
    return this.streamBuffer.filter(event => {
      return Object.entries(context).every(([key, value]) => 
        event.context[key as keyof typeof event.context] === value
      )
    })
  }

  clearBuffer(): void {
    this.streamBuffer = []
  }
}

export const errorStreamingService = new ErrorStreamingService()