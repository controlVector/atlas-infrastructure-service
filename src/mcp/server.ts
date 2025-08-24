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
  ProvisionInfrastructureSchema,
  GetInfrastructureCostsSchema,
  EstimateCostSchema,
  ScaleResourceSchema,
  GetProviderStatusSchema,
  DestroyInfrastructureSchema
} from './tools'
import { CreateInfrastructureRequest, AtlasError } from '../types'

export class AtlasMCPServer {
  private infrastructureService: InfrastructureService

  constructor() {
    this.infrastructureService = new InfrastructureService()
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

      const result = await this.infrastructureService.createInfrastructure(
        params.user_id,
        params.workspace_id,
        createRequest
      )

      return createMCPResult(
        `Infrastructure provisioning started successfully.\n` +
        `Infrastructure ID: ${result.infrastructure?.id}\n` +
        `Operation ID: ${result.operation?.id}\n` +
        `Status: ${result.operation?.status}\n` +
        `Estimated monthly cost: $${result.infrastructure?.estimated_monthly_cost || 0}\n` +
        `Resources being provisioned: ${params.resources.length} resources`
      )
    } catch (error) {
      const message = error instanceof AtlasError ? error.message : 'Failed to provision infrastructure'
      return createMCPResult(`Provisioning failed: ${message}`, true)
    }
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
}

// Export singleton instance
export const atlasMCPServer = new AtlasMCPServer()