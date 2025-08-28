import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'

import { infrastructureRoutes } from './controllers/infrastructureController'
import { mcpRoutes } from './mcp/routes'

const PORT = parseInt(process.env.PORT || '3003')
const HOST = process.env.HOST || '0.0.0.0'

async function buildServer() {
  const fastify = Fastify({
    logger: process.env.NODE_ENV === 'development' 
      ? {
          level: process.env.LOG_LEVEL || 'info',
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true
            }
          }
        }
      : { level: process.env.LOG_LEVEL || 'info' }
  })

  // Security plugins
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      }
    }
  })

  await fastify.register(cors, {
    origin: process.env.NODE_ENV === 'development' 
      ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002']
      : [process.env.FRONTEND_URL || 'https://app.controlvector.io'],
    credentials: true
  })

  // Root endpoint
  fastify.get('/', async () => ({
    service: 'Atlas Infrastructure Agent',
    version: '1.0.0',
    status: 'operational',
    description: 'ControlVector infrastructure deployment and management service',
    timestamp: new Date().toISOString(),
    capabilities: [
      'Infrastructure provisioning',
      'Multi-cloud provider support',
      'Cost estimation and tracking',
      'Resource lifecycle management',
      'Deployment orchestration'
    ],
    providers: ['DigitalOcean'], // Add more as implemented
    endpoints: {
      infrastructure: '/api/v1/infrastructure',
      operations: '/api/v1/operations',
      providers: '/api/v1/providers',
      health: '/api/v1/health',
      mcp_tools: '/api/v1/mcp/tools',
      mcp_call: '/api/v1/mcp/call',
      mcp_health: '/api/v1/mcp/health',
      docs: '/docs'
    }
  }))

  // Health endpoint
  fastify.get('/health', async () => ({
    success: true,
    service: 'atlas',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  }))

  // API routes
  await fastify.register(infrastructureRoutes, { prefix: '/api/v1' })
  
  // MCP routes for tool primitives
  await fastify.register(mcpRoutes, { prefix: '/api/v1' })

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error)

    // Handle specific error types
    if (error.name === 'ValidationError') {
      reply.code(400).send({
        error: 'Validation Error',
        message: 'Request validation failed',
        details: error.message
      })
      return
    }

    if (error.name === 'AtlasError') {
      reply.code((error as any).statusCode || 500).send({
        error: error.name,
        message: error.message,
        code: (error as any).code
      })
      return
    }

    // Default error response
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    })
  })

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    fastify.log.info(`Received ${signal}, starting graceful shutdown...`)
    
    try {
      await fastify.close()
      fastify.log.info('Atlas server closed successfully')
      process.exit(0)
    } catch (error) {
      fastify.log.error(error as Error, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  return fastify
}

async function start() {
  try {
    const fastify = await buildServer()
    
    await fastify.listen({ 
      port: PORT, 
      host: HOST 
    })
    
    fastify.log.info(`🚀 Atlas Infrastructure Agent running on http://${HOST}:${PORT}`)
    fastify.log.info('🏗️  Ready to provision cloud infrastructure!')
    
    // Log environment info
    fastify.log.info('Environment configuration:')
    fastify.log.info(`- Node.js version: ${process.version}`)
    fastify.log.info(`- Environment: ${process.env.NODE_ENV || 'development'}`)
    fastify.log.info(`- Log level: ${process.env.LOG_LEVEL || 'info'}`)
    
    // Log provider status
    const doToken = process.env.DIGITALOCEAN_API_TOKEN
    fastify.log.info(`- DigitalOcean: ${doToken ? 'configured' : 'not configured'}`)
    
    if (!doToken) {
      fastify.log.warn('⚠️  No DigitalOcean API token configured. Set DIGITALOCEAN_API_TOKEN environment variable for full functionality.')
      fastify.log.info('💡 Atlas will still work for cost estimation and testing without real provider credentials.')
    }

  } catch (err) {
    console.error('❌ Error starting Atlas server:', err)
    process.exit(1)
  }
}

// Start server if this file is run directly
if (require.main === module) {
  start()
}

export { buildServer }
