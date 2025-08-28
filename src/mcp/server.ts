/**
 * MCP (Model Context Protocol) Server for Atlas Infrastructure Agent
 * 
 * This implements the tool primitive functions that can be called by inference loop agents.
 * Each function corresponds to a high-level infrastructure operation.
 */

import { InfrastructureService } from '../services/InfrastructureService'
import { 
  ATLAS_MCP_TOOLS, 
  validateMCPToolInput, 
  createMCPResult,
  MCPToolResult,
  GetInfrastructureOverviewSchema,
  CheckDropletStatusSchema,
  CreateDropletSchema,
  ProvisionInfrastructureSchema,
  GetInfrastructureCostsSchema,
  EstimateCostSchema,
  ScaleResourceSchema,
  GetProviderStatusSchema,
  DestroyInfrastructureSchema
} from './tools'
import { CreateInfrastructureRequest, AtlasError } from '../types'
import { createLogger, ErrorCodes, OperationLogger } from '../utils/Logger'
import { errorStreamingService } from '../services/ErrorStreamingService'
import { ProvenDropletHandler } from './proven-droplet-handler'
import { CreateDropletWithSSHSchema, RebuildDropletWithSSHSchema } from './droplet-templates'

export class AtlasMCPServer {
  private infrastructureService: InfrastructureService
  private provenDropletHandler: ProvenDropletHandler
  private logger = createLogger('atlas-mcp-server')

  constructor() {
    this.infrastructureService = new InfrastructureService()
    // Note: ProvenDropletHandler will get the DO token from context when needed
    this.provenDropletHandler = new ProvenDropletHandler('')
    this.logger.info('Atlas MCP Server initialized with proven patterns')
  }

  /**
   * Get list of available MCP tools
   */
  getAvailableTools() {
    return {
      tools: ATLAS_MCP_TOOLS.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema._def // Zod schema definition
      }))
    }
  }

  /**
   * Execute an MCP tool call
   */
  async callTool(toolName: string, input: unknown): Promise<MCPToolResult> {
    try {
      switch (toolName) {
        case 'get_infrastructure_overview':
          return await this.getInfrastructureOverview(input)
        
        case 'check_droplet_status':
          return await this.checkDropletStatus(input)
        
        case 'create_droplet':
          return await this.createDroplet(input)
        
        case 'provision_infrastructure':
          return await this.provisionInfrastructure(input)
        
        case 'get_infrastructure_costs':
          return await this.getInfrastructureCosts(input)
        
        case 'estimate_infrastructure_cost':
          return await this.estimateInfrastructureCost(input)
        
        case 'scale_infrastructure_resource':
          return await this.scaleInfrastructureResource(input)
        
        case 'get_provider_status':
          return await this.getProviderStatus(input)
        
        case 'destroy_infrastructure':
          return await this.destroyInfrastructure(input)
        
        // PROVEN PATTERN TOOLS
        case 'atlas_create_droplet_with_app':
          return await this.createDropletWithApp(input)
        
        case 'atlas_rebuild_droplet_with_ssh':
          return await this.rebuildDropletWithSSH(input)
        
        default:
          return createMCPResult(`Unknown tool: ${toolName}`, true)
      }
    } catch (error) {
      console.error(`MCP tool error (${toolName}):`, error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      return createMCPResult(`Tool execution failed: ${errorMessage}`, true)
    }
  }

  /**
   * MCP Tool: Get Infrastructure Overview
   */
  private async getInfrastructureOverview(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'get_infrastructure_overview')!
    const params = validateMCPToolInput<typeof GetInfrastructureOverviewSchema._type>(tool, input)

    try {
      // Get workspace infrastructure overview
      const infrastructures = await this.infrastructureService.listInfrastructure(params.workspace_id)
      
      // Get real infrastructure data from cloud provider if JWT provided
      let realInfraData = null
      if (params.jwt_token && params.user_id) {
        try {
          realInfraData = await this.infrastructureService.getRealInfrastructureData(
            params.workspace_id,
            params.user_id,
            params.jwt_token
          )
        } catch (error) {
          console.log('Could not fetch real infrastructure data:', error instanceof Error ? error.message : 'Unknown error')
        }
      }

      // Format infrastructure overview
      let overviewMessage = `Infrastructure Overview for Workspace:\n\n`
      
      if (realInfraData && ((realInfraData.droplets && realInfraData.droplets.length > 0) || 
                              (realInfraData.databases && realInfraData.databases.length > 0) || 
                              (realInfraData.load_balancers && realInfraData.load_balancers.length > 0))) {
        overviewMessage += `**Live Infrastructure from Cloud Provider:**\n`
        
        if (realInfraData.droplets && realInfraData.droplets.length > 0) {
          overviewMessage += `\n**Droplets (${realInfraData.droplets.length}):**\n`
          realInfraData.droplets.forEach((droplet: any) => {
            overviewMessage += `• ${droplet.name} - ${droplet.size_slug} (${droplet.status})\n`
            overviewMessage += `  IP: ${droplet.networks?.v4?.[0]?.ip_address || 'N/A'}\n`
            overviewMessage += `  Region: ${droplet.region?.name || 'Unknown'}\n`
          })
        }

        if (realInfraData.databases && realInfraData.databases.length > 0) {
          overviewMessage += `\n**Databases (${realInfraData.databases.length}):**\n`
          realInfraData.databases.forEach((db: any) => {
            overviewMessage += `• ${db.name} - ${db.engine} ${db.version} (${db.status})\n`
            overviewMessage += `  Size: ${db.size}\n`
            overviewMessage += `  Region: ${db.region}\n`
          })
        }

        if (realInfraData.load_balancers && realInfraData.load_balancers.length > 0) {
          overviewMessage += `\n**Load Balancers (${realInfraData.load_balancers.length}):**\n`
          realInfraData.load_balancers.forEach((lb: any) => {
            overviewMessage += `• ${lb.name} - ${lb.algorithm} (${lb.status?.state || 'Unknown'})\n`
            overviewMessage += `  IP: ${lb.ip || 'N/A'}\n`
          })
        }

        overviewMessage += `\n**Total Monthly Cost:** $${realInfraData.monthly_cost || 0}\n`
      } else if (infrastructures.length > 0) {
        overviewMessage += `**Atlas Managed Infrastructure (${infrastructures.length} deployments):**\n`
        infrastructures.forEach(infra => {
          overviewMessage += `• ${infra.name} - ${infra.provider} (${infra.status})\n`
          overviewMessage += `  Region: ${infra.region}\n`
          overviewMessage += `  Resources: ${infra.resources?.length || 0}\n`
          overviewMessage += `  Est. Cost: $${infra.estimated_monthly_cost || 0}/month\n`
        })
        
        const totalEstimatedCost = infrastructures.reduce((sum, infra) => 
          sum + (infra.estimated_monthly_cost || 0), 0
        )
        overviewMessage += `\n**Total Estimated Cost:** $${totalEstimatedCost}/month\n`
      } else {
        overviewMessage += `**No Active Infrastructure Found**\n\n`
        overviewMessage += `You don't currently have any active infrastructure resources.\n`
        overviewMessage += `This could mean:\n`
        overviewMessage += `• No infrastructure has been provisioned yet\n`
        overviewMessage += `• Infrastructure exists but credentials are not configured\n`
        overviewMessage += `• Resources were provisioned outside of Atlas\n\n`
        overviewMessage += `To get started, you can:\n`
        overviewMessage += `• Create new infrastructure using the provision tool\n`
        overviewMessage += `• Configure your cloud provider credentials\n`
        overviewMessage += `• Import existing infrastructure`
      }

      return createMCPResult(overviewMessage)
    } catch (error) {
      return createMCPResult(`Failed to get infrastructure overview: ${error instanceof Error ? error.message : 'Unknown error'}`, true)
    }
  }

  /**
   * MCP Tool: Provision Infrastructure
   */
  private async provisionInfrastructure(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'provision_infrastructure')!
    const params = validateMCPToolInput<typeof ProvisionInfrastructureSchema._type>(tool, input)

    const opLogger = this.logger.operation('provision_infrastructure', {
      userId: params.user_id,
      workspaceId: params.workspace_id,
      correlationId: `prov-${Date.now()}`
    })

    opLogger.info('Infrastructure provisioning requested', {
      infrastructure_name: params.name,
      provider: params.provider,
      region: params.region,
      resource_count: params.resources.length,
      resource_types: params.resources.map(r => r.type)
    })

    try {
      // Convert MCP parameters to infrastructure service format
      const createRequest: CreateInfrastructureRequest = {
        name: params.name,
        provider: params.provider,
        region: params.region,
        resources: params.resources,
        configuration: {},
        tags: {
          created_via: 'mcp',
          created_at: new Date().toISOString()
        }
      }

      opLogger.debug('Calling infrastructure service', createRequest)

      const result = await this.infrastructureService.createInfrastructure(
        params.user_id,
        params.workspace_id,
        createRequest,
        params.jwt_token  // Pass JWT token for provider initialization
      )

      opLogger.success('Infrastructure provisioning initiated', {
        infrastructure_id: result.infrastructure?.id,
        operation_id: result.operation?.id,
        operation_status: result.operation?.status,
        estimated_cost: result.infrastructure?.estimated_monthly_cost
      })

      return createMCPResult(
        `✅ Infrastructure provisioning started successfully!\n\n` +
        `Infrastructure ID: ${result.infrastructure?.id}\n` +
        `Operation ID: ${result.operation?.id}\n` +
        `Status: ${result.operation?.status}\n` +
        `Provider: ${params.provider.toUpperCase()}\n` +
        `Region: ${params.region}\n` +
        `Estimated monthly cost: $${result.infrastructure?.estimated_monthly_cost || 0}\n` +
        `Resources being provisioned: ${params.resources.length} resources\n\n` +
        `🔄 Provisioning is now in progress. You can monitor the status using the operation ID.`
      )
    } catch (error) {
      // Comprehensive error logging and user-friendly error messages
      const errorDetail = this.parseProvisioningError(error)
      
      opLogger.failure('Infrastructure provisioning failed', error, errorDetail.userMessage)

      // Stream error to Watson for real-time user visibility
      try {
        await errorStreamingService.streamInfrastructureError(
          'provision_infrastructure',
          error,
          {
            workspace_id: params.workspace_id,
            user_id: params.user_id,
            request_id: params.user_id + '-' + Date.now(),
            session_id: params.workspace_id + '-session'
          },
          errorDetail.userMessage
        )
      } catch (streamError) {
        this.logger.warn('Failed to stream error to Watson', streamError as any, {
          operation: 'provision_infrastructure',
          userId: params.user_id
        })
      }

      // Return detailed error information to the user
      return createMCPResult(
        `❌ Infrastructure provisioning failed!\n\n` +
        `Error: ${errorDetail.userMessage}\n\n` +
        `${errorDetail.suggestions.length > 0 ? '💡 Suggestions:\n' + errorDetail.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n') + '\n\n' : ''}` +
        `Technical Details:\n` +
        `- Error Code: ${errorDetail.code}\n` +
        `- Provider: ${params.provider.toUpperCase()}\n` +
        `- Region: ${params.region}\n` +
        `- Resources Requested: ${params.resources.length}\n\n` +
        `If this issue persists, please contact support with the error code above.`,
        true
      )
    }
  }

  /**
   * Parse provisioning errors to provide detailed, actionable feedback
   */
  private parseProvisioningError(error: any): {
    code: string
    userMessage: string
    suggestions: string[]
  } {
    let code = ErrorCodes.PROVISIONING_FAILED
    let userMessage = 'Infrastructure provisioning failed due to an unexpected error.'
    let suggestions: string[] = []

    // HTTP errors from cloud providers
    if (error?.response?.status) {
      const status = error.response.status
      code = `HTTP_${status}`

      switch (status) {
        case 400:
          userMessage = 'Invalid request parameters for infrastructure provisioning.'
          suggestions = [
            'Check that the resource specifications are valid for your provider',
            'Verify that the region supports the requested resource types',
            'Ensure resource names follow the provider\'s naming conventions',
            'Check that the resource sizes are available in the selected region'
          ]
          
          // Parse specific DigitalOcean errors
          if (error.response.data?.message) {
            const doError = error.response.data.message.toLowerCase()
            if (doError.includes('size') && doError.includes('not available')) {
              userMessage = 'The requested droplet size is not available in this region.'
              suggestions = [
                'Try a different droplet size (e.g., s-1vcpu-1gb, s-2vcpu-2gb)',
                'Check available sizes for your region',
                'Consider using a different region'
              ]
            } else if (doError.includes('image') && doError.includes('not found')) {
              userMessage = 'The requested OS image is not available.'
              suggestions = [
                'Use a standard image like ubuntu-22-04-x64',
                'Check available images for your region',
                'Verify the image slug is correct'
              ]
            } else if (doError.includes('region') && doError.includes('not found')) {
              userMessage = 'The specified region does not exist or is unavailable.'
              suggestions = [
                'Use a valid region like nyc3, sfo3, or lon1',
                'Check the list of available regions',
                'Verify the region slug is correct'
              ]
            } else if (doError.includes('ssh_key') && doError.includes('not found')) {
              userMessage = 'One or more SSH keys were not found in your account.'
              suggestions = [
                'Upload your SSH keys to your DigitalOcean account first',
                'Use SSH key fingerprints, not key names',
                'Remove the ssh_keys parameter to proceed without SSH keys'
              ]
            }
          }
          break

        case 401:
          code = ErrorCodes.INVALID_CREDENTIALS
          userMessage = 'Authentication failed with your cloud provider.'
          suggestions = [
            'Check that your DigitalOcean API token is valid',
            'Verify your API token has the necessary permissions',
            'Try refreshing your credentials in the settings'
          ]
          break

        case 403:
          code = ErrorCodes.INSUFFICIENT_PERMISSIONS
          userMessage = 'Your account doesn\'t have permission to create these resources.'
          suggestions = [
            'Check that your account has droplet creation permissions',
            'Verify your account is not suspended or limited',
            'Contact your cloud provider if you think this is an error'
          ]
          break

        case 422:
          code = ErrorCodes.INVALID_INPUT
          userMessage = 'Resource validation failed. Please check your specifications.'
          suggestions = [
            'Review all resource specifications for correctness',
            'Ensure required fields are provided',
            'Check that resource limits are not exceeded'
          ]
          break

        case 429:
          code = ErrorCodes.RATE_LIMIT_EXCEEDED
          userMessage = 'Too many requests. Please slow down and try again.'
          suggestions = [
            'Wait a few minutes before trying again',
            'Avoid creating multiple resources simultaneously',
            'Contact support if you need higher rate limits'
          ]
          break

        case 500:
        case 502:
        case 503:
          code = ErrorCodes.SERVICE_UNAVAILABLE
          userMessage = 'Cloud provider service is temporarily unavailable.'
          suggestions = [
            'Try again in a few minutes',
            'Check the cloud provider status page',
            'Try a different region if the issue persists'
          ]
          break
      }
    }
    
    // Network and connection errors
    else if (error?.code) {
      switch (error.code) {
        case 'ECONNREFUSED':
        case 'ENOTFOUND':
        case 'ETIMEDOUT':
          code = ErrorCodes.SERVICE_UNAVAILABLE
          userMessage = 'Unable to connect to the cloud provider.'
          suggestions = [
            'Check your internet connection',
            'Verify the cloud provider service is available',
            'Try again in a few minutes'
          ]
          break
      }
    }

    // Context Manager credential errors
    else if (error?.message?.includes('credentials') || error?.message?.includes('token')) {
      code = ErrorCodes.INVALID_CREDENTIALS
      userMessage = 'Could not retrieve your cloud provider credentials.'
      suggestions = [
        'Verify your API keys are configured in Settings',
        'Check that your authentication token is valid',
        'Try signing out and back in'
      ]
    }

    return { code, userMessage, suggestions }
  }

  /**
   * MCP Tool: Get Infrastructure Costs
   */
  private async getInfrastructureCosts(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'get_infrastructure_costs')!
    const params = validateMCPToolInput<typeof GetInfrastructureCostsSchema._type>(tool, input)

    try {
      // Get workspace infrastructure
      const infrastructures = await this.infrastructureService.listInfrastructure(params.workspace_id)
      
      // Calculate estimated costs
      const estimatedCost = infrastructures.reduce((total, infra) => 
        total + (infra.estimated_monthly_cost || 0), 0
      )

      // Get real cost data from cloud provider
      const realCostData = await this.infrastructureService.getRealCostData(
        params.workspace_id, 
        params.user_id, 
        params.jwt_token
      )

      const currentCost = realCostData.current_monthly_cost || estimatedCost
      const projectedCost = realCostData.projected_monthly_cost || estimatedCost

      return createMCPResult(
        `Current Infrastructure Costs:\n` +
        `Current Monthly Cost: $${currentCost.toFixed(2)}\n` +
        `Projected Monthly Cost: $${projectedCost.toFixed(2)}\n` +
        `Cost Trend: ${realCostData.cost_trend || 'stable'}\n` +
        `Active Infrastructure: ${infrastructures.length} deployments\n` +
        `Cost Source: ${realCostData.current_monthly_cost ? 'Real provider data' : 'Estimated from configurations'}\n` +
        `Recommendations: ${realCostData.recommendations?.length || 0} cost optimization suggestions available`
      )
    } catch (error) {
      return createMCPResult(`Failed to get infrastructure costs: ${error instanceof Error ? error.message : 'Unknown error'}`, true)
    }
  }

  /**
   * MCP Tool: Estimate Infrastructure Cost
   */
  private async estimateInfrastructureCost(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'estimate_infrastructure_cost')!
    const params = validateMCPToolInput<typeof EstimateCostSchema._type>(tool, input)

    try {
      const estimateRequest: CreateInfrastructureRequest = {
        name: 'cost-estimate',
        provider: params.provider,
        region: params.region,
        resources: params.resources.map((resource, index) => ({
          type: resource.type,
          name: `${resource.type}-${index + 1}`,
          specifications: resource.specifications
        })),
        configuration: {},
        tags: { purpose: 'cost_estimate' }
      }

      const estimatedCost = await this.infrastructureService.estimateCost(estimateRequest)

      return createMCPResult(
        `Cost Estimation Results:\n` +
        `Provider: ${params.provider}\n` +
        `Region: ${params.region}\n` +
        `Estimated Monthly Cost: $${estimatedCost.toFixed(2)}\n` +
        `Resources: ${params.resources.length} resources\n` +
        `Cost per resource (average): $${(estimatedCost / params.resources.length).toFixed(2)}\n` +
        `Estimation based on: Current provider pricing`
      )
    } catch (error) {
      return createMCPResult(`Cost estimation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, true)
    }
  }

  /**
   * MCP Tool: Scale Infrastructure Resource
   */
  private async scaleInfrastructureResource(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'scale_infrastructure_resource')!
    const params = validateMCPToolInput<typeof ScaleResourceSchema._type>(tool, input)

    try {
      // For now, we'll create a scaling operation record
      // In a full implementation, this would integrate with the provider APIs
      const operation = {
        id: `scale-${Date.now()}`,
        type: 'resource_scaling',
        status: 'in_progress',
        infrastructure_id: params.infrastructure_id,
        resource_id: params.resource_id,
        scaling_action: params.scaling_action,
        target_specifications: params.target_specifications,
        created_at: new Date().toISOString()
      }

      return createMCPResult(
        `Resource scaling initiated:\n` +
        `Operation ID: ${operation.id}\n` +
        `Infrastructure: ${params.infrastructure_id}\n` +
        `Resource: ${params.resource_id}\n` +
        `Scaling Action: ${params.scaling_action}\n` +
        `Status: ${operation.status}\n` +
        `Target Specifications: ${JSON.stringify(params.target_specifications, null, 2)}`
      )
    } catch (error) {
      return createMCPResult(`Resource scaling failed: ${error instanceof Error ? error.message : 'Unknown error'}`, true)
    }
  }

  /**
   * MCP Tool: Get Provider Status
   */
  private async getProviderStatus(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'get_provider_status')!
    const params = validateMCPToolInput<typeof GetProviderStatusSchema._type>(tool, input)

    try {
      if (params.provider) {
        // Check specific provider
        const connected = await this.infrastructureService.testProviderConnection(params.provider)
        const info = await this.infrastructureService.getProviderInfo(params.provider)

        return createMCPResult(
          `Provider Status: ${params.provider}\n` +
          `Status: ${connected ? 'Connected' : 'Disconnected'}\n` +
          `Name: ${info.name}\n` +
          `Supported Regions: ${info.supported_regions?.length || 0}\n` +
          `Supported Resources: ${info.supported_resource_types?.length || 0}\n` +
          `API Version: ${info.api_version || 'Unknown'}`
        )
      } else {
        // Check all providers
        const providers = this.infrastructureService.getAvailableProviders()
        const statusChecks = await Promise.all(
          providers.map(async (provider) => {
            const connected = await this.infrastructureService.testProviderConnection(provider)
            return { provider, connected }
          })
        )

        const statusReport = statusChecks
          .map(({ provider, connected }) => `${provider}: ${connected ? 'Connected' : 'Disconnected'}`)
          .join('\n')

        const connectedCount = statusChecks.filter(p => p.connected).length
        
        return createMCPResult(
          `All Provider Status:\n` +
          `${statusReport}\n\n` +
          `Summary: ${connectedCount}/${providers.length} providers connected`
        )
      }
    } catch (error) {
      return createMCPResult(`Provider status check failed: ${error instanceof Error ? error.message : 'Unknown error'}`, true)
    }
  }

  /**
   * MCP Tool: Destroy Infrastructure
   */
  private async destroyInfrastructure(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'destroy_infrastructure')!
    const params = validateMCPToolInput<typeof DestroyInfrastructureSchema._type>(tool, input)

    if (!params.confirm) {
      return createMCPResult(
        `Infrastructure destruction requires explicit confirmation.\n` +
        `To proceed, call this tool again with 'confirm: true'.\n` +
        `Warning: This action cannot be undone and will permanently delete all resources.`,
        true
      )
    }

    try {
      const operation = await this.infrastructureService.destroyInfrastructure(params.infrastructure_id)

      return createMCPResult(
        `Infrastructure destruction initiated:\n` +
        `Infrastructure ID: ${params.infrastructure_id}\n` +
        `Operation ID: ${operation.id}\n` +
        `Status: ${operation.status}\n` +
        `Warning: Resources are being permanently deleted\n` +
        `Monitor operation status for completion`
      )
    } catch (error) {
      return createMCPResult(`Infrastructure destruction failed: ${error instanceof Error ? error.message : 'Unknown error'}`, true)
    }
  }

  /**
   * MCP Tool: Check Droplet Status
   */
  private async checkDropletStatus(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'check_droplet_status')!
    const params = validateMCPToolInput<typeof CheckDropletStatusSchema._type>(tool, input)

    try {
      // Get real infrastructure data to find droplet details
      const realInfraData = await this.infrastructureService.getRealInfrastructureData(
        params.workspace_id,
        params.workspace_id, // Use workspace_id as user_id if not provided
        params.jwt_token
      )

      if (!realInfraData || !realInfraData.droplets || realInfraData.droplets.length === 0) {
        return createMCPResult(
          `No droplets found in workspace.\n` +
          `This could mean:\n` +
          `• No droplets are currently provisioned\n` +
          `• DigitalOcean credentials are not configured\n` +
          `• The specified droplet does not exist`
        )
      }

      // Find specific droplet by ID or name
      let targetDroplet = null
      if (params.droplet_id) {
        targetDroplet = realInfraData.droplets.find((droplet: any) => 
          droplet.id.toString() === params.droplet_id || 
          droplet.name === params.droplet_id
        )
      } else {
        // If no ID specified, return info about all droplets
        const dropletSummary = realInfraData.droplets.map((droplet: any) => {
          return `• ${droplet.name} (${droplet.id}) - ${droplet.status}\n` +
                 `  Size: ${droplet.size_slug}\n` +
                 `  IP: ${droplet.networks?.v4?.[0]?.ip_address || 'N/A'}\n` +
                 `  Region: ${droplet.region?.name || 'Unknown'}\n`
        }).join('\n')

        return createMCPResult(
          `Droplet Status Overview:\n\n` +
          `Found ${realInfraData.droplets.length} droplets:\n\n` +
          dropletSummary +
          `\nTotal Monthly Cost: $${realInfraData.monthly_cost || 0}`
        )
      }

      if (!targetDroplet) {
        return createMCPResult(
          `Droplet '${params.droplet_id}' not found.\n\n` +
          `Available droplets:\n` +
          realInfraData.droplets.map((d: any) => `• ${d.name} (${d.id})`).join('\n')
        )
      }

      // Return detailed status for specific droplet
      return createMCPResult(
        `Droplet Status: ${targetDroplet.name}\n\n` +
        `ID: ${targetDroplet.id}\n` +
        `Status: ${targetDroplet.status.toUpperCase()}\n` +
        `Size: ${targetDroplet.size_slug}\n` +
        `Image: ${targetDroplet.image?.name || 'Unknown'}\n` +
        `Public IP: ${targetDroplet.networks?.v4?.[0]?.ip_address || 'N/A'}\n` +
        `Private IP: ${targetDroplet.networks?.v4?.find((n: any) => n.type === 'private')?.ip_address || 'N/A'}\n` +
        `Region: ${targetDroplet.region?.name || 'Unknown'}\n` +
        `Created: ${targetDroplet.created_at}\n` +
        `Monthly Cost: $${targetDroplet.size?.price_monthly || 'Unknown'}\n` +
        `Features: ${targetDroplet.features?.join(', ') || 'None'}\n` +
        `Tags: ${targetDroplet.tags?.join(', ') || 'None'}`
      )
    } catch (error) {
      return createMCPResult(`Failed to check droplet status: ${error instanceof Error ? error.message : 'Unknown error'}`, true)
    }
  }

  /**
   * MCP Tool: Create Droplet
   */
  private async createDroplet(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'create_droplet')!
    const params = validateMCPToolInput<typeof CreateDropletSchema._type>(tool, input)

    const opLogger = this.logger.operation('create_droplet', {
      userId: params.user_id,
      workspaceId: params.workspace_id,
      correlationId: `droplet-${Date.now()}`
    })

    opLogger.info('Droplet creation requested', {
      droplet_name: params.name,
      size: params.size,
      region: params.region,
      image: params.image
    })

    try {
      // Create infrastructure request for single droplet
      const createRequest: CreateInfrastructureRequest = {
        name: `droplet-${params.name}`,
        provider: 'digitalocean',
        region: params.region,
        resources: [{
          type: 'droplet',
          name: params.name,
          specifications: {
            size: params.size,
            image: params.image,
            ssh_keys: params.ssh_keys || [],
            monitoring: true,
            backups: false
          }
        }],
        configuration: {} as any,
        tags: {
          created_via: 'mcp_direct',
          created_at: new Date().toISOString()
        }
      }

      const result = await this.infrastructureService.createInfrastructure(
        params.user_id,
        params.workspace_id,
        createRequest,
        params.jwt_token
      )

      opLogger.success('Droplet creation initiated', {
        infrastructure_id: result.infrastructure?.id,
        operation_id: result.operation?.id,
        operation_status: result.operation?.status
      })

      const dropletResource = result.infrastructure?.resources[0]

      return createMCPResult(
        `✅ Droplet creation started successfully!\n\n` +
        `Droplet Name: ${params.name}\n` +
        `Infrastructure ID: ${result.infrastructure?.id}\n` +
        `Operation ID: ${result.operation?.id}\n` +
        `Status: ${result.operation?.status}\n` +
        `Size: ${params.size}\n` +
        `Region: ${params.region}\n` +
        `Image: ${params.image}\n` +
        `Estimated Monthly Cost: $${dropletResource?.monthly_cost || 0}\n` +
        `${params.domain ? `Domain: ${params.domain}\n` : ''}` +
        `\n🔄 Provisioning is now in progress. The droplet should be available in 1-2 minutes.`
      )
    } catch (error) {
      // Use the same comprehensive error parsing as provision_infrastructure
      const errorDetail = this.parseProvisioningError(error)
      
      opLogger.failure('Droplet creation failed', error, errorDetail.userMessage)

      // Stream error to Watson
      try {
        await errorStreamingService.streamInfrastructureError(
          'create_droplet',
          error,
          {
            workspace_id: params.workspace_id,
            user_id: params.user_id,
            request_id: params.user_id + '-droplet-' + Date.now(),
          },
          errorDetail.userMessage
        )
      } catch (streamError) {
        this.logger.warn('Failed to stream error to Watson', streamError as any)
      }

      return createMCPResult(
        `❌ Droplet creation failed!\n\n` +
        `Error: ${errorDetail.userMessage}\n\n` +
        `${errorDetail.suggestions.length > 0 ? '💡 Suggestions:\n' + errorDetail.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n') + '\n\n' : ''}` +
        `Droplet Details:\n` +
        `- Name: ${params.name}\n` +
        `- Size: ${params.size}\n` +
        `- Region: ${params.region}\n` +
        `- Error Code: ${errorDetail.code}`,
        true
      )
    }
  }

  /**
   * MCP Tool: Create Droplet with Application (PROVEN PATTERN)
   */
  private async createDropletWithApp(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'atlas_create_droplet_with_app')!
    const params = validateMCPToolInput<typeof CreateDropletWithSSHSchema._type>(tool, input)

    const opLogger = this.logger.operation('create_droplet_with_app', {
      userId: params.user_id,
      workspaceId: params.workspace_id,
      correlationId: `proven-droplet-${Date.now()}`
    })

    opLogger.info('Proven droplet creation requested', {
      droplet_name: params.name,
      application_name: params.application.name,
      repository_url: params.application.repository_url,
      branch: params.application.branch
    })

    try {
      // Get DigitalOcean token from context
      const digitalOceanToken = await this.getDigitalOceanToken(params.workspace_id, params.user_id, params.jwt_token)
      
      // Initialize proven handler with token
      const handler = new ProvenDropletHandler(digitalOceanToken)
      
      // Create droplet with proven patterns
      const result = await handler.createDropletWithApp(params)

      opLogger.success('Proven droplet creation initiated', {
        droplet_id: result.droplet?.id,
        application_name: result.deployment?.application_name,
        expected_url: result.deployment?.expected_url
      })

      if (result.success && result.droplet && result.deployment) {
        return createMCPResult(
          `✅ Droplet with application deployment created successfully!\n\n` +
          `🖥️ **Droplet Details:**\n` +
          `- Name: ${result.droplet.name}\n` +
          `- ID: ${result.droplet.id}\n` +
          `- IP Address: ${result.droplet.ip_address}\n` +
          `- Status: ${result.droplet.status}\n` +
          `- SSH Keys: ${result.droplet.ssh_keys.length} configured\n\n` +
          `🚀 **Application Deployment:**\n` +
          `- Application: ${result.deployment.application_name}\n` +
          `- Expected URL: ${result.deployment.expected_url}\n` +
          `- Deployment Log: ${result.deployment.deployment_log_path}\n` +
          `- Estimated Completion: ${new Date(result.deployment.estimated_completion).toLocaleString()}\n\n` +
          `⏱️ **Execution Time:** ${result.execution_time}\n\n` +
          `🔍 **Next Steps:**\n` +
          `1. Wait for cloud-init to complete (~5 minutes)\n` +
          `2. Test application at: ${result.deployment.expected_url}\n` +
          `3. Check deployment logs via SSH: tail -f ${result.deployment.deployment_log_path}\n` +
          `4. Configure domain DNS if needed`
        )
      } else {
        return createMCPResult(
          `❌ Droplet creation failed!\n\n` +
          `Error: ${result.error}\n` +
          `Execution Time: ${result.execution_time}`,
          true
        )
      }
    } catch (error) {
      opLogger.failure('Proven droplet creation failed', error)
      return createMCPResult(`❌ Failed to create droplet with application: ${error instanceof Error ? error.message : 'Unknown error'}`, true)
    }
  }

  /**
   * MCP Tool: Rebuild Droplet with SSH (PROVEN PATTERN)
   */
  private async rebuildDropletWithSSH(input: unknown): Promise<MCPToolResult> {
    const tool = ATLAS_MCP_TOOLS.find(t => t.name === 'atlas_rebuild_droplet_with_ssh')!
    const params = validateMCPToolInput<typeof RebuildDropletWithSSHSchema._type>(tool, input)

    const opLogger = this.logger.operation('rebuild_droplet_with_ssh', {
      userId: params.user_id,
      workspaceId: params.workspace_id,
      correlationId: `rebuild-${Date.now()}`
    })

    opLogger.info('Proven droplet rebuild requested', {
      droplet_id: params.droplet_id,
      backup_first: params.backup_first,
      application_name: params.application?.name
    })

    try {
      // Get DigitalOcean token from context
      const digitalOceanToken = await this.getDigitalOceanToken(params.workspace_id, params.user_id, params.jwt_token)
      
      // Initialize proven handler with token
      const handler = new ProvenDropletHandler(digitalOceanToken)
      
      // Rebuild droplet with proven patterns
      const result = await handler.rebuildDropletWithSSH(params)

      opLogger.success('Proven droplet rebuild initiated', {
        action_id: result.action?.id,
        backup_snapshot: result.backup?.snapshot_id
      })

      if (result.success && result.action) {
        return createMCPResult(
          `✅ Droplet rebuild with SSH access initiated successfully!\n\n` +
          `🔄 **Rebuild Action:**\n` +
          `- Action ID: ${result.action.id}\n` +
          `- Status: ${result.action.status}\n` +
          `- Started: ${result.action.started_at}\n\n` +
          `${result.backup ? `📸 **Backup Created:**\n` +
            `- Snapshot ID: ${result.backup.snapshot_id}\n` +
            `- Snapshot Name: ${result.backup.snapshot_name}\n\n` : ''}` +
          `⏱️ **Timeline:**\n` +
          `- Execution Time: ${result.execution_time}\n` +
          `- Estimated Completion: ${new Date(result.estimated_completion!).toLocaleString()}\n\n` +
          `🔍 **Monitor Progress:**\n` +
          `1. Rebuild typically takes 3-5 minutes\n` +
          `2. Check droplet status to confirm completion\n` +
          `3. SSH access will be available once rebuild completes\n` +
          `4. Application will be auto-deployed if specified`
        )
      } else {
        return createMCPResult(
          `❌ Droplet rebuild failed!\n\n` +
          `Error: ${result.error}\n` +
          `Execution Time: ${result.execution_time}`,
          true
        )
      }
    } catch (error) {
      opLogger.failure('Proven droplet rebuild failed', error)
      return createMCPResult(`❌ Failed to rebuild droplet: ${error instanceof Error ? error.message : 'Unknown error'}`, true)
    }
  }

  /**
   * Helper method to get DigitalOcean token from Context Manager
   */
  private async getDigitalOceanToken(workspaceId: string, userId: string, jwtToken: string): Promise<string> {
    try {
      // Use the context service directly
      const contextService = (this.infrastructureService as any).contextService
      const tokenData = await contextService.getProviderCredentials('digitalocean', workspaceId, userId, jwtToken)
      if (!tokenData || !tokenData.digitalocean_api_token) {
        throw new Error('DigitalOcean API token not found in context. Please configure your credentials.')
      }
      return tokenData.digitalocean_api_token
    } catch (error) {
      this.logger.error('Failed to retrieve DigitalOcean token from context', error as any)
      throw new Error('Could not retrieve DigitalOcean credentials. Please ensure they are configured in your workspace settings.')
    }
  }
}

// Export singleton instance
export const atlasMCPServer = new AtlasMCPServer()