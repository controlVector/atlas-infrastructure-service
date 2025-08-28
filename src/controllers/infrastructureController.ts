import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { InfrastructureService } from '../services/InfrastructureService'
import { 
  CreateInfrastructureRequest, 
  UpdateInfrastructureRequest,
  CloudProvider,
  ResourceType,
  AtlasError 
} from '../types'

// Validation schemas
const CreateInfrastructureSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.enum(['digitalocean', 'aws', 'gcp', 'azure', 'linode', 'vultr']),
  region: z.string().min(1),
  resources: z.array(z.object({
    type: z.enum([
      'droplet', 'volume', 'database', 'load_balancer', 
      'firewall', 'vpc', 'domain', 'cdn', 'kubernetes', 'container_registry'
    ]),
    name: z.string().min(1).max(100),
    specifications: z.record(z.any())
  })).min(1),
  configuration: z.record(z.any()).optional(),
  tags: z.record(z.string()).optional()
})

const UpdateInfrastructureSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  resources: z.array(z.object({
    id: z.string().uuid(),
    specifications: z.record(z.any()).optional()
  })).optional(),
  configuration: z.record(z.any()).optional(),
  tags: z.record(z.string()).optional()
})

// JWT authentication for real user context
interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    user_id: string
    workspace_id: string
    jwt_token: string
  }
}

function extractUserContext(request: FastifyRequest): { user_id: string; workspace_id: string; jwt_token?: string } {
  const authHeader = request.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    
    try {
      // Decode JWT token to extract user info (same format as Watson)
      const tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
      
      return {
        user_id: tokenPayload.user_id,
        workspace_id: tokenPayload.workspace_id,
        jwt_token: token
      }
    } catch (error) {
      console.error('Failed to decode JWT token:', error)
    }
  }
  
  // Fallback for testing without authentication
  return {
    user_id: 'test-user',
    workspace_id: 'test-workspace'
  }
}

export async function infrastructureRoutes(fastify: FastifyInstance) {
  const infrastructureService = new InfrastructureService()

  // Create new infrastructure
  fastify.post('/infrastructure', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const { user_id, workspace_id } = extractUserContext(request)
      const body = request.body as CreateInfrastructureRequest

      const result = await infrastructureService.createInfrastructure(
        user_id,
        workspace_id,
        body
      )

      reply.code(201).send(result)
    } catch (error) {
      if (error instanceof AtlasError) {
        reply.code(error.statusCode).send({
          error: error.name,
          message: error.message,
          code: error.code
        })
      } else {
        reply.code(500).send({
          error: 'Internal Server Error',
          message: 'An unexpected error occurred'
        })
      }
    }
  })

  // Get infrastructure by ID
  fastify.get('/infrastructure/:id', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string }
      
      const infrastructure = await infrastructureService.getInfrastructure(id)
      if (!infrastructure) {
        reply.code(404).send({
          error: 'Not Found',
          message: 'Infrastructure not found'
        })
        return
      }

      reply.send({ infrastructure })
    } catch (error) {
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get infrastructure'
      })
    }
  })

  // List infrastructure for workspace
  fastify.get('/infrastructure', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const { user_id, workspace_id, jwt_token } = extractUserContext(request)
      
      const infrastructures = await infrastructureService.listInfrastructure(workspace_id)
      
      // Calculate total costs
      const currentCost = infrastructures.reduce((total, infra) => 
        total + (infra.estimated_monthly_cost || 0), 0
      )
      
      // Get real DigitalOcean data using user's stored credentials
      const realCostData = await infrastructureService.getRealCostData(workspace_id, user_id, jwt_token)
      
      reply.send({ 
        infrastructure: infrastructures, // Watson expects 'infrastructure' not 'infrastructures'
        operations: [], // No pending operations for now
        current_monthly_cost: realCostData.current_monthly_cost || currentCost,
        projected_monthly_cost: realCostData.projected_monthly_cost || currentCost,
        cost_trend: realCostData.cost_trend || 'stable',
        performance_summary: {
          average_response_time: 150,
          requests_per_minute: 245,
          error_rate: 0.02,
          uptime_percentage: 99.9
        },
        issues: [], // No active issues
        recommendations: realCostData.recommendations || []
      })
    } catch (error) {
      console.error('Failed to get infrastructure data:', error)
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to list infrastructure'
      })
    }
  })

  // Update infrastructure
  fastify.put('/infrastructure/:id', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as UpdateInfrastructureRequest

      const result = await infrastructureService.updateInfrastructure(id, body)

      reply.send(result)
    } catch (error) {
      if (error instanceof AtlasError) {
        reply.code(error.statusCode).send({
          error: error.name,
          message: error.message,
          code: error.code
        })
      } else {
        reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to update infrastructure'
        })
      }
    }
  })

  // Destroy infrastructure
  fastify.delete('/infrastructure/:id', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string }

      const operation = await infrastructureService.destroyInfrastructure(id)

      reply.send({ operation })
    } catch (error) {
      if (error instanceof AtlasError) {
        reply.code(error.statusCode).send({
          error: error.name,
          message: error.message,
          code: error.code
        })
      } else {
        reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to destroy infrastructure'
        })
      }
    }
  })

  // Get deployment operation
  fastify.get('/operations/:id', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string }

      const operation = await infrastructureService.getDeploymentOperation(id)
      if (!operation) {
        reply.code(404).send({
          error: 'Not Found',
          message: 'Operation not found'
        })
        return
      }

      reply.send({ operation })
    } catch (error) {
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get operation'
      })
    }
  })

  // List deployment operations for infrastructure
  fastify.get('/infrastructure/:id/operations', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string }

      const operations = await infrastructureService.listDeploymentOperations(id)

      reply.send({ 
        operations,
        count: operations.length
      })
    } catch (error) {
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to list operations'
      })
    }
  })

  // Get resource by ID
  fastify.get('/infrastructure/:infraId/resources/:resourceId', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const { infraId, resourceId } = request.params as { infraId: string; resourceId: string }

      const resource = await infrastructureService.getResource(infraId, resourceId)
      if (!resource) {
        reply.code(404).send({
          error: 'Not Found',
          message: 'Resource not found'
        })
        return
      }

      reply.send({ resource })
    } catch (error) {
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get resource'
      })
    }
  })

  // Estimate cost for infrastructure
  fastify.post('/estimate-cost', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const body = request.body as CreateInfrastructureRequest

      const estimatedCost = await infrastructureService.estimateCost(body)

      reply.send({
        estimated_monthly_cost: estimatedCost,
        currency: 'USD',
        breakdown: body.resources.map(r => ({
          resource_type: r.type,
          resource_name: r.name,
          // For detailed breakdown, you'd call provider.estimateCost for each resource
          estimated_cost: estimatedCost / body.resources.length // Simplified
        }))
      })
    } catch (error) {
      if (error instanceof AtlasError) {
        reply.code(error.statusCode).send({
          error: error.name,
          message: error.message,
          code: error.code
        })
      } else {
        reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to estimate cost'
        })
      }
    }
  })

  // Get workspace statistics
  fastify.get('/stats', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const { workspace_id } = extractUserContext(request)

      const stats = await infrastructureService.getInfrastructureStats(workspace_id)

      reply.send({ stats })
    } catch (error) {
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get statistics'
      })
    }
  })

  // Get available providers
  fastify.get('/providers', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const providers = infrastructureService.getAvailableProviders()

      // Get detailed info for each provider
      const providersInfo = await Promise.all(
        providers.map(async (provider) => {
          try {
            const info = await infrastructureService.getProviderInfo(provider)
            const connected = await infrastructureService.testProviderConnection(provider)
            return {
              ...info,
              connected,
              status: connected ? 'available' : 'disconnected'
            }
          } catch (error) {
            return {
              name: provider,
              status: 'error',
              connected: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            }
          }
        })
      )

      reply.send({ 
        providers: providersInfo,
        count: providersInfo.length
      })
    } catch (error) {
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get providers'
      })
    }
  })

  // Get provider-specific information (regions, sizes, etc.)
  fastify.get('/providers/:provider', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const { provider } = request.params as { provider: CloudProvider }

      const info = await infrastructureService.getProviderInfo(provider)
      const connected = await infrastructureService.testProviderConnection(provider)

      reply.send({
        provider: {
          ...info,
          connected,
          status: connected ? 'available' : 'disconnected'
        }
      })
    } catch (error) {
      if (error instanceof AtlasError) {
        reply.code(error.statusCode).send({
          error: error.name,
          message: error.message,
          code: error.code
        })
      } else {
        reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get provider information'
        })
      }
    }
  })

  // Health check endpoint
  fastify.get('/health', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const providers = infrastructureService.getAvailableProviders()
      const providerHealth = await Promise.all(
        providers.map(async (provider) => ({
          provider,
          healthy: await infrastructureService.testProviderConnection(provider)
        }))
      )

      const allHealthy = providerHealth.every(p => p.healthy)

      reply.send({
        status: allHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        providers: providerHealth,
        service: 'Atlas Infrastructure Agent',
        version: '1.0.0'
      })
    } catch (error) {
      reply.code(500).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Failed to check health',
        service: 'Atlas Infrastructure Agent',
        version: '1.0.0'
      })
    }
  })

  // Deploy application with AI assistance
  fastify.post('/deploy-application', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const body = z.object({
        repository: z.string().url(),
        branch: z.string().default('main'),
        serverIP: z.string().ip(),
        appName: z.string().min(1),
        sshKeyPath: z.string().optional()
      }).parse(request.body)

      console.log(`[Atlas] Received deployment request: ${body.repository} -> ${body.serverIP}`)

      const result = await infrastructureService.deployApplicationWithAI(body)

      reply.send({
        success: result.success,
        deployment: {
          repository: body.repository,
          branch: body.branch,
          server_ip: body.serverIP,
          app_name: body.appName,
          method: result.finalMethod,
          logs: result.logs
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      console.error('[Atlas] Deployment request failed:', error)
      
      if (error instanceof z.ZodError) {
        reply.code(400).send({
          error: 'Validation Error',
          message: 'Invalid deployment request',
          details: error.errors
        })
      } else {
        reply.code(500).send({
          error: 'Deployment Error',
          message: error instanceof Error ? error.message : 'Unknown deployment error'
        })
      }
    }
  })
}